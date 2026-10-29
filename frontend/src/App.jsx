import { useAuth } from "./context/AuthContext";
import ChatLayout from "./components/ChatLayout";
import Login from "./components/Login";

export default function App() {
  const { user, status, error } = useAuth();

  if (status === "unconfigured") {
    return (
      <div className="center-screen">
        <div className="card">
          <h1>Setup needed</h1>
          <p>
            Copy <code>.env.example</code> to <code>.env</code> and add your CometChat App ID and Region. Put the REST
            API key in the backend's <code>.env</code> (see its <code>.env.example</code>), then restart both{" "}
            <code>npm run dev</code> servers.
          </p>
        </div>
      </div>
    );
  }
  if (status === "initializing") return <div className="center-screen muted">Connecting to CometChat…</div>;
  if (status === "error") {
    return <div className="center-screen error">Could not initialise CometChat: {error?.message}</div>;
  }
  return user ? <ChatLayout /> : <Login />;
}
