import { Link } from 'react-router-dom';
import useTitle from '../useTitle.js';
import { CONTACT_EMAIL } from './Privacy.jsx';

const UPDATED = 'October 17, 2026';

// The terms of service (public; Google's sign-in consent screen and the app stores link to it).
export default function Terms() {
  useTitle('Terms of service');
  return (
    <article className="legal-page">
      <h1>Terms of service</h1>
      <p className="muted">Last updated {UPDATED}</p>
      <p>
        These terms cover your use of MADEbyJIMBOB: the website madebyjimbob.app and the Jortlandia app for
        Android and iPhone. By using them you agree to these terms and to the{' '}
        <Link to="/privacy">privacy policy</Link>. If you don’t agree, please don’t use the service.
        Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>
          You must be 13 or older to create an account. If you’re under 18, you need a parent’s or guardian’s
          OK.
        </li>
        <li>
          Keep your sign-in details to yourself; you’re responsible for what happens on your account. Tell us
          if you think someone else is using it.
        </li>
        <li>
          Don’t pretend to be someone else, and pick a username that isn’t offensive or misleading. We may
          change or reclaim a username that breaks these rules.
        </li>
      </ul>

      <h2>Community rules</h2>
      <p>The chat, comments, notes and profiles are for everyone. Debate hard, but don’t:</p>
      <ul>
        <li>harass, threaten, or bully anyone, or encourage others to;</li>
        <li>post hate against people for who they are;</li>
        <li>share someone’s private information;</li>
        <li>post anything sexual involving minors, sexual content without consent, or graphic violence;</li>
        <li>spam, scam, or post links to malware;</li>
        <li>post anything illegal, or that infringes someone else’s copyright or other rights;</li>
        <li>get around a timeout or ban with another account.</li>
      </ul>
      <p>
        JimBob and his moderators can hide messages, time members out (they can still watch, but not post), or
        ban accounts. We decide what breaks these rules. Use Report on anything you think does.
      </p>

      <h2>What you post</h2>
      <p>
        You keep ownership of what you post. You give MADEbyJIMBOB permission to host, show, and keep it on
        the site and in the apps, including in video replays where chat plays back at the moment it was sent,
        and to use it to run and promote the service (for example, a highlight from a stream). You can delete
        your posts; if you delete your account you choose whether they’re removed or stay as “Deleted user”.
        Only post what you have the right to share.
      </p>

      <h2>JimBob’s videos and art</h2>
      <p>
        The videos, streams, art and other content on MADEbyJIMBOB belong to JimBob or the people who made
        them. You can watch, listen, and share links for your own personal use. Don’t download, copy,
        re-upload, or resell them except through features the service gives you.
      </p>

      <h2>Memberships</h2>
      <ul>
        <li>
          Plus and Premium are paid memberships, billed monthly or yearly through Stripe at the price shown
          when you join. They renew automatically until you cancel.
        </li>
        <li>
          Cancel any time in Account settings → Membership → Manage billing. You keep your membership until
          the end of the period you paid for.
        </li>
        <li>
          Payments aren’t refunded for partial periods, except where the law requires it. If something went
          wrong, email us and we’ll look at it.
        </li>
        <li>
          What each membership includes can change over time. If a price changes, we’ll tell you before it
          applies to your next renewal.
        </li>
      </ul>

      <h2>Super chats</h2>
      <p>
        A super chat is a voluntary payment to support JimBob, with a message shown in the chat. It isn’t a
        purchase of anything, and it isn’t refunded, except for a mistake you tell us about promptly or where
        the law requires it. Super chats follow the community rules: one that breaks them may be hidden
        without a refund.
      </p>

      <h2>JimBob’s store</h2>
      <p>
        The Shop and Art pages show products from JimBob’s store. Buying happens on the store’s own checkout
        (Shopify), under the store’s terms and policies.
      </p>

      <h2>The apps</h2>
      <p>
        These terms apply to the Android and iPhone apps too, along with the rules of the store you got the
        app from. Apple and Google aren’t responsible for the apps or their content.
      </p>

      <h2>The service</h2>
      <p>
        We work to keep MADEbyJIMBOB running, but streams, videos and features can change, pause, or end, and
        the service may sometimes be unavailable. We may end or suspend accounts that break these terms. You
        can stop using the service and delete your account at any time.
      </p>

      <h2>Disclaimers and limits</h2>
      <p>
        The service is provided “as is”. Opinions in videos, streams, chat and comments belong to the people
        who express them. As far as the law allows, MADEbyJIMBOB isn’t liable for indirect or consequential
        losses, and our total liability to you is limited to what you paid us in the 12 months before the
        claim. Nothing here takes away rights you have under laws that can’t be waived.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. We’ll change the date at the top, and for important changes we’ll let
        members know on the site or by email before they take effect. Using the service after that means you
        accept the new terms.
      </p>
    </article>
  );
}
