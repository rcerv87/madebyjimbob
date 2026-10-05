import { useEffect, useRef, useState } from 'react';
import { stripeEmbed } from '../stripeEmbed.js';

// Stripe's checkout inside the page (card, saved cards, Apple Pay, Google Pay). onPaid runs once the payment goes
// through; onBack returns to the form (nothing was charged).
export default function EmbeddedPay({ publishableKey, clientSecret, onPaid, onBack }) {
  const el = useRef(null);
  const paid = useRef(onPaid);
  paid.current = onPaid;
  const [error, setError] = useState('');
  useEffect(() => {
    let remove = null;
    let gone = false;
    stripeEmbed
      .mount({ publishableKey, clientSecret, el: el.current, onComplete: () => paid.current?.() })
      .then((r) => (gone ? r() : (remove = r)))
      .catch((err) => !gone && setError(err.message));
    return () => {
      gone = true;
      remove?.();
    };
  }, [publishableKey, clientSecret]);
  return (
    <div className="embedded-pay">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div ref={el} className="embedded-pay-frame" data-testid="stripe-checkout" />
      <button type="button" className="text-btn" onClick={onBack}>
        ← Back
      </button>
    </div>
  );
}
