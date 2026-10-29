// Browser notifications and a short "ping" for incoming messages.
// The on/off choice is a per-browser preference kept in localStorage.
const STORAGE_KEY = "cc-notifications";

export function notificationsEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export async function setNotificationsEnabled(on) {
  if (on && "Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // preference just won't persist
  }
}

let audioContext = null;

function playPing() {
  try {
    audioContext ??= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.25);
  } catch {
    // audio blocked or unsupported
  }
}

// Pings, and shows a system notification when the tab is in the background.
export function notifyMessage(title, body) {
  if (!notificationsEnabled()) return;
  playPing();
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body });
    } catch {
      // some browsers only allow notifications from a service worker
    }
  }
}
