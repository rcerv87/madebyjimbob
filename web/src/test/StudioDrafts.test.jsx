import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StudioDrafts from '../components/StudioDrafts.jsx';

const drafts = [{ id: '9', title: '2019 art stream', minTier: 'free', durationS: 1200, draft: true }];

function setup(status = 200, body = { ok: true }) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    calls.push([String(url), opts.method, opts.body ? JSON.parse(opts.body) : null]);
    return new Response(JSON.stringify(body), { status });
  });
  const onChanged = vi.fn();
  render(
    <MemoryRouter>
      <StudioDrafts drafts={drafts} onChanged={onChanged} />
    </MemoryRouter>,
  );
  return { calls, onChanged };
}

describe('Studio → Videos → Drafts', () => {
  test('give a draft its title and access, then publish', async () => {
    const { calls, onChanged } = setup();
    expect(screen.getByText('Drafts (1)')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Preview' }).getAttribute('href')).toBe('/watch/9');
    fireEvent.change(screen.getByRole('textbox', { name: 'Title for 2019 art stream' }), {
      target: { value: 'Art stream, March 2019' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Access for 2019 art stream' }), {
      target: { value: 'plus' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls).toEqual([
      ['/api/studio/videos/9', 'PATCH', { title: 'Art stream, March 2019', minTier: 'plus', draft: false }],
    ]);
  });

  test('delete asks first, and a refusal is shown', async () => {
    const { calls, onChanged } = setup(409, { error: 'Something is in the way.' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Something is in the way.');
    expect(calls[0].slice(0, 2)).toEqual(['/api/studio/videos/9', 'DELETE']);
    expect(onChanged).not.toHaveBeenCalled();
  });

  test('shows nothing when there are no drafts', () => {
    const { container } = render(
      <MemoryRouter>
        <StudioDrafts drafts={[]} onChanged={() => {}} />
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe('');
  });
});
