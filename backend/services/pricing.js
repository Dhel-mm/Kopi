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

// Senior Citizen (RA 9994) and PWD (RA 10754) discount policy.
// Menu prices are VAT-inclusive. For a VAT-registered shop the cardholder's
// items are VAT-exempt and the 20% discount is taken from the VAT-exclusive
// price. Set vatRegistered to false if the shop is not VAT-registered: then
// only the 20% discount applies. The discount covers the cardholder's own
// order, which this shop defines as one drink and one food item per order.
const SPECIAL_DISCOUNT = Object.freeze({
  types: Object.freeze(["Senior Citizen", "PWD"]),
  rate: 0.20,
  vatRate: 0.12,
  vatRegistered: true,
  perCardholder: Object.freeze({ drink: 1, food: 1 })
});

// ---- ID number formats ----------------------------------------------------
// PWD ID (NCDA/DOH Philippine Registry for PWDs): RR-PPMM-BBB-NNNNNNN, built from
// the Philippine Standard Geographic Code: region, province, city/municipality,
// barangay (000 when issued by the city) and a sequence number. Most LGUs use a
// 7-digit sequence; some use 5, so 14 or 16 digits are accepted.
// Senior Citizen (OSCA) IDs have no single nationwide format: each city issues
// its own control number. They are checked against the registry instead.
const PSGC_REGIONS = Object.freeze({
  "01": "Region I (Ilocos)", "02": "Region II (Cagayan Valley)", "03": "Region III (Central Luzon)",
  "04": "Region IV-A (CALABARZON)", "05": "Region V (Bicol)", "06": "Region VI (Western Visayas)",
  "07": "Region VII (Central Visayas)", "08": "Region VIII (Eastern Visayas)", "09": "Region IX (Zamboanga Peninsula)",
  "10": "Region X (Northern Mindanao)", "11": "Region XI (Davao)", "12": "Region XII (SOCCSKSARGEN)",
  "13": "NCR (Metro Manila)", "14": "CAR (Cordillera)", "15": "BARMM", "16": "Region XIII (Caraga)",
  "17": "MIMAROPA", "18": "NIR (Negros Island)"
});

