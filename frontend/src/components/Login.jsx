import { useState } from "react";
import { errorText } from "./common";
import { useAuth } from "../context/AuthContext";
import { isDemo, useBackend } from "../services/cometchat";

export default function Login() {
  return <div className="center-screen">{useBackend ? <AccountForm /> : <SampleUserLogin />}</div>;
}

// Email + password, handled by our backend. Used with real CometChat and `npm run demo:auth`.
function AccountForm() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isSignup = mode === "signup";

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isSignup) await signUp(name.trim(), email.trim(), password);
      else await signIn(email.trim(), password);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setError(null);
  }

  return (
    <form className="card login" onSubmit={handleSubmit}>
      <h1>CometChat</h1>
      <div className="segmented" role="tablist">
        <button type="button" role="tab" aria-selected={!isSignup} onClick={() => switchMode("login")}>
          Log in
        </button>
        <button type="button" role="tab" aria-selected={isSignup} onClick={() => switchMode("signup")}>
          Sign up
        </button>
      </div>
      {isDemo && (
        <p className="demo-note small">
          <b>Demo chat backend</b>: accounts are real (stored by the server), chat is the offline demo. Chat with
          Nancy, Susan and John, who are bots that reply.
        </p>
      )}
      {isSignup && (
        <label className="field">
          <span>Name</span>
          <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required disabled={busy} />
        </label>
      )}
      <label className="field">
        <span>Email</span>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
          required
          disabled={busy}
        />
      </label>
      <label className="field">
        <span>Password</span>
        <div className="password-row">
          <input
            type={showPassword ? "text" : "password"}
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={isSignup ? 8 : undefined}
            maxLength={128}
            required
            disabled={busy}
          />
          <button type="button" className="link" onClick={() => setShowPassword((s) => !s)}>
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        {isSignup && <span className="muted small">At least 8 characters. Avoid common passwords.</span>}
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Please wait…" : isSignup ? "Create account" : "Log in"}
      </button>
    </form>
  );
}

// Every new CometChat app ships with these five sample users.
const SAMPLE_USERS = ["cometchat-uid-1", "cometchat-uid-2", "cometchat-uid-3", "cometchat-uid-4", "cometchat-uid-5"];

// Offline demo only (`npm run demo`): no passwords, no server.
function SampleUserLogin() {
  const { signInAsSample } = useAuth();
  const [uid, setUid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleLogin(value) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await signInAsSample(trimmed);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <form
      className="card login"
      onSubmit={(e) => {
        e.preventDefault();
        handleLogin(uid);
      }}
    >
      <h1>CometChat</h1>
      <p className="muted">Log in with a sample user ID (UID).</p>
      <p className="demo-note small">
        <b>Offline demo</b>: no server, no passwords. Log in as uid-1 and uid-2 in two tabs to chat between them.
        Nancy, Susan and John (uid-3 to 5) are bots that reply.
      </p>
      <input autoFocus placeholder="e.g. cometchat-uid-1" value={uid} onChange={(e) => setUid(e.target.value)} disabled={busy} />
      <button type="submit" disabled={busy || !uid.trim()}>
        {busy ? "Logging in…" : "Log in"}
      </button>
      {error && <p className="error">{error}</p>}
      <p className="muted small">Or pick a sample user:</p>
      <div className="chips">
        {SAMPLE_USERS.map((sample) => (
          <button key={sample} type="button" className="chip" disabled={busy} onClick={() => handleLogin(sample)}>
            {sample.replace("cometchat-", "")}
          </button>
        ))}
      </div>
    </form>
  );
}
