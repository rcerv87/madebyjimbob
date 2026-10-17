import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { api, setSignedIn } from './api.js';
import TopBar from './components/TopBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import SignInDialog, { googleError } from './components/SignInDialog.jsx';
import PickUsername from './components/PickUsername.jsx';
import FeedbackDialog from './components/FeedbackDialog.jsx';
import { WelcomeDialog } from './components/WelcomeSteps.jsx';
import AccountNotice from './components/AccountNotice.jsx';
import Home from './pages/Home.jsx';
import NotFound from './pages/NotFound.jsx';
import lazyPage from './lazyPage.js';

// Each page's code loads when it's opened (the watch page brings the video player library),
// so the first visit downloads only the shell and the Videos page.

const Watch = lazyPage(() => import('./pages/Watch.jsx'));
const Studio = lazyPage(() => import('./pages/Studio.jsx'));
const Live = lazyPage(() => import('./pages/Live.jsx'));
const Playlists = lazyPage(() => import('./pages/Playlists.jsx'));
const Playlist = lazyPage(() => import('./pages/Playlist.jsx'));
const Posts = lazyPage(() => import('./pages/Posts.jsx'));
const Shop = lazyPage(() => import('./pages/Shop.jsx'));
const Art = lazyPage(() => import('./pages/Art.jsx'));
const ResetPassword = lazyPage(() => import('./pages/ResetPassword.jsx'));
const Account = lazyPage(() => import('./pages/Account.jsx'));
const Profile = lazyPage(() => import('./pages/Profile.jsx'));
const Membership = lazyPage(() => import('./pages/Membership.jsx'));
const MembershipWelcome = lazyPage(() =>
  import('./pages/Membership.jsx').then((m) => ({ default: m.MembershipWelcome })),
);
const Superchat = lazyPage(() => import('./pages/Superchat.jsx'));
import { useNotifications, NotificationToast } from './notifications.jsx';
import { IosInstallHint } from './install.jsx';
import { useKeepPlaying } from './keepPlaying.js';
import { onAppLink, onAppResume, onBackButton, setAppToken } from './native.js';
import { forgetAppPush, onNotificationTap, refreshAppPush } from './push.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  // What the site offers right now (from /api/me): Send feedback during the beta.
  const [options, setOptions] = useState({});
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Right after signing up (MBJ-115): a short, skippable welcome on top of the page they were on.
  const [welcoming, setWelcoming] = useState(false);
  // Google sent them back with a problem (?auth=google&error=<code>): say so in the sign-in dialog, once.
  const [signInError] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('auth') !== 'google') return '';
    window.history.replaceState(null, '', window.location.pathname);
    return p.get('error') ? googleError(p.get('error')) : '';
  });
  useEffect(() => {
    if (signInError) setSigningIn('signin');
  }, [signInError]);
  const [navOpen, setNavOpen] = useState(false);

  // The session cookie (if any) says who this is; progress saving and sockets follow along.
  const refreshUser = useCallback((u) => {
    if (u !== undefined) return setUser(u);
    api('/me')
      .then((d) => {
        // In an app, a token the site no longer knows (signed out elsewhere, password changed) is dropped.
        if (!d.user) setAppToken(null);
        setUser(d.user);
        setOptions(d.options || {});
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);
  // In the phone apps: a link to the site opens that page here, and the Android back button walks back through the
  // app's pages before leaving it (MBJ-408).
  // Registered once; the latest navigate is read through a ref (it changes on every page).
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    let gone = false;
    const stops = [];
    const keep = (stop) => (gone ? stop() : stops.push(stop));
    onAppLink((path) => navigateRef.current(path)).then(keep);
    onBackButton(() => navigateRef.current('/', { replace: true })).then(keep);
    // A tapped notification opens the reply it's about (MBJ-405).
    onNotificationTap((path) => navigateRef.current(path)).then(keep);
    return () => {
      gone = true;
      stops.forEach((stop) => stop());
    };
  }, []);
  // In the phone apps: coming back from the browser (after paying, say) refreshes who this is.
  useEffect(() => {
    let gone = false;
    let stop = () => {};
    onAppResume(() => refreshUser()).then((s) => {
      if (gone) s();
      else stop = s;
    });
    return () => {
      gone = true;
      stop();
    };
  }, [refreshUser]);
  useEffect(() => setSignedIn(Boolean(user)), [user]);
  // In the phone apps: once signed in, this phone gets that account's notifications (if they're allowed).
  const userId = user?.id;
  useEffect(() => {
    if (userId) refreshAppPush();
  }, [userId]);

  const signOut = () => {
    // The phone forgets this account's notifications first, while it's still signed in.
    forgetAppPush()
      .then(() => api('/auth/sign-out', { method: 'POST' }))
      .catch(() => {})
      .finally(() => setAppToken(null));
    setUser(null);
  };
  // requireSignIn() or requireSignIn('signup' | 'forgot'); also safe as a click handler.
  const session = {
    user,
    requireSignIn: (mode) => setSigningIn(typeof mode === 'string' ? mode : 'signin'),
    refreshUser,
  };
  const notes = useNotifications(user);
  const { watchAt, background } = useKeepPlaying();

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <TopBar
        onFeedback={options.feedback ? () => setFeedbackOpen(true) : undefined}
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
            <Route path="/studio/*" element={<Studio user={user} />} />
            <Route path="/live" element={<Live session={session} />} />
            <Route path="/membership" element={<Membership session={session} />} />
            <Route path="/membership/welcome" element={<MembershipWelcome session={session} />} />
            <Route path="/superchat" element={<Superchat session={session} />} />
            <Route path="/reset-password" element={<ResetPassword session={session} />} />
            <Route path="/account" element={<Account session={session} onUserChanged={refreshUser} />} />
            {/* /@username profiles (MBJ-116); anything else here is a 404 page. */}
            <Route path="/:handle" element={<Profile session={session} />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <NotificationToast notes={notes} />
      <IosInstallHint />
      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
      {user?.needsUsername && (
        // Joined through Google: the welcome follows once they have their username.
        <PickUsername
          user={user}
          onDone={() => {
            refreshUser();
            setWelcoming(true);
          }}
        />
      )}
      {welcoming && user && !user.needsUsername && (
        <WelcomeDialog user={user} onClose={() => setWelcoming(false)} />
      )}
      {signingIn && (
        <SignInDialog
          initialMode={signingIn}
          initialError={signInError}
          onClose={() => setSigningIn(false)}
          onSignedIn={(u, { isNew } = {}) => {
            setUser(u);
            setSigningIn(false);
            if (isNew) setWelcoming(true);
          }}
        />
      )}
    </div>
  );
}
