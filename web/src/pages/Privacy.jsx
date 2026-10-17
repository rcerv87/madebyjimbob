import { Link } from 'react-router-dom';
import useTitle from '../useTitle.js';

export const CONTACT_EMAIL = 'hello@madebyjimbob.app';
const UPDATED = 'October 16, 2026';

// The privacy policy (public; Google's sign-in consent screen and the app stores link to it). Keep it in step with
// what the site really collects: a new kind of personal data, service provider, or tracker means an update here.
export default function Privacy() {
  useTitle('Privacy policy');
  return (
    <article className="legal-page">
      <h1>Privacy policy</h1>
      <p className="muted">Last updated {UPDATED}</p>
      <p>
        MADEbyJIMBOB is JimBob’s home for his videos, live streams, art and community, on madebyjimbob.app and
        in the MADEbyJIMBOB apps for Android and iPhone. This page explains what we collect, why, who helps us
        run the site, and what you can do about it. Questions:{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
      <p>
        <strong>The short version:</strong> we collect what we need to run your account and the community, we
        don’t sell your information, we don’t show ads, and we don’t use advertising or analytics trackers.
        You can download your data or delete your account at any time from Account settings.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your account:</strong> username, email address, and password (stored only in a scrambled
          form we can’t read back), plus a display name, profile picture and bio if you add them. When you
          sign up you confirm you’re 13 or older.
        </li>
        <li>
          <strong>Sign in with Google:</strong> if you choose it, Google tells us your name, email address and
          profile picture. We use them only to create your account and sign you in. We don’t keep Google’s
          access tokens and we don’t get access to anything else in your Google account.
        </li>
        <li>
          <strong>What you post:</strong> chat messages, comments and replies, likes, reactions to moments in
          a video, and notes on videos (public, or private so only you see them). Reports you send, people you
          block or mute, and feedback you send (with the page you were on).
        </li>
        <li>
          <strong>What you watch:</strong> where you are in each video, what you’ve watched, your favorites,
          and view counts, so you can pick up where you left off on any device.
        </li>
        <li>
          <strong>Linked accounts:</strong> if you link your YouTube or Rumble name, we connect it to your
          account. Chat and comments posted publicly on JimBob’s YouTube channel are brought onto the site
          with the public name and picture they had there, so replays and discussions stay complete; linking
          your name shows them as yours.
        </li>
        <li>
          <strong>Memberships and super chats:</strong> payments are handled by Stripe, which holds your card
          details; we never see your full card number. We keep your membership level and its status, and the
          amount and message of super chats you send.
        </li>
        <li>
          <strong>Email:</strong> whether you asked for news from JimBob, which emails we sent you, and
          whether they were delivered, bounced or unsubscribed. People who signed up for the newsletter on
          JimBob’s store may be added to the news list too; every news email has an unsubscribe link.
        </li>
        <li>
          <strong>Sign-ins and security:</strong> for each signed-in device, its IP address and a description
          of the browser or device, and a record of security events such as sign-ins and password changes. You
          can see your devices in Account settings.
        </li>
        <li>
          <strong>Notifications:</strong> if you turn them on, your browser’s push address or the app’s
          notification token, so replies can reach that device.
        </li>
        <li>
          <strong>Cookies and storage:</strong> one cookie keeps you signed in on the website. Your browser
          also keeps a few things on your device: settings such as autoplay and the chat view, where you are
          in videos, and a random number that lets a signed-out visit count as one view per video per day
          without saying who you are. The apps keep your sign-in on your phone. There are no advertising or
          analytics cookies.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>
          To run the site and apps: your account, what you post, your memberships, and watching where you left
          off.
        </li>
        <li>
          To send email: account emails (confirming your address, password resets, account changes) always;
          news from JimBob only if you asked for it.
        </li>
        <li>To send notifications you turned on, such as replies to your comments.</li>
        <li>
          To keep the community safe: moderation (hiding messages, timeouts and bans), handling reports, and
          stopping spam and abuse.
        </li>
        <li>To fix problems and keep the service secure.</li>
      </ul>
      <p>We don’t sell or rent your personal information, and we don’t use it for advertising.</p>

      <h2>What other people can see</h2>
      <p>
        Your username, profile, chat messages, comments, public notes and reactions are public on the site.
        Private notes, your email address, what you watch, and your payments are not.
      </p>

      <h2>Who helps us run the service</h2>
      <p>These companies process data for us, only to provide their service:</p>
      <ul>
        <li>
          <strong>Render</strong> hosts the site and its database (United States).
        </li>
        <li>
          <strong>Cloudflare</strong> stores and delivers video, and runs the site’s domain and email
          forwarding.
        </li>
        <li>
          <strong>Stripe</strong> processes memberships and super chats.
        </li>
        <li>
          <strong>Resend</strong> sends our emails.
        </li>
        <li>
          <strong>Google</strong> provides Sign in with Google, delivers notifications in the apps (Firebase
          Cloud Messaging), and provides YouTube API Services.
        </li>
        <li>
          <strong>Hetzner</strong> runs the servers for live streams while JimBob is live (United States).
        </li>
        <li>
          <strong>Shopify</strong> runs JimBob’s store. The Shop and Art pages show its public products; when
          you buy something, you check out on Shopify under its own privacy policy.
        </li>
      </ul>
      <p>
        We may also share information when the law requires it, or to protect people from harm or the service
        from abuse.
      </p>

      <h2>YouTube</h2>
      <p>
        The site uses YouTube API Services to list JimBob’s videos and channel. By using those parts of the
        site you also agree to the{' '}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
          YouTube Terms of Service
        </a>
        , and Google’s handling of that data is covered by the{' '}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
          Google Privacy Policy
        </a>
        . You can remove the site’s access to your Google account at any time on{' '}
        <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">
          Google’s security settings page
        </a>
        .
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Edit your profile, and change which notifications you get, in Account settings.</li>
        <li>Stop news emails with the unsubscribe link in any of them, or in Account settings.</li>
        <li>
          <strong>Download your data</strong> as a file from Account settings → Privacy and data.
        </li>
        <li>
          <strong>Delete your account</strong> from Account settings → Privacy and data. It’s erased after 30
          days (signing in again before then cancels it). You choose whether your chat messages and comments
          are removed or stay in replays as “Deleted user”.
        </li>
        <li>
          Anything else, or if you can’t sign in: email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        We keep your information while you have an account. When an account is erased, everything tied to it
        is deleted except chat messages and comments you chose to keep as “Deleted user”, payment records we
        must keep for tax and accounting (held by Stripe and in our records), and the fact that an email
        address unsubscribed or bounced, so we never email it by mistake.
      </p>

      <h2>Children</h2>
      <p>
        MADEbyJIMBOB isn’t meant for children under 13, and you must be 13 or older to create an account. If
        you believe a child under 13 has an account, email us and we’ll delete it.
      </p>

      <h2>Security and where data is kept</h2>
      <p>
        Everything travels over encrypted connections, passwords are stored scrambled, and only the people who
        run the site can reach the data. Our servers and providers are in the United States, so your
        information is processed there.
      </p>

      <h2>Changes</h2>
      <p>
        When this policy changes we update it here and change the date at the top. For important changes we’ll
        also let members know on the site or by email.
      </p>
      <p>
        See also the <Link to="/terms">terms of service</Link>.
      </p>
    </article>
  );
}
