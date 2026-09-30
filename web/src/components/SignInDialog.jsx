import { useEffect, useState } from 'react';
import { api, setToken } from '../api.js';

export default function SignInDialog({ onClose, onSignedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tier, setTier] = useState('free');
  const [allowTestTiers, setAllowTestTiers] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/config').then((c) => setAllowTestTiers(c.allowTestTiers)).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim()) return setError('Enter a username.');
    if (password.length < 8) return setError('Use a password of at least 8 characters.');
    setBusy(true);
    try {
      const body = { username, password, ...(allowTestTiers && { tier }) };
      const { token, user } = await api('/session', { method: 'POST', body });
      setToken(token);
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const clearError = (set) => (e) => { set(e.target.value); setError(''); };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Sign in</h2>
        <p className="muted">New here? Pick a chat name and password to create your account.</p>
        <label>
          Username
          <input autoFocus autoComplete="username" value={username} onChange={clearError(setUsername)} maxLength={32} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={clearError(setPassword)} maxLength={200} />
        </label>
        {allowTestTiers && (
          <label>
            Test tier
            <select value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="free">Free</option>
              <option value="plus">Plus</option>
              <option value="premium">Premium</option>
            </select>
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="text-btn" onClick={onClose}>Cancel</button>
          <button className="primary-btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
      </form>
    </div>
  );
}
