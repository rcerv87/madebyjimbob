// Real accounts (MBJ-101, ADR-006): Better Auth on our own Postgres tables. Email + password with a username
// chosen at sign-up; sessions in an httpOnly cookie (web) or a Bearer token (tests, later the phone apps).
// Account emails go through sendEmail(). Google/Apple, magic links, and passkeys come in MBJ-110.
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { username } from 'better-auth/plugins/username';
import { bearer } from 'better-auth/plugins/bearer';
import { haveIBeenPwned } from 'better-auth/plugins/haveibeenpwned';
import crypto from 'crypto';
import { promisify } from 'util';
import { pool } from './db.js';
import { sendEmail, emailEnabled } from './email.js';
import { logger } from './logger.js';
import { containsBannedWord } from './moderation.js';
import { logSecurityEvent, requestOrigin } from './security.js';
import { cancelDeletionOnSignIn } from './deletion.js';

const scrypt = promisify(crypto.scrypt);

// Admins are the people whose *verified* email is listed (a username could be claimed by anyone).
export const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

// Names nobody can sign up with, unless their email is an admin email (so JimBob can be "jimbob").
const RESERVED = new Set(
  'jimbob madebyjimbob admin administrator mod moderator mods support staff help official system root studio account api null undefined me'.split(
    ' ',
  ),
);
export const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/;

// Placeholder for POC accounts that never gave an email (see the real_auth migration).
export const NO_EMAIL_DOMAIN = '@no-email.invalid';

