import { useEffect, useState } from "react";
import { onConnectionChange } from "../services/cometchat";

// "connected" | "connecting" | "disconnected", from the SDK's WebSocket state.
export function useConnectionStatus() {
  const [status, setStatus] = useState("connected");
  useEffect(() => onConnectionChange(setStatus), []);
  return status;
}
