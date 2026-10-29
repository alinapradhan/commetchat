import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import { ListSkeleton, errorText } from "./common";
import { usePagedList } from "../hooks/usePagedList";
import {
  addGroupMembers,
  blockUser,
  createMembersRequest,
  createUsersRequest,
  isGroupAdmin,
  isGroupTarget,
  kickGroupMember,
  leaveGroup,
  onGroupChange,
  unblockUser,
} from "../services/cometchat";

// Right-hand panel with details and actions for the open chat.
export default function DetailsPanel({ target, me, onClose, onTargetChange, onLeft, onDeleteChat }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="details" aria-label={`${target.name} details`}>
      <header className="details-header">
        <strong>{isGroupTarget(target) ? "Group info" : "Contact info"}</strong>
        <button className="icon-btn" onClick={onClose} aria-label="Close details">
          ✕
        </button>
      </header>
      <div className="details-hero">
        <Avatar name={target.name} src={target.avatar} status={target.status} size={72} />
        <h2>{target.name}</h2>
        <p className="muted small">
          {isGroupTarget(target)
            ? `${target.membersCount ?? 0} members · ${target.groupType ?? "group"}`
            : target.status === "online"
              ? "Online"
              : "Offline"}
        </p>
      </div>
      {isGroupTarget(target) ? (
        <GroupDetails group={target} me={me} onLeft={onLeft} onDeleteChat={onDeleteChat} />
      ) : (
        <UserDetails user={target} onTargetChange={onTargetChange} onDeleteChat={onDeleteChat} />
      )}
    </aside>
  );
}

function UserDetails({ user, onTargetChange, onDeleteChat }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function toggleBlock() {
    setBusy(true);
    setError(null);
    try {
      if (user.blockedByMe) await unblockUser(user.id);
      else await blockUser(user.id);
      onTargetChange({ blockedByMe: !user.blockedByMe });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="details-actions">
      {error && <p className="error small">{error}</p>}
      <button className={user.blockedByMe ? "secondary" : "danger-btn"} onClick={toggleBlock} disabled={busy}>
        {user.blockedByMe ? "Unblock user" : "Block user"}
      </button>
      <button className="secondary" onClick={() => onDeleteChat(user)}>
        Delete chat
      </button>
    </div>
  );
}

function GroupDetails({ group, me, onLeft, onDeleteChat }) {
  const members = usePagedList(() => createMembersRequest(group.id), [group.id]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isAdmin = isGroupAdmin(group);
  const myUid = me.getUid();
  const reload = members.reload;

  useEffect(() => onGroupChange(`details-${group.id}`, (guid) => guid === group.id && reload()), [group.id, reload]);

  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const handleKick = (member) =>
    window.confirm(`Remove ${member.name} from ${group.name}?`) &&
    run(async () => {
      await kickGroupMember(group.id, member.id);
      reload();
    });

  const handleLeave = () =>
    window.confirm(`Leave ${group.name}?`) &&
    run(async () => {
      await leaveGroup(group.id);
      onLeft(group);
    });

  return (
    <>
      <div className="details-section">
        <div className="details-section-title">
          <strong>Members</strong>
          {isAdmin && !adding && (
            <button className="small-btn" onClick={() => setAdding(true)}>
              + Add
            </button>
          )}
        </div>
        {adding && (
          <AddMembers
            group={group}
            existing={new Set(members.items.map((m) => m.id))}
            onDone={() => {
              setAdding(false);
              reload();
            }}
          />
        )}
        {members.loading ? (
          <ListSkeleton rows={3} />
        ) : members.error ? (
          <p className="error small">{errorText(members.error)}</p>
        ) : (
          <ul className="member-list">
            {members.items.map((member) => (
              <li key={member.id} className="member">
                <Avatar name={member.name} src={member.avatar} status={member.status} size={32} />
                <span className="truncate">
                  {member.name}
                  {member.id === myUid && <span className="muted"> (you)</span>}
                </span>
                {(member.id === group.owner || member.scope !== "participant") && (
                  <span className="scope">{member.id === group.owner ? "owner" : member.scope}</span>
                )}
                {isAdmin && member.id !== myUid && member.id !== group.owner && (
                  <button className="link danger" onClick={() => handleKick(member)} disabled={busy}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="details-actions">
        {error && <p className="error small">{error}</p>}
        <button className="secondary" onClick={() => onDeleteChat(group)}>
          Clear chat
        </button>
        {group.owner !== myUid && (
          <button className="danger-btn" onClick={handleLeave} disabled={busy}>
            Leave group
          </button>
        )}
      </div>
    </>
  );
}

function AddMembers({ group, existing, onDone }) {
  const users = usePagedList(() => createUsersRequest(), []);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const candidates = users.items.filter((u) => !existing.has(u.id));

  const toggle = (uid) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  async function handleAdd() {
    setBusy(true);
    setError(null);
    try {
      await addGroupMembers(group.id, [...selected]);
      onDone();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="add-members">
      {users.loading ? (
        <p className="muted small">Loading users…</p>
      ) : !candidates.length ? (
        <p className="muted small">Everyone is already in this group.</p>
      ) : (
        candidates.map((u) => (
          <label key={u.id} className="check-row">
            <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
            <Avatar name={u.name} src={u.avatar} size={26} />
            <span className="truncate">{u.name}</span>
          </label>
        ))
      )}
      {error && <p className="error small">{error}</p>}
      <div className="dialog-actions">
        <button className="secondary" onClick={onDone}>
          Cancel
        </button>
        <button onClick={handleAdd} disabled={busy || !selected.size}>
          {busy ? "Adding…" : `Add ${selected.size || ""}`.trim()}
        </button>
      </div>
    </div>
  );
}
