// What each tier includes (MBJ-104/105): the membership page and Account settings show this table.
// Each row: [perk, Free, Plus, Premium], where true = included, false = not, a string = a short note.
export const PERKS = [
  ['Free videos', true, true, true],
  ['The full video library', false, true, true],
  ['Premium-only streams and early access', false, false, true],
  ['Post in chat', 'Slow mode', true, true],
  ['Listen only and background audio', false, true, true],
  ['Member podcast feed', false, true, true],
  ['Chat badge', false, 'Plus', 'Premium'],
  ['Call in to live shows', false, false, true],
  ['Favorite members, highlighted in every chat', false, false, true],
];

export const TIERS = ['free', 'plus', 'premium'];

// 500 → "$5", 1250 → "$12.50".
export function money(cents, currency = 'usd') {
  const value = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

// Sends the viewer to Stripe's page (checkout, billing, or a super chat). Replaceable in tests.
export const goTo = { url: (u) => window.location.assign(u) };
