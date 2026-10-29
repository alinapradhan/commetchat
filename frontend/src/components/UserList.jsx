import { useState } from "react";
import Avatar from "./Avatar";
import { ListSkeleton, SearchBox, errorText, loadMoreOnScroll } from "./common";
import { useDebounced } from "../hooks/useDebounced";
import { usePagedList } from "../hooks/usePagedList";
import { createUsersRequest, targetKey } from "../services/cometchat";

export default function UserList({ me, activeKey, onSelect }) {
  const [query, setQuery] = useState("");
  const keyword = useDebounced(query.trim());
  const { items, loading, error, hasMore, loadMore } = usePagedList(() => createUsersRequest(keyword), [keyword]);
  const users = items.filter((u) => u.id !== me.getUid());

  return (
    <>
      <SearchBox value={query} onChange={setQuery} placeholder="Search users" />
      {loading ? (
        <ListSkeleton />
      ) : error ? (
        <p className="list-empty error">{errorText(error)}</p>
      ) : !users.length ? (
        <p className="list-empty">No users found.</p>
      ) : (
        <ul className="list" onScroll={loadMoreOnScroll(hasMore, loadMore)}>
          {users.map((user) => (
            <li key={user.id}>
              <button
                className={`list-item ${targetKey(user) === activeKey ? "active" : ""}`}
                onClick={() => onSelect(user)}
              >
                <Avatar name={user.name} src={user.avatar} status={user.status} />
                <div className="list-item-body">
                  <strong className="truncate">{user.name}</strong>
                  <span className="muted small">
                    {user.blockedByMe ? "Blocked" : user.status === "online" ? "Online" : "Offline"}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
