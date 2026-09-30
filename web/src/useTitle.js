import { useEffect } from 'react';

// Browser tab title while this page is open; matches what the server sends for link previews.
// shown=false leaves the title to the page on screen (the watch page kept behind the Mini player).
export default function useTitle(title, shown = true) {
  useEffect(() => {
    if (shown) document.title = title ? `${title} · MADEbyJIMBOB` : 'MADEbyJIMBOB';
  }, [title, shown]);
}
