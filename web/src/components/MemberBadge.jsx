// Plus / Premium next to the name of a member whose YouTube or Rumble account is linked (MBJ-215).
export default function MemberBadge({ tier }) {
  if (!tier || tier === 'free') return null;
  return (
    <span className={`tier-pill tier-${tier} member-badge`}>{tier === 'plus' ? 'Plus' : 'Premium'}</span>
  );
}
