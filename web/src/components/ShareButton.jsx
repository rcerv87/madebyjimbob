import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../api.js';

// Copy a link to a video (optionally at the current moment), or use the phone's share sheet.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / non-secure pages: fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.('copy') ?? false;
    ta.remove();
    return ok;
  }
}

export default function ShareButton({ title, path, getTimeMs }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState('');
  const [atMs, setAtMs] = useState(0);
  const wrapRef = useRef(null);

  const base = `${location.origin}${path}`;
  const atSec = Math.floor(atMs / 1000);
  const atUrl = `${base}${path.includes('?') ? '&' : '?'}t=${atSec}`;

  useEffect(() => {
    if (!open) return;
    const close = (e) => !wrapRef.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(''), 2500);
    return () => clearTimeout(t);
  }, [done]);

  const toggle = () => {
    setAtMs(getTimeMs?.() || 0);
    setDone('');
    setOpen((o) => !o);
  };

  const copy = async (url, label) => {
    const ok = await copyText(url);
    setDone(ok ? `${label} copied` : 'Couldn’t copy. Press and hold the link to copy it.');
    setOpen(false);
  };

  const share = async (url) => {
    try {
      await navigator.share({ title, url });
      setOpen(false);
    } catch {
      /* the viewer closed the share sheet */
    }
  };

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div className="share" ref={wrapRef}>
      <button type="button" className="share-btn" onClick={toggle} aria-expanded={open}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M14 5l6 6-6 6M20 11H9a5 5 0 0 0-5 5v3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Share
      </button>
      {open && (
        <div className="share-menu" role="menu" aria-label="Share">
          {canShare && (
            <button type="button" role="menuitem" onClick={() => share(atSec > 0 ? atUrl : base)}>
              Share…
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => copy(base, 'Link')}>
            Copy link
          </button>
          {atSec > 0 && (
            <button type="button" role="menuitem" onClick={() => copy(atUrl, `Link at ${formatTime(atSec)}`)}>
              Copy link at {formatTime(atSec)}
            </button>
          )}
        </div>
      )}
      {done && (
        <span className="share-done" role="status">
          {done}
        </span>
      )}
    </div>
  );
}
