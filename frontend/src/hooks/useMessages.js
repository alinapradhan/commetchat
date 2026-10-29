import { useCallback, useEffect, useRef, useState } from "react";
import {
  CometChat,
  MESSAGE_PAGE_SIZE,
  applyReactionEvent,
  createMessagesRequest,
  deleteMessage,
  editTextMessage,
  isGroupTarget,
  sendMediaMessage,
  sendTextMessage,
  targetKey,
  targetKeyFromMessage,
  toggleReaction,
} from "../services/cometchat";

const sameId = (a, b) => String(a) === String(b);

const appendUnique = (list, message) =>
  list.some((m) => sameId(m.getId(), message.getId())) ? list : [...list, message];

const replaceById = (list, message) => list.map((m) => (sameId(m.getId(), message.getId()) ? message : m));

// Message history, live incoming messages, edits, deletes, reactions,
// read receipts and typing indicators for the single open chat.
export function useMessages(target, me) {
  const key = targetKey(target);
  const myUid = me.getUid();
  const isGroup = isGroupTarget(target);

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  // Highest message id the other side has received / read
  // (in groups: received / read by every member).
  const [receipts, setReceipts] = useState({ delivered: 0, read: 0 });
  const [typing, setTyping] = useState({}); // uid -> name

  const requestRef = useRef(null);

  useEffect(() => {
    const request = createMessagesRequest(target);
    requestRef.current = request;
    setMessages([]);
    setReceipts({ delivered: 0, read: 0 });
    setTyping({});
    setLoading(true);
    setError(null);

    request
      .fetchPrevious()
      .then((list) => {
        if (requestRef.current !== request) return; // user switched chats
        setMessages(list);
        setHasMore(list.length === MESSAGE_PAGE_SIZE);
        const last = list[list.length - 1];
        if (last && last.getSender().getUid() !== myUid) {
          CometChat.markAsRead(last).catch(() => {});
        }
      })
      .catch((e) => requestRef.current === request && setError(e))
      .finally(() => requestRef.current === request && setLoading(false));

    const listenerId = `messages-${key}`;
    const belongsHere = (message) => targetKeyFromMessage(message, myUid) === key;
    const onIncoming = (message) => {
      if (!belongsHere(message)) return;
      setMessages((prev) => appendUnique(prev, message));
      if (message.getSender().getUid() !== myUid) {
        CometChat.markAsRead(message).catch(() => {});
      }
    };
    const onChanged = (message) => {
      if (belongsHere(message)) setMessages((prev) => replaceById(prev, message));
    };
    const onReaction = (added) => (event) => {
      if (event.getReceiverType() === CometChat.RECEIVER_TYPE.GROUP ? event.getReceiverId() !== target.id : isGroup) {
        return;
      }
      const reaction = event.getReaction();
      if (reaction.getUid?.() === myUid) return; // my own reactions come back from toggleReaction
      setMessages((prev) =>
        prev.map((m) => (sameId(m.getId(), reaction.getMessageId()) ? applyReactionEvent(m, event, added) : m)),
      );
    };
    const raiseMark = (field, receipt) => {
      const id = Number(receipt.getMessageId());
      setReceipts((prev) => (id > prev[field] ? { ...prev, [field]: id } : prev));
    };
    const onUserReceipt = (field) => (receipt) => {
      if (receipt.getReceiverType() !== CometChat.RECEIVER_TYPE.USER) return;
      if (receipt.getSender().getUid() !== target.id) return;
      raiseMark(field, receipt);
    };
    const onGroupReceipt = (field) => (receipt) => {
      if (receipt.getReceiverType() !== CometChat.RECEIVER_TYPE.GROUP) return;
      if (receipt.getReceiver() !== target.id) return;
      raiseMark(field, receipt);
    };
    const isThisChat = (indicator) =>
      isGroup
        ? indicator.getReceiverType() === CometChat.RECEIVER_TYPE.GROUP && indicator.getReceiverId() === target.id
        : indicator.getReceiverType() === CometChat.RECEIVER_TYPE.USER && indicator.getSender().getUid() === target.id;

    CometChat.addMessageListener(
      listenerId,
      new CometChat.MessageListener({
        onTextMessageReceived: onIncoming,
        onMediaMessageReceived: onIncoming,
        onCustomMessageReceived: onIncoming,
        onMessageEdited: onChanged,
        onMessageDeleted: onChanged,
        onMessageReactionAdded: onReaction(true),
        onMessageReactionRemoved: onReaction(false),
        onMessagesDelivered: onUserReceipt("delivered"),
        onMessagesRead: onUserReceipt("read"),
        onMessagesDeliveredToAll: onGroupReceipt("delivered"),
        onMessagesReadByAll: onGroupReceipt("read"),
        onTypingStarted: (indicator) => {
          if (!isThisChat(indicator)) return;
          const sender = indicator.getSender();
          setTyping((prev) => ({ ...prev, [sender.getUid()]: sender.getName() }));
        },
        onTypingEnded: (indicator) => {
          if (!isThisChat(indicator)) return;
          setTyping((prev) => {
            const next = { ...prev };
            delete next[indicator.getSender().getUid()];
            return next;
          });
        },
      }),
    );

    return () => CometChat.removeMessageListener(listenerId);
    // target fields are captured through `key`; re-run only when the chat changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, myUid]);

  const loadOlder = useCallback(async () => {
    const request = requestRef.current;
    const older = await request.fetchPrevious();
    if (requestRef.current !== request) return;
    setMessages((prev) => [...older, ...prev]);
    setHasMore(older.length === MESSAGE_PAGE_SIZE);
  }, []);

  const appendSent = (sent) => {
    setMessages((prev) => appendUnique(prev, sent));
    return sent;
  };
  const applyChange = (updated) => {
    setMessages((prev) => replaceById(prev, updated));
    return updated;
  };

  // Each action returns the message the server sent back.
  const send = (text, replyTo) => sendTextMessage(target, text, replyTo).then(appendSent);
  const sendFile = (file, replyTo) => sendMediaMessage(target, file, replyTo).then(appendSent);
  const edit = (message, text) => editTextMessage(message, text).then(applyChange);
  const remove = (message) => deleteMessage(message).then(applyChange);
  const react = (message, emoji) => toggleReaction(message, emoji).then(applyChange);

  // Status tick for messages I sent.
  const statusOf = useCallback(
    (message) => {
      const id = Number(message.getId());
      if (message.getReadAt() || id <= receipts.read) return "read";
      if (message.getDeliveredAt() || id <= receipts.delivered) return "delivered";
      return "sent";
    },
    [receipts],
  );

  return {
    messages,
    loading,
    hasMore,
    error,
    loadOlder,
    send,
    sendFile,
    edit,
    remove,
    react,
    statusOf,
    typingNames: Object.values(typing),
  };
}
