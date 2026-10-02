const catalog = require("../../Customer/Catalog");

class OrderError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function money(value, label = "Amount") {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
      value > 1000000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) {
    throw new OrderError(`${label} must be a non-negative amount with at most two decimal places.`);
  }
  return Math.round(value * 100);
}

function priceItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 100) {
    throw new OrderError("Choose between 1 and 100 order lines.");
  }
  return items.map(item => {
    if (!item || typeof item !== "object") throw new OrderError("Invalid order item.");
    const product = catalog.findProduct(item.productId);
    if (!product) throw new OrderError("A product is no longer on the menu. Please refresh your cart.");
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
      throw new OrderError(`Choose a whole quantity from 1 to 100 for ${product.name}.`);
    }
    const supplied = item.options ?? {};
    if (typeof supplied !== "object" || Array.isArray(supplied) || supplied === null) {
      throw new OrderError("Invalid customizer options.");
    }
    const allowed = new Set(product.options.flatMap(option => [option.key, option.label]));
    if (Object.keys(supplied).some(key => !allowed.has(key))) {
      throw new OrderError(`Some options for ${product.name} are outdated. Edit the item in the menu.`);
    }
    const options = {};
    let variant = Object.keys(product.prices)[0];
    let extra = 0;
    for (const option of product.options) {
      if (supplied[option.key] != null && supplied[option.label] != null &&
          supplied[option.key] !== supplied[option.label]) throw new OrderError("Conflicting option values.");
      let value = supplied[option.label] ?? supplied[option.key];
      if (value == null || value === "") {
        if (option.addOnPrice) continue;
        if (option.priceKey && option.values.length > 1) {
          throw new OrderError(`Please choose ${option.label.toLowerCase()} for ${product.name}.`);
        }
        value = option.defaultValue ?? option.values[0];
      }
      if (!option.values.includes(value)) throw new OrderError(`Invalid ${option.label.toLowerCase()} for ${product.name}.`);
      options[option.label] = value;
      if (option.priceKey) variant = value;
      if (option.addOnPrice) extra += money(option.addOnPrice);
    }
    if (!Object.hasOwn(product.prices, variant)) throw new OrderError("Invalid product size.");
    const priceCents = money(product.prices[variant]) + extra;
    return {
      productId: product.id, name: product.name, image: product.image,
      category: product.category, variant, options, quantity: item.quantity,
      price: priceCents / 100, priceCents,
      ...(typeof item.cartId === "string" ? { cartId: item.cartId.slice(0, 150) } : {})
    };
  });
}

function quote(body, inStore = false, resolveVoucher) {
  const items = priceItems(body.items);
  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  if (subtotalCents > 100000000) throw new OrderError("Order total is too large.");
  if (body.voucher != null && typeof body.voucher !== "string") throw new OrderError("Invalid voucher.");
  const voucher = (body.voucher || "").trim().toUpperCase();
  let discountCents = 0;
  if (inStore) {
    // The cashier is authenticated as Admin; only this route permits a manual discount.
    discountCents = money(body.discount ?? 0, "Discount");
    if (discountCents > subtotalCents) throw new OrderError("Discount cannot exceed the subtotal.");
  }
  if (voucher) {
    if (discountCents > 0) throw new OrderError("Use either a voucher or a manual discount, not both.");
    if (!resolveVoucher) throw new OrderError("That voucher code is not valid.");
    discountCents = Math.min(resolveVoucher(voucher), subtotalCents);
  }
  // Current shop policy: free delivery. Never accept a browser-supplied fee or price.
  return {
    items, voucher, subtotal: subtotalCents / 100, deliveryFee: 0,
    voucherDiscount: discountCents / 100, total: (subtotalCents - discountCents) / 100
  };
}

module.exports = { catalog, OrderError, money, priceItems, quote };
