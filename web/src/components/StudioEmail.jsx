import { useEffect, useState } from 'react';
import { api, timeAgo } from '../api.js';

const STATUS_LABEL = {
  sent: 'Sent',
  failed: 'Failed',
  off: 'Not sent (email off)',
  suppressed: 'Blocked (bounced or spam)',
  bounced: 'Bounced',
  complained: 'Marked as spam',
};

const TEST_RESULT = {
  off: 'Not sent: email is off on the server (see the line above).',
  suppressed: 'Not sent: that address bounced or reported spam before, so it gets no more mail.',
  failed: "Couldn't send: the email service refused it. Hover the result below for the reason.",
};

// Studio: is account email on, what each email looks like, send yourself a test, and the latest sends.
export default function StudioEmail() {
  const [info, setInfo] = useState(null);
  const [template, setTemplate] = useState('verify_email');
  const [preview, setPreview] = useState(null);
  const [to, setTo] = useState('');
  const [note, setNote] = useState(null);
  const [error, setError] = useState('');

  const load = () =>
    api('/studio/email')
      .then(setInfo)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    setPreview(null);
    api(`/studio/email/preview/${template}`)
      .then(setPreview)
      .catch((e) => setError(e.message));
  }, [template]);

  const sendTest = async (e) => {
    e.preventDefault();
    setNote(null);
    try {
      const { status } = await api('/studio/email/test', { method: 'POST', body: { to, template } });
      setNote(
        status === 'sent'
          ? { ok: true, text: `Sent. Check ${to} (and its spam folder) in a minute.` }
          : { ok: false, text: TEST_RESULT[status] || `Not sent (${status}).` },
      );
      load();
    } catch (err) {
      setNote({ ok: false, text: err.message });
    }
  };

  return (
    <section className="panel studio-email">
      <h2>Account email</h2>
      {error && <p className="error small">{error}</p>}
      {info && (
        <p className={`small ${info.enabled ? '' : 'muted'}`}>
          {info.enabled
            ? `On: sending as ${info.from}.`
            : 'Off: nothing is sent until RESEND_API_KEY and EMAIL_FROM are set on the server.'}
          {info.suppressed > 0 && ` ${info.suppressed} address(es) blocked after bounces or spam reports.`}
        </p>
      )}
      <form className="email-test" onSubmit={sendTest}>
        <select value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="Email template">
          {(info?.templates || []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="Send a test to…"
          aria-label="Test email address"
          required
        />
        <button className="primary-btn">Send test</button>
      </form>
      {note && <p className={`small ${note.ok ? '' : 'error'}`}>{note.text}</p>}
      {preview && (
        <>
          <p className="small email-subject">
            <span className="muted">Subject:</span> {preview.subject}
          </p>
          <iframe className="email-preview" title="Email preview" sandbox="" srcDoc={preview.html} />
        </>
      )}
      {info?.recent.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>To</th>
                <th>Email</th>
                <th>Result</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {info.recent.map((r) => (
                <tr key={r.id}>
                  <td>{r.to}</td>
                  <td>{info.templates.find((t) => t.id === r.template)?.label || r.template}</td>
                  <td title={r.error || undefined}>{STATUS_LABEL[r.status] || r.status}</td>
                  <td>{timeAgo(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
