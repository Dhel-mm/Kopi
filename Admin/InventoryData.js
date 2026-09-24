const KopiInventory = (() => {
  const STORAGE_KEY = "kopi_admin_inventory_stock";
  const CUSTOM_ITEMS_KEY = "kopi_admin_inventory_custom_items";
  const catalog = [
    ["coffee-beans","Coffee Beans (1kg)","Coffee & Powders",1000,"g",180], ["matcha-powder","Matcha Powder (500g)","Coffee & Powders",500,"g",80], ["chocolate-powder","Chocolate Powder (1kg)","Coffee & Powders",1000,"g",180],
    ["sugar","Sugar (250g)","Sweeteners & Syrups",250,"g",40], ["liquid-sweetener","Liquid Sweetener (1L)","Sweeteners & Syrups",1000,"ml",160], ["condensed-milk","Condensed Milk (390g Can)","Sweeteners & Syrups",390,"g",65], ["kopi-special-syrup","Kopi; Special Syrup (1L)","Sweeteners & Syrups",1000,"ml",160], ["caramel-syrup","Caramel Syrup (750ml)","Sweeteners & Syrups",750,"ml",120], ["vanilla-syrup","Vanilla Syrup (750ml)","Sweeteners & Syrups",750,"ml",120], ["mocha-syrup","Mocha Syrup / Sauce (1L)","Sweeteners & Syrups",1000,"ml",160],
    ["fresh-milk","Fresh Milk (1L)","Dairy, Creams & Toppings",1000,"ml",160], ["sea-salt-cream","Sea Salt Cream (1L)","Dairy, Creams & Toppings",1000,"ml",160], ["cream-base","Cream Base (1L)","Dairy, Creams & Toppings",1000,"ml",160], ["whipped-cream","Whipped Cream (400g Can)","Dairy, Creams & Toppings",400,"g",60], ["nutella-spread","Nutella Spread (1kg)","Dairy, Creams & Toppings",1000,"g",160],
    ["sprite","Sprite 1.5L","Fruit Bases, Teas & Carbonation",1500,"ml",240], ["green-apple-syrup","Green Apple Syrup (750ml)","Fruit Bases, Teas & Carbonation",750,"ml",120], ["blueberry-syrup","Blueberry Syrup (750ml)","Fruit Bases, Teas & Carbonation",750,"ml",120], ["lychee-syrup","Lychee Syrup (750ml)","Fruit Bases, Teas & Carbonation",750,"ml",120], ["strawberry-syrup","Strawberry Syrup / Sauce (1L)","Fruit Bases, Teas & Carbonation",1000,"ml",160], ["hibiscus-tea","Hibiscus Tea Leaves (500g)","Fruit Bases, Teas & Carbonation",500,"g",80], ["strawberry-boba","Strawberry Popping Boba (1kg)","Fruit Bases, Teas & Carbonation",1000,"g",160],
    ["oreo-cookies","Oreo Cookies (Pack of 120g)","Mix-ins & Garnishes",120,"g",20], ["biscoff-cookies","Biscoff Cookies (Pack of 250g)","Mix-ins & Garnishes",250,"g",40], ["biscoff-crumbs","Biscoff Crumbs (1kg)","Mix-ins & Garnishes",1000,"g",160], ["chocolate-topping","Chocolate Topping / Shavings (500g)","Mix-ins & Garnishes",500,"g",80],
    ["chicken-wings","Chicken Wings (1kg / Approx. 20 pcs)","Proteins & Meal Bases",20,"pcs",4], ["chicken-fingers","Chicken Fingers (1kg)","Proteins & Meal Bases",1000,"g",160], ["pork-liempo","Pork Liempo (1kg)","Proteins & Meal Bases",1000,"g",160], ["beef-tapa","Beef Tapa (1kg)","Proteins & Meal Bases",1000,"g",160], ["ground-beef","Ground Beef (1kg)","Proteins & Meal Bases",1000,"g",160], ["bangus","Bangus / Milkfish (Pack of 5 pcs)","Proteins & Meal Bases",5,"pcs",1], ["hungarian-sausage","Hungarian Sausage (Pack of 1kg)","Proteins & Meal Bases",1000,"g",160],
    ["cooked-rice","Cooked Rice (1kg)","Carbs, Sides & Cheese",1000,"g",160], ["french-fries","French Fries (2kg Bag)","Carbs, Sides & Cheese",2000,"g",320], ["nachos","Nachos (500g Bag)","Carbs, Sides & Cheese",500,"g",80], ["tortilla-wraps","Tortilla Wraps (Pack of 10 pcs)","Carbs, Sides & Cheese",10,"pcs",2], ["cheese-blocks","Cheese Blocks (150g)","Carbs, Sides & Cheese",150,"g",25], ["cheese-sauce","Cheese Sauce (1L)","Carbs, Sides & Cheese",1000,"ml",160],
    ["breading-mix","Breading Mix (1kg)","Breading, Oils & Produce",1000,"g",160], ["cooking-oil","Cooking Oil (1L / 1.5L)","Breading, Oils & Produce",1500,"ml",240], ["fresh-eggs","Fresh Eggs (Tray of 30 pcs)","Breading, Oils & Produce",30,"pcs",5], ["side-vegetables","Side Vegetables (1kg)","Breading, Oils & Produce",1000,"g",160],
    ["sweet-chili","Sweet Chili Sauce (1L)","Chicken Flavor Coatings",1000,"ml",160], ["spicy-seasoning","Spicy Seasoning Powder (500g)","Chicken Flavor Coatings",500,"g",80], ["garlic-parmesan","Garlic Parmesan Sauce / Glaze (1L)","Chicken Flavor Coatings",1000,"ml",160],
    ["tube-ice","Tube Ice (10kg Bag)","Disposables & Service",10000,"g",1600], ["12oz-cups","12oz Cups (Pack of 50)","Disposables & Service",50,"pcs",10], ["16oz-cups","16oz Cups (Pack of 50)","Disposables & Service",50,"pcs",10], ["straws","Straws (Pack of 100)","Disposables & Service",100,"pcs",20], ["paper-bag","Paper Bag (Pack of 50/100)","Packaging & Utensils",50,"pcs",10], ["takeout-container","Takeout Container (Pack of 50)","Packaging & Utensils",50,"pcs",10], ["plastic-spoon","Plastic Spoon (Pack of 100)","Packaging & Utensils",100,"pcs",20], ["plastic-fork","Plastic Fork (Pack of 100)","Packaging & Utensils",100,"pcs",20]
  ].map(([id,name,category,quantity,unit]) => ({ id,name,category,quantity,maxQuantity:quantity,unit }));

  const recipes = {
    "caramel-frappe": { "coffee-beans":18, "caramel-syrup":25, "fresh-milk":120, "cream-base":100, "whipped-cream":15, "tube-ice":180, "16oz-cups":1, "straws":1 }
  };

  function getCustomItems() { try { const saved = JSON.parse(localStorage.getItem(CUSTOM_ITEMS_KEY) || "[]"); return Array.isArray(saved) ? saved : []; } catch { return []; } }
  function getStock() { try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); return [...catalog, ...getCustomItems()].map(item => ({ ...item, quantity: Number.isFinite(saved[item.id]) ? saved[item.id] : item.quantity })); } catch { return [...catalog, ...getCustomItems()].map(item => ({ ...item })); } }
  function saveStock(stock) { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(stock.map(item => [item.id, item.quantity])))); }
  function setQuantity(id, quantity) { const stock = getStock(); const item = stock.find(entry => entry.id === id); if (!item) return; item.quantity = Math.max(0, Number(quantity) || 0); saveStock(stock); }
  function addStock(id, packages) { const stock = getStock(); const item = stock.find(entry => entry.id === id); const count = Math.max(0, Number(packages) || 0); if (!item || !count) return; item.quantity += item.maxQuantity * count; saveStock(stock); }
  function addProduct({ name, category, quantity, unit }) { const amount = Math.max(0, Number(quantity) || 0); const items = getCustomItems(); items.push({ id:`custom-${Date.now()}`, name, category, quantity:amount, maxQuantity:amount, unit, lowAt:amount / 4 }); localStorage.setItem(CUSTOM_ITEMS_KEY, JSON.stringify(items)); }
  function status(item) {
    const needsTwoPackages = ["sugar", "condensed-milk", "sprite"].includes(item.id);
    const lowStockLimit = needsTwoPackages
      ? item.maxQuantity * 2
      : item.maxQuantity * 0.25;

    return item.quantity <= 0
      ? "Out of Stock"
      : item.quantity < lowStockLimit
        ? "Low Stock"
        : "In Stock";
  }
  function deductForOrder(order) { const stock = getStock(); let changed = false; (order.items || []).forEach(item => { const recipe = recipes[item.productId]; if (!recipe) return; Object.entries(recipe).forEach(([ingredientId, amount]) => { const ingredient = stock.find(entry => entry.id === ingredientId); if (ingredient) { ingredient.quantity = Math.max(0, ingredient.quantity - amount * Number(item.quantity || 1)); changed = true; } }); }); if (changed) saveStock(stock); return changed; }
  return { getStock, setQuantity, addStock, addProduct, status, deductForOrder };
})();
