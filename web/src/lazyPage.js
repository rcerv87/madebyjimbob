import { lazy } from 'react';

// After a deploy, a tab opened earlier asks for page files that no longer exist (each build renames them), and the
// page went blank until a refresh. Now it reloads once to pick up the new version; a second failure within a minute
// shows the error instead of looping. `reload` is replaceable for tests.
export default function lazyPage(load, reload = () => window.location.reload()) {
  return lazy(() =>
    load().catch((err) => {
      try {
        const last = Number(sessionStorage.getItem('mbj.reloadedForUpdate')) || 0;
        if (Date.now() - last > 60_000) {
          sessionStorage.setItem('mbj.reloadedForUpdate', String(Date.now()));
          reload();
          return new Promise(() => {}); // the reload takes over
        }
      } catch {
        // storage blocked: fall through to the error
      }
      throw err;
    }),
  );
}
