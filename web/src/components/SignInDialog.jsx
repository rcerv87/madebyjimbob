import { useState } from 'react';
import { api } from '../api.js';

const TITLES = { signin: 'Sign in', signup: 'Create your account', forgot: 'Reset your password' };

// Sign in (email or username), create an account, or ask for a password reset link (MBJ-101, 108, 113).
export default function SignInDialog({ onClose, onSignedIn, initialMode = 'signin' }) {
  const [mode, setMode] = useState(initialMode);
  const [login, setLogin] = useState(''); // email or username, for sign-in
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [oldEnough, setOldEnough] = useState(false);
  const [error, setError] = useState('');
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

  const field = (set) => (e) => {
    set(e.target.value);
    setError('');
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog auth-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{TITLES[mode]}</h2>

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
