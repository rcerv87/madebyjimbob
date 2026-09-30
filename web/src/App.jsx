import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { api, getToken, setToken } from './api.js';
import TopBar from './components/TopBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import SignInDialog from './components/SignInDialog.jsx';
import Home from './pages/Home.jsx';
import NotFound from './pages/NotFound.jsx';

// Each page's code loads when it's opened (the watch page brings the video player library),
// so the first visit downloads only the shell and the Videos page.
const Watch = lazy(() => import('./pages/Watch.jsx'));
const Studio = lazy(() => import('./pages/Studio.jsx'));
const Playlists = lazy(() => import('./pages/Playlists.jsx'));
const Playlist = lazy(() => import('./pages/Playlist.jsx'));
const Posts = lazy(() => import('./pages/Posts.jsx'));
const Shop = lazy(() => import('./pages/Shop.jsx'));
const Art = lazy(() => import('./pages/Art.jsx'));
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
        <Suspense fallback={<p className="muted page-msg">Loading…</p>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/playlists" element={<Playlists />} />
            <Route path="/playlist/:id" element={<Playlist />} />
            <Route path="/posts" element={<Posts session={session} />} />
            <Route path="/shop" element={<Shop />} />
            <Route path="/art" element={<Art />} />
            <Route path="/watch/:id" element={<Watch session={session} />} />
            <Route path="/studio" element={<Studio user={user} />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
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
