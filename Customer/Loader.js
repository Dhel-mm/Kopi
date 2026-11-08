/* Page loader: a cup of coffee with rising steam while the page loads.
   Include right after <body> (and Loader.css in <head>). It appears only if
   loading takes more than a moment, and on Staff and Cashier pages it waits
   until the account check has finished. */
(() => {
  "use strict";
  const loader = document.createElement("div");
  loader.className = "kopi-loader";
  loader.setAttribute("role", "status");
  loader.setAttribute("aria-live", "polite");
  loader.innerHTML = `<div class="kopi-loader-cup" aria-hidden="true">
      <svg viewBox="0 0 120 120">
        <g class="steam">
          <path d="M47 40c-6-6 6-10 0-16s6-10 0-16"/>
          <path d="M60 40c-6-6 6-10 0-16s6-10 0-16"/>
          <path d="M73 40c-6-6 6-10 0-16s6-10 0-16"/>
        </g>
        <ellipse class="saucer" cx="60" cy="106" rx="44" ry="7"/>
        <g class="cup-group">
          <path class="handle" d="M90 60h5a10 10 0 0 1 0 20h-7"/>
          <path class="cup" d="M28 50h64v22c0 18-14 32-32 32S28 90 28 72z"/>
          <ellipse class="coffee" cx="60" cy="51" rx="30" ry="5.5"/>
          <ellipse class="crema" cx="54" cy="50" rx="10" ry="2"/>
        </g>
      </svg>
    </div>
    <p class="kopi-loader-text">Brewing<span>.</span><span>.</span><span>.</span></p>`;
  document.body.prepend(loader);

  let loaded = false, finished = false;
  // Staff and Cashier pages stay "loading" until their account check finishes or shows an error.
  const waiting = () => document.body.classList.contains("workspace-loading") &&
    !document.querySelector("#workspaceGate h1");
  function finish(force = false) {
    if (finished || (!force && (!loaded || waiting()))) return;
    finished = true;
    observer.disconnect();
    // Start the fade from wherever the fade-in reached, so it never jumps.
    loader.style.opacity = getComputedStyle(loader).opacity;
    void loader.offsetWidth;
    loader.classList.add("is-done");
    loader.style.opacity = "0";
    setTimeout(() => loader.remove(), 400);
  }
  const observer = new MutationObserver(() => finish());
  observer.observe(document.body, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true });
  window.addEventListener("load", () => { loaded = true; finish(); });
  // Never block the page for long, even if something fails to load.
  setTimeout(() => finish(true), 8000);
})();
