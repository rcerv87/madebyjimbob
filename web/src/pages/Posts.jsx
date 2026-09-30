import LibraryTabs from '../components/LibraryTabs.jsx';

// Posts (MBJ-804) are the next release after the Videos section and the live indicator.
export default function Posts() {
  return (
    <div className="library">
      <LibraryTabs />
      <div className="page-msg">
        <h2>Posts are coming soon</h2>
        <p className="muted">
          JimBob’s updates, photos, and polls will live here, with the same threaded comments as videos.
        </p>
      </div>
    </div>
  );
}
