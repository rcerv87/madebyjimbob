import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { api, getToken, setToken } from './api.js';
import TopBar from './components/TopBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import SignInDialog from './components/SignInDialog.jsx';
import Home from './pages/Home.jsx';
import Watch from './pages/Watch.jsx';
import Studio from './pages/Studio.jsx';
import Playlists from './pages/Playlists.jsx';
import Playlist from './pages/Playlist.jsx';
import Posts from './pages/Posts.jsx';
import { useNotifications, NotificationToast } from './notifications.jsx';
import { IosInstallHint } from './install.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!getToken()) return;
    api('/me')
      .then((d) => setUser(d.user))
      .catch(() => setToken(null));
  }, []);

  const signOut = () => {
    api('/session', { method: 'DELETE' }).catch(() => {});
    setToken(null);
    setUser(null);
  };
  const session = { user, requireSignIn: () => setSigningIn(true) };
  const notes = useNotifications(user);

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <TopBar
        user={user}
        notes={notes}
        onSignIn={() => setSigningIn(true)}
        onSignOut={signOut}
        onMenu={() => setNavOpen((o) => !o)}
      />
      <Sidebar isAdmin={!!user?.isAdmin} onNavigate={() => setNavOpen(false)} />
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/playlists" element={<Playlists />} />
          <Route path="/playlist/:id" element={<Playlist />} />
          <Route path="/posts" element={<Posts />} />
          <Route path="/watch/:id" element={<Watch session={session} />} />
          <Route path="/studio" element={<Studio user={user} />} />
        </Routes>
      </main>
      <NotificationToast notes={notes} />
      <IosInstallHint />
      {signingIn && (
        <SignInDialog
          onClose={() => setSigningIn(false)}
          onSignedIn={(u) => {
            setUser(u);
            setSigningIn(false);
          }}
        />
      )}
    </div>
  );
}
