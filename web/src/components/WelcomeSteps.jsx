import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { usePush } from '../push.js';

const SKIPPED_KEY = 'mbjb_welcome_skipped';
const readSkipped = () => {
  try {
    return JSON.parse(localStorage.getItem(SKIPPED_KEY) || '[]');
  } catch {
    return [];
  }
};
const saveSkipped = (list) => {
  try {
    localStorage.setItem(SKIPPED_KEY, JSON.stringify(list));
  } catch {
    // Private browsing: skipping just isn't remembered.
  }
};

// The welcome steps and what's left of them (MBJ-115): confirm your email, turn on notifications on this device,
// link your YouTube name, and look at membership. Each is done, skipped, or still to do. Nothing is required.
export function useWelcome(user) {
  const [info, setInfo] = useState(null);
  const [skipped, setSkipped] = useState(readSkipped);
  const [note, setNote] = useState('');
  const push = usePush();

  const load = useCallback(
    () =>
      api('/account/welcome')
        .then(setInfo)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const skip = (id) => {
    const next = [...new Set([...skipped, id])];
    setSkipped(next);
    saveSkipped(next);
  };
  const resend = async () => {
    try {
      await api('/auth/send-verification-email', {
        method: 'POST',
        body: { email: user.email, callbackURL: '/?verified=1' },
      });
      setNote(`Sent. Check ${user.email} (and the spam folder).`);
    } catch (err) {
      setNote(err.message);
    }
  };

  if (!user || !info) return { ready: false, steps: [], left: 0 };
  // Push only counts as a step where this browser can do it.
  const pushPossible = ['on', 'off', 'needs-install'].includes(push.state);
  const steps = [
    {
      id: 'email',
      title: user.email ? 'Confirm your email' : 'Add your email',
      why: 'So you can reset your password, and so memberships and rewards work.',
      done: info.emailConfirmed,
      action: user.email ? (
        <button type="button" className="text-btn" onClick={resend}>
          Send the link again
        </button>
      ) : (
        <Link to="/account#profile">Add it in Account settings</Link>
      ),
    },
    pushPossible && {
      id: 'push',
      title: 'Turn on notifications on this device',
      why: 'Get a ping when someone replies to you or mentions you.',
      done: push.state === 'on' || info.pushOn,
      action:
        push.state === 'needs-install' ? (
          <span className="muted small">
            On iPhone: add the site to your Home Screen first, then open it from there.
          </span>
        ) : (
          <button type="button" className="text-btn" onClick={push.enable} disabled={push.busy}>
            Turn on
          </button>
        ),
    },
    {
      id: 'youtube',
      title: 'Link your YouTube name',
      why: 'Your old chat messages and comments from JimBob’s streams show under your name here.',
      done: info.youtubeLinked,
      action: <Link to="/account#linked">Link it</Link>,
    },
    {
      id: 'membership',
      title: 'See membership options',
      why: 'Plus and Premium open the full library and member streams, and support JimBob directly.',
      done: info.member,
      action: (
        <Link to="/membership" onClick={() => skip('membership')}>
          Have a look
        </Link>
      ),
    },
  ]
    .filter(Boolean)
    .map((s) => ({ ...s, skipped: !s.done && skipped.includes(s.id) }));

  return {
    ready: true,
    steps,
    left: steps.filter((s) => !s.done && !s.skipped).length,
    dismissed: info.dismissed,
    note: note || push.error,
    skip,
    dismiss: () => api('/account/welcome/dismiss', { method: 'POST' }).then(load),
  };
}

export function WelcomeList({ welcome, onNavigate }) {
  return (
    <>
      <ol className="welcome-steps">
        {welcome.steps.map((s) => (
          <li key={s.id} className={s.done ? 'done' : s.skipped ? 'skipped' : ''}>
            <span className="welcome-mark" aria-hidden="true">
              {s.done ? '✓' : ''}
            </span>
            <div>
              <strong>{s.title}</strong>
              {s.done && <span className="muted small"> · done</span>}
              {s.skipped && <span className="muted small"> · skipped</span>}
              {!s.done && <p className="muted small">{s.why}</p>}
              {!s.done && (
                <p className="welcome-actions small" onClick={onNavigate}>
                  {s.action}
                  {!s.skipped && (
                    <button
                      type="button"
                      className="text-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        welcome.skip(s.id);
                      }}
                    >
                      Skip
                    </button>
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {welcome.note && <p className="small">{welcome.note}</p>}
    </>
  );
}

// Right after signing up: the steps in a dialog. Closing it leaves you on the page you signed up from.
export function WelcomeDialog({ user, onClose }) {
  const welcome = useWelcome(user);
  if (!welcome.ready) return null;
  // Following a step's link closes the dialog; buttons (Send again, Turn on, Skip) keep it open.
  const onNavigate = (e) => e.target.closest('a') && onClose();
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog auth-dialog"
        role="dialog"
        aria-label="Welcome"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Welcome, {user.username}</h2>
        <p className="muted small">
          A few things that make the site yours. Skip any of them; they’re in Account settings whenever you
          want them.
        </p>
        <WelcomeList welcome={welcome} onNavigate={onNavigate} />
        <div className="dialog-actions">
          <button type="button" className="primary-btn" onClick={onClose}>
            {welcome.left ? 'I’ll do the rest later' : 'All set'}
          </button>
        </div>
      </div>
    </div>
  );
}

// In Account settings: what's left, until it's all done or they hide it.
export function WelcomeChecklist({ user }) {
  const welcome = useWelcome(user);
  if (!welcome.ready || welcome.dismissed || !welcome.left) return null;
  return (
    <section className="panel settings-section" id="welcome">
      <div className="setting-head">
        <h2>Finish setting up ({welcome.left} left)</h2>
        <button type="button" className="text-btn small" onClick={welcome.dismiss}>
          Hide this
        </button>
      </div>
      <WelcomeList welcome={welcome} />
    </section>
  );
}
