// Small shared UI pieces used by the lists and panels.

export function ListSkeleton({ rows = 6 }) {
  return (
    <ul className="list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="list-item skeleton-row">
          <span className="skeleton skeleton-avatar" />
          <span className="skeleton-lines">
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line short" />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="search">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}

// Calls `onEnd` when a scrollable list is scrolled close to its bottom.
export const loadMoreOnScroll = (hasMore, onEnd) => (e) => {
  const el = e.currentTarget;
  if (hasMore && el.scrollTop + el.clientHeight >= el.scrollHeight - 60) onEnd();
};

export const errorText = (error) => error?.message || "Something went wrong";
