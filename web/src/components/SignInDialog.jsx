import { useState } from 'react';
import { api, setToken } from '../api.js';

export default function SignInDialog({ onClose, onSignedIn }) {
  const [username, setUsername] = useState('');
  const [tier, setTier] = useState('free');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim()) return setError('Enter a username.');
    setBusy(true);
    try {
      const { token, user } = await api('/session', { method: 'POST', body: { username, tier } });
      setToken(token);
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Sign in</h2>
        <p className="muted">Pick a chat name. The tier picker is for testing member access.</p>
        <label>
          Username
          <input autoFocus value={username} onChange={(e) => { setUsername(e.target.value); setError(''); }} maxLength={32} />
        </label>
        <label>
          Test tier
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="free">Free</option>
            <option value="plus">Plus</option>
            <option value="premium">Premium</option>
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="text-btn" onClick={onClose}>Cancel</button>
          <button className="primary-btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
      </form>
    </div>
  );
}
