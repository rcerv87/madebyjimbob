import { NavLink } from 'react-router-dom';

// The three main sections of the library.
export default function LibraryTabs() {
  const tab = ({ isActive }) => `library-tab ${isActive ? 'active' : ''}`;
  return (
    <nav className="library-tabs" aria-label="Library">
      <NavLink to="/" end className={tab}>
        Videos
      </NavLink>
      <NavLink to="/playlists" className={tab}>
        Playlists
      </NavLink>
      <NavLink to="/posts" className={tab}>
        Posts
      </NavLink>
    </nav>
  );
}
