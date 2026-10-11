import { useState } from 'react';
import { api } from '../api.js';

// Shown once to someone who joined through Google (MBJ-110): they never typed a username, so the site made one
// up. They pick their own here, or keep it.
export default function PickUsername({ user, onDone }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (body) => {
    setError('');
    try {
      setBusy(true);
      await api('/account/username', { method: 'POST', body });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog auth-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          save({ username: username.trim() });
        }}
      >
        <h2>Pick your username</h2>
        <p className="muted">
          This is the name everyone sees in chat and comments. It can’t be changed later, so choose one you
          like.
        </p>
        <label>
          Username
          <input
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setError('');
            }}
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9_]+"
            title="Letters, numbers, and underscores"
            placeholder={user.username}
            required
          />
        </label>
        <span className="hint">3–32 letters, numbers, or underscores.</span>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="text-btn" disabled={busy} onClick={() => save({ keep: true })}>
            Keep {user.username}
          </button>
          <button className="primary-btn" disabled={busy}>
            {busy ? 'One moment…' : 'Save username'}
          </button>
        </div>
      </form>
    </div>
  );
}
