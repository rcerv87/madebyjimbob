import { useEffect } from 'react';
import { createPortal } from 'react-dom';

// What everything in the chat does, behind the ? in its header.
export default function ChatHelp({ live, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog chat-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="chat-help-title">How the chat works</h2>

        <h3>People</h3>
        <dl>
          <dt>Tap a name</dt>
          <dd>
            Puts <b>@name</b> in your message. That’s a <b>mention</b>: they get a notification.
          </dd>
          <dt>Tap a picture</dt>
          <dd>Opens their menu with everything below.</dd>
          <dt>Reply</dt>
          <dd>Quotes their message above yours and notifies them. Tap a quote to jump to the original.</dd>
          <dt>Show only their messages</dt>
          <dd>Hides everyone else until you tap Show everyone.</dd>
          <dt>Highlight</dt>
          <dd>
            Colors their messages so you can spot them. 5 colors, one person each, for this chat only. A new
            stream starts clean.
          </dd>
          <dt>
            ★ Favorite <span className="tier-pill tier-premium">Premium</span>
          </dt>
          <dd>
            Highlights them in your color in every chat and comment section, on all your devices. 10 colors.
            Manage them in Account settings.
          </dd>
          <dt>View profile</dt>
          <dd>Their page, with recent comments.</dd>
          <dt>Mute, Block, Report</dt>
          <dd>
            Mute and Block hide their chat and comments from you (blocked members also can’t reply to you).
            Report sends the message to the moderators. Undo in Account settings.
          </dd>
        </dl>

        <h3>Messages</h3>
        <dl>
          <dt>Type @</dt>
          <dd>Suggests names from this chat.</dd>
          <dt>Time on a message</dt>
          <dd>Tap it to play the video from that moment.</dd>
          {live ? (
            <>
              <dt>Joined late?</dt>
              <dd>The last 10 minutes of chat are loaded. Scroll up to read them.</dd>
              <dt>Saved with the replay</dt>
              <dd>Everything said live shows up at its moment when people watch later.</dd>
            </>
          ) : (
            <>
              <dt>Live only / Live + replay</dt>
              <dd>
                Live only shows the chat exactly as it happened during the stream. Live + replay adds messages
                from people watching later and timestamped comments.
              </dd>
              <dt>Chat while watching</dt>
              <dd>Your message is saved at this moment in the video, and everyone watching sees it.</dd>
            </>
          )}
          <dt>Jump to latest</dt>
          <dd>Shows up when you scroll back. Tap it to catch up.</dd>
          <dt>YT and JB tags</dt>
          <dd>YT came from YouTube; JB was posted here.</dd>
        </dl>

        <div className="dialog-actions">
          <button type="button" className="primary-btn" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
