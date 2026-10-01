import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StudioImports from '../components/StudioImports.jsx';
import StudioVideoActions, { tusUpload } from '../components/StudioVideoActions.jsx';

function fakeApi(routes) {
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const path = String(url)
      .replace(/^\/api/, '')
      .split('?')[0];
    const hit = routes[`${opts.method || 'GET'} ${path}`] || routes[path] || [404, { error: 'Not mocked' }];
    return new Response(JSON.stringify(hit[1]), { status: hit[0] });
  });
  return (method, path) =>
    globalThis.fetch.mock.calls
      .filter(
        ([url, opts = {}]) =>
          String(url).split('?')[0] === `/api${path}` && (opts.method || 'GET') === method,
      )
      .map(([, opts]) => (opts.body ? JSON.parse(opts.body) : null));
}

describe('Studio → Add videos', () => {
  test('says when the helper isn’t running, queues links, and shows failures with a retry', async () => {
    const sent = fakeApi({
      '/studio/imports': [
        200,
        {
          helper: null,
          jobs: [
            {
              id: 3,
              url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
              status: 'failed',
              tier: 'free',
              error: 'yt-dlp: Video unavailable',
              createdAt: new Date(),
            },
          ],
        },
      ],
      'POST /studio/imports': [200, { queued: [{ id: 4 }], skipped: [] }],
      'POST /studio/imports/3/retry': [200, { job: {} }],
      '/studio/channel': [
        200,
        { listing: null, counts: { all: 0 }, videos: [], total: 0, apiKey: false, helper: null },
      ],
    });
    render(
      <MemoryRouter>
        <StudioImports />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Helper not running')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Paste links' }));
    expect(screen.getByText('npm run import:worker')).toBeTruthy();
    expect(screen.getByText(/Video unavailable/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('YouTube video links'), {
      target: { value: 'https://youtu.be/BBBBBBBBBBB' },
    });
    fireEvent.change(screen.getByLabelText('Who can watch'), { target: { value: 'plus' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    expect(await screen.findByText(/1 added to the queue/)).toBeTruthy();
    expect(sent('POST', '/studio/imports')).toEqual([
      { urls: 'https://youtu.be/BBBBBBBBBBB', tier: 'plus', withComments: true },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(sent('POST', '/studio/imports/3/retry')).toHaveLength(1));
  });
});

describe('Studio → replace or delete a video', () => {
  test('delete asks first, then deletes the file on Cloudflare too', async () => {
    const sent = fakeApi({ 'DELETE /studio/videos/9': [200, { ok: true, stream: { deleted: true } }] });
    const onChanged = vi.fn();
    render(<StudioVideoActions video={{ id: 9, title: 'Not JimBob' }} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/Delete “Not JimBob” and its chat and comments\?/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(sent('DELETE', '/studio/videos/9')).toEqual([{ removeFromStream: true }]);
  });

  test('a video already being replaced shows Cloudflare’s progress', async () => {
    fakeApi({ '/studio/videos/9/replacement': [200, { state: 'inprogress', pct: 40 }] });
    render(<StudioVideoActions video={{ id: 9, title: 'T', replacing: true }} onChanged={() => {}} />);
    expect(await screen.findByText(/Cloudflare is processing \(40%\)/)).toBeTruthy();
  });

  test('uploads a file to Cloudflare in pieces, resuming after a dropped piece', async () => {
    const MB = 1024 * 1024;
    const file = new Blob([new Uint8Array(120 * MB)]);
    let received = 0;
    let dropped = false;
    globalThis.fetch = vi.fn(async (url, opts) => {
      if (opts.method === 'HEAD')
        return new Response(null, { status: 200, headers: { 'Upload-Offset': String(received) } });
      if (!dropped && received === 50 * MB) {
        dropped = true;
        throw new Error('network');
      }
      expect(Number(opts.headers['Upload-Offset'])).toBe(received);
      received += opts.body.size;
      return new Response(null, { status: 204, headers: { 'Upload-Offset': String(received) } });
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const progress = [];
    await tusUpload('https://upload.example/x', file, (p) => progress.push(p));
    vi.useRealTimers();
    expect(received).toBe(120 * MB);
    expect(progress.at(-1)).toBe(1);
    expect(
      globalThis.fetch.mock.calls.filter(([, o]) => o.method === 'PATCH').map(([, o]) => o.body.size),
    ).toEqual([50 * MB, 50 * MB, 50 * MB, 20 * MB]);
  });
});

describe('Studio → Add videos → From the channel', () => {
  const v = (id, over = {}) => ({
    youtubeId: id,
    title: `Title ${id}`,
    kind: 'live',
    publishedAt: new Date(),
    durationS: 3600,
    thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    state: 'new',
    ...over,
  });
  const listing = { status: 'done', source: 'helper', videoCount: 3, finishedAt: new Date() };

  test('lists the channel; already-imported and queued ones can’t be picked; Select all and queue', async () => {
    const sent = fakeApi({
      '/studio/imports': [200, { helper: { online: true, name: 'PC' }, jobs: [] }],
      '/studio/channel': [
        200,
        {
          listing,
          apiKey: false,
          counts: { all: 3, onsite: 1, queued: 0, new: 2 },
          total: 3,
          videos: [
            v('AAAAAAAAAAA', { availability: 'subscriber_only' }),
            v('BBBBBBBBBBB'),
            v('CCCCCCCCCCC', { state: 'onsite', videoId: 7 }),
          ],
        },
      ],
      'POST /studio/imports': [200, { queued: [{}, {}], skipped: [] }],
    });
    render(
      <MemoryRouter>
        <StudioImports />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/3 videos, listed/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'On the site' }).getAttribute('href')).toBe('/watch/7');
    expect(screen.getByLabelText('Import Title CCCCCCCCCCC').disabled).toBe(true);

    fireEvent.click(screen.getByLabelText(/Select all shown \(2\)/));
    expect(screen.getByText(/1 of these is members-only on YouTube/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Queue 2 videos' }));
    expect(await screen.findByText('2 videos added to the import queue.')).toBeTruthy();
    expect(sent('POST', '/studio/imports')).toEqual([
      { urls: ['AAAAAAAAAAA', 'BBBBBBBBBBB'], tier: 'free', withComments: true },
    ]);
  });

  test('a channel with no list yet asks for one by itself (once), and says when the helper isn’t running', async () => {
    const sent = fakeApi({
      '/studio/imports': [200, { helper: null, jobs: [] }],
      '/studio/channel': [
        200,
        { listing: null, apiKey: false, counts: { all: 0 }, total: 0, videos: [], helper: null },
      ],
      'POST /studio/channel/refresh': [200, { listing: { status: 'queued', source: 'helper' } }],
    });
    render(
      <MemoryRouter>
        <StudioImports />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(sent('POST', '/studio/channel/refresh')).toEqual([
        { url: 'https://www.youtube.com/@madebyjimbob' },
      ]),
    );
    expect(screen.getAllByText(/npm run import:worker/).length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(sent('POST', '/studio/channel/refresh')).toHaveLength(1);
  });
});
