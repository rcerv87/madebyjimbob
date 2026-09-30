import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import useTitle from '../useTitle.js';

// Where the reset link lands (Better Auth adds ?token=, or ?error=INVALID_TOKEN for a used or old link).
export default function ResetPassword({ session }) {
  useTitle('Reset password');
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) return setError('The two passwords don’t match.');
    setBusy(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { newPassword: password, token } });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!token || params.get('error')) {
    return (
      <div className="narrow-page">
        <h1>Reset password</h1>
        <p className="error">That link has expired or was already used.</p>
        <button className="primary-btn" onClick={() => session.requireSignIn('forgot')}>
          Send a new link
        </button>
      </div>
    );
  }
  if (done) {
    return (
      <div className="narrow-page">
        <h1>Password changed</h1>
        <p>You’re signed out on your other devices. Sign in with your new password.</p>
        <button className="primary-btn" onClick={() => session.requireSignIn()}>
          Sign in
        </button>
      </div>
    );
  }
  return (
    <form className="narrow-page" onSubmit={submit}>
      <h1>Choose a new password</h1>
      <label>
        New password
        <input
          aria-describedby="hint-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError('');
          }}
          minLength={10}
          maxLength={128}
          required
          autoFocus
        />
      </label>
      <span className="hint" id="hint-password">
        At least 10 characters.
      </span>
      <label>
        Type it again
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setError('');
          }}
          required
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-btn" disabled={busy}>
        {busy ? 'Saving…' : 'Save new password'}
      </button>
    </form>
  );
}
