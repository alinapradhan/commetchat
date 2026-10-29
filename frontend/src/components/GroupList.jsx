import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import { ListSkeleton, SearchBox, errorText, loadMoreOnScroll } from "./common";
import { useDebounced } from "../hooks/useDebounced";
import { usePagedList } from "../hooks/usePagedList";
import { createGroupsRequest, joinGroup, onGroupChange, targetKey } from "../services/cometchat";

export default function GroupList({ activeKey, onSelect, onJoined, onCreate }) {
  const [query, setQuery] = useState("");
  const [joining, setJoining] = useState(null);
  const [joinError, setJoinError] = useState(null);
  const keyword = useDebounced(query.trim());
  const { items, loading, error, hasMore, loadMore, reload } = usePagedList(
    () => createGroupsRequest(keyword),
    [keyword],
  );

  useEffect(() => onGroupChange("group-list", reload), [reload]);

  async function handleJoin(group) {
    setJoining(group.id);
    setJoinError(null);
    try {
      onJoined(await joinGroup(group.id));
      reload();
    } catch (e) {
      setJoinError(errorText(e));
    } finally {
      setJoining(null);
    }
  }

  return (
    <>
      <div className="list-toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Search groups" />
        <button className="small-btn" onClick={onCreate}>
          + New group
        </button>
      </div>
      {joinError && <p className="error small pad">{joinError}</p>}
      {loading ? (
        <ListSkeleton />
      ) : error ? (
        <p className="list-empty error">{errorText(error)}</p>
      ) : !items.length ? (
        <p className="list-empty">No groups found. Create one!</p>
      ) : (
        <ul className="list" onScroll={loadMoreOnScroll(hasMore, loadMore)}>
          {items.map((group) => (
            <li key={group.id} className="list-row">
              <button
                className={`list-item ${targetKey(group) === activeKey ? "active" : ""}`}
                onClick={() => (group.hasJoined ? onSelect(group) : handleJoin(group))}
                disabled={joining === group.id}
              >
                <Avatar name={group.name} src={group.avatar} />
                <div className="list-item-body">
                  <strong className="truncate">{group.name}</strong>
                  <span className="muted small">
                    {group.membersCount} member{group.membersCount === 1 ? "" : "s"} · {group.groupType}
                  </span>
                </div>
                {!group.hasJoined && <span className="join-pill">{joining === group.id ? "Joining…" : "Join"}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