// POC passwords were `scrypt$salt$hash`; they keep working until the person next changes their password.
async function verifyLegacy(password, stored) {
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const actual = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const onRender = Boolean(process.env.RENDER);

// Signs session cookies. Render generates BETTER_AUTH_SECRET (render.yaml); if it's ever missing, fall back to a
// stable value derived from the database URL (secret, and the same on every restart) rather than a default.
export const usingFallbackSecret = !process.env.BETTER_AUTH_SECRET;
const authSecret =
  process.env.BETTER_AUTH_SECRET ||
  crypto
    .createHash('sha256')
    .update(`mbj-auth:${process.env.DATABASE_URL || ''}`)
    .digest('hex');
export const baseURL = (
  process.env.SITE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${process.env.PORT || 3000}`
).replace(/\/+$/, '');

const plugins = [
  username({
    minUsernameLength: 3,
    maxUsernameLength: 32,
    usernameValidator: (name) => USERNAME_RE.test(name) && !containsBannedWord(name),
    // Lower-case copy for lookups; the name as typed is what everyone sees.
    schema: { user: { fields: { username: 'username_key', displayUsername: 'username' } } },
  }),
  bearer(),
];
if (process.env.PASSWORD_LEAK_CHECK !== 'off') {
  plugins.push(
    haveIBeenPwned({
      customPasswordCompromisedMessage:
        'That password has shown up in a data breach, so it’s easy to guess. Please choose a different one.',
    }),
  );
}

export const auth = betterAuth({
  appName: 'MADEbyJIMBOB',
  baseURL,
  basePath: '/api/auth',
  secret: authSecret,
  database: pool,
  telemetry: { enabled: false },
  // Into our logger (message only: the extra arguments can hold user details). Its startup schema check
  // expects text foreign keys; ours are bigint because ids are serial, so that warning is noise.
  logger: {
    level: 'warn',
    log: (level, message, ...args) => {
      if (/has a different type in the database/.test(message)) return;
      const err = args.find((a) => a instanceof Error);
      logger[level === 'success' ? 'info' : level]({ component: 'auth', ...(err && { err }) }, message);
    },
  },
  // The site's own origin is always trusted, and on Render its onrender.com address too (tabs opened there before the
  // move to SITE_URL keep working); on a developer's machine, any localhost port (Vite, tests).
  trustedOrigins: onRender
    ? [process.env.RENDER_EXTERNAL_URL].filter(Boolean)
    : ['http://localhost:*', 'http://127.0.0.1:*'],
  advanced: {
    cookiePrefix: 'mbj',
    useSecureCookies: baseURL.startsWith('https://'),
    database: { generateId: 'serial' },
    // Set by our Express middleware from the proxy-aware req.ip (clients can't forge it).
    ipAddress: { ipAddressHeaders: ['x-mbj-client-ip'] },
  },
  user: {
    modelName: 'users',
    fields: {
      name: 'display_name',
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    additionalFields: {
      // Never settable at sign-up or by the user: tiers come from payments (MBJ-104).
      tier: { type: 'string', required: false, defaultValue: 'free', input: false },
      xp: { type: 'number', required: false, defaultValue: 0, input: false },
      // 'admin' opens Studio (npm run set-role); never settable by the user.
      role: { type: 'string', required: false, defaultValue: 'viewer', input: false },
    },
    changeEmail: { enabled: true, updateEmailWithoutVerification: true },
  },
  session: {
    modelName: 'sessions',
    fields: {
      userId: 'user_id',
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    // Stay signed in: 90 days, renewed at most once a day while the site is used.
    expiresIn: 60 * 60 * 24 * 90,
    updateAge: 60 * 60 * 24,
  },
  account: {
    modelName: 'accounts',
    fields: {
      userId: 'user_id',
      accountId: 'account_id',
      providerId: 'provider_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  verification: {
    modelName: 'verifications',
    fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    // Unverified accounts can watch and chat; paying and rewards check emailVerified (MBJ-108).
    requireEmailVerification: false,
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: async ({ user }, request) => {
      await logSecurityEvent(user.id, 'password_reset', requestOrigin(request?.headers));
    },
    resetPasswordTokenExpiresIn: 60 * 60,
    password: {
      hash: hashPassword,
      verify: ({ hash, password }) =>
        hash.startsWith('scrypt$') ? verifyLegacy(password, hash) : verifyPassword({ hash, password }),
    },
    // No userId on these emails: sign-up sends before the new user's row is committed. The log has the address.
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        template: 'reset_password',
        data: { username: user.username || user.name, url },
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        template: 'verify_email',
        data: { username: user.username || user.name, url },
      });
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const name = String(user.username || '').toLowerCase();
          if (RESERVED.has(name) && !ADMIN_EMAILS.has(String(user.email).toLowerCase())) {
            throw new APIError('BAD_REQUEST', {
              code: 'USERNAME_RESERVED',
              message: 'That username is reserved. Please pick another.',
            });
          }
          // The display name starts as the username (members can change it later, MBJ-117).
          return { data: { ...user, name: user.displayUsername || user.username || user.name } };
        },
        after: async (user, ctx) => {
          await logSecurityEvent(user.id, 'account_created', requestOrigin(ctx?.headers));
        },
      },
    },
    session: {
      create: {
        // Every new session is a sign-in, except the ones sign-up and password changes make for you.
        after: async (session, ctx) => {
          const path = ctx?.path || '';
          if (path.startsWith('/sign-up') || path === '/change-password' || path === '/reset-password')
            return;
          const origin = { ip: session.ipAddress, userAgent: session.userAgent };
          await logSecurityEvent(session.userId, 'signed_in', origin);
          // Signing in within the 30 days calls off a pending account deletion (MBJ-118).
          await cancelDeletionOnSignIn(session.userId, origin);
        },
      },
    },
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/change-password' || isAPIError(ctx.context.returned)) return;
      const userId = ctx.context.session?.user.id;
      if (userId) await logSecurityEvent(userId, 'password_changed', requestOrigin(ctx.headers));
    }),
  },
  rateLimit: {
    // Always on except in tests (AUTH_RATE_LIMIT=off); in memory, fine for one server.
    enabled: process.env.AUTH_RATE_LIMIT !== 'off',
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-in/username': { window: 60, max: 10 },
      '/sign-up/email': { window: 60 * 10, max: 5 },
      '/request-password-reset': { window: 60 * 10, max: 3 },
      '/send-verification-email': { window: 60 * 10, max: 3 },
      '/change-password': { window: 60 * 10, max: 5 },
      '/verify-password': { window: 60 * 10, max: 10 },
    },
  },
  plugins,
});

// The signed-in user for an Express request or a WebSocket upgrade, shaped for the API (or null).
export async function sessionUser(nodeHeaders) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(nodeHeaders) });
  return session ? publicUser(session.user) : null;
}

export function publicUser(u) {
  if (!u) return null;
  const email = String(u.email || '').toLowerCase();
  const hasEmail = email && !email.endsWith(NO_EMAIL_DOMAIN);
  const isAdmin = u.role === 'admin' || Boolean(u.emailVerified && hasEmail && ADMIN_EMAILS.has(email));
  return {
    id: Number(u.id),
    username: u.displayUsername || u.username,
    displayName: u.name,
    // Admins see every tier so JimBob and mods can check gated videos.
    tier: isAdmin ? 'premium' : u.tier || 'free',
    xp: u.xp ?? 0,
    isAdmin,
    email: hasEmail ? u.email : null,
    emailVerified: Boolean(u.emailVerified),
    // Ask them to confirm only when a confirmation email can actually be sent.
    confirmEmail: Boolean(hasEmail && !u.emailVerified && emailEnabled),
  };
}
