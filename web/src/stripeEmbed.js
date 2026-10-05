// Stripe's checkout shown inside our pages (embedded): the viewer pays without leaving, so a live stream keeps playing.
// Stripe.js must load from js.stripe.com (never bundled), once per page. Replaceable in tests.

let loading = null;
const loadScript = () =>
  (loading ||= new Promise((resolve, reject) => {
    if (window.Stripe) return resolve(window.Stripe);
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/endive/stripe.js';
    s.async = true;
    s.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error('Stripe didn’t load.')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Couldn’t reach Stripe. Check the connection and try again.'));
    };
    document.head.appendChild(s);
  }));

const instances = new Map();

export const stripeEmbed = {
  // Mounts the checkout for a session into el; onComplete runs once it's paid. Returns a function that removes it.
  async mount({ publishableKey, clientSecret, el, onComplete }) {
    const Stripe = await loadScript();
    if (!instances.has(publishableKey)) instances.set(publishableKey, Stripe(publishableKey));
    const stripe = instances.get(publishableKey);
    const options = { fetchClientSecret: async () => clientSecret, onComplete };
    // Newer Stripe.js calls it createEmbeddedCheckoutPage; older releases initEmbeddedCheckout.
    const checkout = stripe.createEmbeddedCheckoutPage
      ? await stripe.createEmbeddedCheckoutPage(options)
      : await stripe.initEmbeddedCheckout(options);
    checkout.mount(el);
    return () => checkout.destroy();
  },
};
