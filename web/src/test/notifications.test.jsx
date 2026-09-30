import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Bell, NotificationToast, notificationUrl, describe as describeNote } from '../notifications.jsx';

const note = (id, over = {}) => ({
  id,
  type: 'mention',
  where: 'chat',
  videoId: '4',
  videoTitle: 'Evolution Debate',
  actor: 'sam',
  excerpt: 'what do you think @ruben',
  offsetMs: 3_872_000,
  commentId: null,
  read: false,
  createdAt: new Date().toISOString(),
  ...over,
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function renderAt(path, ui) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {ui}
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('notification links and text', () => {
  test('open the video at the moment, plus the thread for comments', () => {
    expect(notificationUrl(note(1))).toBe('/watch/4?t=3872&chat=all');
    expect(notificationUrl(note(2, { where: 'comment', commentId: '88', offsetMs: null }))).toBe(
      '/watch/4?comment=88',
    );
    expect(describeNote(note(1))).toBe('sam mentioned you in chat');
    expect(describeNote(note(2, { type: 'reply' }))).toBe('sam replied to you');
  });
});

describe('Bell', () => {
  test('shows the unread count and opens a notification at its moment', () => {
    mockApi({ '/push/key': { publicKey: null } });
    const markRead = vi.fn();
    renderAt(
      '/',
      <Bell notes={{ unread: 2, items: [note(1), note(2, { type: 'reply', read: true })], markRead }} />,
    );
    const bell = screen.getByRole('button', { name: 'Notifications, 2 unread' });
    expect(bell.textContent).toContain('2');
    fireEvent.click(bell);
    expect(screen.getByText('sam mentioned you in chat')).toBeTruthy();
    expect(screen.getByText('sam replied to you')).toBeTruthy();

    fireEvent.click(screen.getByText('sam mentioned you in chat'));
    expect(markRead).toHaveBeenCalledWith([1]);
    expect(screen.getByTestId('where').textContent).toBe('/watch/4?t=3872&chat=all');
  });

  test('mark all read', () => {
    mockApi({ '/push/key': { publicKey: null } });
    const markRead = vi.fn();
    renderAt('/', <Bell notes={{ unread: 1, items: [note(1)], markRead }} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(markRead).toHaveBeenCalledWith();
  });
});

describe('NotificationToast', () => {
  const notes = (n) => ({ toast: n, dismissToast: vi.fn(), markRead: vi.fn() });

  test('on the same video it offers to jump to the moment', () => {
    const state = notes(note(1));
    renderAt('/watch/4', <NotificationToast notes={state} />);
    expect(screen.getByText('sam mentioned you in chat')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to it' }));
    expect(state.markRead).toHaveBeenCalledWith([1]);
    expect(screen.getByTestId('where').textContent).toBe('/watch/4?t=3872&chat=all');
  });

  test('elsewhere it names the video and says Open', () => {
    renderAt('/', <NotificationToast notes={notes(note(1))} />);
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(screen.getByText('Evolution Debate')).toBeTruthy();
  });
});
