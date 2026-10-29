import { useEffect, useRef, useState } from "react";
import EmojiPicker from "./EmojiPicker";
import { errorText } from "./common";
import { previewText, setTyping } from "../services/cometchat";

const TYPING_TIMEOUT_MS = 2000;

export default function MessageComposer({ target, onSend, onSendFile, replyTo, editing, onCancelContext }) {
  const [text, setText] = useState("");
  const [error, setError] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef(null);
  const fileRef = useRef(null);
  const typingRef = useRef(false);
  const timerRef = useRef(null);

  function stopTyping() {
    clearTimeout(timerRef.current);
    if (typingRef.current) {
      typingRef.current = false;
      setTyping(target, false);
    }
  }

  // Stop the indicator when switching chats or unmounting.
  useEffect(() => stopTyping, [target.id, target.type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Editing loads the message text into the box; replying just focuses it.
  useEffect(() => {
    if (editing) setText(editing.getText());
    if (editing || replyTo) textareaRef.current?.focus();
  }, [editing, replyTo]);

  function cancelContext() {
    if (editing) setText("");
    onCancelContext();
  }

  function handleChange(e) {
    setText(e.target.value);
    if (editing) return;
    if (!typingRef.current) {
      typingRef.current = true;
      setTyping(target, true);
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(stopTyping, TYPING_TIMEOUT_MS);
  }

  function insertEmoji(emoji) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    const value = text.trim();
    if (!value) return;
    if (editing && value === editing.getText()) {
      cancelContext();
      return;
    }
    setText("");
    setError(null);
    setShowEmoji(false);
    stopTyping();
    try {
      await onSend(value);
    } catch (err) {
      setText(value); // give the text back so nothing is lost
      setError(errorText(err));
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await onSendFile(file);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setUploading(false);
    }
  }

  const context = editing ?? replyTo;

  return (
    <form className="composer" onSubmit={handleSubmit}>
      {context && (
        <div className="composer-context">
          <div className="composer-context-text">
            <strong>{editing ? "Editing message" : `Replying to ${replyTo.getSender().getName()}`}</strong>
            <span className="muted truncate">{previewText(context)}</span>
          </div>
          <button type="button" className="icon-btn" aria-label={editing ? "Cancel edit" : "Cancel reply"} onClick={cancelContext}>
            ✕
          </button>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
      {uploading && <p className="muted small">Uploading…</p>}
      <div className="composer-row">
        {!editing && (
          <>
            <button
              type="button"
              className="icon-btn"
              aria-label="Attach a photo or file"
              onClick={() => fileRef.current.click()}
              disabled={uploading}
            >
              📎
            </button>
            <input ref={fileRef} type="file" hidden onChange={handleFile} />
          </>
        )}
        <div className="emoji-anchor">
          <button
            type="button"
            className="icon-btn"
            aria-label="Insert emoji"
            aria-expanded={showEmoji}
            onClick={() => setShowEmoji((open) => !open)}
          >
            😊
          </button>
          {showEmoji && <EmojiPicker onPick={insertEmoji} onClose={() => setShowEmoji(false)} />}
        </div>
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder={`Message ${target.name}`}
          aria-label={`Message ${target.name}`}
          value={text}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) handleSubmit(e);
            if (e.key === "Escape" && context) cancelContext();
          }}
        />
        <button type="submit" disabled={!text.trim()}>
          {editing ? "Save" : "Send"}
        </button>
      </div>
    </form>
  );
}
