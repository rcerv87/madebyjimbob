import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, count, timeAgo } from '../api.js';

const FOLDER = 'MADEbyJIMBOB Library';
const SITE_ONLY = 'Not on YouTube';
const STEPS = ['Before you start', 'Get the program', 'Make the folder', 'Start it', 'Let it run'];
const STEP_KEY = 'mbj-uploader-step';

function savedStep() {
  try {
    const n = Number(window.localStorage.getItem(STEP_KEY));
    return n >= 0 && n < STEPS.length ? n : 0;
  } catch {
    return 0;
  }
}

// Studio → Library uploader (MBJ-818): a walk-through for putting the whole YouTube library on the site from a
// Windows PC. One step on screen at a time; the last step shows the upload's progress as it happens.
export default function StudioUploader() {
  const [step, setStep] = useState(savedStep);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    () =>
      api('/studio/library/uploader')
        .then((s) => {
          setStatus(s);
          setError('');
        })
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  // On the last step, keep the progress fresh while the page is open.
  const watching = step === STEPS.length - 1;
  useEffect(() => {
    if (!watching) return undefined;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [watching, load]);

  const go = (n) => {
    setStep(n);
    setCopied(false);
    try {
      window.localStorage.setItem(STEP_KEY, String(n));
    } catch {
      // Private browsing: the step just isn't remembered.
    }
    if (n === 1 || n === STEPS.length - 1) load(); // a fresh download link; fresh progress
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(FOLDER);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const mb = status?.download?.sizeBytes ? Math.round(status.download.sizeBytes / 1e6) : null;
  const p = status?.progress;

  return (
    <section className="panel studio-uploader">
      <h2>Put your video library on the site</h2>
      <p className="muted">
        A small program for your Windows PC reads your video files (your Google Takeout download, recordings
        you already have, and videos that were never on YouTube) and uploads them here. You set it up once and
        it runs by itself. Nothing is installed.
      </p>

      <ol className="wizard-steps" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              className={`wizard-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
              aria-current={i === step ? 'step' : undefined}
              onClick={() => go(i)}
            >
              <span className="wizard-num">{i < step ? '✓' : i + 1}</span>
              <span className="wizard-label">{label}</span>
            </button>
          </li>
        ))}
      </ol>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {status?.storageProblem && (
        <p className="error" role="alert">
          {status.storageProblem} Tell Ruben before you start.
        </p>
      )}

      <div className="wizard-body">
        <h3>
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </h3>

        {step === 0 && (
          <>
            <ul className="wizard-list">
              <li>
                <strong>A Windows PC</strong> you can leave on. A full library takes days, not hours.
              </li>
              <li>
                <strong>Your video files.</strong> For YouTube videos, your Google Takeout download is the
                easy way: leave the .zip files exactly as Google gave them to you, don’t unzip them. Video
                files you already have (OBS recordings, old exports) work too.
              </li>
              <li>
                <strong>Videos that were never on YouTube are welcome.</strong> They upload as drafts that
                only you see, and you give each a title and publish it here in Studio. Step 3 shows where to
                put them.
              </li>
              <li>
                <strong>Free space</strong> on the drive that holds them. The program needs working room.
              </li>
              <li>
                <strong>Your username and password for this site.</strong>{' '}
                {status &&
                  (status.hasPassword ? (
                    <>
                      Your username is <strong>{status.username}</strong>.
                    </>
                  ) : (
                    <span className="error">
                      Your account ({status.username}) signs in with Google and has no password yet. Sign out,
                      choose Sign in → Forgot password, and follow the email to set one. Then come back here.
                    </span>
                  ))}
              </li>
            </ul>
          </>
        )}

        {step === 1 && (
          <>
            {status?.download ? (
              <p>
                <a className="primary-btn" href={status.download.url}>
                  Download the uploader{mb ? ` (${mb} MB)` : ''}
                </a>
              </p>
            ) : (
              <p className="error">
                {status && !status.storageReady
                  ? 'The download isn’t available yet: the site’s video storage isn’t set up. Tell Ruben.'
                  : status
                    ? 'The download isn’t available yet. Tell Ruben it needs to be published.'
                    : 'Checking for the download…'}
              </p>
            )}
            <ol className="wizard-list">
              <li>Click the button and wait for the download to finish.</li>
              <li>
                Open your <strong>Downloads</strong> folder, right-click{' '}
                <strong>MADEbyJIMBOB-Library-Uploader.zip</strong>, and choose <strong>Extract All</strong>,
                then <strong>Extract</strong>.
              </li>
              <li>
                Move the new <strong>MADEbyJIMBOB Library Uploader</strong> folder somewhere you’ll find it,
                like your Desktop.
              </li>
            </ol>
            <p className="muted small">
              If your browser warns about the file, choose Keep. It’s the program from this site.
            </p>
          </>
        )}

        {step === 2 && (
          <>
            <ol className="wizard-list">
              <li>
                Open <strong>File Explorer</strong> and click the drive where your Takeout files are (for
                example C: or E:).
              </li>
              <li>
                Right-click an empty spot, choose <strong>New</strong>, then <strong>Folder</strong>.
              </li>
              <li>
                Name it exactly: <code className="wizard-code">{FOLDER}</code>{' '}
                <button type="button" className="text-btn small" onClick={copy}>
                  {copied ? 'Copied' : 'Copy name'}
                </button>
              </li>
              <li>
                Move all of your Takeout .zip files into that folder. Video files of things that are on your
                YouTube channel (OBS recordings of streams, for example) can go in too.
              </li>
              <li>
                <strong>Videos that were never on YouTube:</strong> put them in a folder named{' '}
                <code className="wizard-code">{SITE_ONLY}</code> inside that one. The program makes this
                folder the first time it runs, so you can also add them after step 4.
              </li>
            </ol>
            <p className="muted small">
              The folder has to sit directly on the drive, like E:\{FOLDER}, not inside another folder. Your
              Desktop also works.
            </p>
          </>
        )}

        {step === 3 && (
          <>
            <ol className="wizard-list">
              <li>
                Open the <strong>MADEbyJIMBOB Library Uploader</strong> folder and double-click{' '}
                <strong>Start MADEbyJIMBOB Library Uploader</strong>.
              </li>
              <li>
                If a blue box says “Windows protected your PC”, click <strong>More info</strong>, then{' '}
                <strong>Run anyway</strong>. That’s normal for a program that isn’t from the Microsoft Store.
              </li>
              <li>
                A black window opens and asks for your username{status ? ` (${status.username})` : ''} and
                password for this site. Type each one and press <strong>Enter</strong>. It only asks the first
                time. Dots show instead of your password as you type.
              </li>
              <li>
                If it asks where the folder is, type its location (for example E:\{FOLDER}) and press{' '}
                <strong>Enter</strong>.
              </li>
              <li>
                It asks <strong>“Start automatically?”</strong> Press <strong>Enter</strong> for yes. Then
                after a restart or a power cut it starts again by itself when you log in to Windows.
              </li>
            </ol>
          </>
        )}

        {step === 4 && (
          <>
            <div className="wizard-progress" aria-live="polite">
              {p && p.done + p.uploading > 0 ? (
                <>
                  <strong>{count(p.done, 'video')} uploaded</strong>
                  {p.uploading > 0 && <span> · {count(p.uploading, 'video')} in progress</span>}
                  {p.drafts > 0 && (
                    <span>
                      {' '}
                      · <Link to="/studio/videos">{count(p.drafts, 'draft')} to publish</Link>
                    </span>
                  )}
                  {p.lastFinishedAt && (
                    <span className="muted small">
                      {' '}
                      · last finished {timeAgo(p.lastFinishedAt)}
                      {p.lastTitle ? `: ${p.lastTitle}` : ''}
                    </span>
                  )}
                </>
              ) : (
                <span className="muted">
                  Nothing uploaded yet. The first video shows here once the program finishes it (this page
                  checks every 30 seconds).
                </span>
              )}
            </div>
            <ul className="wizard-list">
              <li>
                <strong>Leave the black window open.</strong> It works through one video at a time.
              </li>
              <li>
                <strong>Keep the PC awake:</strong> Settings → System → Power → set Sleep to Never while
                plugged in.
              </li>
              <li>You can keep using the PC. It may run a little slower.</li>
              <li>
                You can close the window any time. Double-click the Start file again and it picks up where it
                left off. Nothing is uploaded twice.
              </li>
              <li>
                <strong>After a restart or a power cut</strong> it starts again by itself once you log in to
                Windows (minimized, on the taskbar). The video it was in the middle of starts over; finished
                ones are kept. To turn this off, double-click <strong>Stop starting automatically</strong> in
                the uploader folder.
              </li>
              <li>New files you add to the folder later are found within 10 minutes.</li>
              <li>
                Videos from your <strong>{SITE_ONLY}</strong> folder arrive as drafts. Open{' '}
                <Link to="/studio/videos">Studio → Videos</Link>, give each a title, choose who can watch, and
                press Publish.
              </li>
              <li>
                If a file called <strong>needs-review.txt</strong> appears in the folder, it lists videos the
                program couldn’t match to a YouTube video, so it skipped them. Never on YouTube? Move them
                into <strong>{SITE_ONLY}</strong>. Otherwise send the list to Ruben.
              </li>
              <li>
                <strong>Keep your Takeout files.</strong> They’re your full-quality backup.
              </li>
            </ul>
            {status?.storageHost && <p className="muted small">Videos are stored at {status.storageHost}.</p>}
            <details className="wizard-help">
              <summary>If something goes wrong</summary>
              <ul className="wizard-list">
                <li>
                  “That username and password didn’t work”: check for typos; it’s the same sign-in as here.
                </li>
                <li>“That account can’t add videos”: tell Ruben; it’s a setting on his side.</li>
                <li>
                  The window says it stopped: it starts again by itself in 30 seconds. If it keeps stopping,
                  send Ruben a photo of the window.
                </li>
              </ul>
            </details>
          </>
        )}
      </div>

      <div className="wizard-nav">
        <button type="button" className="text-btn" onClick={() => go(step - 1)} disabled={step === 0}>
          Back
        </button>
        {step < STEPS.length - 1 && (
          <button type="button" className="primary-btn" onClick={() => go(step + 1)}>
            Next: {STEPS[step + 1]}
          </button>
        )}
      </div>
    </section>
  );
}
