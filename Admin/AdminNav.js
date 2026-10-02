(() => {
  "use strict";

  const links = Array.from(document.querySelectorAll(".admin-nav .admin-nav-link"));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let navigating = false;
  let indicator = null;
  let navigationTimer = null;

  function resetMotion() {
    window.clearTimeout(navigationTimer);
    navigationTimer = null;
    indicator?.remove();
    indicator = null;
    navigating = false;
    document.body.classList.remove("admin-nav-is-moving");
    links.forEach(link => {
      link.classList.remove("admin-nav-link-motion-target");
      link.querySelector("i")?.classList.remove("admin-nav-icon-clicked");
    });
  }

  // Back/forward cache may restore the old document with its animation state.
  window.addEventListener("pageshow", resetMotion);
  window.addEventListener("pagehide", resetMotion);

  function animateIcon(link) {
    const icon = link.querySelector("i");
    if (!icon) return;
    icon.classList.remove("admin-nav-icon-clicked");
    void icon.offsetWidth;
    icon.classList.add("admin-nav-icon-clicked");
  }

  function canAnimateNavigation(event, link) {
    return !reducedMotion.matches &&
      !event.defaultPrevented &&
      (event.button == null || event.button === 0) &&
      !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
      (!link.target || link.target === "_self");
  }

  links.forEach(link => {
    link.addEventListener("click", event => {
      if (!canAnimateNavigation(event, link)) return;
      if (navigating) {
        event.preventDefault();
        return;
      }
      animateIcon(link);

      // Stay on the current page so its icon can finish the click response.
      if (new URL(link.href).href === window.location.href) {
        event.preventDefault();
        return;
      }

      const activeLink = document.querySelector(".admin-nav .admin-nav-link.active");
      if (!activeLink || !link.href) return;

      event.preventDefault();
      navigating = true;

      const nav = activeLink.closest(".admin-nav");
      const from = {left: activeLink.offsetLeft, top: activeLink.offsetTop,
        width: activeLink.offsetWidth, height: activeLink.offsetHeight};
      const to = {left: link.offsetLeft, top: link.offsetTop,
        width: link.offsetWidth, height: link.offsetHeight};
      indicator = document.createElement("span");
      indicator.className = "admin-nav-motion-indicator";
      indicator.setAttribute("aria-hidden", "true");
      indicator.style.transform = `translate(${from.left}px, ${from.top}px)`;
      indicator.style.width = `${from.width}px`;
      indicator.style.height = `${from.height}px`;

      nav.prepend(indicator);
      // Commit the starting position before moving, avoiding a one-frame jump.
      void indicator.offsetWidth;
      document.body.classList.add("admin-nav-is-moving");
      link.classList.add("admin-nav-link-motion-target");

      let followed = false;
      function followLink() {
        if (followed || !navigating) return;
        followed = true;
        window.clearTimeout(navigationTimer);
        // Keep the highlight visible at its destination while the page loads.
        window.location.assign(link.href);
      }
      indicator.addEventListener("transitionend", event => {
        if (event.target === indicator && event.propertyName === "transform") followLink();
      });
      indicator.style.transform = `translate(${to.left}px, ${to.top}px)`;
      indicator.style.width = `${to.width}px`;
      indicator.style.height = `${to.height}px`;
      navigationTimer = window.setTimeout(followLink, 420);
    });
  });
})();
