import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, timeAgo, TIER_LABEL } from '../api.js';
import { PushPrompt } from '../notifications.jsx';
import { usePush } from '../push.js';
import useTitle from '../useTitle.js';

// Account settings (MBJ-106): profile, sign-in and security, notifications, membership, privacy.
export default function Account({ session, onUserChanged }) {
  useTitle('Account settings');
  const [params, setParams] = useSearchParams();
  const user = session.user;
  const emailResult = params.get('email');

  if (!user) {
    return (
      <div className="narrow-page">
        <h1>Account settings</h1>
        <p>Sign in to manage your account.</p>
        <button className="primary-btn" onClick={() => session.requireSignIn()}>
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="account-page">
      <h1>Account settings</h1>
      {emailResult && <EmailResult result={emailResult} onClose={() => setParams({}, { replace: true })} />}
      <ProfileSection user={user} />
      <SecuritySection user={user} onUserChanged={onUserChanged} />
      <NotificationsSection />
      <MembershipSection user={user} />
      <section className="panel settings-section" id="privacy">
        <h2>Privacy and data</h2>
        <p className="muted">
          Coming soon: download a copy of everything you’ve posted, or delete your account.
        </p>
      </section>
    </div>
  );
}

const EMAIL_RESULTS = {
  changed: ['ok', 'Your email is changed. We told your old address, in case it wasn’t you.'],
  expired: ['error', 'That link has expired or was already used. Change your email again to get a new one.'],
  taken: ['error', 'That email was taken by another account in the meantime. Try a different one.'],
};

function EmailResult({ result, onClose }) {
  const [kind, text] = EMAIL_RESULTS[result] || [];
  if (!text) return null;
  return (
    <div className={`account-notice ${kind === 'ok' ? 'ok' : ''}`} role="status">
      <span>{text}</span>
      <button className="text-btn" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

function ProfileSection({ user }) {
  return (
    <section className="panel settings-section" id="profile">
      <h2>Profile</h2>
      <div className="profile-row">
        <span className="avatar big" aria-hidden="true">
          {user.username[0].toUpperCase()}
        </span>
        <div>
          <p className="profile-name">{user.displayName || user.username}</p>
          <p className="muted small">@{user.username}</p>
        </div>
      </div>
      <p className="muted small">Profile photos, a bio, and a public profile page are coming soon.</p>
    </section>
  );
}

function SecuritySection({ user, onUserChanged }) {
  return (
    <section className="panel settings-section" id="security">
      <h2>Sign-in and security</h2>
      <EmailForm user={user} onUserChanged={onUserChanged} />
      <PasswordForm />
      <Devices />
      <Activity />
    </section>
  );
}

function EmailForm({ user, onUserChanged }) {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);

  const resend = async () => {
    setError('');
    try {
      await api('/auth/send-verification-email', {
        method: 'POST',
        body: { email: user.email, callbackURL: '/account?email=changed' },
      });
      setSentTo(user.email);
    } catch (err) {
      setError(err.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api('/account/email', { method: 'POST', body: { newEmail, password } });
      setSentTo(r.sentTo);
      setOpen(false);
      setPassword('');
      onUserChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setting">
      <div className="setting-head">
        <div>
          <h3>Email</h3>
          <p>
            {user.email || <span className="muted">No email yet</span>}{' '}
            {user.email &&
              (user.emailVerified ? (
                <span className="badge ok">Confirmed</span>
              ) : (
                <span className="badge">Not confirmed</span>
              ))}
          </p>
        </div>
        {!open && (
          <button className="text-btn" onClick={() => setOpen(true)}>
            {user.email ? 'Change' : 'Add'}
          </button>
        )}
      </div>
      {user.email && !user.emailVerified && user.confirmEmail && !sentTo && (
        <button className="text-btn small" onClick={resend}>
          Send the confirmation link again
        </button>
      )}
      {sentTo && (
        <p className="small" role="status">
          We sent a link to <strong>{sentTo}</strong>. Your email changes when you tap it (the link works for
          24 hours). If that address already has an account, no email is sent.
        </p>
      )}
      {open && (
        <form className="setting-form" onSubmit={submit}>
          <label>
            New email
            <input
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            Your password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <div className="form-actions">
            <button className="primary-btn" disabled={busy}>
              {busy ? 'Sending…' : 'Send confirmation link'}
            </button>
            <button type="button" className="text-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function PasswordForm() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next !== confirm) return setError('The two new passwords don’t match.');
    setBusy(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next, revokeOtherSessions: true },
      });
      setDone(true);
      setOpen(false);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setting">
      <div className="setting-head">
        <div>
          <h3>Password</h3>
          {done && (
            <p className="small" role="status">
              Password changed. Your other devices were signed out.
            </p>
          )}
        </div>
        {!open && (
          <button className="text-btn" onClick={() => setOpen(true)}>
            Change
          </button>
        )}
      </div>
      {open && (
        <form className="setting-form" onSubmit={submit}>
          <label>
            Current password
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              minLength={10}
              maxLength={128}
              required
              aria-describedby="new-password-hint"
            />
          </label>
          <span className="hint" id="new-password-hint">
            At least 10 characters. Changing it signs out your other devices.
          </span>
          <label>
            Type the new one again
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </label>
          <div className="form-actions">
            <button className="primary-btn" disabled={busy}>
              {busy ? 'Saving…' : 'Change password'}
            </button>
            <button type="button" className="text-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// "Chrome on Windows" from a user agent; good enough to recognise your own devices.
export function describeDevice(ua) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung Internet'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'A browser';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  return os ? `${browser} on ${os}` : browser;
}

function Devices() {
  const [sessions, setSessions] = useState(null);
  const [current, setCurrent] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([api('/auth/list-sessions'), api('/auth/get-session')])
      .then(([list, mine]) => {
        setSessions(list);
        setCurrent(mine?.session?.token || null);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const signOut = async (token) => {
    setError('');
    try {
      await api('/auth/revoke-session', { method: 'POST', body: { token } });
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const signOutOthers = async () => {
    setError('');
    try {
      await api('/auth/revoke-other-sessions', { method: 'POST' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const others = (sessions || []).filter((s) => s.token !== current);
  return (
    <div className="setting">
      <div className="setting-head">
        <h3>Signed-in devices</h3>
        {others.length > 0 && (
          <button className="text-btn" onClick={signOutOthers}>
            Sign out everywhere else
          </button>
        )}
      </div>
      {!sessions && !error && <p className="muted small">Loading…</p>}
      <ul className="device-list">
        {(sessions || [])
          .slice()
          .sort((a, b) => (a.token === current ? -1 : b.token === current ? 1 : 0))
          .map((s) => (
            <li key={s.id}>
              <div>
                <span>{describeDevice(s.userAgent)}</span>
                {s.token === current && <span className="badge ok">This device</span>}
                <span className="muted small">Signed in {timeAgo(s.createdAt).toLowerCase()}</span>
              </div>
              {s.token !== current && (
                <button className="text-btn" onClick={() => signOut(s.token)}>
                  Sign out
                </button>
              )}
            </li>
          ))}
      </ul>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

const EVENT_LABEL = {
  account_created: 'Account created',
  signed_in: 'Signed in',
  password_changed: 'Password changed',
  password_reset: 'Password reset by email',
  email_change_requested: 'Asked to change email',
  email_changed: 'Email changed',
  email_change_undone: 'Email change undone',
};

function Activity() {
  const [events, setEvents] = useState(null);
  useEffect(() => {
    api('/account/security')
      .then((d) => setEvents(d.events))
      .catch(() => setEvents([]));
  }, []);
  return (
    <div className="setting">
      <h3>Recent activity</h3>
      <p className="muted small">Something here you didn’t do? Change your password.</p>
      <ul className="activity-list">
        {(events || []).map((e) => (
          <li key={e.id}>
            <span>{EVENT_LABEL[e.type] || e.type}</span>
            <span className="muted small">
              {[e.detail, e.userAgent && describeDevice(e.userAgent), timeAgo(e.createdAt)]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TYPES = [
  ['mention', 'Someone mentions you (@name)'],
  ['reply', 'Someone replies to you'],
];

function NotificationsSection() {
  const [prefs, setPrefs] = useState(null);
  const [error, setError] = useState('');
  const push = usePush();

  useEffect(() => {
    api('/account/notifications')
      .then((d) => setPrefs(d.prefs))
      .catch((e) => setError(e.message));
  }, []);

  const toggle = async (type, channel) => {
    const value = !prefs[type][channel];
    setPrefs((p) => ({ ...p, [type]: { ...p[type], [channel]: value } }));
    try {
      const d = await api('/account/notifications', {
        method: 'PUT',
        body: { prefs: { [type]: { [channel]: value } } },
      });
      setPrefs(d.prefs);
      setError('');
    } catch (err) {
      setError(`Couldn’t save: ${err.message}`);
      setPrefs((p) => ({ ...p, [type]: { ...p[type], [channel]: !value } }));
    }
  };

  return (
    <section className="panel settings-section" id="notifications">
      <h2>Notifications</h2>
      {prefs && (
        <div className="table-wrap">
          <table className="prefs-table">
            <thead>
              <tr>
                <th>When</th>
                <th>In the bell</th>
                <th>Push</th>
              </tr>
            </thead>
            <tbody>
              {TYPES.map(([type, label]) => (
                <tr key={type}>
                  <td>{label}</td>
                  {['site', 'push'].map((channel) => (
                    <td key={channel}>
                      <input
                        type="checkbox"
                        checked={prefs[type][channel]}
                        onChange={() => toggle(type, channel)}
                        aria-label={`${label}: ${channel === 'site' ? 'in the bell' : 'push'}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Push reaches the devices where you turned it on. We don’t email notifications.
      </p>
      <PushPrompt push={push} />
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

const PERKS = [
  ['Free videos', true, true, true],
  ['The full video library', false, true, true],
  ['Premium-only streams and early access', false, false, true],
  ['Post in chat', 'Slow mode', true, true],
  ['Listen only and background audio', false, true, true],
  ['Member podcast feed', false, true, true],
  ['Chat badge', false, 'Plus', 'Premium'],
  ['Call in to live shows', false, false, true],
];

function MembershipSection({ user }) {
  const mark = (v) => (v === true ? '✓' : v || '—');
  return (
    <section className="panel settings-section" id="membership">
      <h2>Membership</h2>
      <p>
        You’re on <strong>{TIER_LABEL[user.tier]}</strong>.{' '}
        {user.tier === 'free' && 'Paid memberships open soon. Here’s what they’ll include:'}
      </p>
      <div className="table-wrap">
        <table className="perks-table">
          <thead>
            <tr>
              <th />
              <th>Free</th>
              <th>Plus</th>
              <th>Premium</th>
            </tr>
          </thead>
          <tbody>
            {PERKS.map(([perk, ...tiers]) => (
              <tr key={perk}>
                <td>{perk}</td>
                {tiers.map((v, i) => (
                  <td key={i}>{mark(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
