import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import { ListSkeleton, SearchBox, errorText, loadMoreOnScroll } from "./common";
import { previewText } from "../services/cometchat";
import { formatTime } from "../utils/format";

export default function ConversationList({
  conversations,
  loading,
  error,
  hasMore,
  onLoadMore,
  activeKey,
  onSelect,
  muted,
  onToggleMute,
  onDelete,
}) {
  const [query, setQuery] = useState("");
  const [menuKey, setMenuKey] = useState(null);

  // Close the row menu on any outside click.
  useEffect(() => {
    if (!menuKey) return;
    const close = (e) => !e.target.closest(".row-menu, .row-menu-btn") && setMenuKey(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuKey]);

  const q = query.trim().toLowerCase();
  const visible = q
    ? conversations.filter(
        (c) => c.target.name.toLowerCase().includes(q) || previewText(c.lastMessage).toLowerCase().includes(q),
      )
    : conversations;

  return (
    <>
      <SearchBox value={query} onChange={setQuery} placeholder="Search chats" />
      {loading ? (
        <ListSkeleton />
      ) : error ? (
        <p className="list-empty error">{errorText(error)}</p>
      ) : !visible.length ? (
        <p className="list-empty">{q ? "No chats match your search." : "No conversations yet. Start one from Users."}</p>
      ) : (
        <ul className="list" onScroll={loadMoreOnScroll(hasMore && !q, onLoadMore)}>
          {visible.map(({ key, target, lastMessage, unread }) => {
            const isMuted = muted.has(key);
            return (
              <li key={key} className="list-row">
                <button className={`list-item ${key === activeKey ? "active" : ""}`} onClick={() => onSelect(target)}>
                  <Avatar name={target.name} src={target.avatar} status={target.status} />
                  <div className="list-item-body">
                    <div className="list-item-row">
                      <strong className="truncate">{target.name}</strong>
                      {lastMessage && <span className="muted small">{formatTime(lastMessage.getSentAt())}</span>}
                    </div>
                    <div className="list-item-row">
                      <span className="muted truncate">{previewText(lastMessage)}</span>
                      <span className="row-badges">
                        {isMuted && (
                          <span className="muted small" aria-label="Muted" title="Muted">
                            🔕
                          </span>
                        )}
                        {unread > 0 && <span className={`badge ${isMuted ? "badge-muted" : ""}`}>{unread}</span>}
                      </span>
                    </div>
                  </div>
                </button>
                <button
                  className="row-menu-btn"
                  aria-label={`Options for ${target.name}`}
                  aria-expanded={menuKey === key}
                  onClick={() => setMenuKey(menuKey === key ? null : key)}
                >
                  ⋯
                </button>
                {menuKey === key && (
                  <div className="row-menu" role="menu">
                    <button
                      role="menuitem"
                      onClick={() => {
                        onToggleMute(key);
                        setMenuKey(null);
                      }}
                    >
                      {isMuted ? "Unmute" : "Mute"}
                    </button>
                    <button
                      role="menuitem"
                      className="danger"
                      onClick={() => {
                        setMenuKey(null);
                        onDelete(target);
                      }}
                    >
                      Delete chat
                    </button>
                  </div>
                )}
              </li>
            );
          })}
          {hasMore && !q && <li className="list-empty small">Loading more…</li>}
        </ul>
      )}
    </>
  );
}
