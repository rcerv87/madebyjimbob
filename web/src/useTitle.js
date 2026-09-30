import { useEffect } from 'react';

// Browser tab title while this page is open; matches what the server sends for link previews.
export default function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · MADEbyJIMBOB` : 'MADEbyJIMBOB';
  }, [title]);
}
