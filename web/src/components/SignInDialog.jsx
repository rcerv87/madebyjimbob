import { useEffect, useState } from 'react';
import { api } from '../api.js';

const TITLES = { signin: 'Sign in', signup: 'Create your account', forgot: 'Reset your password' };

// Sign in (email or username), create an account, or ask for a password reset link (MBJ-101, 108, 113).
// Why Google sent someone back without signing them in, in words (the codes come from the sign-in library).
export const GOOGLE_ERRORS = {
  account_not_linked:
    'There’s already an account with that Google email, and its email isn’t confirmed yet. Sign in with your password, confirm your email from Account settings, and Google will work from then on.',
  access_denied: 'Google sign-in was cancelled.',
  ACCOUNT_BANNED: 'This account has been banned. If you think that’s a mistake, contact JimBob’s team.',
};
export const googleError = (code) =>
  GOOGLE_ERRORS[code] || 'Google sign-in didn’t go through. Please try again, or use your password.';

export default function SignInDialog({ onClose, onSignedIn, initialMode = 'signin', initialError = '' }) {
  const [mode, setMode] = useState(initialMode);
  const [google, setGoogle] = useState(false);
  useEffect(() => {
    api('/sign-in-options')
      .then((o) => setGoogle(Boolean(o.google)))
      .catch(() => {});
  }, []);
  const [login, setLogin] = useState(''); // email or username, for sign-in
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [oldEnough, setOldEnough] = useState(false);
  const [error, setError] = useState(initialError);
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);

  const switchTo = (m) => {
    setMode(m);
    setError('');
    setSentTo('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      setBusy(true);
      if (mode === 'forgot') {
        await api('/auth/request-password-reset', {
          method: 'POST',
          body: { email: email.trim(), redirectTo: '/reset-password' },
        });
        setSentTo(email.trim());
        return;
      }
      if (mode === 'signup') {
        if (!oldEnough) throw new Error('You need to be 13 or older to create an account.');
        await api('/auth/sign-up/email', {
          method: 'POST',
          body: {
            email: email.trim(),
            username: username.trim(),
            name: username.trim(),
            password,
            callbackURL: '/?verified=1',
          },
        });
      } else {
        const id = login.trim();
        if (id.includes('@')) {
          await api('/auth/sign-in/email', { method: 'POST', body: { email: id, password } });
        } else {
          await api('/auth/sign-in/username', { method: 'POST', body: { username: id, password } });
        }
      }
      const { user } = await api('/me');
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Off to Google and back to this page; a problem comes back as ?auth=google&error=<code> (see App.jsx).
  const withGoogle = async () => {
    setError('');
    try {
      setBusy(true);
      const here = `${window.location.pathname}${window.location.search}`;
      const { url } = await api('/auth/sign-in/social', {
        method: 'POST',
        body: { provider: 'google', callbackURL: here, errorCallbackURL: '/?auth=google' },
      });
      window.location.assign(url);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const field = (set) => (e) => {
    set(e.target.value);
    setError('');
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog auth-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{TITLES[mode]}</h2>

        {google && mode !== 'forgot' && (
          <>
            <button type="button" className="google-btn" onClick={withGoogle} disabled={busy}>
              <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
              </svg>
              Continue with Google
            </button>
            {mode === 'signup' && (
              <p className="hint">By continuing with Google you confirm you’re 13 or older.</p>
            )}
            <div className="auth-or" role="separator">
              or
            </div>
          </>
        )}

        {mode === 'signin' && (
          <>
            <label>
              Email or username
              <input
                aria-describedby="hint-username"
                autoFocus
                autoComplete="username"
                value={login}
                onChange={field(setLogin)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={field(setPassword)}
                required
              />
            </label>
            <button type="button" className="text-btn small forgot-link" onClick={() => switchTo('forgot')}>
              Forgot password?
            </button>
          </>
        )}

        {mode === 'signup' && (
          <>
            <label>
              Email
              <input
                autoFocus
                type="email"
                autoComplete="email"
                value={email}
                onChange={field(setEmail)}
                required
              />
            </label>
            <label>
              Username
              <input
                autoComplete="username"
                value={username}
                onChange={field(setUsername)}
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9_]+"
                title="Letters, numbers, and underscores"
                required
              />
            </label>
            <span className="hint" id="hint-username">
              Shown in chat and comments. 3–32 letters, numbers, or underscores.
            </span>
            <label>
              Password
              <input
                aria-describedby="hint-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={field(setPassword)}
                minLength={10}
                maxLength={128}
                required
              />
            </label>
            <span className="hint" id="hint-password">
              At least 10 characters.
            </span>
            <label className="check">
              <input type="checkbox" checked={oldEnough} onChange={(e) => setOldEnough(e.target.checked)} />
              I’m 13 or older
            </label>
          </>
        )}

        {mode === 'forgot' &&
          (sentTo ? (
            <p>
              If there’s an account for <strong>{sentTo}</strong>, we’ve sent it a link to choose a new
              password. The link works for 1 hour. Check your spam folder if it doesn’t arrive.
            </p>
          ) : (
            <>
              <p className="muted">
                Enter your account’s email and we’ll send you a link to choose a new password.
              </p>
              <label>
                Email
                <input
                  autoFocus
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={field(setEmail)}
                  required
                />
              </label>
            </>
          ))}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="text-btn" onClick={onClose}>
            {sentTo ? 'Close' : 'Cancel'}
          </button>
          {!sentTo && (
            <button className="primary-btn" disabled={busy}>
              {busy
                ? 'One moment…'
                : { signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link' }[mode]}
            </button>
          )}
        </div>

        <p className="auth-switch small">
          {mode === 'signin' ? (
            <>
              New here?{' '}
              <button type="button" className="text-btn" onClick={() => switchTo('signup')}>
                Create an account
              </button>
            </>
          ) : (
            <>
              {mode === 'signup' ? 'Already have an account?' : 'Remembered it?'}{' '}
              <button type="button" className="text-btn" onClick={() => switchTo('signin')}>
                Sign in
              </button>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
