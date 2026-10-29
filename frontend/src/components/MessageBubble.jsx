import { useState } from "react";
import { QUICK_REACTIONS } from "./EmojiPicker";
import { attachmentOf, messageKind, previewText, quotedMessageOf, reactionsOf } from "../services/cometchat";
import { formatClock, formatSize, splitLinks } from "../utils/format";

const TICKS = { sent: "✓", delivered: "✓✓", read: "✓✓" };
const TICK_LABELS = { sent: "Sent", delivered: "Delivered", read: "Read" };

function MessageContent({ message, kind }) {
  if (kind === "deleted") return <em className="bubble-text">This message was deleted</em>;
  if (kind === "text") {
    return (
      <div className="bubble-text">
        {splitLinks(message.getText()).map((part, i) =>
          part.type === "link" ? (
            <a key={i} href={part.value} target="_blank" rel="noopener noreferrer">
              {part.value}
            </a>
          ) : (
            <span key={i}>{part.value}</span>
          ),
        )}
      </div>
    );
  }
  const attachment = attachmentOf(message);
  if (kind === "image" && attachment) {
    return (
      <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="bubble-image">
        <img src={attachment.url} alt={attachment.name} loading="lazy" />
      </a>
    );
  }
  if (kind === "file" && attachment) {
    return (
      <a href={attachment.url} download={attachment.name} target="_blank" rel="noopener noreferrer" className="file-chip">
        <span aria-hidden="true">📎</span>
        <span className="truncate">{attachment.name}</span>
        {attachment.size > 0 && <span className="muted small">{formatSize(attachment.size)}</span>}
      </a>
    );
  }
  return <div className="bubble-text">{previewText(message)}</div>;
}

export default function MessageBubble({ message, mine, isGroup, status, actions, onJumpTo }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const kind = messageKind(message);
  const deleted = kind === "deleted";
  const quoted = deleted ? null : quotedMessageOf(message);
  const reactions = deleted ? [] : reactionsOf(message);
  const act = (fn) => () => {
    setMenuOpen(false);
    fn(message);
  };

  return (
    <div className={`bubble-row ${mine ? "mine" : ""}`} id={`msg-${message.getId()}`}>
      <div className="bubble-wrap">
        <div className={`bubble ${kind === "image" ? "bubble-media" : ""} ${deleted ? "bubble-deleted" : ""}`}>
          {isGroup && !mine && <div className="bubble-sender">{message.getSender().getName()}</div>}
          {quoted && (
            <button type="button" className="quote" onClick={() => onJumpTo(quoted.getId())}>
              <strong>{quoted.getSender().getName()}</strong>
              <span className="truncate">{previewText(quoted)}</span>
            </button>
          )}
          <MessageContent message={message} kind={kind} />
          <div className="bubble-meta">
            {!deleted && message.getEditedAt?.() ? <span>edited · </span> : null}
            {formatClock(message.getSentAt())}
            {status && (
              <span className={`tick ${status}`} aria-label={TICK_LABELS[status]} title={TICK_LABELS[status]}>
                {TICKS[status]}
              </span>
            )}
          </div>
        </div>

        {!deleted && (
          <div className={`msg-actions ${menuOpen ? "open" : ""}`} role="toolbar" aria-label="Message actions">
            {QUICK_REACTIONS.map((emoji) => (
              <button key={emoji} onClick={act((m) => actions.onReact(m, emoji))} aria-label={`React ${emoji}`}>
                {emoji}
              </button>
            ))}
            <span className="msg-actions-sep" />
            <button onClick={act(actions.onReply)}>Reply</button>
            {kind === "text" && <button onClick={act(actions.onCopy)}>Copy</button>}
            {mine && kind === "text" && <button onClick={act(actions.onEdit)}>Edit</button>}
            {mine && (
              <button className="danger" onClick={act(actions.onDelete)}>
                Delete
              </button>
            )}
          </div>
        )}
        {!deleted && (
          <button
            className="msg-actions-toggle"
            aria-label="Show message actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ⋯
          </button>
        )}
      </div>

      {reactions.length > 0 && (
        <div className="reactions">
          {reactions.map((r) => (
            <button
              key={r.emoji}
              className={`reaction ${r.mine ? "mine" : ""}`}
              aria-pressed={r.mine}
              aria-label={`${r.emoji} ${r.count}${r.mine ? ", including you" : ""}`}
              onClick={() => actions.onReact(message, r.emoji)}
            >
              {r.emoji} {r.count}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
