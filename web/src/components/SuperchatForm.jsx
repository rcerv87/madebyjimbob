import { useState } from 'react';
import { api } from '../api.js';
import { money, goTo } from '../membership.js';
import EmbeddedPay from './EmbeddedPay.jsx';

const AMOUNTS = [200, 500, 1000, 2000, 5000, 10000];
// Where the message waits while the viewer is on Stripe's own page (only when the checkout can't open in the page),
// so it's back in the chat box if they cancel.
export const DRAFT_KEY = 'mbj.superchatDraft';

// Pay JimBob a super chat (MBJ-109): pick an amount, write a message, pay. With Stripe's publishable key the checkout
// opens right here (saved cards, Apple Pay, Google Pay), so a live stream keeps playing; onPaid runs when it's paid.
// Without it, Stripe's own page, then back. Signed-out viewers sign in first.
export default function SuperchatForm({
  session,
  returnTo = '/live',
  onDone,
  onPaid,
  onDraft,
  initialMessage = '',
  publishableKey = null,
}) {
  const [cents, setCents] = useState(500);
  const [custom, setCustom] = useState('');
  const [message, setMessage] = useState(initialMessage.slice(0, 200));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clientSecret, setClientSecret] = useState(null);
  const [paid, setPaid] = useState(false);
  const amount = custom ? Math.round(Number(custom) * 100) : cents;
  const valid = Number.isFinite(amount) && amount >= 200 && amount <= 50000;

  const write = (text) => {
    setMessage(text);
    onDraft?.(text);
  };

  const pay = async (e) => {
    e.preventDefault();
    if (!session.user) return session.requireSignIn();
    if (!valid) return setError('Pick an amount from $2 to $500.');
    setBusy(true);
    setError('');
    try {
      const r = await api('/superchats/checkout', {
        method: 'POST',
        body: {
          amountCents: amount,
          message: message.trim(),
          returnTo,
          ...(publishableKey && { embedded: true }),
        },
      });
      if (r.clientSecret) {
        setClientSecret(r.clientSecret);
        setBusy(false);
        return;
      }
      try {
        sessionStorage.setItem(DRAFT_KEY, message);
      } catch {
        // Private mode: the draft just isn't kept.
      }
      onDone?.();
      goTo.url(r.url);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (paid)
    return (
      <div className="notice" role="status">
        <p>
          <strong>Thanks! Your {money(amount)} super chat is on its way to JimBob.</strong>
        </p>
        <button type="button" className="text-btn" onClick={() => (setPaid(false), write(''))}>
          Send another
        </button>
      </div>
    );

  if (clientSecret)
    return (
      <EmbeddedPay
        publishableKey={publishableKey}
        clientSecret={clientSecret}
        onPaid={() => {
          setClientSecret(null);
          onDraft?.('');
          if (onPaid) onPaid({ amount, message });
          else setPaid(true);
        }}
        onBack={() => setClientSecret(null)}
      />
    );

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
          onChange={(e) => write(e.target.value)}
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
