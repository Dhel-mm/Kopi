const {catalog, priceItems, OrderError} = require("./pricing");
const {createInventoryService} = require("./inventory");

function createProductAvailability(db) {
  const stock = createInventoryService(db);

  function canMake(product, options, takeout) {
    try {
      stock.check(priceItems([{productId: product.id, quantity: 1, options}]), takeout);
      return true;
    } catch (error) {
      if (error instanceof OrderError && error.status === 409) return false;
      throw error;
    }
  }

  // A product remains orderable if at least one size/flavor can be made.
  // Sizes, choices (ice level, flavors) and add-ons that cannot be made from
  // current stock are listed so the menu can mark them sold out.
  function describe(product, takeout) {
    const choiceOptions = product.options.filter(option => !option.addOnPrice);
    let combos = [{}];
    for (const option of choiceOptions) {
      combos = combos.flatMap(choice => option.values.map(value => ({...choice, [option.key]: value})));
    }
    const makeable = combos.filter(options => canMake(product, options, takeout));
    const unavailable = {};
    for (const option of choiceOptions) {
      const missing = option.values.filter(value => !makeable.some(options => options[option.key] === value));
      if (missing.length) unavailable[option.label] = missing;
    }
    if (makeable.length) {
      for (const option of product.options.filter(option => option.addOnPrice)) {
        const missing = option.values.filter(value => !canMake(product, {...makeable[0], [option.key]: value}, takeout));
        if (missing.length) unavailable[option.label] = missing;
      }
    }
    return {productId: product.id, available: makeable.length > 0, unavailable};
  }

  const list = db.transaction(serviceType => {
    if (!["Dine-in", "Takeout"].includes(serviceType)) throw new OrderError("Choose Dine-in or Takeout.");
    return catalog.products.map(product => describe(product, serviceType === "Takeout"));
  });
  return {list};
}

module.exports = {createProductAvailability};
