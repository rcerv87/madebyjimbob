import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import lazyPage from '../lazyPage.js';

describe('pages after a deploy', () => {
  test('a missing page file reloads the page once', async () => {
    sessionStorage.removeItem('mbj.reloadedForUpdate');
    const reload = vi.fn();
    const Page = lazyPage(
      () => Promise.reject(new Error('Failed to fetch dynamically imported module')),
      reload,
    );
    render(
      <Suspense fallback={<p>loading</p>}>
        <Page />
      </Suspense>,
    );
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.getByText('loading')).toBeTruthy();
  });

  test('a page that loads is shown, with no reload', async () => {
    const reload = vi.fn();
    const Page = lazyPage(() => Promise.resolve({ default: () => <p>the page</p> }), reload);
    render(
      <Suspense fallback={<p>loading</p>}>
        <Page />
      </Suspense>,
    );
    expect(await screen.findByText('the page')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });
});
