import { useState } from "react";
import Avatar from "./Avatar";
import MessageList from "./MessageList";
import MessageComposer from "./MessageComposer";
import { errorText } from "./common";
import { useMessages } from "../hooks/useMessages";
import { isGroupTarget } from "../services/cometchat";

export default function ChatWindow({ target, me, initialUnread, onMessageSent, onMessageChanged, onShowDetails, onUnblock }) {
  const chat = useMessages(target, me);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [actionError, setActionError] = useState(null);
  const isGroup = isGroupTarget(target);

  let subtitle = isGroup
    ? `${target.membersCount ?? 0} member${target.membersCount === 1 ? "" : "s"}`
    : target.status === "online"
      ? "Online"
      : "Offline";
  if (chat.typingNames.length) {
    subtitle = isGroup ? `${chat.typingNames.join(", ")} typing…` : "typing…";
  }

  const cancelContext = () => {
    setReplyTo(null);
    setEditing(null);
  };

  async function handleSend(text) {
    if (editing) {
      onMessageChanged(await chat.edit(editing, text));
      setEditing(null);
      return;
    }
    const sent = await chat.send(text, replyTo);
    setReplyTo(null);
    onMessageSent(sent);
  }

  async function handleSendFile(file) {
    const sent = await chat.sendFile(file, replyTo);
    setReplyTo(null);
    onMessageSent(sent);
  }

  const run = (action) => {
    setActionError(null);
    action().catch((e) => setActionError(errorText(e)));
  };

  const actions = {
    onReply: (message) => {
      setEditing(null);
      setReplyTo(message);
    },
    onEdit: (message) => {
      setReplyTo(null);
      setEditing(message);
    },
    onCopy: (message) => run(() => navigator.clipboard.writeText(message.getText())),
    onReact: (message, emoji) => run(() => chat.react(message, emoji)),
    onDelete: (message) =>
      window.confirm("Delete this message for everyone?") &&
      run(async () => onMessageChanged(await chat.remove(message))),
  };

  let footer;
  if (!isGroup && target.blockedByMe) {
    footer = (
      <div className="composer-blocked">
        You blocked {target.name}.{" "}
        <button className="link" onClick={() => run(onUnblock)}>
          Unblock
        </button>
      </div>
    );
  } else if (!isGroup && target.hasBlockedMe) {
    footer = <div className="composer-blocked">You can't reply to this conversation.</div>;
  } else {
    footer = (
      <MessageComposer
        target={target}
        onSend={handleSend}
        onSendFile={handleSendFile}
        replyTo={replyTo}
        editing={editing}
        onCancelContext={cancelContext}
      />
    );
  }

  return (
    <section className="chat" aria-label={`Chat with ${target.name}`}>
      <header className="chat-header">
        <button className="chat-header-info" onClick={onShowDetails} aria-label={`Show details for ${target.name}`}>
          <Avatar name={target.name} src={target.avatar} status={target.status} />
          <span className="chat-header-text">
            <strong className="truncate">{target.name}</strong>
            <span className={`small ${chat.typingNames.length ? "typing" : "muted"}`}>{subtitle}</span>
          </span>
        </button>
        <button className="icon-btn" onClick={onShowDetails} aria-label="Chat details">
          ⓘ
        </button>
      </header>

      {chat.loading ? (
        <div className="messages-wrap">
          <p className="list-empty">Loading messages…</p>
        </div>
      ) : chat.error ? (
        <div className="messages-wrap">
          <p className="list-empty error">{errorText(chat.error)}</p>
        </div>
      ) : (
        <MessageList
          messages={chat.messages}
          myUid={me.getUid()}
          isGroup={isGroup}
          hasMore={chat.hasMore}
          onLoadOlder={chat.loadOlder}
          statusOf={chat.statusOf}
          initialUnread={initialUnread}
          actions={actions}
        />
      )}

      {actionError && (
        <p className="error small action-error" role="alert">
          {actionError}{" "}
          <button className="link" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </p>
      )}
      {footer}
    </section>
  );
}
