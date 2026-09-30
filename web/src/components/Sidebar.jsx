import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Home', d: 'M4 11 12 4l8 7v9h-5v-6H9v6H4z' },
  { to: '/studio', label: 'Studio', d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
];

export default function Sidebar({ isAdmin, onNavigate }) {
  return (
    <nav className="sidebar" aria-label="Main">
      {links
        .filter((l) => l.to !== '/studio' || isAdmin)
        .map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end
            onClick={onNavigate}
            className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}
          >
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path
                d={l.d}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
            <span>{l.label}</span>
          </NavLink>
        ))}
    </nav>
  );
}
