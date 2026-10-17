(() => {
  const root = document.documentElement;
  const key = "kopi_welcome_transition";
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const nativeTransition = "onpageswap" in window && "onpagereveal" in window;
  let navigating = false;
  let timer;

  // Runs in the head so the form does not flash before its entrance animation.
  if (/\/login\.html$/i.test(window.location.pathname)) {
    try {
      const started = Number(sessionStorage.getItem(key));
      sessionStorage.removeItem(key);
      if (started && Date.now() - started < 15000 && !reducedMotion()) root.classList.add("welcome-entering");
    } catch { /* Navigation also works when storage is unavailable. */ }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const link = document.querySelector('.btn-container a[href="login.html"]');
    if (!link) return;
    link.addEventListener("click", event => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (nativeTransition || reducedMotion()) return;
      event.preventDefault();
      if (navigating) return;
      navigating = true;
      root.classList.add("welcome-leaving");
      try { sessionStorage.setItem(key, String(Date.now())); } catch { /* Optional visual effect. */ }
      timer = window.setTimeout(() => window.location.assign(link.href), 200);
    });
  });

  // Back/forward cache must restore a visible, clickable Get Started button.
  window.addEventListener("pageshow", event => {
    window.clearTimeout(timer);
    navigating = false;
    root.classList.remove("welcome-leaving");
    if (event.persisted) root.classList.remove("welcome-entering");
  });
})();
