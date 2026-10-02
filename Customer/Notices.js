/* Shared, text-only feedback. Destructive actions keep their native confirmations. */
const KopiNotice = (() => {
  const kinds = new Set(["success", "error", "warning", "loading", "info"]);
  function kindFor(message) {
    const text = String(message || "");
    if (/incorrect|inactive|invalid|failed|could not|cannot|can't|unable|error|expired|not found|do not match|too many|unavailable|not enough|insufficient|already used|already exists|not permitted|permission|unauthorized|out of stock/i.test(text)) return "error";
    if (/please wait|loading|checking|saving|sending|signing in/i.test(text)) return "loading";
    if (/success|saved|created|copied|removed|updated successfully|prices and stock checked|is now preparing|signed out|thank you for your feedback/i.test(text)) return "success";
    if (/please select|please enter|please complete|please log in|must|required|do not send|estimate|review|changed|expired|excluded/i.test(text)) return "warning";
    return "info";
  }
  function paint(element, kind) {
    element.classList.add("kopi-notice");
    element.dataset.noticeType = kinds.has(kind) ? kind : "info";
    element.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
    element.setAttribute("aria-atomic", "true");
  }
  function set(element, message, kind = kindFor(message)) {
    if (!element) return;
    element.textContent = String(message || "");
    paint(element, kind);
    // Remember explicit severity only for this exact message, never for later updates.
    element.dataset.noticeMessage = element.textContent;
  }
  function toast(message, kind = kindFor(message), duration = 6000) {
    const node = document.createElement("div");
    node.className = "kopi-toast logout-toast";
    node.dataset.noticeType = kinds.has(kind) ? kind : "info";
    node.setAttribute("role", kind === "error" ? "alert" : "status");
    node.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
    const icon = document.createElement("span");
    icon.className = "kopi-toast-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = {success:"✓",error:"!",warning:"!",loading:"…",info:"i"}[node.dataset.noticeType];
    const text = document.createElement("span");
    text.className = "kopi-toast-text";
    text.textContent = String(message);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "kopi-toast-close";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "×";
    node.append(icon, text, close);
    // A toast inside an open dialog must be in the dialog's top layer.
    const parent = document.querySelector("dialog[open]") || document.body;
    parent.querySelectorAll(".kopi-toast").forEach(previous => previous.remove());
    parent.appendChild(node);
    requestAnimationFrame(() => node.classList.add("show"));
    let timer;
    const dismiss = () => { clearTimeout(timer); node.remove(); };
    const startTimer = () => { clearTimeout(timer); timer = setTimeout(dismiss, duration); };
    close.addEventListener("click", dismiss);
    node.addEventListener("mouseenter", () => clearTimeout(timer));
    node.addEventListener("mouseleave", startTimer);
    node.addEventListener("focusin", () => clearTimeout(timer));
    node.addEventListener("focusout", startTimer);
    startTimer();
    return node;
  }
  function refresh() {
    document.querySelectorAll('[role="status"], [role="alert"], #inventoryEmpty, #usersEmpty').forEach(element => {
      if (element.closest(".logout-toast, .success-message")) return;
      if (element.querySelector("ul,table,article,details")) {
        element.classList.remove("kopi-notice");
        return;
      }
      const message = element.textContent.trim();
      if (!message) { element.classList.remove("kopi-notice"); return; }
      const kind = element.dataset.noticeMessage === element.textContent ? element.dataset.noticeType : kindFor(message);
      paint(element, kind);
    });
  }
  const observer = new MutationObserver(refresh);
  observer.observe(document.body, {childList:true, subtree:true, characterData:true});
  refresh();
  return {set, toast, kindFor};
})();
window.KopiNotice = KopiNotice;
