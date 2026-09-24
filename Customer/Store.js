const KopiStore = (() => {
  const CART_KEY = "kopiCart";
  const CHECKOUT_KEY = "kopiCheckout";
  const ADDRESS_KEY = "kopiAddress";

  const products = KopiCatalog.categories;

  function allProducts() {
    return products.flatMap(category => category.products.map(product => ({ ...product, category: category.name })));
  }

  function findProduct(id) {
    return allProducts().find(product => product.id === id);
  }

  function read(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getCart() {
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
    const raw = localStorage.getItem(CHECKOUT_KEY);
    if (raw !== null) {
      return read(CHECKOUT_KEY, []);
    }
    return getCart();
  }

  function getAddress() {
    return localStorage.getItem(ADDRESS_KEY) || "Lingga, Calamba City";
  }

  function setAddress(address) {
    localStorage.setItem(ADDRESS_KEY, address);
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