function formatIdNumber(type, raw) {
  const text = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (type === "PWD") {
    const digits = text.replace(/[\s-]/g, "");
    if (!/^\d{14}(\d{2})?$/.test(digits)) {
      throw new OrderError("Enter the PWD ID number in the official format RR-PPMM-BBB-NNNNNNN (for example 04-3405-012-0001234). Numbers only.");
    }
    const region = digits.slice(0, 2), province = digits.slice(2, 4), city = digits.slice(4, 6);
    if (!PSGC_REGIONS[region]) throw new OrderError(`"${region}" is not a Philippine region code. A PWD ID starts with the region code (01 to 18).`);
    if (province === "00" || city === "00") throw new OrderError("The PWD ID's province and city codes (digits 3 to 6) cannot be 00.");
    return `${region}-${province}${city}-${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  const compact = text.replace(/\s+/g, " ");
  if (!/^[A-Z0-9][A-Z0-9 \-\/]{3,29}$/.test(compact) || (compact.match(/\d/g) || []).length < 3) {
    throw new OrderError("Enter the OSCA ID control number exactly as printed (4 to 30 letters and numbers, with at least 3 digits).");
  }
  return compact;
}

function specialDiscountInput(value, inStore) {
  if (value == null || value === false) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new OrderError("Invalid Senior Citizen/PWD discount details.");
  if (!SPECIAL_DISCOUNT.types.includes(value.type)) throw new OrderError("Choose Senior Citizen or PWD for the discount.");
  const idNumber = formatIdNumber(value.type, value.idNumber);
  const name = typeof value.name === "string" ? value.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 120 || !/^[\p{L}][\p{L} .,'’\-]*$/u.test(name)) {
    throw new OrderError("Enter the cardholder's name exactly as printed on the ID.");
  }
  // At the counter the cashier must see the physical ID before applying it.
  if (inStore && value.idChecked !== true) throw new OrderError(`Check the customer's ${value.type} ID before applying the discount.`);
  return { type: value.type, idNumber, name };
}

// Picks the cardholder's own items (the highest-priced eligible drink and food
// unit) and returns the VAT exemption and 20% discount in centavos.
function specialDiscountAmounts(items, policy = SPECIAL_DISCOUNT) {
  const units = [];
  for (const kind of ["drink", "food"]) {
    const candidates = items
      .filter(item => (catalog.findProduct(item.productId)?.type || "food") === kind)
      .sort((a, b) => b.priceCents - a.priceCents);
    if (candidates.length && policy.perCardholder[kind] > 0) {
      const pick = candidates[0];
      units.push({ productId: pick.productId, name: pick.name, variant: pick.variant, kind,
        quantity: Math.min(policy.perCardholder[kind], pick.quantity), unitPriceCents: pick.priceCents });
    }
  }
  let vatExemptCents = 0, discountCents = 0;
  for (const unit of units) {
    const grossCents = unit.unitPriceCents * unit.quantity;
    const baseCents = policy.vatRegistered ? Math.round(grossCents / (1 + policy.vatRate)) : grossCents;
    unit.vatExemptCents = grossCents - baseCents;
    unit.discountCents = Math.round(baseCents * policy.rate);
    vatExemptCents += unit.vatExemptCents;
    discountCents += unit.discountCents;
  }
  return { units, vatExemptCents, discountCents };
}

// verifyId (optional) checks the ID against the registry; see idRegistry.js.
function quote(body, inStore = false, resolveVoucher, verifyId) {
  const items = priceItems(body.items);
  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  if (subtotalCents > 100000000) throw new OrderError("Order total is too large.");
  if (body.voucher != null && typeof body.voucher !== "string") throw new OrderError("Invalid voucher.");
  const voucher = (body.voucher || "").trim().toUpperCase();
  let cardholder = specialDiscountInput(body.specialDiscount, inStore);
  if (cardholder && voucher) {
    throw new OrderError("The Senior Citizen/PWD discount cannot be combined with a voucher. Remove the voucher or the discount.");
  }
  let discountCents = 0;
  // Manual discounts are not allowed for anyone. They left no reason or approval
  // on record. Price reductions must come from an admin-created voucher.
  if (body.discount != null && body.discount !== 0) {
    throw new OrderError("Manual discounts are not allowed. Ask an administrator to create a voucher instead.");
  }
  if (voucher) {
    if (!resolveVoucher) throw new OrderError("That voucher code is not valid.");
    discountCents = Math.min(resolveVoucher(voucher), subtotalCents);
  }
  let specialDiscount = null, specialCents = 0;
  let verification = null;
  if (cardholder && verifyId) {
    verification = verifyId(cardholder);
    cardholder = { ...cardholder, idNumber: verification.idNumber, name: verification.name };
  }
  if (cardholder) {
    const amounts = specialDiscountAmounts(items);
    if (!amounts.units.length) throw new OrderError("Add the cardholder's drink or food item before applying the discount.");
    specialCents = amounts.vatExemptCents + amounts.discountCents;
    specialDiscount = {
      ...cardholder,
      ...(verification ? { verification } : {}),
      vatExempt: amounts.vatExemptCents / 100,
      discount: amounts.discountCents / 100,
      deduction: specialCents / 100,
      coveredItems: amounts.units.map(unit => ({ productId: unit.productId, name: unit.name, variant: unit.variant,
        quantity: unit.quantity, unitPrice: unit.unitPriceCents / 100 })),
      rule: `20% discount${SPECIAL_DISCOUNT.vatRegistered ? " and 12% VAT exemption" : ""} on the cardholder's own order: one drink and one food item.`
    };
  }
  // Current shop policy: free delivery. Never accept a browser-supplied fee or price.
  return {
    items, voucher, subtotal: subtotalCents / 100, deliveryFee: 0,
    voucherDiscount: discountCents / 100, specialDiscount,
    total: (subtotalCents - discountCents - specialCents) / 100
  };
}

module.exports = { catalog, OrderError, money, priceItems, quote, SPECIAL_DISCOUNT, specialDiscountAmounts, formatIdNumber, PSGC_REGIONS };
