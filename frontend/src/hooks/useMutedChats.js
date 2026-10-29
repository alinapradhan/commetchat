import { useCallback, useState } from "react";

// Muted chats are a local preference (per user, per browser): a muted chat still
// counts unread messages but never pings or shows a notification.
export function useMutedChats(uid) {
  const storageKey = `cc-muted:${uid}`;
  const [muted, setMuted] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey)) ?? []);
    } catch {
      return new Set();
    }
  });

  const toggleMute = useCallback(
    (key) => {
      setMuted((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        try {
          localStorage.setItem(storageKey, JSON.stringify([...next]));
        } catch {
          // preference just won't persist
        }
        return next;
      });
    },
    [storageKey],
  );

  return { muted, toggleMute };
}
