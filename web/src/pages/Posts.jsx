import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatTime } from '../api.js';
import { BRAND, money, sized } from '../brand.js';
import { POST_EXAMPLES } from '../postExamples.js';
import LibraryTabs from '../components/LibraryTabs.jsx';

const TIER_RANK = { free: 0, plus: 1, premium: 2 };

// Posts (MBJ-804) aren't built yet; this previews what they'll look like with example posts in
// JimBob's style, using the real video and store product they point to.
export default function Posts({ session }) {
  const [videos, setVideos] = useState([]);
  const [stickers, setStickers] = useState([]);

  useEffect(() => {
    api('/videos')
      .then((d) => setVideos(d.videos))
      .catch(() => {});
    api('/shop?collection=stickers')
      .then((d) => setStickers(d.products))
      .catch(() => {});
  }, []);

  return (
    <div className="library">
      <LibraryTabs />
      <p className="preview-note">
        <b>Preview.</b> These are example posts in JimBob’s style to show what Posts will look like. Posting
        from Studio, comments, and real polls are coming (MBJ-804).
      </p>
      <ol className="post-feed">
        {POST_EXAMPLES.map((p) => (
          <li key={p.id}>
            <PostCard
              p={p}
              video={p.videoTitle && videos.find((v) => v.title === p.videoTitle)}
              product={p.productHandle && stickers.find((s) => s.handle === p.productHandle)}
              userTier={session?.user?.tier || 'free'}
              requireSignIn={session?.requireSignIn}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PostCard({ p, video, product, userTier, requireSignIn }) {
  const locked = p.kind === 'members' && TIER_RANK[userTier] < TIER_RANK[p.tier?.toLowerCase() || 'plus'];
  return (
    <article className="post">
      <header className="post-head">
        <img className="post-avatar" src={BRAND.avatar} alt="" width="40" height="40" />
        <div>
          <b>{BRAND.name}</b>
          <span className="muted small">
            {' '}
            · {p.when} · <span className="example-tag">Example</span>
          </span>
        </div>
        {p.kind === 'members' && <span className={`tier-pill tier-${p.tier.toLowerCase()}`}>{p.tier}</span>}
      </header>

      {locked ? (
        <div className="post-locked">
          {p.images?.[0] && <img src={p.images[0].src} alt="" className="blurred" />}
          <div>
            <b>{p.tier} members only</b>
            <p className="muted">Join {p.tier} to see this post and the full library.</p>
            {requireSignIn && (
              <button type="button" className="primary-btn" onClick={requireSignIn}>
                Sign in
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <p className="post-text">{p.text}</p>
          {p.images && (
            <div className={`post-images n${p.images.length}`}>
              {p.images.map((im) => (
                <img key={im.src} src={im.src} alt={im.alt} loading="lazy" />
              ))}
            </div>
          )}
          {p.kind === 'poll' && <Poll options={p.options} />}
          {p.kind === 'video' && <VideoAttachment video={video} title={p.videoTitle} />}
          {p.kind === 'product' && <ProductAttachment product={product} title={p.productTitle} />}
        </>
      )}

      {p.tags && (
        <p className="post-tags">
          {p.tags.map((t) => (
            <span key={t}>#{t.replace(/\s+/g, '')}</span>
          ))}
        </p>
      )}
    </article>
  );
}

// Preview poll: counts only this browser's vote, nothing is saved.
function Poll({ options }) {
  const [picked, setPicked] = useState(null);
  return (
    <div className="poll" role="group" aria-label="Poll">
      {options.map((o, i) => (
        <button
          key={o}
          type="button"
          className="poll-option"
          aria-pressed={picked === i}
          onClick={() => setPicked(i)}
        >
          <span>{o}</span>
          {picked === i && <span className="poll-mine">Your pick</span>}
        </button>
      ))}
      <p className="muted small">
        {picked === null ? 'Tap an answer.' : 'In the real feature, results show here.'}
      </p>
    </div>
  );
}

function VideoAttachment({ video, title }) {
  if (!video) return <p className="muted small">Links to “{title}” once it’s on the site.</p>;
  return (
    <Link to={`/watch/${video.id}`} className="post-attachment">
      <span className="attach-thumb">
        {video.thumbnail && <img src={video.thumbnail} alt="" loading="lazy" />}
        {video.durationS ? <span className="duration">{formatTime(video.durationS)}</span> : null}
      </span>
      <span className="attach-body">
        <b>{video.title}</b>
        <span className="muted small">
          {video.chatCount ? `${video.chatCount.toLocaleString()} chat messages · ` : ''}Watch with live chat
          replay
        </span>
      </span>
    </Link>
  );
}

function ProductAttachment({ product, title }) {
  const href = product?.url || `${BRAND.store}/collections/stickers`;
  return (
    <a className="post-attachment" href={href} target="_blank" rel="noopener noreferrer">
      <span className="attach-thumb square">
        {product?.image && <img src={sized(product.image, 300)} alt="" loading="lazy" />}
      </span>
      <span className="attach-body">
        <b>{product?.title || title}</b>
        <span className="muted small">{product ? `${money(product.price)} · ` : ''}View in store ↗</span>
      </span>
    </a>
  );
}
