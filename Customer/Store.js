const KopiStore = (() => {
  const CART_KEY = "kopiCart";
  const CHECKOUT_KEY = "kopiCheckout";
  const ADDRESS_KEY = "kopiAddress";
  const SESSION_KEY = "kopi_api_session";

  // Each account keeps its own cart, checkout and delivery address in this
  // browser (saved as "kopiCart:user12", "kopiCart:guest", ...). A new account
  // starts empty, and one person's cart or address never shows for another.
  function ownerId() {
    const stores = [typeof sessionStorage === "undefined" ? null : sessionStorage, localStorage];
    for (const store of stores) {
      try {
        const id = JSON.parse(store?.getItem(SESSION_KEY) || "null")?.user?.id;
        if (id != null) return "user" + id;
      } catch { /* A damaged session counts as a guest. */ }
    }
    return "guest";
  }
  const scoped = key => key + ":" + ownerId();

  const products = KopiCatalog.categories;

  function allProducts() {
    return products.flatMap(category => category.products.map(product => ({ ...product, category: category.name })));
  }

  function findProduct(id) {
    return allProducts().find(product => product.id === id);
  }

  function readRaw(fullKey, fallback) {
    try {
      return JSON.parse(localStorage.getItem(fullKey)) || fallback;
    } catch {
      return fallback;
    }
  }

  function read(key, fallback) {
    return readRaw(scoped(key), fallback);
  }

  function write(key, value) {
    localStorage.setItem(scoped(key), JSON.stringify(value));
  }

  // Items added before logging in or signing up move into that account.
  function adoptGuestCart() {
    const owner = ownerId();
    if (owner === "guest") return;
    const guestKey = CART_KEY + ":guest";
    const guest = readRaw(guestKey, []);
    localStorage.removeItem(CHECKOUT_KEY + ":guest");
    if (!guest.length) return;
    const cart = readRaw(CART_KEY + ":" + owner, []);
    for (const item of guest) {
      const existing = cart.find(entry => sameOrder(entry, item));
      if (existing) existing.quantity += item.quantity;
      else cart.push(item);
    }
    localStorage.setItem(CART_KEY + ":" + owner, JSON.stringify(cart));
    localStorage.removeItem(guestKey);
  }

  // Data saved before carts were kept per account is cleared once, because
  // it cannot be told which account it belonged to.
  for (const legacy of [CART_KEY, CHECKOUT_KEY, ADDRESS_KEY]) {
    try { localStorage.removeItem(legacy); } catch { /* Storage may be unavailable. */ }
  }

  function getCart() {
    adoptGuestCart();
    return read(CART_KEY, []);
  }

  function saveCart(cart) {
    write(CART_KEY, cart);
    updateCartCount();
  }

  function addToCart(itemData) {
    const cart = getCart();
    const existing = cart.find(item => sameOrder(item, itemData));

    if (existing) {
      existing.quantity += itemData.quantity;
    } else {
      cart.push({ ...itemData, cartId: Date.now().toString(36) + Math.random().toString(36).slice(2, 8) });
    }

    saveCart(cart);
  }

  function sameOrder(a, b) {
    return a.productId === b.productId &&
      JSON.stringify(a.options || {}) === JSON.stringify(b.options || {});
  }

  function updateCartItem(cartId, data) {
    const cart = getCart().map(item => item.cartId === cartId ? { ...item, ...data } : item);
    saveCart(cart);
  }

  function deleteCartItem(cartId) {
    saveCart(getCart().filter(item => item.cartId !== cartId));
  }

  function clearCart() {
    saveCart([]);
  }

  function consumeCheckout(orderedItems) {
    const cart = getCart();
    for (const ordered of orderedItems) {
      const item = cart.find(entry=>entry.cartId===ordered.cartId && sameOrder(entry,ordered));
      if (item) item.quantity = Math.max(0,item.quantity-ordered.quantity);
    }
    saveCart(cart.filter(item=>item.quantity>0));
  }

  function cartTotal(cart = getCart()) {
    return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  function cartCount(cart = getCart()) {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }

  function updateCartCount() {
    document.querySelectorAll("[data-cart-count]").forEach(count => {
      count.textContent = cartCount();
    });
  }

  function setCheckout(items) {
    write(CHECKOUT_KEY, items);
  }

  function getCheckout() {
    const raw = localStorage.getItem(scoped(CHECKOUT_KEY));
    if (raw !== null) {
      return read(CHECKOUT_KEY, []);
    }
    return getCart();
  }

  // A new account starts with an empty delivery address.
  function getAddress() {
    return localStorage.getItem(scoped(ADDRESS_KEY)) || "";
  }

  function setAddress(address) {
    localStorage.setItem(scoped(ADDRESS_KEY), address);
  }

  return {
    products,
    allProducts,
    findProduct,
    getCart,
    saveCart,
    addToCart,
    updateCartItem,
    deleteCartItem,
    clearCart,
    consumeCheckout,
    cartTotal,
    cartCount,
    updateCartCount,
    setCheckout,
    getCheckout,
    getAddress,
    setAddress
  };
})();

document.addEventListener("DOMContentLoaded", KopiStore.updateCartCount);

// The header and phone navigation share a highlight below their link content.
(() => {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const links = Array.from(document.querySelectorAll(".nav-links .nav-link"));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let navigating = false;
  let indicator = null;
  let navigationTimer = null;

  function resetMotion() {
    window.clearTimeout(navigationTimer);
    navigationTimer = null;
    navigating = false;
    indicator?.remove();
    indicator = null;
    document.body.classList.remove("nav-is-moving");
    links.forEach(link => link.querySelector("i")?.classList.remove("nav-link-icon-clicked"));
  }

  function animateIcon(link) {
    const icon = link.querySelector("i");
    if (!icon) return;
    icon.classList.remove("nav-link-icon-clicked");
    void icon.offsetWidth;
    icon.classList.add("nav-link-icon-clicked");
  }

  window.addEventListener("pageshow", resetMotion);
  window.addEventListener("pagehide", resetMotion);

  links.forEach(link => {
    link.addEventListener("click", event => {
      if (event.defaultPrevented ||
          (event.button != null && event.button !== 0) ||
          event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
          (link.target && link.target !== "_self") ||
          link.hasAttribute("download") || !link.href) return;

      if (navigating) {
        event.preventDefault();
        return;
      }
      if (reducedMotion.matches) return;
      if (link.href === window.location.href) {
        event.preventDefault();
        animateIcon(link);
        return;
      }

      const nav = link.closest(".nav-links");
      const activeLink = nav?.querySelector(".nav-link.active");
      if (!activeLink) return;

      // Phone layouts highlight the icon; wider layouts highlight the whole link.
      const activeIcon = activeLink.querySelector("i");
      const iconBackground = activeIcon && window.getComputedStyle(activeIcon).backgroundColor;
      const useIcon = iconBackground && iconBackground !== "transparent" &&
        iconBackground !== "rgba(0, 0, 0, 0)";
      const source = useIcon ? activeIcon : activeLink;
      const target = useIcon ? link.querySelector("i") : link;
      if (!target) return;

      const from = source.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      const style = window.getComputedStyle(source);
      const left = from.left - navRect.left - nav.clientLeft + nav.scrollLeft;
      const top = from.top - navRect.top - nav.clientTop + nav.scrollTop;

      event.preventDefault();
      navigating = true;
      indicator = document.createElement("span");
      indicator.className = "nav-link-motion-indicator";
      indicator.setAttribute("aria-hidden", "true");
      indicator.style.backgroundColor = style.backgroundColor;
      indicator.style.borderRadius = style.borderRadius;
      indicator.style.width = `${from.width}px`;
      indicator.style.height = `${from.height}px`;
      indicator.style.transform = `translate(${left}px, ${top}px)`;
      nav.prepend(indicator);
      void indicator.offsetWidth;
      document.body.classList.add("nav-is-moving");
      animateIcon(link);

      let followed = false;
      function followLink() {
        if (followed) return;
        followed = true;
        window.clearTimeout(navigationTimer);
        window.location.assign(link.href);
      }

      indicator.addEventListener("transitionend", event => {
        if (event.target === indicator && event.propertyName === "transform") followLink();
      });
      indicator.style.transform = `translate(${left + to.left - from.left}px, ${top + to.top - from.top}px)`;
      indicator.style.width = `${to.width}px`;
      indicator.style.height = `${to.height}px`;
      navigationTimer = window.setTimeout(followLink, 420);
    });
  });
})();
