import { useEffect } from "react";

const EMOJIS = [
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "😉",
  "😍", "🥰", "😘", "😋", "😜", "🤪", "🤔", "🤨", "😐", "🙄", "😏", "😴",
  "😮", "😲", "😢", "😭", "😤", "😡", "🥳", "😎", "🤓", "🤯", "🥺", "😬",
  "👍", "👎", "👏", "🙌", "🙏", "💪", "👋", "🤝", "✌️", "👌", "🤞", "👀",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🔥", "✨", "🎉", "💯", "✅", "❌",
  "☕", "🍕", "🎂", "🚀", "💡", "📌", "📎", "📷", "🎨", "💻", "📅", "⏰",
];

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export default function EmojiPicker({ onPick, onClose }) {
  // Close on Escape or a click outside the picker and its toggle button.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    const onClick = (e) => !e.target.closest(".emoji-anchor") && onClose();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  return (
    <div className="emoji-picker" role="dialog" aria-label="Emoji picker">
      {EMOJIS.map((emoji) => (
        <button key={emoji} type="button" onClick={() => onPick(emoji)} aria-label={`Insert ${emoji}`}>
          {emoji}
        </button>
      ))}
    </div>
  );
}
