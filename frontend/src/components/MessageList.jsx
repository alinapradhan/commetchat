import { Fragment, useLayoutEffect, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";
import { dayKey, formatDay } from "../utils/format";

const NEAR_BOTTOM_PX = 80;

export default function MessageList({ messages, myUid, isGroup, hasMore, onLoadOlder, statusOf, initialUnread, actions }) {
  const scrollRef = useRef(null);
  const lastIdRef = useRef(undefined); // undefined until the first page has rendered
  const heightBeforeLoadRef = useRef(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // The "New messages" divider goes before the first unread message, worked
  // out once from the unread count the chat had when it was opened.
  const dividerIdRef = useRef(undefined);
  if (dividerIdRef.current === undefined && messages.length) {
    dividerIdRef.current =
      initialUnread > 0 ? messages[Math.max(0, messages.length - initialUnread)].getId() : null;
  }

  const scrollToBottom = (smooth = false) => {
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setNewBelow(0);
  };

  // First page -> show the unread divider (or the bottom).
  // Older page prepended -> keep the reader's position.
  // New message -> follow it if the reader is at the bottom or sent it; otherwise count it.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (heightBeforeLoadRef.current !== null) {
      el.scrollTop += el.scrollHeight - heightBeforeLoadRef.current;
      heightBeforeLoadRef.current = null;
      return;
    }
    const last = messages[messages.length - 1];
    const lastId = last?.getId();
    if (lastId === lastIdRef.current) return;
    if (lastIdRef.current === undefined) {
      const divider = el.querySelector("#unread-divider");
      if (divider) el.scrollTop = divider.offsetTop - el.offsetTop - 12;
      else el.scrollTop = el.scrollHeight;
    } else if (atBottomRef.current || last?.getSender().getUid() === myUid) {
      el.scrollTop = el.scrollHeight;
    } else {
      setNewBelow((n) => n + 1);
    }
    if (last) lastIdRef.current = lastId;
  }, [messages, myUid]);

  function handleScroll() {
    const el = scrollRef.current;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) setNewBelow(0);
  }

  async function handleLoadOlder() {
    heightBeforeLoadRef.current = scrollRef.current.scrollHeight;
    setLoadingOlder(true);
    try {
      await onLoadOlder();
    } catch {
      heightBeforeLoadRef.current = null;
    } finally {
      setLoadingOlder(false);
    }
  }

  function jumpTo(id) {
    const target = scrollRef.current?.querySelector(`#msg-${CSS.escape(String(id))}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("flash");
    setTimeout(() => target.classList.remove("flash"), 1200);
  }

  let previousDay = null;

  return (
    <div className="messages-wrap">
      <div className="messages" ref={scrollRef} onScroll={handleScroll} role="log" aria-live="polite">
        {hasMore && (
          <button className="load-older" onClick={handleLoadOlder} disabled={loadingOlder}>
            {loadingOlder ? "Loading…" : "Load older messages"}
          </button>
        )}
        {!messages.length && <p className="list-empty">No messages yet. Say hi 👋</p>}
        {messages.map((message) => {
          const day = dayKey(message.getSentAt());
          const showDay = day !== previousDay;
          previousDay = day;
          const mine = message.getSender().getUid() === myUid;
          return (
            <Fragment key={message.getId()}>
              {showDay && (
                <div className="day-separator">
                  <span>{formatDay(message.getSentAt())}</span>
                </div>
              )}
              {message.getId() === dividerIdRef.current && (
                <div id="unread-divider" className="unread-divider">
                  <span>New messages</span>
                </div>
              )}
              <MessageBubble
                message={message}
                mine={mine}
                isGroup={isGroup}
                status={mine ? statusOf(message) : null}
                actions={actions}
                onJumpTo={jumpTo}
              />
            </Fragment>
          );
        })}
      </div>
      {!atBottom && (
        <button className="jump-bottom" onClick={() => scrollToBottom(true)} aria-label="Jump to latest messages">
          {newBelow > 0 ? `↓ ${newBelow} new` : "↓"}
        </button>
      )}
    </div>
  );
}
