import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { api, setSignedIn } from './api.js';
import TopBar from './components/TopBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import SignInDialog from './components/SignInDialog.jsx';
import AccountNotice from './components/AccountNotice.jsx';
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
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
const Account = lazy(() => import('./pages/Account.jsx'));
import { useNotifications, NotificationToast } from './notifications.jsx';
import { IosInstallHint } from './install.jsx';
import { useKeepPlaying } from './keepPlaying.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // The session cookie (if any) says who this is; progress saving and sockets follow along.
  const refreshUser = useCallback((u) => {
    if (u !== undefined) return setUser(u);
    api('/me')
      .then((d) => setUser(d.user))
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);
  useEffect(() => setSignedIn(Boolean(user)), [user]);

  const signOut = () => {
    api('/auth/sign-out', { method: 'POST' }).catch(() => {});
    setUser(null);
  };
  // requireSignIn() or requireSignIn('signup' | 'forgot'); also safe as a click handler.
  const session = { user, requireSignIn: (mode) => setSigningIn(typeof mode === 'string' ? mode : 'signin') };
  const notes = useNotifications(user);
  const { watchAt, background } = useKeepPlaying();

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <TopBar
        user={user}
        notes={notes}
        onSignIn={() => setSigningIn('signin')}
        onSignOut={signOut}
        onMenu={() => setNavOpen((o) => !o)}
      />
      <Sidebar isAdmin={!!user?.isAdmin} onNavigate={() => setNavOpen(false)} />
      <main className="main">
        <AccountNotice user={user} onUserChanged={refreshUser} />
        {/* Its own spot and Routes, so it stays mounted (hidden) while its video plays in the Mini player. */}
        {watchAt && (
          <div hidden={background}>
            <Suspense fallback={<p className="muted page-msg">Loading…</p>}>
              <Routes location={watchAt}>
                <Route path="/watch/:id" element={<Watch session={session} background={background} />} />
              </Routes>
            </Suspense>
          </div>
        )}
        <Suspense fallback={<p className="muted page-msg">Loading…</p>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/playlists" element={<Playlists />} />
            <Route path="/playlist/:id" element={<Playlist />} />
            <Route path="/posts" element={<Posts session={session} />} />
            <Route path="/shop" element={<Shop />} />
            <Route path="/art" element={<Art />} />
            <Route path="/watch/:id" element={null} />
            <Route path="/studio" element={<Studio user={user} />} />
            <Route path="/reset-password" element={<ResetPassword session={session} />} />
            <Route path="/account" element={<Account session={session} onUserChanged={refreshUser} />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <NotificationToast notes={notes} />
      <IosInstallHint />
      {signingIn && (
        <SignInDialog
          initialMode={signingIn}
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
