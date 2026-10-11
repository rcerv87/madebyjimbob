import { useState } from 'react';
import { api } from '../api.js';

const MAX_SIDE = 1600;

// Shrinks a picture in the browser to a JPEG at most 1600px on its long side, so a phone screenshot is small
// enough to send with the note.
export async function shrinkImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That file isn’t a picture this browser can open.'));
      el.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Where this feedback is coming from: the page, the video and where it was, and the screen.
export function feedbackContext() {
  const { pathname, search } = window.location;
  const videoId = pathname.match(/^\/watch\/(\d+)/)?.[1] || null;
  const video = videoId ? document.querySelector('video, audio') : null;
  return {
    page: `${pathname}${search}`,
    videoId,
    offsetMs: video && Number.isFinite(video.currentTime) ? Math.round(video.currentTime * 1000) : null,
    screen: `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}x`,
  };
}

// Send feedback (MBJ-819): a short note from the page you're on, with an optional screenshot. Opened from the
// account menu during the beta.
export default function FeedbackDialog({ onClose }) {
  // Read once, when the dialog opens: the page and the moment the person was looking at.
  const [context] = useState(feedbackContext);
  const [note, setNote] = useState('');
  const [screenshot, setScreenshot] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const pick = async (e) => {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return setScreenshot(null);
    try {
      setScreenshot(await shrinkImage(file));
    } catch (err) {
      setScreenshot(null);
      setError(err.message);
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      setBusy(true);
      await api('/feedback', { method: 'POST', body: { ...context, note: note.trim(), screenshot } });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog auth-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Send feedback</h2>
        {sent ? (
          <>
            <p>Thanks. JimBob’s team will see it.</p>
            <div className="dialog-actions">
              <button type="button" className="primary-btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">
              Something broken, confusing, or missing? Say what happened. The page you’re on
              {context.videoId ? ', the video and where you were in it,' : ''} and your device are sent along.
            </p>
            <label>
              What happened, or what would you like?
              <textarea
                autoFocus
                rows={4}
                maxLength={2000}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setError('');
                }}
                required
              />
            </label>
            <label>
              Screenshot (optional)
              <input type="file" accept="image/*" onChange={pick} />
            </label>
            {screenshot && <img className="feedback-preview" src={screenshot} alt="Your screenshot" />}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="text-btn" onClick={onClose}>
                Cancel
              </button>
              <button className="primary-btn" disabled={busy || !note.trim()}>
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
