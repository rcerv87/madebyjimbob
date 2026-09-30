// Account email templates (MBJ-114). Each returns { subject, text, html }: plain, branded, and readable
// with images off. Every value from outside is escaped; links are absolute URLs built by the caller.

const TEAL = '#27717A';

export function siteUrl() {
  return (process.env.SITE_URL || 'https://madebyjimbob.onrender.com').replace(/\/+$/, '');
}

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

// Shows enough of an address to recognise it: jimbob@example.com → ji***@example.com
export function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${name.slice(0, 2)}***@${domain}`;
}

function layout({ heading, paragraphs, button, after = [] }) {
  const p = (t) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1d2327">${t}</p>`;
  const site = siteUrl();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="color-scheme" content="light"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#f3f5f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f6">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;font-family:Jost,Segoe UI,Helvetica,Arial,sans-serif">
<tr><td style="padding:20px 28px;border-bottom:3px solid ${TEAL};font-size:20px;font-weight:700;letter-spacing:.5px;color:${TEAL}">MADE<span style="color:#1d2327">by</span>JIMBOB</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1d2327">${esc(heading)}</h1>
${paragraphs.map(p).join('\n')}
${
  button
    ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="display:inline-block;background:${TEAL};color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:12px 22px;border-radius:8px">${esc(button.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#5b6770">Button not working? Copy this link into your browser:<br><a href="${esc(button.url)}" style="color:${TEAL};word-break:break-all">${esc(button.url)}</a></p>`
    : ''
}
${after.map(p).join('\n')}
</td></tr>
<tr><td style="padding:16px 28px 24px;font-size:12px;line-height:1.5;color:#5b6770;border-top:1px solid #e3e7ea">
This is an account email from <a href="${esc(site)}" style="color:${TEAL}">MADEbyJIMBOB</a>. It's about your account, so it's sent even if you don't get our newsletter.
</td></tr>
</table></td></tr></table>
</body></html>`;
}

function plain({ heading, paragraphs, button, after = [] }) {
  return [
    heading,
    '',
    ...paragraphs.flatMap((t) => [t, '']),
    ...(button ? [`${button.label}: ${button.url}`, ''] : []),
    ...after.flatMap((t) => [t, '']),
    `MADEbyJIMBOB · ${siteUrl()}`,
  ].join('\n');
}

// Paragraph text is written here, never taken from users, except the escaped values passed in.
function build(subject, parts) {
  const escaped = {
    ...parts,
    paragraphs: parts.paragraphs.map((t) => t.html),
    after: (parts.after || []).map((t) => t.html),
  };
  const text = {
    ...parts,
    paragraphs: parts.paragraphs.map((t) => t.text),
    after: (parts.after || []).map((t) => t.text),
  };
  return { subject, html: layout(escaped), text: plain(text) };
}

// A sentence with values: t`Hi ${name},` gives the same sentence as text and as escaped HTML.
function t(strings, ...values) {
  const join = (f) => strings.reduce((out, s, i) => out + s + (i < values.length ? f(values[i]) : ''), '');
  return { text: join(String), html: join((v) => `<strong>${esc(v)}</strong>`) };
}
const line = (s) => ({ text: s, html: esc(s) });

export const TEMPLATES = {
  verify_email: {
    label: 'Verify email',
    sample: () => ({ username: 'jimbobfan', url: `${siteUrl()}/verify?token=sample` }),
    render: ({ username, url }) =>
      build('Confirm your email for MADEbyJIMBOB', {
        heading: 'Confirm your email',
        paragraphs: [
          t`Hi ${username},`,
          line('Tap the button to confirm this is your email. The link works for 24 hours.'),
        ],
        button: { label: 'Confirm email', url },
        after: [line("Didn't sign up? You can ignore this email and no account will use this address.")],
      }),
  },
  reset_password: {
    label: 'Reset password',
    sample: () => ({ username: 'jimbobfan', url: `${siteUrl()}/reset?token=sample` }),
    render: ({ username, url }) =>
      build('Reset your MADEbyJIMBOB password', {
        heading: 'Reset your password',
        paragraphs: [
          t`Hi ${username},`,
          line('Someone asked to reset the password for your account. The link works once, for 1 hour.'),
        ],
        button: { label: 'Choose a new password', url },
        after: [line("Didn't ask for this? Ignore this email; your password stays the same.")],
      }),
  },
  email_changed: {
    label: 'Email changed (to the old address)',
    sample: () => ({
      username: 'jimbobfan',
      newEmail: 'new.address@example.com',
      undoUrl: `${siteUrl()}/account/undo-email?token=sample`,
    }),
    render: ({ username, newEmail, undoUrl }) =>
      build('Your MADEbyJIMBOB email was changed', {
        heading: 'Your email was changed',
        paragraphs: [
          t`Hi ${username},`,
          t`Your account's email is now ${maskEmail(newEmail)}. Account emails will go there from now on.`,
        ],
        button: { label: "This wasn't me — undo it", url: undoUrl },
        after: [
          line('The undo link works for 7 days. It also signs out every device and asks for a new password.'),
        ],
      }),
  },
  new_sign_in: {
    label: 'New sign-in',
    sample: () => ({
      username: 'jimbobfan',
      device: 'Chrome on Windows',
      when: 'Sept 30, 2026, 10:42 AM',
      securityUrl: `${siteUrl()}/account#security`,
    }),
    render: ({ username, device, when, securityUrl }) =>
      build('New sign-in to your MADEbyJIMBOB account', {
        heading: 'New sign-in to your account',
        paragraphs: [t`Hi ${username},`, t`Your account was just signed in on ${device} (${when}).`],
        button: { label: 'Check your devices', url: securityUrl },
        after: [
          line(
            "If this was you, there's nothing to do. If not, change your password and sign out that device.",
          ),
        ],
      }),
  },
  account_deletion_requested: {
    label: 'Account deletion requested',
    sample: () => ({ username: 'jimbobfan', date: 'Oct 30, 2026', cancelUrl: `${siteUrl()}/account` }),
    render: ({ username, date, cancelUrl }) =>
      build('Your MADEbyJIMBOB account will be deleted', {
        heading: 'Your account will be deleted',
        paragraphs: [
          t`Hi ${username},`,
          t`We got your request. Your account and data will be erased on ${date}.`,
          line('Changed your mind? Sign in before then and the deletion is cancelled.'),
        ],
        button: { label: 'Keep my account', url: cancelUrl },
      }),
  },
  account_deleted: {
    label: 'Account deleted',
    sample: () => ({ username: 'jimbobfan' }),
    render: ({ username }) =>
      build('Your MADEbyJIMBOB account was deleted', {
        heading: 'Your account was deleted',
        paragraphs: [
          t`Hi ${username},`,
          line(
            "Your account and its data have been erased. This is the last email you'll get from us about it.",
          ),
          line("You're always welcome back."),
        ],
      }),
  },
};

export function renderEmail(template, data) {
  const tpl = TEMPLATES[template];
  if (!tpl) throw new Error(`Unknown email template: ${template}`);
  return tpl.render(data);
}
