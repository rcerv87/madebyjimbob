import { Link } from 'react-router-dom';
import useTitle from '../useTitle.js';

export default function NotFound() {
  useTitle('Page not found');
  return (
    <div className="page-msg">
      <h2>Page not found</h2>
      <p className="muted">
        That link doesn’t go anywhere on the site. It may have moved or been typed wrong.
      </p>
      <p>
        <Link to="/" className="primary-btn">
          Go to videos
        </Link>
      </p>
    </div>
  );
}
