const KopiApi = (() => {
  const baseUrl = window.location.protocol === "file:" ? "http://localhost:3000/api" : "/api";
  const sessionKey = "kopi_api_session";

  function getSession() {
    try {
      return JSON.parse(sessionStorage.getItem(sessionKey) || localStorage.getItem(sessionKey)) || null;
    } catch {
      return null;
    }
  }

  function saveSession(data, remember) {
    if (remember === undefined) remember = Boolean(localStorage.getItem(sessionKey));
    clearSession();
    (remember ? localStorage : sessionStorage).setItem(sessionKey, JSON.stringify(data));
  }

  function clearSession() {
    localStorage.removeItem(sessionKey);
    sessionStorage.removeItem(sessionKey);
  }

  async function request(path, options = {}) {
    const session = getSession();

    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    if (session?.token) {
      headers.Authorization = `Bearer ${session.token}`;
    }

    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers
    });

    let data;
    try { data = await response.json(); }
    catch { throw new Error("The server returned an unexpected response. Check that the backend is running."); }

    if (!response.ok) {
      const error = new Error(data.message || "Something went wrong.");
      error.status = response.status;
      if (response.status === 401 && !path.startsWith("/auth/")) clearSession();
      throw error;
    }

    return data;
  }

  async function logout() {
    try { await request("/auth/logout", { method:"POST" }); }
    finally { clearSession(); }
  }

  async function download(path, filename) {
    const response = await fetch(baseUrl + path, {headers:{Authorization:"Bearer "+(getSession()?.token||"")}});
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.message || "Download failed.");
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function pendingKey(path) { return "kopi_pending_" + (getSession()?.user?.id ?? "guest") + "_" + path; }
  function pendingOrder(path) {
    try { return JSON.parse(sessionStorage.getItem(pendingKey(path))); } catch { return null; }
  }
  function hasPendingOrder(path) { const pending=pendingOrder(path); return Boolean(pending && !pending.rejected); }

  async function placeOrder(path, payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map(byte => byte.toString(16).padStart(2, "0")).join("");
    const key = pendingKey(path);
    let pending = pendingOrder(path);
    if (pending && !pending.rejected && pending.hash !== hash) {
      throw new Error("A previous checkout has not been cleared. Use Recover previous order before starting a different order.");
    }
    if (pending?.hash !== hash) {
      pending = { hash, requestKey: crypto.randomUUID(), payload };
    }
    pending.payload = payload;
    pending.rejected = false;
    sessionStorage.setItem(key, JSON.stringify(pending));
    try {
      return await request(path, { method: "POST", body: JSON.stringify({ ...payload, requestKey: pending.requestKey }) });
    } catch (error) {
      // A validation rejection is safe to edit. Network/5xx failures may have
      // succeeded, so preserve the original payload and key for recovery.
      if (error.status >= 400 && error.status < 500) {
        pending.rejected = true;
        sessionStorage.setItem(key, JSON.stringify(pending));
      }
      throw error;
    }
  }

  async function recoverOrder(path) {
    const pending = pendingOrder(path);
    if (!pending) throw new Error("There is no previous checkout to recover.");
    try {
      return await request(path+"/requests/"+encodeURIComponent(pending.requestKey));
    } catch (error) {
      if (error.status !== 404 || !pending.payload) throw error;
      return placeOrder(path,pending.payload);
    }
  }

  function finishOrder(path) {
    sessionStorage.removeItem(pendingKey(path));
    sessionStorage.removeItem("kopi_pending_" + path);
  }

  return {
    placeOrder,
    pendingOrder,
    hasPendingOrder,
    recoverOrder,
    finishOrder,
    request,
    logout,
    download,
    getSession,
    saveSession,
    clearSession
  };
})();
