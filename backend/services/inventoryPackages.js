const {OrderError} = require("./pricing");
const {round} = require("./inventory");

function packageLabel(value) {
  if (typeof value !== "string") throw new OrderError("Enter a stock unit, such as bottle, bag or pack.");
  const label = value.trim().replace(/\s+/g, " ");
  if (!label || label.length > 40 || !/^[\p{L}\p{N}][\p{L}\p{N} .()/'’\-]*$/u.test(label)) {
    throw new OrderError("Enter a stock unit of up to 40 characters using letters, numbers, spaces or simple punctuation.");
  }
  return label;
}

function packageDefinition(item, input) {
  if (input.confirmedMeasured !== true) throw new OrderError("Confirm the measurement of your full packages.");
  const units = {L:["ml",1000],kg:["g",1000],g:["g",1],ml:["ml",1],pcs:["pcs",1]};
  const unit = units[input.recipeUnit];
  if (!unit) throw new OrderError("Choose L, kg, g, ml or pcs as the recipe unit.");
  if (unit[0] !== item.measurement) {
    throw new OrderError(`This ingredient is measured in ${item.measurement}. Use ${item.measurement === "ml" ? "L or ml" : item.measurement === "g" ? "kg or g" : "pcs"} for its package size.`);
  }
  const amount = input.recipeAmount, count = input.stockAmount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 100000000 || round(amount) !== amount) {
    throw new OrderError("Enter a recipe amount greater than zero with up to 3 decimal places.");
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > 100000000) {
    throw new OrderError("Enter a whole number of full packages greater than zero.");
  }
  const perPackage = amount * unit[1] / count;
  const capacity = round(perPackage);
  if (capacity < 0.001 || capacity > 100000000 || Math.abs(capacity - perPackage) > 0.0000001) {
    throw new OrderError("Each package must contain a measurable amount with up to 3 decimal places in the inventory unit.");
  }
  return {capacity, label:packageLabel(input.stockUnit)};
}

module.exports = {packageLabel, packageDefinition};
