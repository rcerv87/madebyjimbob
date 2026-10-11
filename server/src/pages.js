// Page HTML with each page's own title, description, and link-preview tags (Open Graph / Twitter).
// The app draws pages in the browser, so without this every link preview and crawler would see the
// same empty page. Unknown pages get a real 404. Until ALLOW_INDEXING=true (the real domain is live,
// ADR-011), every page carries noindex so the onrender preview stays out of search; previews still work.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';
import { playback } from './stream.js';
import { findProfile } from './profiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_INDEX = path.join(__dirname, '../../web/dist/index.html');

const SITE_NAME = 'MADEbyJIMBOB';
const DEFAULT_DESCRIPTION =
  "JimBob's live streams, debates, and art. Watch with the original live chat, comment, and join the community. Live on YouTube weekdays around 12:00pm ET.";
const DEFAULT_IMAGE = '/brand/header-art.jpg';

// Used when the web app hasn't been built (tests, a fresh checkout).
const FALLBACK_TEMPLATE =
  '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>MadeByJimBob</title>' +
  '<meta name="description" content="" /></head><body><div id="root"></div></body></html>';

// The built page, read again only when a new build replaces it (a cheap stat per request, not a read).
let template = { mtimeMs: null, html: FALLBACK_TEMPLATE };
function loadTemplate() {
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(DIST_INDEX).mtimeMs;
  } catch {
    return FALLBACK_TEMPLATE;
  }
  if (template.mtimeMs !== mtimeMs) template = { mtimeMs, html: fs.readFileSync(DIST_INDEX, 'utf8') };
  return template.html;
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const summary = (text, max = 200) => {
  const flat = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : flat;
};

const page = (title, description = DEFAULT_DESCRIPTION, extra = {}) => ({
  status: 200,
  title: title ? `${title} · ${SITE_NAME}` : SITE_NAME,
  description,
  image: DEFAULT_IMAGE,
  type: 'website',
  ...extra,
});

const notFound = () => ({ ...page('Page not found'), status: 404, noindex: true });

// What a URL is, for its preview. Returns { status, title, description, image, type, noindex }.
export async function pageMeta(pathname) {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return page(null);
  if (p === '/playlists') return page('Playlists', "Playlists of JimBob's streams, debates, and animations.");
  if (p === '/posts') return page('Posts', "JimBob's updates, work in progress, and polls.");
  if (p === '/shop') return page('Shop', "Books, shirts, stickers, and art prints from JimBob's store.");
  if (p === '/art')
    return page('Art', "JimBob's illustrations and comics: originals, prints, and digital art.");
  if (/^\/studio(\/(live|videos|add|members|reports|email))?$/.test(p))
    return { ...page('Studio'), noindex: true };
  if (p === '/live') return page('JimBob live', 'Watch JimBob live on MADEbyJIMBOB.');
  if (p === '/superchat')
    return page(
      'Super chat JimBob',
      'Send JimBob a super chat from anywhere, even while you watch on YouTube or Rumble.',
    );
  if (p === '/membership')
    return page(
      'Membership',
      'Join Plus or Premium: the full library, member streams, and perks. Supports JimBob directly.',
    );
  if (p === '/membership/welcome') return { ...page('Welcome'), noindex: true };
  if (p === '/reset-password') return { ...page('Reset password'), noindex: true };
  if (p === '/account') return { ...page('Account settings'), noindex: true };

  // Profiles (MBJ-116): out of search unless the member allows it.
  const profile = p.match(/^\/@([A-Za-z0-9_]{3,32})$/);
  if (profile) {
    const u = await findProfile(profile[1]);
    if (!u) return notFound();
    const name = u.display_name || u.username;
    return {
      ...page(
        `${name} (@${u.username})`,
        `${name} on MADEbyJIMBOB: comments and chat in JimBob's community.`,
      ),
      noindex: !u.profile_indexable,
    };
  }

  const watch = p.match(/^\/watch\/(\d{1,18})$/);
  if (watch) {
    const { rows } = await pool.query(
      'SELECT id, title, description, stream_uid, duration_s, published_at FROM videos WHERE id = $1',
      [watch[1]],
    );
    const v = rows[0];
    if (!v) return notFound();
    return page(v.title, summary(v.description) || `Watch ${v.title} with the original live chat.`, {
      image: playback(v.stream_uid)?.thumbnail?.replace(/height=\d+/, 'height=720') || DEFAULT_IMAGE,
      type: 'video.other',
      durationS: v.duration_s,
      publishedAt: v.published_at,
    });
  }

  const list = p.match(/^\/playlist\/(\d{1,18})$/);
  if (list) {
    const { rows } = await pool.query(
      `SELECT p.title, p.description,
         (SELECT v.stream_uid FROM playlist_items pi
            JOIN videos v ON v.id = pi.video_id OR (pi.video_id IS NULL AND v.youtube_id = pi.youtube_id)
          WHERE pi.playlist_id = p.id ORDER BY pi.position LIMIT 1) AS stream_uid
       FROM playlists p WHERE p.id = $1`,
      [list[1]],
    );
    if (!rows[0]) return notFound();
    return page(
      rows[0].title,
      summary(rows[0].description) || `A playlist of JimBob's videos: ${rows[0].title}.`,
      {
        image: playback(rows[0].stream_uid)?.thumbnail?.replace(/height=\d+/, 'height=720') || DEFAULT_IMAGE,
      },
    );
  }

  return notFound();
}

export function renderPage(meta, { siteUrl, url, indexing }) {
  const abs = (u) => (/^https?:\/\//.test(u) ? u : `${siteUrl}${u}`);
  const noindex = meta.noindex || !indexing;
  const tags = [
    `<link rel="canonical" href="${esc(url)}" />`,
    noindex ? '<meta name="robots" content="noindex" />' : '',
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:type" content="${esc(meta.type)}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(abs(meta.image))}" />`,
    meta.durationS ? `<meta property="video:duration" content="${Number(meta.durationS)}" />` : '',
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta name="twitter:site" content="@byjimbob" />',
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${esc(abs(meta.image))}" />`,
  ]
    .filter(Boolean)
    .join('\n    ');

  // Replacer functions, so a "$" in a title or description is never read as a pattern like $& or $'.
  return loadTemplate()
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(meta.title)}</title>`)
    .replace(
      /<meta name="description"[^>]*>/,
      () => `<meta name="description" content="${esc(meta.description)}" />`,
    )
    .replace('</head>', () => `    ${tags}\n  </head>`);
}
