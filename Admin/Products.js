// The cashier and customer menu use the same catalog as server-side pricing.
const PRODUCTS = KopiCatalog.products.map(product => ({ ...product, image: "../Customer/" + product.image }));
const CATEGORIES = [
  { id: "all", label: "All Items", icon: "bi-grid-3x3-gap-fill" },
  { id: "kopi", label: "Kopi;", icon: "bi-cup-hot-fill" },
  { id: "non-kopi", label: "Non-Kopi;", icon: "bi-cup-fill" },
  { id: "fruit-soda-tea-series", label: "Fruit Soda and Tea Series", icon: "bi-cup-straw" },
  { id: "cream-based", label: "Frappe", icon: "bi-snow2" },
  { id: "coffee-based", label: "Coffee Based", icon: "bi-cup" },
  { id: "rice-meals", label: "Rice Meals", icon: "bi-egg-fried" },
  { id: "chicken-meals", label: "Chicken Meals", icon: "bi-basket2-fill" },
  { id: "snacks", label: "Snacks", icon: "bi-cookie" }
];

function findProductById(id) {
  return PRODUCTS.find(product => product.id === id) || null;
}
