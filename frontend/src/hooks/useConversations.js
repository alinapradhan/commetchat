import { useCallback, useEffect, useRef, useState } from "react";
import {
  CometChat,
  LIST_PAGE_SIZE,
  createConversationsRequest,
  onGroupChange,
  previewText,
  targetKeyFromMessage,
} from "../services/cometchat";
import { notifyMessage } from "../utils/notify";

// Keeps the sidebar live: new messages bump a conversation to the top and
// raise its unread count; edits, deletes, presence and group changes update it.
export function useConversations(me, activeKey, muted) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  // Listeners are registered once, so they read the latest values via refs.
  const activeKeyRef = useRef(activeKey);
  const conversationsRef = useRef(conversations);
  const mutedRef = useRef(muted);
  activeKeyRef.current = activeKey;
  conversationsRef.current = conversations;
  mutedRef.current = muted;

  const requestRef = useRef(null);
  const loadingMoreRef = useRef(false);

  const refresh = useCallback(async () => {
    const request = createConversationsRequest();
    requestRef.current = request;
    try {
      const list = await request.fetchNext();
      if (requestRef.current !== request) return;
      setConversations(list);
      setHasMore(list.length === LIST_PAGE_SIZE);
      setError(null);
    } catch (e) {
      if (requestRef.current === request) setError(e);
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    const request = requestRef.current;
    if (!request || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      const more = await request.fetchNext();
      if (requestRef.current !== request) return;
      setConversations((prev) => [...prev, ...more.filter((m) => !prev.some((p) => p.key === m.key))]);
      setHasMore(more.length === LIST_PAGE_SIZE);
    } finally {
      loadingMoreRef.current = false;
    }
  }, []);

  // Moves a conversation to the top with its newest message.
  const applyMessage = useCallback(
    (message, { countAsUnread = false } = {}) => {
      const key = targetKeyFromMessage(message, me.getUid());
      if (!conversationsRef.current.some((c) => c.key === key)) {
        refresh(); // first message in a brand-new chat
        return;
      }
      setConversations((prev) => {
        const current = prev.find((c) => c.key === key);
        const updated = {
          ...current,
          lastMessage: message,
          unread: countAsUnread ? current.unread + 1 : current.unread,
        };
        return [updated, ...prev.filter((c) => c.key !== key)];
      });
    },
    [me, refresh],
  );

  // An edited or deleted message: update the preview if it is the last one.
  const replaceMessage = useCallback((message) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.lastMessage && String(c.lastMessage.getId()) === String(message.getId()) ? { ...c, lastMessage: message } : c,
      ),
    );
  }, []);

  const markRead = useCallback((key) => {
    setConversations((prev) => prev.map((c) => (c.key === key && c.unread ? { ...c, unread: 0 } : c)));
  }, []);

  const removeConversation = useCallback((key) => {
    setConversations((prev) => prev.filter((c) => c.key !== key));
  }, []);

  const updateTarget = useCallback((key, patch) => {
    setConversations((prev) => prev.map((c) => (c.key === key ? { ...c, target: { ...c.target, ...patch } } : c)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const listenerId = "conversation-list";
    const onIncoming = (message) => {
      const key = targetKeyFromMessage(message, me.getUid());
      const isActive = key === activeKeyRef.current;
      if (!isActive) CometChat.markAsDelivered(message).catch(() => {});
      applyMessage(message, { countAsUnread: !isActive });

      if ((!isActive || document.hidden) && !mutedRef.current.has(key)) {
        const sender = message.getSender().getName();
        const chat = conversationsRef.current.find((c) => c.key === key)?.target;
        const title = chat?.type === CometChat.RECEIVER_TYPE.GROUP ? `${sender} in ${chat.name}` : sender;
        notifyMessage(title, previewText(message));
      }
    };
    CometChat.addMessageListener(
      listenerId,
      new CometChat.MessageListener({
        onTextMessageReceived: onIncoming,
        onMediaMessageReceived: onIncoming,
        onCustomMessageReceived: onIncoming,
        onMessageEdited: replaceMessage,
        onMessageDeleted: replaceMessage,
      }),
    );

    const setStatus = (user, status) =>
      setConversations((prev) =>
        prev.map((c) =>
          c.key === `user:${user.getUid()}` ? { ...c, target: { ...c.target, status } } : c,
        ),
      );
    CometChat.addUserListener(
      listenerId,
      new CometChat.UserListener({
        onUserOnline: (user) => setStatus(user, "online"),
        onUserOffline: (user) => setStatus(user, "offline"),
      }),
    );

    // Joined, left, added or removed: member counts and the list itself can change.
    const stopGroups = onGroupChange(listenerId, () => refresh());

    return () => {
      CometChat.removeMessageListener(listenerId);
      CometChat.removeUserListener(listenerId);
      stopGroups();
    };
  }, [me, applyMessage, replaceMessage, refresh]);

  return {
    conversations,
    loading,
    error,
    hasMore,
    loadMore,
    applyMessage,
    replaceMessage,
    markRead,
    removeConversation,
    updateTarget,
    refresh,
  };
}
