// Example posts for the Posts preview, modeled on the kinds of posts JimBob makes on YouTube
// (icon-painting progress, debate call-outs, polls) plus what the platform adds (members-only posts,
// store drops, stream links). Captions are written for the preview, not copied from YouTube. Real posting
// arrives with MBJ-804; delete this file then.
export const POST_EXAMPLES = [
  {
    id: 'ex-icon',
    kind: 'images',
    when: 'Work in progress',
    text: 'Icon update: gold leaf is down and the robes are blocked in. Faces and hands next, which is the part that takes the longest.',
    images: [
      {
        src: '/brand/posts/icon-gold.jpg',
        alt: 'Icon board with gold leaf applied and the robes painted in flat colors',
      },
      {
        src: '/brand/posts/icon-painting.jpg',
        alt: 'The same icon further along, with ornaments and the book painted',
      },
    ],
    tags: ['Icon painting'],
  },
  {
    id: 'ex-poll',
    kind: 'poll',
    when: 'Poll',
    text: 'Who should I debate next? Top answer gets an invite for next week’s stream.',
    options: [
      'An atheist YouTuber',
      'A Protestant apologist',
      'An evolution professor',
      'You pick (comments)',
    ],
  },
  {
    id: 'ex-stream',
    kind: 'video',
    when: 'Stream',
    text: 'Round two is coming. If you missed the first one, here it is with the full live chat replay.',
    videoTitle: 'Evolution Debate',
  },
  {
    id: 'ex-members',
    kind: 'members',
    when: 'Members only',
    tier: 'Plus',
    text: 'Plus members: the full time-lapse of this icon from bare board to gold, plus the brushes and paints I use.',
    images: [{ src: '/brand/posts/icon-drawing.jpg', alt: 'The icon drawn in pencil on a prepared board' }],
  },
  {
    id: 'ex-store',
    kind: 'product',
    when: 'Store',
    text: 'New Orthodox sticker pack is up in the shop. Stick them on your laptop and start conversations.',
    productHandle: 'orthodox-sticker-pack-2026',
    productTitle: 'Orthodox Sticker Pack',
  },
  {
    id: 'ex-qa',
    kind: 'text',
    when: 'Q&A',
    text: 'Q&A Friday. Leave your questions below and I’ll answer the best ones on Friday’s stream. Timestamps will be in the notes.',
  },
];
