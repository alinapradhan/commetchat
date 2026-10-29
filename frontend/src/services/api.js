// Calls our own backend (../backend). The session lives in an HttpOnly cookie,
// so page JavaScript never sees or stores it.
async function call(path, { method = "GET", body } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export const api = {
  health: () => call("/health"),
  // The signed-in account, or null when there is no valid session.
  me: () =>
    call("/auth/me")
      .then((data) => data.user)
      .catch((error) => {
        if (error.status === 401) return null;
        throw error;
      }),
  signup: (name, email, password) =>
    call("/auth/signup", { method: "POST", body: { name, email, password } }).then((data) => data.user),
  login: (email, password) => call("/auth/login", { method: "POST", body: { email, password } }).then((data) => data.user),
  logout: () => call("/auth/logout", { method: "POST" }),
  chatToken: () => call("/chat/token", { method: "POST" }),
};
