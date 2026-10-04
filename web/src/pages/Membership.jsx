import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, TIER_LABEL } from '../api.js';
import { PERKS, TIERS, money, goTo } from '../membership.js';
import useTitle from '../useTitle.js';

// The membership page (MBJ-105): what each tier includes, its price (from Stripe), and Join, which opens Stripe's
// checkout and comes back to where the viewer was (?return=, e.g. a locked video), with ?tier= picked.
export default function Membership({ session }) {
  useTitle('Membership');
  const [params] = useSearchParams();
  const returnTo = params.get('return') || '/';
  const picked = params.get('tier');
  const [data, setData] = useState(null);
  const [interval, setInterval_] = useState('month');
  const [busy, setBusy] = useState('');
  const [upgrade, setUpgrade] = useState(null); // { tier, amountDue, currency } while confirming
  const [error, setError] = useState('');

  useEffect(() => {
    api('/membership')
      .then(setData)
      .catch((e) => setError(e.message));
  }, [session.user?.id, session.user?.tier]);

  const plans = data?.plans || [];
  const hasYearly = plans.some((p) => p.interval === 'year');
  const priceOf = (tier) =>
    plans.find((p) => p.tier === tier && p.interval === interval) || plans.find((p) => p.tier === tier);
  const myTier = session.user?.tier || 'free';
  const member = data?.membership?.live;

  const join = async (tier) => {
    if (!session.user) return session.requireSignIn();
    setError('');
    setBusy(tier);
    try {
      const { url } = await api('/membership/checkout', {
        method: 'POST',
        body: { tier, interval: priceOf(tier)?.interval || interval, returnTo },
      });
      goTo.url(url);
    } catch (err) {
      setError(err.message);
      setBusy('');
    }
  };
  // A member moving up (Plus → Premium): show today's prorated charge, then switch on the card on file.
  const askUpgrade = async (tier) => {
    setError('');
    setBusy(tier);
    try {
      setUpgrade(await api(`/membership/upgrade?tier=${tier}`));
    } catch (err) {
      setError(err.message);
    }
    setBusy('');
  };
  const confirmUpgrade = async () => {
    setBusy('upgrade');
    try {
      await api('/membership/upgrade', { method: 'POST', body: { tier: upgrade.tier } });
      setUpgrade(null);
      await session.refreshUser?.();
    } catch (err) {
      setError(err.message);
      setUpgrade(null);
    }
    setBusy('');
  };
  const manage = async () => {
    setBusy('manage');
    try {
      goTo.url((await api('/membership/portal', { method: 'POST' })).url);
    } catch (err) {
      setError(err.message);
      setBusy('');
    }
  };

  return (
    <div className="membership-page">
      <h1>Become a member</h1>
      <p className="muted">
        Support JimBob directly and get the whole archive, ad-free and cancel-proof. Cancel any time.
      </p>
      {data && !data.configured && (
        <p className="notice">Memberships open soon. Here’s what they’ll include.</p>
      )}
      {hasYearly && (
        <div className="chat-view interval-pick" role="group" aria-label="Billing">
          <button type="button" aria-pressed={interval === 'month'} onClick={() => setInterval_('month')}>
            Monthly
          </button>
          <button type="button" aria-pressed={interval === 'year'} onClick={() => setInterval_('year')}>
            Yearly
          </button>
        </div>
      )}
      <div className="plan-cards">
        {['free', 'plus', 'premium'].map((tier, i) => {
          const price = priceOf(tier);
          const mine = Boolean(session.user) && myTier === tier;
          return (
            <section key={tier} className={`plan-card tier-${tier} ${picked === tier ? 'picked' : ''}`}>
              <h2>{TIER_LABEL[tier]}</h2>
              <p className="plan-price">
                {tier === 'free' ? (
                  '$0'
                ) : price ? (
                  <>
                    {money(price.amount, price.currency)}
                    <span className="muted"> / {price.interval}</span>
                  </>
                ) : (
                  <span className="muted">Price coming soon</span>
                )}
              </p>
              <ul>
                {PERKS.filter((row) => row[i + 1]).map((row) => (
                  <li key={row[0]}>
                    {row[0]}
                    {typeof row[i + 1] === 'string' && <span className="muted"> ({row[i + 1]})</span>}
                  </li>
                ))}
              </ul>
              {mine ? (
                <p className="plan-mine">Your plan</p>
              ) : tier === 'free' ? null : member && TIERS.indexOf(tier) > TIERS.indexOf(myTier) ? (
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => askUpgrade(tier)}
                  disabled={Boolean(busy)}
                >
                  {busy === tier ? 'Checking price…' : `Upgrade to ${TIER_LABEL[tier]}`}
                </button>
              ) : member ? (
                <button type="button" className="text-btn" onClick={manage} disabled={busy === 'manage'}>
                  Switch in Manage billing
                </button>
              ) : (
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => join(tier)}
                  disabled={!data?.configured || !price || Boolean(busy)}
                >
                  {busy === tier
                    ? 'Opening checkout…'
                    : session.user
                      ? `Join ${TIER_LABEL[tier]}`
                      : 'Sign in to join'}
                </button>
              )}
            </section>
          );
        })}
      </div>
      {upgrade && (
        <div className="dialog-backdrop" onClick={() => setUpgrade(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Upgrade to ${TIER_LABEL[upgrade.tier]}`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Upgrade to {TIER_LABEL[upgrade.tier]}</h2>
            <p>
              You’ll pay <strong>{money(upgrade.amountDue, upgrade.currency)}</strong> today (the difference
              for the rest of this billing period), then the {TIER_LABEL[upgrade.tier]} price at your next
              renewal. It uses the card on file and starts right away.
            </p>
            <div className="dialog-actions">
              <button type="button" className="text-btn" onClick={() => setUpgrade(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={confirmUpgrade}
                disabled={busy === 'upgrade'}
              >
                {busy === 'upgrade'
                  ? 'Upgrading…'
                  : `Upgrade for ${money(upgrade.amountDue, upgrade.currency)}`}
              </button>
            </div>
          </div>
        </div>
      )}
      {member && (
        <p>
          <button type="button" className="text-btn" onClick={manage} disabled={busy === 'manage'}>
            Manage billing
          </button>{' '}
          <span className="muted small">Change card, switch plan, cancel, or see receipts.</span>
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="muted small">
        Payments are handled by Stripe; your card details never touch this site.{' '}
        {returnTo !== '/' && <Link to={returnTo}>Back to where you were</Link>}
      </p>
    </div>
  );
}

// After Stripe's checkout: the membership switches on when Stripe tells the site (usually seconds), then back.
export function MembershipWelcome({ session }) {
  useTitle('Welcome');
  const [params] = useSearchParams();
  const returnTo = params.get('return') || '/';
  const [waited, setWaited] = useState(0);
  const tier = session.user?.tier || 'free';
  const on = tier !== 'free';

  useEffect(() => {
    if (on || waited >= 30) return undefined;
    const t = setTimeout(() => {
      session.refreshUser?.();
      setWaited((w) => w + 2);
    }, 2000);
    return () => clearTimeout(t);
  }, [on, waited, session]);

  return (
    <div className="membership-page page-msg">
      {on ? (
        <>
          <h1>Welcome to {TIER_LABEL[tier]}!</h1>
          <p>Thanks for supporting JimBob. Everything in your plan is open now.</p>
        </>
      ) : (
        <>
          <h1>Thanks! Setting up your membership…</h1>
          <p className="muted">
            {waited >= 30
              ? 'Your payment went through; your membership can take a minute to show. Refresh in a moment.'
              : 'This takes a few seconds.'}
          </p>
        </>
      )}
      <p>
        <Link className="primary-btn" to={returnTo}>
          {returnTo === '/' ? 'Go to the videos' : 'Back to where you were'}
        </Link>
      </p>
    </div>
  );
}
