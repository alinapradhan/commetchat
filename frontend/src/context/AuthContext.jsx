import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../services/api";
import {
  getLoggedInUser,
  initCometChat,
  isConfigured,
  isDemo,
  loginWithToken,
  loginWithUid,
  logout,
  useBackend,
} from "../services/cometchat";

const AuthContext = createContext(null);

// Signs the browser in to CometChat as `account`, reusing an existing chat session when it matches.
async function connectChat(account) {
  const existing = await getLoggedInUser();
  if (existing?.getUid() === account.uid) return existing;
  if (existing) await logout().catch(() => {});
  const { authToken } = await api.chatToken();
  return loginWithToken(authToken);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // CometChat user, used across the app
  const [account, setAccount] = useState(null); // our backend account: { uid, name, email }
  // "initializing" -> "ready" | "error" | "unconfigured"
  const [status, setStatus] = useState(isConfigured ? "initializing" : "unconfigured");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        await initCometChat();
        let chatUser = null;
        let signedIn = null;
        if (useBackend) {
          const health = await api.health();
          if (!isDemo && health.chat === "demo") {
            throw new Error("The server is in demo mode. Add COMETCHAT_REST_API_KEY to the backend .env and restart it.");
          }
          signedIn = await api.me();
          if (signedIn) chatUser = await connectChat(signedIn);
          else if (await getLoggedInUser()) await logout().catch(() => {}); // stale chat session
        } else {
          chatUser = await getLoggedInUser(); // the SDK keeps the demo session
        }
        if (cancelled) return;
        setAccount(signedIn);
        setUser(chatUser);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setError(e);
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // After the backend accepts the login, connect chat; undo the login if that fails.
  const finishSignIn = useCallback(async (signedIn) => {
    try {
      const chatUser = await connectChat(signedIn);
      setAccount(signedIn);
      setUser(chatUser);
      return chatUser;
    } catch (e) {
      await api.logout().catch(() => {});
      throw e;
    }
  }, []);

  const signIn = useCallback(
    async (email, password) => finishSignIn(await api.login(email, password)),
    [finishSignIn],
  );

  const signUp = useCallback(
    async (name, email, password) => finishSignIn(await api.signup(name, email, password)),
    [finishSignIn],
  );

  // Offline demo only.
  const signInAsSample = useCallback(async (uid) => {
    const chatUser = await loginWithUid(uid);
    setUser(chatUser);
    return chatUser;
  }, []);

  const signOut = useCallback(async () => {
    await logout().catch(() => {});
    if (useBackend) await api.logout().catch(() => {});
    setUser(null);
    setAccount(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, account, status, error, signIn, signUp, signInAsSample, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
