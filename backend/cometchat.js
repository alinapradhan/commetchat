// Talks to the CometChat REST API with the secret REST API key, which never
// leaves this server. Demo mode returns fake tokens for the offline demo backend.
export function createCometChatClient({ demo, appId, region, restApiKey }, fetchImpl = fetch) {
  if (demo) {
    return {
      mode: "demo",
      async createUser() {},
      // Only the in-browser demo backend accepts these. They are not real credentials.
      async createAuthToken(user) {
        return `demo.${Buffer.from(JSON.stringify({ uid: user.uid, name: user.name })).toString("base64url")}`;
      },
      async revokeAuthToken() {},
    };
  }

  const baseUrl = `https://${encodeURIComponent(appId)}.api-${encodeURIComponent(region)}.cometchat.io/v3`;

  async function call(method, path, body) {
    const response = await fetchImpl(baseUrl + path, {
      method,
      headers: { apikey: restApiKey, "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(json?.error?.message || `CometChat API responded ${response.status}`);
      error.code = json?.error?.code;
      error.status = response.status;
      throw error;
    }
    return json?.data ?? json;
  }

  return {
    mode: "live",
    async createUser(user) {
      try {
        await call("POST", "/users", { uid: user.uid, name: user.name });
      } catch (error) {
        if (error.code !== "ERR_UID_ALREADY_EXISTS") throw error;
      }
    },
    async createAuthToken(user) {
      const data = await call("POST", `/users/${encodeURIComponent(user.uid)}/auth_tokens`, {});
      if (!data?.authToken) throw new Error("CometChat did not return an auth token");
      return data.authToken;
    },
    // CometChat tokens don't expire on their own, so logout revokes them.
    async revokeAuthToken(uid, token) {
      await call("DELETE", `/users/${encodeURIComponent(uid)}/auth_tokens/${encodeURIComponent(token)}`).catch(
        () => {},
      );
    },
  };
}
