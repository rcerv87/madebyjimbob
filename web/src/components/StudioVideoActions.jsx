import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// Cloudflare takes uploads in pieces of 5–200 MB that are multiples of 256 KB.
const CHUNK = 50 * 1024 * 1024;

// Sends a file to a one-time Cloudflare (tus) upload URL in pieces, picking up where it left off after a
// dropped piece. onProgress gets 0..1.
export async function tusUpload(url, file, onProgress) {
  let offset = 0;
  let failures = 0;
  while (offset < file.size) {
    const piece = file.slice(offset, offset + CHUNK);
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Offset': String(offset),
          'Content-Type': 'application/offset+octet-stream',
        },
        body: piece,
      });
      if (!res.ok) throw new Error(`Cloudflare answered ${res.status}`);
      offset = Number(res.headers.get('Upload-Offset')) || offset + piece.size;
      failures = 0;
      onProgress(offset / file.size);
    } catch (err) {
      failures += 1;
      if (failures > 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * failures));
      // Ask how much arrived, then carry on from there.
      const head = await fetch(url, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } }).catch(
        () => null,
      );
      if (head?.ok) offset = Number(head.headers.get('Upload-Offset')) || offset;
    }
  }
}

// Studio Content row: replace the video file (keeping chat and comments), or delete the video.
export default function StudioVideoActions({ video, onChanged }) {
  const fileRef = useRef(null);
  const [phase, setPhase] = useState(video.replacing ? 'processing' : null); // uploading | processing | done
  const [pct, setPct] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [alsoFile, setAlsoFile] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  // While Cloudflare processes the new file, check every 10s; the server swaps it in when it's ready.
  const check = useCallback(async () => {
    try {
      const r = await api(`/studio/videos/${video.id}/replacement`);
      if (r.state === 'swapped') {
        setPhase('done');
        setNote('Replaced. The new file is playing now.');
        onChanged();
      } else if (r.state === 'error') {
        setPhase(null);
        setError(`Cloudflare couldn’t process that file: ${r.error || 'unknown reason'}. Try another file.`);
      } else if (r.state === 'none') {
        setPhase(null);
      } else {
        setPct(r.pct);
      }
    } catch (err) {
      setError(err.message);
    }
  }, [video.id, onChanged]);
  useEffect(() => {
    if (phase !== 'processing') return undefined;
    check();
    const t = setInterval(check, 10_000);
    return () => clearInterval(t);
  }, [phase, check]);

  // Leaving mid-upload would lose it.
  useEffect(() => {
    if (phase !== 'uploading') return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  const replace = async (file) => {
    if (!file) return;
    setError('');
    setNote('');
    try {
      const { uploadUrl } = await api(`/studio/videos/${video.id}/replacement`, {
        method: 'POST',
        body: { size: file.size, name: file.name },
      });
      setPhase('uploading');
      setPct(0);
      await tusUpload(uploadUrl, file, (p) => setPct(Math.round(p * 100)));
      setPct(null);
      setPhase('processing');
    } catch (err) {
      setPhase(null);
      setError(err.message);
    }
  };

  const cancel = async () => {
    await api(`/studio/videos/${video.id}/replacement`, { method: 'DELETE' }).catch(() => {});
    setPhase(null);
  };

  const remove = async () => {
    setError('');
    try {
      const r = await api(`/studio/videos/${video.id}`, {
        method: 'DELETE',
        body: { removeFromStream: alsoFile },
      });
      if (alsoFile && r.stream && !r.stream.deleted && r.stream.reason !== 'shared') {
        window.alert(
          `Deleted from the site. The video file is still on Cloudflare (${r.stream.reason}); delete it in Cloudflare → Stream (id ${r.streamUid}).`,
        );
      }
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="video-actions">
      {phase === 'uploading' && <span className="small">Uploading {pct}% — keep this page open</span>}
      {phase === 'processing' && (
        <span className="small">
          Cloudflare is processing{pct != null ? ` (${pct}%)` : ''}…{' '}
          <button className="text-btn small" onClick={cancel}>
            Cancel
          </button>
        </span>
      )}
      {note && <span className="small">{note}</span>}
      {!phase && !confirming && (
        <>
          <button
            className="text-btn small"
            onClick={() => fileRef.current?.click()}
            title="Swap in a better file"
          >
            Replace video
          </button>
          <button className="text-btn small danger-text" onClick={() => setConfirming(true)}>
            Delete
          </button>
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        hidden
        aria-label={`New video file for ${video.title}`}
        onChange={(e) => replace(e.target.files?.[0])}
      />
      {confirming && (
        <span className="delete-confirm small">
          Delete “{video.title}” and its chat and comments?
          <label className="check">
            <input type="checkbox" checked={alsoFile} onChange={(e) => setAlsoFile(e.target.checked)} />
            Also delete the file from Cloudflare
          </label>
          <button className="danger-btn small" onClick={remove}>
            Delete
          </button>
          <button className="text-btn small" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </span>
      )}
      {error && <span className="error small">{error}</span>}
    </div>
  );
}
