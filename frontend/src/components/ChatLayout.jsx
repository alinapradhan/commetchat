import { useState } from "react";
import Avatar from "./Avatar";
import ChatWindow from "./ChatWindow";
import ConversationList from "./ConversationList";
import CreateGroupDialog from "./CreateGroupDialog";
import DetailsPanel from "./DetailsPanel";
import GroupList from "./GroupList";
import UserList from "./UserList";
import { errorText } from "./common";
import { useAuth } from "../context/AuthContext";
import { useConnectionStatus } from "../hooks/useConnectionStatus";
import { useConversations } from "../hooks/useConversations";
import { useMutedChats } from "../hooks/useMutedChats";
import { deleteConversation, isGroupTarget, targetKey, unblockUser } from "../services/cometchat";
import { notificationsEnabled, setNotificationsEnabled } from "../utils/notify";

const TABS = [
  { id: "chats", label: "Chats" },
  { id: "users", label: "Users" },
  { id: "groups", label: "Groups" },
];

const CONNECTION_TEXT = {
  connecting: "Reconnecting…",
  disconnected: "Connection lost. Trying to reconnect…",
};

export default function ChatLayout() {
  const { user: me, signOut } = useAuth();
  const [tab, setTab] = useState("chats");
  const [active, setActive] = useState(null);
  const [unreadAtOpen, setUnreadAtOpen] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [notifyOn, setNotifyOn] = useState(notificationsEnabled);
  const { muted, toggleMute } = useMutedChats(me.getUid());
  const connection = useConnectionStatus();

  const activeKey = active ? targetKey(active) : null;
  const conv = useConversations(me, activeKey, muted);

  // The conversation's copy of the target carries live presence and member counts.
  const activeTarget = active ? { ...active, ...conv.conversations.find((c) => c.key === activeKey)?.target } : null;

  function openChat(target) {
    const key = targetKey(target);
    setUnreadAtOpen(conv.conversations.find((c) => c.key === key)?.unread ?? 0);
    setActive(target);
    if (key !== activeKey) setShowDetails(false);
    conv.markRead(key);
  }

  function patchActive(patch) {
    setActive((prev) => ({ ...prev, ...patch }));
    conv.updateTarget(activeKey, patch);
  }

  function closeChat() {
    setActive(null);
    setShowDetails(false);
  }

  async function handleDeleteChat(target) {
    const what = isGroupTarget(target) ? `the chat history of ${target.name}` : `your chat with ${target.name}`;
    if (!window.confirm(`Delete ${what}? Messages are removed for you only.`)) return;
    try {
      await deleteConversation(target);
      conv.removeConversation(targetKey(target));
      if (targetKey(target) === activeKey) closeChat();
    } catch (e) {
      window.alert(errorText(e));
    }
  }

  async function handleUnblock() {
    await unblockUser(activeTarget.id);
    patchActive({ blockedByMe: false });
  }

  function handleLeftGroup() {
    closeChat();
    conv.refresh();
  }

  function handleGroupReady(group) {
    setCreatingGroup(false);
    conv.refresh();
    openChat(group);
  }

  async function toggleNotifications() {
    await setNotificationsEnabled(!notifyOn);
    setNotifyOn(!notifyOn);
  }

  const layoutClass = ["layout", active && "has-active", showDetails && activeTarget && "has-details"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={layoutClass}>
      {connection !== "connected" && (
        <div className="connection-banner" role="status">
          {CONNECTION_TEXT[connection]}
        </div>
      )}

      <aside className="sidebar" aria-label="Conversations">
        <header className="sidebar-header">
          <Avatar name={me.getName()} src={me.getAvatar()} size={36} />
          <strong className="truncate">{me.getName()}</strong>
          <button
            className="icon-btn"
            onClick={toggleNotifications}
            aria-pressed={notifyOn}
            aria-label={notifyOn ? "Turn off notifications" : "Turn on notifications"}
            title={notifyOn ? "Notifications on" : "Notifications off"}
          >
            {notifyOn ? "🔔" : "🔕"}
          </button>
          <button className="link" onClick={signOut}>
            Log out
          </button>
        </header>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === "chats" && conv.conversations.some((c) => c.unread > 0) && <i className="tab-dot" />}
            </button>
          ))}
        </nav>
        {tab === "chats" && (
          <ConversationList
            conversations={conv.conversations}
            loading={conv.loading}
            error={conv.error}
            hasMore={conv.hasMore}
            onLoadMore={conv.loadMore}
            activeKey={activeKey}
            onSelect={openChat}
            muted={muted}
            onToggleMute={toggleMute}
            onDelete={handleDeleteChat}
          />
        )}
        {tab === "users" && <UserList me={me} activeKey={activeKey} onSelect={openChat} />}
        {tab === "groups" && (
          <GroupList
            activeKey={activeKey}
            onSelect={openChat}
            onJoined={handleGroupReady}
            onCreate={() => setCreatingGroup(true)}
          />
        )}
      </aside>

      <main className="main">
        {activeTarget ? (
          <>
            <button className="link back" onClick={closeChat}>
              ← Back
            </button>
            <ChatWindow
              key={activeKey}
              target={activeTarget}
              me={me}
              initialUnread={unreadAtOpen}
              onMessageSent={conv.applyMessage}
              onMessageChanged={conv.replaceMessage}
              onShowDetails={() => setShowDetails((open) => !open)}
              onUnblock={handleUnblock}
            />
          </>
        ) : (
          <div className="empty-state">
            <p className="empty-icon" aria-hidden="true">💬</p>
            <p>Select a conversation, or start one from Users or Groups.</p>
          </div>
        )}
      </main>

      {showDetails && activeTarget && (
        <DetailsPanel
          key={activeKey}
          target={activeTarget}
          me={me}
          onClose={() => setShowDetails(false)}
          onTargetChange={patchActive}
          onLeft={handleLeftGroup}
          onDeleteChat={handleDeleteChat}
        />
      )}

      {creatingGroup && <CreateGroupDialog onCreated={handleGroupReady} onClose={() => setCreatingGroup(false)} />}
    </div>
  );
}
