const rowsEl = document.getElementById("inventoryRows");
const searchEl = document.getElementById("inventorySearch");
const categoryEl = document.getElementById("categoryFilter");

let inventory = [];
let query = "";
let stockFilter = "All";

function statusClass(status) {
  return status.toLowerCase().replaceAll(" ", "-");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[character]));
}

function displayMeasurement(item, value = item.quantity) {
  const amount = Number(value);

  if (item.measurement === "g" && amount >= 1000) {
    return `${amount / 1000} kg`;
  }

  if (item.measurement === "ml" && amount >= 1000) {
    return `${amount / 1000} L`;
  }

  return `${amount} ${item.measurement}`;
}

function packageStock(item) {
  // An opened package counts until its final measurable amount is consumed.
  const remaining = Math.max(0, Math.round(Number(item.quantity) * 1000));
  const capacity = Math.round(Number(item.initialQuantity) * 1000);
  const count = capacity > 0 ? Math.ceil(remaining / capacity) : 0;
  const label = item.packageUnit || "package";
  const plural = /s$/i.test(label) ? label : /(ch|sh|x|z)$/i.test(label) ? label+"es" : label+"s";
  const amount = count.toLocaleString(undefined,{maximumFractionDigits:0});
  return `${amount} ${count === 1 ? label : plural}`;
}

const itemCategories = item => item.category.split(",").map(value => value.trim());

function filteredInventory() {
  return inventory.filter(item => {
    const categoryMatches =
      categoryEl.value === "All" || itemCategories(item).includes(categoryEl.value);

    const searchMatches =
      !query ||
      `${item.productName} ${item.category}`
        .toLowerCase()
        .includes(query);

    const stockMatches = stockFilter === "All" || item.status === stockFilter;
    return categoryMatches && searchMatches && stockMatches;
  });
}

