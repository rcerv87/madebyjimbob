import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StudioUploader from '../components/StudioUploader.jsx';

const ready = {
  storageReady: true,
  download: { url: 'https://r2.example/uploader.zip?sig=1', sizeBytes: 163431192, updatedAt: new Date() },
  username: 'jimbob',
  hasPassword: true,
  progress: { done: 12, uploading: 1, lastFinishedAt: new Date(), lastTitle: 'Evolution Debate' },
};
const serve = (status) => {
  globalThis.fetch = vi.fn(async () => Response.json(status));
};
const next = (name) => fireEvent.click(screen.getByRole('button', { name: `Next: ${name}` }));

describe('Studio → Library uploader', () => {
  beforeEach(() => window.localStorage.clear());

  test('walks through the steps: download, folder, start, and live progress', async () => {
    serve(ready);
    render(
      <MemoryRouter>
        <StudioUploader />
      </MemoryRouter>,
    );
    expect(screen.getByText('Step 1 of 5: Before you start')).toBeTruthy();
    expect(await screen.findByText('jimbob')).toBeTruthy();

    next('Get the program');
    const link = await screen.findByRole('link', { name: 'Download the uploader (163 MB)' });
    expect(link.getAttribute('href')).toBe(ready.download.url);

    next('Make the folder');
    expect(screen.getByText('MADEbyJIMBOB Library')).toBeTruthy();
    expect(screen.getByText('Not on YouTube')).toBeTruthy();
    next('Start it');
    expect(screen.getByText(/Windows protected your PC/)).toBeTruthy();
    next('Let it run');
    expect(await screen.findByText('12 videos uploaded')).toBeTruthy();
    expect(screen.getByText(/Evolution Debate/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Next/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Step 4 of 5: Start it')).toBeTruthy();
  });

  test('remembers the step, and says so when the download or a password is missing', async () => {
    window.localStorage.setItem('mbj-uploader-step', '1');
    serve({ ...ready, download: null, hasPassword: false });
    render(
      <MemoryRouter>
        <StudioUploader />
      </MemoryRouter>,
    );
    expect(screen.getByText('Step 2 of 5: Get the program')).toBeTruthy();
    expect(await screen.findByText(/needs to be published/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(/signs in with Google and has no password yet/)).toBeTruthy();
  });
});
