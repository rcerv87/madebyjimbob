import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StudioFileImport, { normTitle, takeoutIds, matchFile } from '../components/StudioFileImport.jsx';

// What Takeout's "video metadata" CSV looks like (columns vary by export date; matched by name).
const TAKEOUT_CSV = `Video ID,Approx Duration (ms),Video Audio Language,Video Title (Original),Privacy
AAAAAAAAAAA,3600000,en,"Debate: Is ""Evolution"" True?",Public
BBBBBBBBBBB,600000,en,Guitar build part 2,Public
`;

describe('matching files to YouTube videos', () => {
  test('titles compare without punctuation, case, extensions, or Takeout’s " (1)"', () => {
    expect(normTitle('Debate: Is "Evolution" True? (1).mp4')).toBe(normTitle('Debate- Is Evolution True'));
  });

  test("Takeout's CSV gives exact ids; an [id] in the name wins; otherwise a unique channel title", () => {
    const csv = takeoutIds(TAKEOUT_CSV);
    expect(csv.get(normTitle('Debate: Is "Evolution" True?'))).toBe('AAAAAAAAAAA');
    const byTitle = new Map([[normTitle('Only on the channel'), [{ youtubeId: 'CCCCCCCCCCC' }]]]);
    expect(matchFile('Debate： Is Evolution True.mp4', { csv, byTitle })).toBe('AAAAAAAAAAA');
    expect(matchFile('Something [DDDDDDDDDDD].mkv', { csv, byTitle })).toBe('DDDDDDDDDDD');
    expect(matchFile('Only on the channel.mov', { csv, byTitle })).toBe('CCCCCCCCCCC');
    expect(matchFile('Unknown.mp4', { csv, byTitle })).toBe(null);
  });
});

function fakeApi(routes) {
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const path = u.startsWith('/api') ? u.replace(/^\/api/, '').split('?')[0] : u;
    const hit = routes[`${opts.method || 'GET'} ${path}`] || routes[path] || [404, { error: 'Not mocked' }];
    return new Response(hit[1] === null ? null : JSON.stringify(hit[1]), { status: hit[0] });
  });
  return (method, path) =>
    globalThis.fetch.mock.calls.filter(
      ([url, o = {}]) =>
        String(url)
          .split('?')[0]
          .replace(/^\/api/, '') === path && (o.method || 'GET') === method,
    );
}

describe('Studio → Add videos → From files', () => {
  test('matches a Takeout folder, then uploads new ones for import and swaps better copies in', async () => {
    const sent = fakeApi({
      '/studio/channel': [
        200,
        {
          listing: { status: 'done' },
          total: 2,
          videos: [
            {
              youtubeId: 'AAAAAAAAAAA',
              title: 'Debate: Is "Evolution" True?',
              state: 'new',
              durationS: 3600,
            },
            {
              youtubeId: 'BBBBBBBBBBB',
              title: 'Guitar build part 2',
              state: 'onsite',
              videoId: 5,
              durationS: 600,
            },
          ],
        },
      ],
      'POST /studio/imports/file': [200, { job: { id: 7 }, uploadUrl: 'https://upload.example/new' }],
      'PATCH https://upload.example/new': [204, null],
      'POST /studio/imports/7/uploaded': [200, { job: { id: 7, status: 'queued' } }],
      'POST /studio/videos/5/replacement': [200, { uploadUrl: 'https://upload.example/swap' }],
      'PATCH https://upload.example/swap': [204, null],
    });
    const onQueued = vi.fn();
    render(
      <MemoryRouter>
        <StudioFileImport tier="plus" withComments onQueued={onQueued} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(sent('GET', '/studio/channel')).toHaveLength(1));
    const folder = [
      new File([TAKEOUT_CSV], 'videos.csv', { type: 'text/csv' }),
      new File(['x'.repeat(10)], 'Debate： Is Evolution True.mp4', { type: 'video/mp4' }),
      new File(['y'.repeat(10)], 'Guitar build part 2.mp4', { type: 'video/mp4' }),
      new File(['z'], 'Mystery clip.mp4', { type: 'video/mp4' }),
    ];
    fireEvent.change(screen.getByText('Pick a folder (Takeout)').querySelector('input'), {
      target: { files: folder },
    });

    expect(
      await screen.findByText(
        /3 files: 1 new, 1 already on the site \(replace\), 0 already queued, 1 not matched/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Adds about 70 minutes/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Upload 2 files' }));
    await waitFor(() => expect(onQueued).toHaveBeenCalled());

    const body = JSON.parse(sent('POST', '/studio/imports/file')[0][1].body);
    expect(body).toMatchObject({ video: 'AAAAAAAAAAA', size: 10, tier: 'plus', withComments: true });
    expect(sent('POST', '/studio/imports/7/uploaded')).toHaveLength(1);
    expect(sent('POST', '/studio/videos/5/replacement')).toHaveLength(1);
    expect(screen.getByText(/The helper adds its title, chat, and comments/)).toBeTruthy();
    expect(screen.getByText(/replaces the site’s copy once Cloudflare has processed it/)).toBeTruthy();
  });
});