function populateCategories() {
  const selected = categoryEl.value;

  categoryEl.innerHTML = `<option value="All">All Categories</option>`;

  [...new Set(inventory.flatMap(itemCategories))]
    .sort()
    .forEach(category => {
      categoryEl.insertAdjacentHTML(
        "beforeend",
        `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
      );
    });

  categoryEl.value = [...categoryEl.options].some(
    option => option.value === selected
  ) ? selected : "All";
}

function render() {
  const visible = filteredInventory();

  const counts = inventory.reduce((total, item) => {
    total[item.status] += 1;
    return total;
  }, {
    "In Stock": 0,
    "Low Stock": 0,
    "Out of Stock": 0
  });

  document.getElementById("totalProducts").textContent = inventory.length;
  document.getElementById("inStock").textContent = counts["In Stock"];
  document.getElementById("lowStock").textContent = counts["Low Stock"];
  document.getElementById("outStock").textContent = counts["Out of Stock"];
  document.querySelectorAll("[data-stock-filter]").forEach(card => {
    card.setAttribute("aria-pressed", String(card.dataset.stockFilter === stockFilter));
  });

  rowsEl.innerHTML = visible.map(item => `
    <tr>
      <td>${escapeHtml(item.productName)}</td>
      <td>${escapeHtml(item.category)}</td>
      <td>${escapeHtml(packageStock(item))}</td>
      <td>${escapeHtml(displayMeasurement(item))}<small class="stock-pack-size">${escapeHtml(displayMeasurement(item,item.initialQuantity))} / ${escapeHtml(item.packageUnit || "package")}</small></td>
      <td>${escapeHtml(displayMeasurement(item, item.reorderLevel ?? 0))}<small class="stock-pack-size">${escapeHtml(reorderNote(item))}</small></td>
      <td>
        <span class="stock-status ${statusClass(item.status)}">
          ${escapeHtml(item.status)}
        </span>
      </td>
      <td>
        <div class="inventory-actions">
          <button class="inv-manage-btn" type="button" data-manage="${item.id}" aria-label="Manage ${escapeHtml(item.productName)}: add stock, correct count, low-stock alert, history">
            <i class="bi bi-sliders2" aria-hidden="true"></i><span>Manage</span>
          </button>
        </div>
      </td>
    </tr>
  `).join("");

  document.getElementById("inventoryEmpty").hidden = visible.length !== 0;
  document.getElementById("inventoryRange").textContent = stockFilter === "All"
    ? `Showing ${visible.length} of ${inventory.length} products`
    : `Showing ${visible.length} ${stockFilter.toLowerCase()} ingredient${visible.length === 1 ? "" : "s"}`;

  rowsEl.querySelectorAll("[data-manage]").forEach(button => {
    button.addEventListener("click", () => openManage(Number(button.dataset.manage)));
  });
}

function reorderNote(item) {
  const basis = { Manual: "Manual level", Usage: "Based on usage", Package: "Package baseline" }[item.reorderBasis] || "";
  const days = item.daysLeft == null ? "no recent usage" : `≈ ${item.daysLeft} day${item.daysLeft === 1 ? "" : "s"} left`;
  return `${basis} · ${days}`;
}

/* ---------- Low-stock parameters ---------- */
let reorderItem = null;

const reorderManualMode = () => document.getElementById("reorderModeManual").checked;
function syncReorderMode() {
  document.getElementById("reorderAutoFields").hidden = reorderManualMode();
  document.getElementById("reorderManualFields").hidden = !reorderManualMode();
}

function reorderPreviewLevel() {
  if (!reorderItem) return 0;
  const manual = reorderManualMode() ? document.getElementById("reorderManual").value.trim() : "";
  if (manual !== "") return Number(manual);
  const lead = Number(document.getElementById("reorderLeadTime").value) || 0;
  const safety = Number(document.getElementById("reorderSafety").value) || 0;
  return Math.max(reorderItem.packageLevel, Math.round(reorderItem.averageDailyUsage * (lead + safety) * 1000) / 1000);
}

function paintReorderPreview() {
  const level = reorderPreviewLevel();
  const status = reorderItem.quantity <= 0 ? "Out of Stock" : reorderItem.quantity <= level ? "Low Stock" : "In Stock";
  document.getElementById("reorderPreview").innerHTML =
    `It will show as <strong>Low Stock</strong> at <strong>${escapeHtml(displayMeasurement(reorderItem, level))}</strong>. With ${escapeHtml(displayMeasurement(reorderItem))} now, it is <strong>${escapeHtml(status)}</strong>.`;
}

function openReorderSettings(id) {
  reorderItem = inventory.find(entry => entry.id === id);
  if (!reorderItem) return;
  document.getElementById("reorderFacts").innerHTML = [
    ["Package baseline", displayMeasurement(reorderItem, reorderItem.packageLevel)],
    ["Average daily usage (14 days)", reorderItem.averageDailyUsage ? `${displayMeasurement(reorderItem, reorderItem.averageDailyUsage)} / day` : "No order usage yet"],
    ["Estimated days left", reorderItem.daysLeft == null ? "—" : `${reorderItem.daysLeft} days`]
  ].map(([term, value]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  document.getElementById("reorderLeadTime").value = reorderItem.leadTimeDays;
  document.getElementById("reorderSafety").value = reorderItem.safetyDays;
  document.getElementById("reorderManual").value = reorderItem.manualReorderLevel ?? "";
  document.getElementById("reorderUnit").textContent = `(${reorderItem.measurement})`;
  document.getElementById(reorderItem.manualReorderLevel == null ? "reorderModeAuto" : "reorderModeManual").checked = true;
  syncReorderMode();
  paintReorderPreview();
}

["reorderModeAuto", "reorderModeManual"].forEach(id => document.getElementById(id).addEventListener("change", () => { syncReorderMode(); paintReorderPreview(); }));
["reorderLeadTime", "reorderSafety", "reorderManual"].forEach(id =>
  document.getElementById(id).addEventListener("input", paintReorderPreview));
document.getElementById("reorderForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!reorderItem) return;
  const button = document.getElementById("saveReorder");
  const manual = reorderManualMode() ? document.getElementById("reorderManual").value.trim() : "";
  if (reorderManualMode() && manual === "") return KopiNotice.set(document.getElementById("reorderPreview"), "Enter the amount, or choose Automatic.", "error");
  button.disabled = true;
  try {
    const result = await KopiApi.request(`/admin/inventory/${reorderItem.id}/reorder-settings`, {
      method: "PATCH",
      body: JSON.stringify({
        leadTimeDays: Number(document.getElementById("reorderLeadTime").value),
        safetyDays: Number(document.getElementById("reorderSafety").value),
        reorderLevel: manual === "" ? null : Number(manual)
      })
    });
    KopiNotice.toast(result.message, "success");
    manageDialog.close();
    refreshInventory();
  } catch (error) {
    KopiNotice.set(document.getElementById("reorderPreview"), error.message, "error");
  } finally {
    button.disabled = false;
  }
});

async function refreshInventory() {
  try {
    const data = await KopiApi.request("/admin/inventory");
    inventory = data.items;
    populateCategories();
    render();
    refreshRecipes();
    if (typeof refreshConversions === "function") refreshConversions();
  } catch (error) {
    rowsEl.innerHTML = "";
    document.getElementById("inventoryEmpty").hidden = false;
    KopiNotice.set(document.getElementById("inventoryEmpty"),error.message,"error");
  }
}

/* ---------- Add stock and set stock (one dialog, two modes) ---------- */
const manageDialog = document.getElementById("manageDialog");
const unitWords = { g: "grams (g)", ml: "milliliters (ml)", pcs: "pieces (pcs)" };
const plural = (word, count) => Number(count) === 1 ? word : `${word}s`;
let stockItem = null, stockMode = "add";
const round3 = value => Math.round(Number(value) * 1000) / 1000;

function stockFacts(item) {
  const pack = item.packageUnit || "package";
  document.getElementById("stockFacts").innerHTML = [
    ["Available now", displayMeasurement(item)],
    [`One ${pack}`, displayMeasurement(item, item.initialQuantity)],
    ["Status", item.status]
  ].map(([term, value]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
}

function paintStockPreview() {
  if (!stockItem) return;
  const preview = document.getElementById("stockPreview");
  if (stockMode === "add") {
    const packages = Number(document.getElementById("addPackages").value);
    if (!Number.isFinite(packages) || packages <= 0) { preview.textContent = "Enter how many arrived."; return; }
    const added = round3(packages * stockItem.initialQuantity);
    preview.innerHTML = `Adding <strong>${escapeHtml(displayMeasurement(stockItem, added))}</strong>. After this you will have <strong>${escapeHtml(displayMeasurement(stockItem, round3(stockItem.quantity + added)))}</strong>.`;
  } else {
    const amount = Number(document.getElementById("setAmount").value);
    if (document.getElementById("setAmount").value === "" || !Number.isFinite(amount) || amount < 0) { preview.textContent = "Enter the amount you counted."; return; }
    const change = round3(amount - stockItem.quantity);
    preview.innerHTML = change === 0 ? "No change from the current stock."
      : `New stock: <strong>${escapeHtml(displayMeasurement(stockItem, amount))}</strong> (${change > 0 ? "+" : "−"}${escapeHtml(displayMeasurement(stockItem, Math.abs(change)))} from now).`;
  }
}

function openStockDialog(id, mode) {
  stockItem = inventory.find(entry => entry.id === id);
  if (!stockItem) return;
  stockMode = mode;
  const pack = stockItem.packageUnit || "package";
  const adding = mode === "add";
  document.getElementById("stockIntro").textContent = adding
    ? `Record a delivery. Enter how many ${plural(pack, 2)} arrived.`
    : "Use this after counting what is on the shelf, for example after spills or a stock check.";
  document.getElementById("addStockFields").hidden = !adding;
  document.getElementById("setStockFields").hidden = adding;
  document.getElementById("addPackagesLabel").textContent = `How many ${plural(pack, 2)} arrived?`;
  document.getElementById("addPackagesUnit").textContent = plural(pack, 2);
  document.getElementById("addPackages").value = 1;
  document.getElementById("setUnit").textContent = unitWords[stockItem.measurement] || stockItem.measurement;
  document.getElementById("setAmount").value = stockItem.quantity;
  document.getElementById("stockSave").textContent = adding ? "Add stock" : "Save count";
  document.getElementById("stockStatus").textContent = "";
  paintStockPreview();
}

/* ---------- One Manage dialog: add stock, correct count, low-stock alert, history ---------- */
let manageItem = null;
function setManageTab(tab) {
  manageDialog.querySelectorAll("[data-tab]").forEach(button => {
    button.setAttribute("aria-selected", String(button.dataset.tab === tab));
    button.tabIndex = button.dataset.tab === tab ? 0 : -1;
  });
  manageDialog.querySelectorAll("[data-panels]").forEach(panel => { panel.hidden = !panel.dataset.panels.split(" ").includes(tab); });
  if (tab === "add" || tab === "set") openStockDialog(manageItem.id, tab);
  if (tab === "alert") openReorderSettings(manageItem.id);
  if (tab === "history") loadMovements(manageItem);
  const focus = {add: "addPackages", set: "setAmount", alert: "reorderLeadTime"}[tab];
  if (focus && manageDialog.open) document.getElementById(focus).focus();
}
function openManage(id, tab = "add") {
  manageItem = inventory.find(entry => entry.id === id);
  if (!manageItem) return;
  document.getElementById("manageTitle").textContent = manageItem.productName;
  stockFacts(manageItem);
  setManageTab(tab);
  manageDialog.showModal();
  if (tab === "add") document.getElementById("addPackages").select();
}
manageDialog.querySelector(".inv-tabs").addEventListener("click", event => {
  const tab = event.target.closest("[data-tab]");
  if (tab && manageItem) setManageTab(tab.dataset.tab);
});
manageDialog.querySelector(".inv-tabs").addEventListener("keydown", event => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const tabs = [...manageDialog.querySelectorAll("[data-tab]")];
  const index = tabs.findIndex(tab => tab.getAttribute("aria-selected") === "true");
  const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
  setManageTab(next.dataset.tab);
  next.focus();
});

async function loadMovements(item) {
  const list = document.getElementById("movementList");
  list.textContent = "Loading…";
  try {
    const data = await KopiApi.request("/admin/inventory/" + item.id + "/movements");
    const when = value => new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z").toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
    list.innerHTML = data.movements.length
      ? '<ul class="stock-movements">' + data.movements.map(row => `<li class="${row.changeAmount > 0 ? "in" : "out"}"><strong>${row.changeAmount > 0 ? "+" : "−"}${escapeHtml(displayMeasurement(item, Math.abs(row.changeAmount)))}</strong><span>${escapeHtml(row.reason)}</span><small>${escapeHtml(row.orderNumber || "Stock adjustment")} · ${escapeHtml(when(row.createdAt))}</small></li>`).join("") + "</ul>"
      : "No stock changes recorded yet.";
  } catch (error) { KopiNotice.set(list, error.message, "error"); }
}

manageDialog.querySelectorAll("[data-step]").forEach(button => button.addEventListener("click", () => {
  const input = document.getElementById("addPackages");
  input.value = Math.max(1, round3((Number(input.value) || 0) + Number(button.dataset.step)));
  paintStockPreview();
}));
manageDialog.querySelectorAll("[data-quick]").forEach(button => button.addEventListener("click", () => {
  document.getElementById("addPackages").value = button.dataset.quick;
  paintStockPreview();
}));
["addPackages", "setAmount"].forEach(id => document.getElementById(id).addEventListener("input", paintStockPreview));

document.getElementById("stockForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!stockItem) return;
  const status = document.getElementById("stockStatus"), button = document.getElementById("stockSave");
  let path, body;
  if (stockMode === "add") {
    const packages = Number(document.getElementById("addPackages").value);
    if (!Number.isFinite(packages) || packages <= 0) return KopiNotice.set(status, "Enter how many arrived (more than 0).", "error");
    path = "add-stock"; body = { amount: round3(packages * stockItem.initialQuantity) };
  } else {
    const raw = document.getElementById("setAmount").value, amount = Number(raw);
    if (raw === "" || !Number.isFinite(amount) || amount < 0) return KopiNotice.set(status, "Enter the amount you counted (0 or more).", "error");
    path = "set-stock"; body = { quantity: amount };
  }
  button.disabled = true;
  try {
    await KopiApi.request(`/admin/inventory/${stockItem.id}/${path}`, { method: "PATCH", body: JSON.stringify(body) });
    KopiNotice.toast(`${stockItem.productName}: stock updated.`, "success");
    manageDialog.close();
    refreshInventory();
  } catch (error) {
    KopiNotice.set(status, error.message, "error");
  } finally {
    button.disabled = false;
  }
});

/* ---------- Add product ---------- */
const productDialog = document.getElementById("productDialog");
const productForm = document.getElementById("productForm");
const newUnit = () => productForm.querySelector('[name="newUnit"]:checked')?.value || "g";

function paintProductPreview() {
  const pack = document.getElementById("newPackage").value.trim() || "package";
  productForm.querySelectorAll("[data-package-name]").forEach(node => { node.textContent = pack; });
  const count = Number(document.getElementById("newStartPackages").value) || 0;
  productForm.querySelector("[data-package-plural]").textContent = plural(pack, count);
  productForm.querySelector("[data-unit-name]").textContent = newUnit();
  const size = Number(document.getElementById("newPackSize").value);
  const preview = document.getElementById("productPreview");
  if (!Number.isFinite(size) || size <= 0) { preview.textContent = `Enter how much is in one ${pack}.`; return; }
  const total = round3(count * size);
  preview.innerHTML = `Starting stock: <strong>${escapeHtml(String(count))} ${escapeHtml(plural(pack, count))}</strong> = <strong>${escapeHtml(total.toLocaleString("en-PH"))} ${escapeHtml(newUnit())}</strong>.`;
}

function addProduct() {
  productForm.reset();
  const select = document.getElementById("newCategory");
  const categories = [...new Set(inventory.map(item => item.category).filter(Boolean))].sort();
  select.replaceChildren(...categories.map(name => new Option(name, name)), new Option("+ New category…", "__new"));
  if (!categories.length) select.value = "__new";
  document.getElementById("newCategoryNameField").hidden = select.value !== "__new";
  document.getElementById("productStatus").textContent = "";
  paintProductPreview();
  productDialog.showModal();
  document.getElementById("newName").focus();
}

document.getElementById("newCategory").addEventListener("change", event => {
  document.getElementById("newCategoryNameField").hidden = event.target.value !== "__new";
  if (event.target.value === "__new") document.getElementById("newCategoryName").focus();
});
productForm.querySelectorAll("[data-new-step]").forEach(button => button.addEventListener("click", () => {
  const input = document.getElementById("newStartPackages");
  input.value = Math.max(0, round3((Number(input.value) || 0) + Number(button.dataset.newStep)));
  paintProductPreview();
}));
productForm.addEventListener("input", paintProductPreview);
productForm.addEventListener("change", paintProductPreview);

productForm.addEventListener("submit", async event => {
  event.preventDefault();
  const status = document.getElementById("productStatus"), button = document.getElementById("productSave");
  const productName = document.getElementById("newName").value.trim();
  const select = document.getElementById("newCategory");
  const category = (select.value === "__new" ? document.getElementById("newCategoryName").value : select.value).trim();
  const packageUnit = document.getElementById("newPackage").value.trim().toLowerCase() || "package";
  const size = Number(document.getElementById("newPackSize").value);
  const count = Number(document.getElementById("newStartPackages").value || 0);
  if (!productName) return KopiNotice.set(status, "Enter the product name.", "error");
  if (!category) return KopiNotice.set(status, "Choose or enter a category.", "error");
  if (!Number.isFinite(size) || size <= 0) return KopiNotice.set(status, `Enter how much is in one ${packageUnit}.`, "error");
  if (!Number.isFinite(count) || count < 0) return KopiNotice.set(status, "Enter how many you have now (0 or more).", "error");
  const sku = productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  if (!sku) return KopiNotice.set(status, "Use letters or numbers in the product name.", "error");
  const quantity = round3(count * size);
  button.disabled = true;
  try {
    await KopiApi.request("/admin/inventory", {
      method: "POST",
      body: JSON.stringify({ sku, productName, category, quantity, initialQuantity: size, measurement: newUnit(),
        packageUnit, lowStockLevel: quantity * 0.25 })
    });
    KopiNotice.toast(`${productName} was added to inventory.`, "success");
    productDialog.close();
    refreshInventory();
  } catch (error) {
    KopiNotice.set(status, error.message, "error");
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));

searchEl.addEventListener("input", () => {
  query = searchEl.value.trim().toLowerCase();
  render();
});

categoryEl.addEventListener("change", render);

document.querySelectorAll("[data-stock-filter]").forEach(card => {
  card.addEventListener("click", () => {
    const nextFilter = card.dataset.stockFilter;
    stockFilter = nextFilter === stockFilter ? "All" : nextFilter;
    render();
  });
});

document.getElementById("addProduct").addEventListener("click", addProduct);

window.addEventListener("focus", refreshInventory);

refreshInventory();

let recipes = [];
const recipeDialog = document.getElementById("recipeDialog");
const recipeSelect = document.getElementById("recipeSelect");
async function refreshRecipes() {
  try {
    const data = await KopiApi.request("/admin/inventory/recipes");
    recipes = data.recipes;
    const unresolved = recipes.filter(recipe => recipe.issues.length);
    document.getElementById("recipeSummary").textContent = unresolved.length
      ? `${unresolved.length} recipe/modifier definitions need setup. Affected selections cannot be ordered until resolved.`
      : "All recipes and modifiers have matching inventory units.";
    const selected = recipeSelect.value;
    recipeSelect.innerHTML = recipes.map(recipe => `<option value="${escapeHtml(recipe.id)}">${recipe.issues.length ? "⚠ " : ""}${escapeHtml(recipe.label)}</option>`).join("");
    if (recipes.some(recipe=>recipe.id===selected)) recipeSelect.value=selected;
  } catch(error) {
    KopiNotice.set(document.getElementById("recipeSummary"),error.message,"error");
  }
}
function addRecipeRow(term = {}) {
  const row=document.createElement("div");
  row.className="recipe-line";
  const item=inventory.find(item=>item.sku===term.sku);
  row.innerHTML=`
    <label>Ingredient<span class="recipe-select"><select data-sku required>
      <option value="">Choose inventory product</option>
      ${term.sku&&!item?`<option value="${escapeHtml(term.sku)}" selected>Missing: ${escapeHtml(term.sku)}</option>`:""}
      ${inventory.map(entry=>`<option value="${escapeHtml(entry.sku)}" ${entry.sku===term.sku?"selected":""}>${escapeHtml(entry.productName)} (${escapeHtml(entry.measurement)})</option>`).join("")}
    </select><i class="bi bi-chevron-down" aria-hidden="true"></i></span></label>
    <label>Amount<input data-amount type="number" min="0.001" step="0.001" required value="${Number(term.amount)||""}"></label>
    <label>Unit<span class="recipe-select"><select data-unit><option>g</option><option>ml</option><option>pcs</option></select><i class="bi bi-chevron-down" aria-hidden="true"></i></span></label>
    <button type="button" data-remove aria-label="Remove ingredient">×</button>`;
  row.querySelector("[data-unit]").value=term.unit||item?.measurement||"g";
  row.querySelector("[data-sku]").addEventListener("change",()=>{
    const stock=inventory.find(entry=>entry.sku===row.querySelector("[data-sku]").value);
    if(stock) row.querySelector("[data-unit]").value=stock.measurement;
  });
  row.querySelector("[data-remove]").addEventListener("click",()=>row.remove());
  document.getElementById("recipeLines").appendChild(row);
}
function renderRecipe() {
  const recipe=recipes.find(recipe=>recipe.id===recipeSelect.value);
  document.getElementById("recipeLines").replaceChildren();
  document.getElementById("recipeIssues").textContent=recipe?.issues.join(" ")||"Units match. Review the quantities before saving.";
  recipe?.terms.forEach(addRecipeRow);
}
document.getElementById("openRecipes").addEventListener("click",()=>{renderRecipe();recipeDialog.showModal();});
document.getElementById("closeRecipes").addEventListener("click",()=>recipeDialog.close());
document.getElementById("addRecipeLine").addEventListener("click",()=>addRecipeRow());
recipeSelect.addEventListener("change",renderRecipe);
document.getElementById("recipeForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const terms=Array.from(document.querySelectorAll(".recipe-line"),row=>({
    sku:row.querySelector("[data-sku]").value,
    amount:Number(row.querySelector("[data-amount]").value),
    unit:row.querySelector("[data-unit]").value
  }));
  const button=document.getElementById("saveRecipe");
  button.disabled=true;
  try {
    await KopiApi.request("/admin/inventory/recipes/"+encodeURIComponent(recipeSelect.value),{method:"PUT",body:JSON.stringify({terms})});
    await refreshRecipes();
    renderRecipe();
    document.getElementById("recipeIssues").textContent="Recipe saved.";
  } catch(error) { KopiNotice.set(document.getElementById("recipeIssues"),error.message,"error"); }
  finally { button.disabled=false; }
});
