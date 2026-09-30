import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Videos', d: 'M4 11 12 4l8 7v9h-5v-6H9v6H4z' },
  { to: '/playlists', label: 'Playlists', d: 'M4 6h12M4 11h12M4 16h7M16 14v6l5-3z' },
  { to: '/posts', label: 'Posts', d: 'M5 4h14v12H9l-4 4z' },
  { to: '/shop', label: 'Shop', d: 'M5 8h14l-1 12H6zM9 8a3 3 0 0 1 6 0' },
  { to: '/art', label: 'Art', d: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4' },
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
