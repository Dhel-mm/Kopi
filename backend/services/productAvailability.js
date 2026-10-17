const {catalog, priceItems, OrderError} = require("./pricing");
const {createInventoryService} = require("./inventory");

function createProductAvailability(db) {
  const stock = createInventoryService(db);

  // A product remains orderable if at least one size/flavor can be made.
  // Optional add-ons are checked when the cashier chooses them.
  function available(product, takeout) {
    let choices = [{}];
    for (const option of product.options.filter(option => !option.addOnPrice)) {
      choices = choices.flatMap(choice => option.values.map(value => ({...choice, [option.key]: value})));
    }
    return choices.some(options => {
      try {
        stock.check(priceItems([{productId: product.id, quantity: 1, options}]), takeout);
        return true;
      } catch (error) {
        if (error instanceof OrderError && error.status === 409) return false;
        throw error;
      }
    });
  }

  const list = db.transaction(serviceType => {
    if (!["Dine-in", "Takeout"].includes(serviceType)) throw new OrderError("Choose Dine-in or Takeout.");
    return catalog.products.map(product => ({productId: product.id, available: available(product, serviceType === "Takeout")}));
  });
  return {list};
}

module.exports = {createProductAvailability};
