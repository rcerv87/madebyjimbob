import { useSyncExternalStore } from 'react';

// Where the video is, in ms. The player reports its time about 4 times a second; keeping that in the
// watch page's state would re-render the whole page (player, comments, up next) on every tick, so it
// lives here instead and only the parts that show the time subscribe.
export function createClock() {
  let ms = 0;
  const listeners = new Set();
  return {
    get: () => ms,
    set(next) {
      if (next === ms) return;
      ms = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// The clock's current time; re-renders the caller when it moves.
export const useClock = (clock) => useSyncExternalStore(clock.subscribe, clock.get);
