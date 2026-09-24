// Transcribed from the owner's recipe sheet. Unknown conversions are NOT guessed.
const { categories } = require("../../Customer/Catalog");
const t = (sku, amount, unit) => ({ sku, amount, unit });
const g = (sku, amount) => t(sku, amount, "g");
const ml = (sku, amount) => t(sku, amount, "ml");
const pcs = (sku, amount) => t(sku, amount, "pcs");
const milk = n => ml("fresh-milk", n);
const coffee = n => g("coffee-beans", n);
const sweet = n => ml("liquid-sweetener", n);
const hotCold = (hot, cold, isHot) => isHot ? hot : cold;
const recipes = [];
function add(id, label, terms) { recipes.push({ id, label, terms }); }

const drink = {
  "kopi-special": h => [coffee(h?18:20), milk(h?100:140), ml("kopi-special-syrup", h?20:25)],
  "caramel-macchiato": h => [coffee(h?18:20), milk(h?100:140), ml("caramel-syrup", h?20:25), ml("vanilla-syrup", h?10:15)],
  "sea-salt-latte": h => [coffee(h?18:20), milk(h?100:140), ml("sea-salt-cream", h?20:25)],
  "white-choco-mocha": h => [coffee(h?18:20), milk(h?100:140), ml("white-chocolate-sauce", h?25:30)],
  "salted-caramel": h => [coffee(h?18:20), milk(h?100:140), ml("caramel-syrup", h?15:20), ml("salted-caramel-sauce", h?10:15)],
  "nutella-latte": h => [coffee(h?18:20), milk(h?100:140), g("nutella-spread", h?20:25)],
  "spanish-latte": h => [coffee(h?18:20), milk(h?100:140), ml("condensed-milk", h?20:30)],
  "dirty-matcha": h => [coffee(h?18:20), g("matcha-powder", h?5:6), milk(h?100:140), sweet(h?15:20)],
  "cafe-latte": h => [coffee(h?18:20), milk(h?120:150)],
  // The supplied master stock explicitly assigns Mocha Syrup / Sauce to Dark Mocha.
  "dark-mocha": h => [coffee(h?18:20), milk(h?100:140), ml("mocha-syrup", h?20:30)],
  "americano": h => [coffee(h?18:20)],
  "matcha-latte": h => [g("matcha-powder", h?5:6), milk(h?100:140), sweet(h?15:20)],
  "milky-chocolate": h => [g("chocolate-powder", h?25:30), milk(h?100:140)],
  "sea-salt-matcha": h => [g("matcha-powder", h?5:6), milk(h?100:140), ml("sea-salt-cream", h?20:25)],
  "chocolate-matcha": h => [g("matcha-powder", h?5:6), milk(h?100:140), ml("chocolate-sauce", h?20:25)],
  "milky-oreo": h => [g("oreo-cookies", h?25:30), milk(h?100:140), sweet(h?15:20)],
  "milky-strawberry": h => [ml("strawberry-syrup", h?25:30), milk(h?100:140), ...(!h?[ml("strawberry-syrup",20)]:[])],
  "strawberry-oreo": h => [g("oreo-cookies", h?25:30), ml("strawberry-syrup", h?20:25), milk(h?100:140)],
  "hibiscus-tea-with-strawberry": h => [g("hibiscus-tea", h?10:12), ml("strawberry-syrup", h?15:20), g("strawberry-boba", h?30:40)]
};
const cream = {
  "nutty-choco": [g("chocolate-powder",25),milk(120),g("nutella-spread",20),g("tube-ice",100),g("whipped-cream",20)],
  "matcha-cream": [g("matcha-powder",5),milk(120),sweet(20),g("tube-ice",100),g("whipped-cream",25)],
  "cookies-n-cream": [g("oreo-cookies",30),milk(120),ml("cream-base",20),g("tube-ice",100),g("whipped-cream",20)],
  "triple-chocolate": [g("chocolate-powder",25),ml("chocolate-sauce",20),milk(120),g("tube-ice",100),g("whipped-cream",20),g("chocolate-topping",15)],
  "strawberry-n-cream": [ml("strawberry-syrup",30),milk(120),ml("cream-base",20),g("tube-ice",100),g("whipped-cream",25),g("strawberry-topping",20)],
  "triple-white-chocolate": [ml("white-chocolate-sauce",30),milk(120),ml("cream-base",20),g("tube-ice",100),g("whipped-cream",20)],
  "biscoff-n-cream": [g("biscoff-cookies",25),milk(120),ml("cream-base",20),g("tube-ice",100),g("whipped-cream",20),g("biscoff-crumbs",10)]
};
const frappe = {
  "caramel-frappe": [ml("caramel-syrup",20)],
  "triple-mocha": [ml("chocolate-sauce",30),ml("mocha-syrup",20)],
  "mocha-frappe": [ml("mocha-syrup",25)],
  "dark-mochaccino": [ml("mocha-syrup",25)],
  "white-mocha-frappe": [ml("white-chocolate-sauce",30)]
};
const rice = {
  bangus: g("bangus",150), liempo:g("pork-liempo",150),
  tapa:g("beef-tapa",120), "hungarian-sausage":g("hungarian-sausage",100)
};
const snacks = {
  "beef-quesadilla":[g("ground-beef",80),pcs("tortilla-wraps",2),g("cheese-blocks",40),ml("cheese-sauce",20),ml("cooking-oil",10)],
  "cheese-quesadilla":[pcs("tortilla-wraps",2),g("cheese-blocks",50),ml("cheese-sauce",20),ml("cooking-oil",10)],
  nachos:[g("nachos",100),g("cheese-sauce",50),g("ground-beef",50),g("snack-toppings",20),ml("nachos-sauce",20)],
  "cheesy-fries":[g("french-fries",150),g("cheese-sauce",50),g("snack-toppings",20)]
};

