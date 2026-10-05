import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import SuperchatForm from '../components/SuperchatForm.jsx';
import useTitle from '../useTitle.js';

// The link JimBob pins in his YouTube and Rumble chats and descriptions: madebyjimbob.app/superchat. Works any time:
// when he's live on the site it lands in the live chat, otherwise he sees it in Studio (and on his stream overlay).
export default function Superchat({ session }) {
  useTitle('Super chat');
  const [params] = useSearchParams();
  const sent = params.get('superchat') === 'sent';
  const [publishableKey, setPublishableKey] = useState(null);
  useEffect(() => {
    api('/membership')
      .then((d) => setPublishableKey(d.publishableKey || null))
      .catch(() => {});
  }, []);
  return (
    <div className="membership-page superchat-page">
      <h1>Super chat JimBob</h1>
      {sent ? (
        <div className="notice" role="status">
          <p>
            <strong>Thanks! Your super chat is on its way to JimBob.</strong>
          </p>
          <p>
            <Link to="/live">Watch live on the site</Link> · <Link to="/superchat">Send another</Link>
          </p>
        </div>
      ) : (
        <>
          <p className="muted">
            Watching on YouTube or Rumble? Send your super chat here: it goes to JimBob directly, and he sees
            it on his stream.
          </p>
          <SuperchatForm session={session} returnTo="/superchat" publishableKey={publishableKey} />
        </>
      )}
    </div>
  );
}
