import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StudioMembers from '../components/StudioMembers.jsx';

const base = {
  email: 'j•••@example.com',
  emailVerified: true,
  tier: 'free',
  role: 'viewer',
  adminByEmail: false,
  bannedAt: null,
  banReason: null,
  createdAt: new Date(),
  lastSeenAt: new Date(),
  chatCount: 3,
  commentCount: 1,
};
const members = [
  { ...base, id: 1, username: 'ruben', adminByEmail: true },
  { ...base, id: 2, username: 'jimbob', tier: 'premium' },
  { ...base, id: 3, username: 'spammer' },
  { ...base, id: 4, username: 'old_troll', bannedAt: new Date(), banReason: 'Insults' },
];
const actions = [
  { id: 9, action: 'ban', actor: 'ruben', target: 'old_troll', reason: 'Insults', createdAt: new Date() },
];

function setup(path = '/studio/members') {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    calls.push([u, opts.method || 'GET', opts.body ? JSON.parse(opts.body) : null]);
    if (u.startsWith('/api/studio/members?'))
      return Response.json({ members, total: members.length, offset: 0, pageSize: 50, actions });
    const id = Number(u.match(/members\/(\d+)/)[1]);
    const m = members.find((x) => x.id === id);
    if (u.endsWith('/role')) return Response.json({ member: { ...m, role: JSON.parse(opts.body).role } });
    if (u.endsWith('/timeout'))
      return Response.json({
        member:
          opts.method === 'DELETE'
            ? { ...m, timeoutUntil: null, timeoutReason: null }
            : {
                ...m,
                timeoutUntil: new Date(Date.now() + 86400000),
                timeoutReason: JSON.parse(opts.body).reason,
              },
      });
    if (opts.method === 'DELETE') return Response.json({ member: { ...m, bannedAt: null, banReason: null } });
    return Response.json({ member: { ...m, bannedAt: new Date(), banReason: JSON.parse(opts.body).reason } });
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <StudioMembers user={{ id: 1, username: 'ruben', isAdmin: true }} />
    </MemoryRouter>,
  );
  return calls;
}

describe('Studio members', () => {
  test('lists members and makes one an admin', async () => {
    const calls = setup();
    expect(await screen.findByText('Members (4)')).toBeTruthy();
    expect(screen.getByText('Admin by site setting')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Role for ruben' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Role for jimbob' }), {
      target: { value: 'admin' },
    });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Role for jimbob' }).value).toBe('admin'),
    );
    expect(calls).toContainEqual(['/api/studio/members/2/role', 'POST', { role: 'admin' }]);
    // Staff can't be banned, so the button goes away.
    expect(screen.getAllByRole('button', { name: 'Ban…' })).toHaveLength(1);
  });

  test('bans with a reason and unbans', async () => {
    const calls = setup();
    await screen.findByText('Members (4)');
    expect(screen.getByText(/^Banned .*Insults/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ban…' })[1]);
    const confirm = screen.getByRole('button', { name: 'Ban spammer' });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Why ban spammer' }), {
      target: { value: 'Scam links' },
    });
    fireEvent.click(confirm);
    expect(await screen.findByText(/Scam links/)).toBeTruthy();
    expect(calls).toContainEqual(['/api/studio/members/3/ban', 'POST', { reason: 'Scam links' }]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Unban' })[1]);
    await waitFor(() => expect(calls).toContainEqual(['/api/studio/members/4/ban', 'DELETE', null]));
  });

  test('filters and searches', async () => {
    const calls = setup();
    await screen.findByText('Members (4)');
    fireEvent.click(screen.getByRole('button', { name: 'Banned' }));
    await waitFor(() => expect(calls.some(([u]) => u.includes('filter=banned'))).toBe(true));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search members' }), { target: { value: 'jim' } });
    await waitFor(() => expect(calls.some(([u]) => u.includes('q=jim'))).toBe(true));
  });
});

describe('Studio members: timeouts', () => {
  test('time someone out for a set length with a reason, and end it early', async () => {
    const calls = setup();
    await screen.findByText('Members (4)');
    fireEvent.click(screen.getAllByRole('button', { name: 'Time out…' })[1]);
    const confirm = screen.getByRole('button', { name: 'Time out spammer' });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: 'How long to time out spammer' }), {
      target: { value: 'twoweeks' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Why time out spammer' }), {
      target: { value: 'Link spam' },
    });
    fireEvent.click(confirm);
    expect(await screen.findByText(/Timed out until .*: Link spam/)).toBeTruthy();
    expect(calls).toContainEqual([
      '/api/studio/members/3/timeout',
      'POST',
      { length: 'twoweeks', reason: 'Link spam' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'End timeout' }));
    await waitFor(() => expect(calls).toContainEqual(['/api/studio/members/3/timeout', 'DELETE', null]));
  });

  test('a custom end date is sent as a time; opening with ?q= finds that member', async () => {
    const calls = setup('/studio/members?q=spammer');
    await screen.findByText('Members (4)');
    expect(screen.getByRole('searchbox', { name: 'Search members' }).value).toBe('spammer');
    expect(calls[0][0]).toContain('q=spammer');
    fireEvent.click(screen.getAllByRole('button', { name: 'Time out…' })[1]);
    fireEvent.change(screen.getByRole('combobox', { name: 'How long to time out spammer' }), {
      target: { value: 'custom' },
    });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2030-01-02T15:00' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Why time out spammer' }), {
      target: { value: 'Cool off' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Time out spammer' }));
    await waitFor(() => expect(calls.some(([u, m]) => u.endsWith('/timeout') && m === 'POST')).toBe(true));
    const sent = calls.find(([u, m]) => u.endsWith('/timeout') && m === 'POST')[2];
    expect(sent.length).toBe('custom');
    expect(sent.until).toBe(new Date('2030-01-02T15:00').toISOString());
  });
});