for (const category of categories) for (const product of category.products) {
  for (const variant of Object.keys(product.prices)) {
    const hot = variant.startsWith("HOT");
    let terms;
    if (drink[product.id]) {
      terms = [...drink[product.id](hot), pcs(hot?"12oz-cups":"16oz-cups",1)];
      if (!hot) terms.push(g("tube-ice",120),pcs("straws",1));
    } else if (category.id === "fruit-soda-tea-series") {
      terms = [ml(product.id+"-syrup",25),ml("sprite",220),g("tube-ice",120),pcs("16oz-cups",1),pcs("straws",1)];
    } else if (cream[product.id]) {
      terms = [...cream[product.id],pcs("16oz-cups",1),pcs("straws",1)];
    } else if (frappe[product.id]) {
      terms = [coffee(18),milk(100),...frappe[product.id],g("tube-ice",150),g("whipped-cream",20),pcs("16oz-cups",1),pcs("straws",1)];
    } else if (rice[product.id]) {
      terms = [rice[product.id],g("cooked-rice",150),pcs("fresh-eggs",1),g("side-vegetables",product.id==="hungarian-sausage"?50:30),ml("cooking-oil",15)];
    } else if (product.id === "chicken-wings") {
      const factor = variant==="12pcs"?2:1;
      terms = [pcs("chicken-wings",6*factor),g("breading-mix",50*factor),ml("cooking-oil",15*factor)];
    } else if (product.id === "chicken-fingers-with-fries") {
      terms = [pcs("chicken-fingers",5),g("french-fries",120),g("breading-mix",40),ml("cooking-oil",15)];
    } else terms = snacks[product.id];
    if (!terms) throw new Error("Missing recipe definition: "+product.id);
    add(product.id+"|"+variant, product.name+" — "+variant, terms);
  }
}
add("@addon|Oat milk","Add-on — Oat milk",[ml("oat-milk",60)]);
add("@addon|Espresso shot","Add-on — Espresso shot",[coffee(10)]);
for (const [id,sku] of Object.entries({
  "hibiscus-tea-with-strawberry":"strawberry-syrup","green-apple":"green-apple-syrup",
  blueberry:"blueberry-syrup",lychee:"lychee-syrup",strawberry:"strawberry-syrup"
})) add("@syrup|"+id,"Extra syrup — "+id,[ml(sku,10)]);
add("@flavor|Sweet Chili","Chicken flavor — Sweet Chili",[ml("sweet-chili",30)]);
add("@flavor|Spicy","Chicken flavor — Spicy",[g("spicy-seasoning",5)]);
add("@flavor|Garlic Parmesan","Chicken flavor — Garlic Parmesan",[g("garlic-parmesan",20)]);
add("@packaging|order","Online / takeout — per order",[pcs("paper-bag",1)]);
add("@packaging|food","Online / takeout — per food item",[pcs("takeout-container",1),pcs("plastic-fork",1)]);
add("@packaging|rice","Online / takeout — per rice meal",[pcs("plastic-spoon",1)]);

module.exports = recipes;
