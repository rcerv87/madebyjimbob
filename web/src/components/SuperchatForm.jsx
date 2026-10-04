import { useState } from 'react';
import { api } from '../api.js';
import { money, goTo } from '../membership.js';

const AMOUNTS = [200, 500, 1000, 2000, 5000, 10000];

// Pay JimBob a super chat (MBJ-109): pick an amount, write a message, pay on Stripe's page; it shows in the live chat
// (or in Studio when he isn't live on the site). Signed-out viewers sign in first.
export default function SuperchatForm({ session, returnTo = '/live', onDone, initialMessage = '' }) {
  const [cents, setCents] = useState(500);
  const [custom, setCustom] = useState('');
  const [message, setMessage] = useState(initialMessage.slice(0, 200));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const amount = custom ? Math.round(Number(custom) * 100) : cents;
  const valid = Number.isFinite(amount) && amount >= 200 && amount <= 50000;

  const pay = async (e) => {
    e.preventDefault();
    if (!session.user) return session.requireSignIn();
    if (!valid) return setError('Pick an amount from $2 to $500.');
    setBusy(true);
    setError('');
    try {
      const { url } = await api('/superchats/checkout', {
        method: 'POST',
        body: { amountCents: amount, message: message.trim(), returnTo },
      });
      onDone?.();
      goTo.url(url);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="superchat-form" onSubmit={pay}>
      <div className="superchat-amounts" role="group" aria-label="Amount">
        {AMOUNTS.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={!custom && cents === c}
            onClick={() => {
              setCents(c);
              setCustom('');
            }}
          >
            {money(c)}
          </button>
        ))}
      </div>
      <label>
        Other amount ($)
        <input
          id="superchat-custom"
          type="number"
          inputMode="decimal"
          min="2"
          max="500"
          step="1"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="e.g. 15"
        />
      </label>
      <label>
        Message (optional)
        <textarea
          id="superchat-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={200}
          rows={3}
          placeholder="Say something to JimBob"
        />
        <span className="muted small">{200 - message.length} left</span>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-btn" disabled={busy || !valid}>
        {busy
          ? 'Opening checkout…'
          : session.user
            ? `Send ${valid ? money(amount) : ''} super chat`
            : 'Sign in to send'}
      </button>
      <p className="muted small">
        Paid securely through Stripe. It goes to JimBob directly, not through YouTube.
      </p>
    </form>
  );
}
