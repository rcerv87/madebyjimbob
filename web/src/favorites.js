// Highlight colors in chat (MBJ-219: 5 quick colors, one person each, per chat) and favorite members (MBJ-220,
// Premium: highlighted in every chat and comment section, more colors). The class `hl-<color>` sets the tint.
export const HIGHLIGHT_COLORS = ['red', 'yellow', 'blue', 'purple', 'green'];
export const FAVORITE_COLORS = [
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
];

// username (lowercase) → color, for a signed-in viewer's favorites (empty unless they're Premium).
export const favoriteMap = (user) =>
  new Map((user?.favorites || []).map((f) => [f.username.toLowerCase(), f.color]));
