import { useEffect, useState } from "react";
import { errorText } from "./common";
import { createGroup } from "../services/cometchat";

export default function CreateGroupDialog({ onCreated, onClose }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await createGroup(name.trim()));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card dialog" role="dialog" aria-modal="true" aria-labelledby="new-group-title" onSubmit={handleSubmit}>
        <h2 id="new-group-title">New group</h2>
        <p className="muted small">Public groups can be found and joined by anyone in the app.</p>
        <input
          autoFocus
          placeholder="Group name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        {error && <p className="error small">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
