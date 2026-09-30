// React Router v7 behavior, switched on now (the app and the tests use the same flags): navigations run
// as transitions, so the current page stays up while the next page's code loads instead of flashing
// "Loading…", and relative links inside splat routes resolve the v7 way.
export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };
