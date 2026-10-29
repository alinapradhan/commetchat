// CometChat timestamps are in seconds.
export function formatTime(seconds) {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export const formatClock = (seconds) =>
  seconds ? new Date(seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

// Groups messages by calendar day in the viewer's time zone.
export const dayKey = (seconds) => new Date(seconds * 1000).toDateString();

export function formatDay(seconds, now = new Date()) {
  const date = new Date(seconds * 1000);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  });
}

export function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]])/g;

// Splits text into plain and link parts so links can be rendered as <a>.
export function splitLinks(text) {
  return text
    .split(URL_PATTERN)
    .filter(Boolean)
    .map((value) => ({ type: /^https?:\/\//.test(value) ? "link" : "text", value }));
}
