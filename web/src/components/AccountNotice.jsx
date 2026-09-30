import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

const DISMISSED = 'mbjb_email_notice_dismissed';

// One line under the top bar about the account's email: thanks after confirming (?verified=1), a nudge to
// confirm with a resend button, or, for accounts from before real sign-up, a box to add an email.
export default function AccountNotice({ user, onUserChanged }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [verified, setVerified] = useState(false);
  const [undo, setUndo] = useState(null); // 'restored' | 'undo-expired', from the "This wasn't me" link
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISSED) === '1';
    } catch {
      return false;
    }
  });
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // The verification link signs you in and lands on /?verified=1; the undo link lands on /?email=….
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const email = location.pathname === '/account' ? null : params.get('email');
    if (params.get('verified') !== '1' && email !== 'restored' && email !== 'undo-expired') return;
    if (email) {
      setUndo(email);
      onUserChanged(null); // undo signs out every device, this one too
      params.delete('email');
    } else {
      setVerified(true);
      onUserChanged();
    }
    params.delete('verified');
    const rest = params.toString();
    navigate({ pathname: location.pathname, search: rest ? `?${rest}` : '' }, { replace: true });
  }, [location.search, location.pathname, navigate, onUserChanged]);

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISSED, '1');
    } catch {
      /* private mode: hidden until reload */
    }
  };

  const resend = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/auth/send-verification-email', {
        method: 'POST',
        body: { email: user.email, callbackURL: '/?verified=1' },
      });
      setNote(`Sent. Check ${user.email} (and the spam folder).`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const addEmail = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/change-email', {
        method: 'POST',
        body: { newEmail: email.trim(), callbackURL: '/?verified=1' },
      });
      const { user: updated } = await api('/me');
      if (!updated?.email) {
        setError(
          'That email is already used by another account. Sign in to that one, or use a different email.',
        );
      } else {
        onUserChanged(updated);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (undo) {
    return (
      <div className={`account-notice ${undo === 'restored' ? 'ok' : ''}`} role="status">
        <span>
          {undo === 'restored'
            ? 'Your email was changed back. We signed you out everywhere and emailed you a link to choose a new password.'
            : 'That link has expired or was already used.'}
        </span>
        <button className="text-btn" onClick={() => setUndo(null)}>
          Close
        </button>
      </div>
    );
  }
  if (verified) {
    return (
      <div className="account-notice ok" role="status">
        <span>Thanks! Your email is confirmed.</span>
        <button className="text-btn" onClick={() => setVerified(false)}>
          Close
        </button>
      </div>
    );
  }
  if (!user || user.emailVerified || dismissed) return null;
  if (user.email && !user.confirmEmail) return null; // email is off on the server

  if (!user.email) {
    return (
      <form className="account-notice" onSubmit={addEmail}>
        <span>Add an email so you can reset your password and keep your account.</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          aria-label="Your email"
          required
        />
        <button className="primary-btn" disabled={busy}>
          Add email
        </button>
        <button type="button" className="text-btn" onClick={dismiss}>
          Later
        </button>
        {error && <span className="error">{error}</span>}
      </form>
    );
  }

  return (
    <div className="account-notice" role="status">
      <span>
        {note || (
          <>
            Confirm your email: we sent a link to <strong>{user.email}</strong>.
          </>
        )}
      </span>
      {!note && (
        <button className="text-btn" onClick={resend} disabled={busy}>
          Send it again
        </button>
      )}
      <button className="text-btn" onClick={dismiss}>
        Later
      </button>
      {error && <span className="error">{error}</span>}
    </div>
  );
}
