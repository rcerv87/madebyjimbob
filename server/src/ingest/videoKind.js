// A video's type for the dashboard filters, from yt-dlp metadata. Pure function.
// - live: it was a live stream (YouTube keeps was_live / live_status on the archived broadcast)
// - short: vertical and 3 minutes or less (YouTube's Shorts limit), or a /shorts/ URL
// - video: everything else
export function videoKind(meta = {}) {
  if (meta.was_live === true || meta.live_status === 'was_live' || meta.live_status === 'post_live')
    return 'live';
  const url = String(meta.webpage_url || meta.original_url || '');
  const vertical = Number(meta.height) > Number(meta.width);
  const short = Number(meta.duration) > 0 && Number(meta.duration) <= 180;
  if (url.includes('/shorts/') || (vertical && short)) return 'short';
  return 'video';
}
