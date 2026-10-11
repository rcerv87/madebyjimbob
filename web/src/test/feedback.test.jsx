import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FeedbackDialog, { feedbackContext } from '../components/FeedbackDialog.jsx';
import StudioFeedback, { asStory, deviceName } from '../components/StudioFeedback.jsx';

describe('Send feedback', () => {
  test('sends the note with the page it came from, then says thanks', async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, opts) => {
      calls.push([String(url), JSON.parse(opts.body)]);
      return Response.json({ id: 1 });
    });
    window.history.pushState(null, '', '/shop?sort=new');
    render(<FeedbackDialog onClose={() => {}} />);
    const sendBtn = screen.getByRole('button', { name: 'Send' });
    expect(sendBtn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('What happened, or what would you like?'), {
      target: { value: '  The price is cut off.  ' },
    });
    fireEvent.click(sendBtn);
    expect(await screen.findByText(/Thanks\./)).toBeTruthy();
    expect(calls[0][0]).toBe('/api/feedback');
    expect(calls[0][1]).toMatchObject({
      note: 'The price is cut off.',
      page: '/shop?sort=new',
      videoId: null,
      offsetMs: null,
      screenshot: null,
    });
    expect(calls[0][1].screen).toMatch(/^\d+x\d+ @/);
    window.history.pushState(null, '', '/');
  });

  test('on a video page it includes the video and the moment', () => {
    window.history.pushState(null, '', '/watch/42');
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { value: 754.3 });
    document.body.appendChild(video);
    expect(feedbackContext()).toMatchObject({ page: '/watch/42', videoId: '42', offsetMs: 754300 });
    video.remove();
    window.history.pushState(null, '', '/');
  });

  test('a refusal from the server is shown and the note is kept', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'That’s a lot of feedback for one day.' }), { status: 409 }),
    );
    render(<FeedbackDialog onClose={() => {}} />);
    const box = screen.getByLabelText('What happened, or what would you like?');
    fireEvent.change(box, { target: { value: 'Again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/a lot of feedback/);
    expect(box.value).toBe('Again');
  });
});

const item = {
  id: 3,
  username: 'beta_tester',
  note: 'The chat jumped to the top.\nSecond line.',
  page: '/watch/4?chat=all',
  videoId: '4',
  videoTitle: 'Evolution Debate',
  offsetMs: 754000,
  userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36',
  screen: '390x844 @3x',
  status: 'new',
  hasScreenshot: true,
  createdAt: new Date(),
};

describe('Studio → Feedback', () => {
  test('lists notes with where they came from and moves them along', async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      calls.push([String(url), opts.method || 'GET', opts.body ? JSON.parse(opts.body) : null]);
      return Response.json(String(url).includes('?status=') ? { feedback: [item] } : { ok: true });
    });
    render(
      <MemoryRouter>
        <StudioFeedback />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Feedback (1)')).toBeTruthy();
    expect(screen.getByText(/Chrome on Android/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Evolution Debate at 12:34' }).getAttribute('href')).toBe(
      '/watch/4?t=754',
    );
    expect(screen.getByRole('link', { name: 'Screenshot' }).getAttribute('href')).toBe(
      '/api/studio/feedback/3/screenshot',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark seen' }));
    await waitFor(() => expect(calls).toContainEqual(['/api/studio/feedback/3', 'POST', { status: 'seen' }]));
  });

  test('a note becomes a backlog story to paste; devices get short names', () => {
    const story = asStory(item);
    expect(story.split('\n')[0]).toBe('Feedback from beta_tester: The chat jumped to the top.');
    expect(story).toContain('- Page: /watch/4?chat=all');
    expect(story).toContain('- Video: Evolution Debate at 12:34');
    expect(story).toContain('(390x844 @3x)');
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) Version/17.5 Mobile Safari/604.1')).toBe(
      'Safari on iPhone',
    );
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36 Edg/126.0')).toBe(
      'Edge on Windows',
    );
  });
});
