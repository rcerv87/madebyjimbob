import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StudioEmail from '../components/StudioEmail.jsx';

const templates = [
  { id: 'verify_email', label: 'Verify email' },
  { id: 'reset_password', label: 'Reset password' },
];

describe('Studio account email', () => {
  test('says when email is off, previews a template, and sends a test', async () => {
    mockApi({
      '/studio/email': { enabled: false, from: null, templates, suppressed: 0, recent: [] },
      '/studio/email/preview/verify_email': { subject: 'Confirm your email', html: '<p>Hi</p>', text: 'Hi' },
      '/studio/email/test': { status: 'off' },
    });
    render(<StudioEmail />);

    expect(await screen.findByText(/Off: nothing is sent/)).toBeTruthy();
    expect(await screen.findByText('Confirm your email')).toBeTruthy();
    expect(screen.getByTitle('Email preview').getAttribute('srcdoc')).toBe('<p>Hi</p>');

    fireEvent.change(screen.getByLabelText('Test email address'), { target: { value: 'ruben@example.com' } });
    fireEvent.click(screen.getByText('Send test'));
    await waitFor(() => expect(screen.getByText(/Not sent: email is off on the server/)).toBeTruthy());
    const [, opts] = globalThis.fetch.mock.calls.find(([url]) => String(url).endsWith('/studio/email/test'));
    expect(JSON.parse(opts.body)).toEqual({ to: 'ruben@example.com', template: 'verify_email' });
  });
});
