// Menu Management: add, edit, hide and archive menu items. The server checks
// every change; the customer menu and cashier show the result right away.
(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"}[c]));
  const peso = value => `₱${Number(value).toLocaleString("en-PH", {maximumFractionDigits: 2})}`;
  const imageUrl = image => image ? `../Customer/${image}` : "";
  const grid = $("menuGrid");
  const dialog = $("itemDialog");
  const form = $("itemForm");
  let data = {categories: [], products: [], archived: []};
  let filter = "all";
  let editing = null;
  let photoData = "";
  // Ingredients in Inventory, and the current recipes, for the item editor.
  let stock = null;

  async function loadStock() {
    if (stock) return stock;
    const [inventory, recipes] = await Promise.all([KopiApi.request("/admin/inventory"), KopiApi.request("/admin/inventory/recipes")]);
    stock = {items: inventory.items, recipes: new Map(recipes.recipes.map(recipe => [recipe.id, recipe]))};
    return stock;
  }

  async function load() {
    try {
      data = await KopiApi.request("/admin/menu");
      render();
    } catch (error) {
      $("menuTotal").textContent = "Could not load the menu. " + error.message;
    }
  }

  function categoryName(id) {
    return data.categories.find(category => category.id === id)?.name || "Uncategorized";
  }

  function render() {
    const counts = new Map();
    data.products.forEach(product => counts.set(product.category, (counts.get(product.category) || 0) + 1));
    const chips = [["all", "All Items", data.products.length],
      ...data.categories.map(category => [category.id, category.name, counts.get(category.id) || 0])];
    if (!chips.some(([id]) => id === filter)) filter = "all";
    $("menuFilters").innerHTML = chips.map(([id, name, count]) =>
      `<button type="button" class="menu-chip${id === filter ? " active" : ""}" data-filter="${esc(id)}" aria-pressed="${id === filter}">${esc(name)} <span class="menu-count">${count}</span></button>`).join("");
    $("archivedCount").textContent = data.archived.length;
    const search = $("menuSearch").value.trim().toLowerCase();
    const shown = data.products.filter(product => (filter === "all" || product.category === filter) &&
      (!search || `${product.name} ${product.description} ${categoryName(product.category)}`.toLowerCase().includes(search)));
    $("menuTotal").textContent = `${shown.length} item${shown.length === 1 ? "" : "s"}`;
    // Grouped under category headings, like the customer menu.
    const sections = data.categories.map(category => [category, shown.filter(product => product.category === category.id)])
      .filter(([, products]) => products.length);
    grid.innerHTML = sections.length ? sections.map(([category, products]) => `<section class="menu-group">
        <h2>${esc(category.name)}</h2>
        <div class="menu-group-cards">${products.map(card).join("")}</div>
      </section>`).join("")
      : `<p class="menu-empty">${search ? "No menu items match your search." : "No items in this category yet."}</p>`;
  }

  // Same size chips as the customer menu: "HOT - 12oz" shows as Hot 12oz with a cup icon.
  function sizeChip(size, price) {
    const [temperature, name] = size.includes(" - ") ? size.split(" - ").map(part => part.trim()) : [null, size.trim()];
    const label = temperature ? `${temperature.charAt(0)}${temperature.slice(1).toLowerCase()} ${name}` : name;
    const icon = temperature === "HOT" ? "bi-cup-hot-fill" : temperature === "ICED" ? "bi-snow" : "";
    const tone = temperature ? ` ${temperature.toLowerCase()}` : "";
    return `<span class="size-chip${tone}">${icon ? `<i class="bi ${icon}" aria-hidden="true"></i>` : ""}${size === "Regular" ? "" : `<span>${esc(label)}</span>`}<strong>${peso(price)}</strong></span>`;
  }

  function card(product) {
    const status = product.available ? "Available" : "Unavailable";
    return `<article class="menu-card${product.available ? "" : " is-unavailable"}">
      <div class="menu-card-photo">
        <img src="${esc(imageUrl(product.image))}" alt="" loading="lazy">
        <span class="menu-status ${product.available ? "on" : "off"}"><i aria-hidden="true"></i>${status}</span>
      </div>
      <div class="menu-card-body">
        <h3>${esc(product.name)}</h3>
        <span class="size-chips">${Object.entries(product.prices).map(([size, price]) => sizeChip(size, price)).join("")}</span>
      </div>
      <div class="menu-card-actions">
        <button type="button" class="menu-toggle ${product.available ? "on" : "off"}" data-toggle="${esc(product.id)}" role="switch" aria-checked="${product.available}" aria-label="${esc(product.name)} available to order" title="Click to mark ${product.available ? "unavailable" : "available"}"><span class="menu-toggle-track" aria-hidden="true"></span><span class="menu-toggle-text"><strong>${status}</strong><small>Tap to ${product.available ? "hide" : "sell"}</small></span></button>
        <button type="button" class="menu-ghost-btn" data-edit="${esc(product.id)}">Edit</button>
        <button type="button" class="menu-icon-btn" data-archive="${esc(product.id)}" aria-label="Archive ${esc(product.name)}" title="Archive"><i class="bi bi-archive" aria-hidden="true"></i></button>
      </div>
    </article>`;
  }

  $("menuFilters").addEventListener("click", event => {
    const chip = event.target.closest("[data-filter]");
    if (!chip) return;
    filter = chip.dataset.filter;
    render();
  });
  $("menuSearch").addEventListener("input", render);

  grid.addEventListener("click", async event => {
    const toggle = event.target.closest("[data-toggle]");
    const edit = event.target.closest("[data-edit]");
    const archive = event.target.closest("[data-archive]");
    if (edit) return openEditor(data.products.find(product => product.id === edit.dataset.edit));
    const button = toggle || archive;
    if (!button) return;
    const product = data.products.find(entry => entry.id === (toggle?.dataset.toggle || archive?.dataset.archive));
    if (!product) return;
    if (archive && !await KopiNotice.confirm(`${product.name} leaves the menu, but past orders keep it. You can restore it from Archived.`, {title: `Archive ${product.name}?`, confirmText: "Archive"})) return;
    button.disabled = true;
    try {
      if (toggle) {
        await KopiApi.request(`/admin/menu/products/${encodeURIComponent(product.id)}/availability`, {method: "PATCH", body: JSON.stringify({available: !product.available})});
        KopiNotice.toast(`${product.name} is now ${product.available ? "unavailable" : "available"}.`, "success");
      } else {
        await KopiApi.request(`/admin/menu/products/${encodeURIComponent(product.id)}/archive`, {method: "PATCH", body: JSON.stringify({archived: true})});
        KopiNotice.toast(`${product.name} was archived.`, "success");
      }
      await load();
    } catch (error) {
      button.disabled = false;
      KopiNotice.toast(error.message, "error");
    }
  });

  // ---------- Item editor ----------
  function addSizeRow(name = "", price = "") {
    const row = $("sizeRowTemplate").content.firstElementChild.cloneNode(true);
    row.querySelector("[data-size-name]").value = name;
    row.querySelector("[data-size-price]").value = price;
    $("sizeRows").append(row);
    syncDefaultSize();
  }
  function addChoiceRow(label = "", values = [], defaultValue = "") {
    const row = $("choiceRowTemplate").content.firstElementChild.cloneNode(true);
    row.querySelector("[data-choice-label]").value = label;
    row.querySelector("[data-choice-values]").value = values.join(", ");
    row.querySelector("[data-choice-default]").value = defaultValue || "";
    $("choiceRows").append(row);
  }
  function sizeNames() {
    return [...$("sizeRows").querySelectorAll("[data-size-name]")].map(input => input.value.trim()).filter(Boolean);
  }
  function syncDefaultSize(selected) {
    const select = $("defaultSize");
    const keep = selected ?? select.value;
    select.replaceChildren(new Option("Customer chooses", ""), ...sizeNames().map(name => new Option(name, name)));
    select.value = sizeNames().includes(keep) ? keep : "";
  }
  $("addSize").addEventListener("click", () => addSizeRow());
  $("addChoice").addEventListener("click", () => addChoiceRow());
  $("sizeRows").addEventListener("input", () => { syncDefaultSize(); syncIngredientSizes(); });
  for (const rows of [$("sizeRows"), $("choiceRows")]) {
    rows.addEventListener("click", event => {
      const remove = event.target.closest("[data-remove]");
      if (!remove) return;
      remove.closest(".menu-row").remove();
      syncDefaultSize();
      syncIngredientSizes();
    });
  }

  // ---------- Ingredients, entered while adding the item ----------
  const NEW_INGREDIENT = "__new";
  // A row is one ingredient, with one amount box for each size of the item.
  function addIngredientRow(row = {}) {
    const node = document.createElement("div");
    node.className = "menu-ingredient";
    node.innerHTML = `<div class="menu-ingredient-top">
        <label class="menu-field">Ingredient<span class="menu-select"><select data-ingredient></select><i class="bi bi-chevron-down" aria-hidden="true"></i></span></label>
        <button class="menu-remove-btn" type="button" data-remove-ingredient aria-label="Remove ingredient"><i class="bi bi-trash3" aria-hidden="true"></i></button>
      </div>
      <div class="menu-fields menu-ingredient-new" data-new-fields hidden>
        <label class="menu-field">New ingredient name<input data-new-name maxlength="100" placeholder="e.g. Ube Syrup"></label>
        <label class="menu-field">Category<input data-new-category maxlength="100" list="ingredientCategories" placeholder="e.g. Syrups"></label>
        <label class="menu-field">Measured in<span class="menu-select"><select data-new-unit><option value="g">Grams (g)</option><option value="ml">Milliliters (ml)</option><option value="pcs">Pieces (pcs)</option></select><i class="bi bi-chevron-down" aria-hidden="true"></i></span></label>
        <label class="menu-field">Stock on hand<input data-new-quantity type="number" min="0" step="0.001" inputmode="decimal" placeholder="0"></label>
        <label class="menu-field menu-field-wide">Amount in one full package<input data-new-package type="number" min="0.001" step="0.001" inputmode="decimal" placeholder="e.g. 1000"></label>
      </div>
      <div class="menu-ingredient-amounts" data-amounts></div>`;
    const select = node.querySelector("[data-ingredient]");
    const options = stock.items.map(item => new Option(`${item.productName} (${item.measurement})`, `${item.sku}|${item.measurement}`));
    // A recipe may use a different unit than the stock, through a saved conversion.
    const key = row.sku ? `${row.sku}|${row.unit}` : "";
    if (key && !options.some(option => option.value === key)) {
      const item = stock.items.find(entry => entry.sku === row.sku);
      options.push(new Option(`${item?.productName || row.sku} (${row.unit})`, key));
    }
    select.replaceChildren(new Option("Choose an ingredient…", ""), new Option("+ New ingredient…", NEW_INGREDIENT), ...options);
    select.value = key;
    node.dataset.values = JSON.stringify(row.values || []);
    $("ingredientRows").append(node);
    syncIngredientRow(node);
    return node;
  }
  function ingredientUnit(node) {
    const value = node.querySelector("[data-ingredient]").value;
    if (value === NEW_INGREDIENT) return node.querySelector("[data-new-unit]").value;
    return value ? value.split("|")[1] : "";
  }
  // Keeps typed amounts in place when sizes are added, renamed or removed.
  function syncIngredientRow(node) {
    const box = node.querySelector("[data-amounts]");
    const typed = box.children.length ? [...box.querySelectorAll("input")].map(input => input.value) : JSON.parse(node.dataset.values || "[]");
    const unit = ingredientUnit(node);
    node.querySelector("[data-new-fields]").hidden = node.querySelector("[data-ingredient]").value !== NEW_INGREDIENT;
    box.replaceChildren(...sizeNames().map((name, index) => {
      const label = document.createElement("label");
      label.className = "menu-field";
      label.textContent = `${name}${unit ? ` (${unit})` : ""}`;
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0.001";
      input.step = "0.001";
      input.inputMode = "decimal";
      input.dataset.size = name;
      input.value = typed[index] ?? "";
      label.append(input);
      return label;
    }));
  }
  function syncIngredientSizes() {
    $("ingredientRows").querySelectorAll(".menu-ingredient").forEach(syncIngredientRow);
  }
  $("addIngredient").addEventListener("click", () => addIngredientRow().querySelector("select").focus());
  $("ingredientRows").addEventListener("change", event => {
    if (event.target.matches("[data-ingredient],[data-new-unit]")) syncIngredientRow(event.target.closest(".menu-ingredient"));
  });
  $("ingredientRows").addEventListener("click", event => {
    event.target.closest("[data-remove-ingredient]")?.closest(".menu-ingredient").remove();
  });
  // Rows of an existing item: one per ingredient, with its amount for each size.
  function fillIngredients(product) {
    $("ingredientRows").replaceChildren();
    const categories = [...new Set(stock.items.map(item => item.category))].sort();
    $("ingredientCategories").replaceChildren(...categories.map(name => new Option(name, name)));
    if (!product) return void addIngredientRow();
    const sizes = Object.keys(product.prices);
    const rows = new Map();
    sizes.forEach((size, index) => {
      for (const term of stock.recipes.get(`${product.id}|${size}`)?.terms || []) {
        const key = `${term.sku}|${term.unit}`;
        if (!rows.has(key)) rows.set(key, {sku: term.sku, unit: term.unit, values: []});
        rows.get(key).values[index] = term.amount;
      }
    });
    rows.forEach(addIngredientRow);
    if (!rows.size) addIngredientRow();
  }
  // Blank rows are ignored. Returns null when nothing was entered.
  function ingredientPayload() {
    const rows = [];
    for (const node of $("ingredientRows").querySelectorAll(".menu-ingredient")) {
      const choice = node.querySelector("[data-ingredient]").value;
      const amounts = {};
      node.querySelectorAll("[data-amounts] input").forEach(input => { if (input.value !== "") amounts[input.dataset.size] = Number(input.value); });
      const empty = !Object.keys(amounts).length;
      if (!choice) {
        if (empty) continue;
        throw new Error("Choose the ingredient for each row that has an amount.");
      }
      if (empty) throw new Error("Enter how much of each ingredient the item uses, or remove the row.");
      if (choice === NEW_INGREDIENT) {
        const field = name => node.querySelector(`[data-new-${name}]`).value;
        if (!field("name").trim() || !field("category").trim()) throw new Error("Enter the new ingredient's name and category.");
        if (!(Number(field("package")) > 0)) throw new Error("Enter the amount in one full package of the new ingredient.");
        rows.push({amounts, newIngredient: {name: field("name"), category: field("category"), measurement: field("unit"),
          quantity: Number(field("quantity")) || 0, packageQuantity: Number(field("package"))}});
      } else {
        const [sku, unit] = choice.split("|");
        rows.push({sku, unit, amounts});
      }
    }
    return rows.length ? rows : null;
  }
  $("addOnsOn").addEventListener("change", () => { $("addOnFields").hidden = !$("addOnsOn").checked; });
  $("itemCategory").addEventListener("change", () => {
    const isNew = $("itemCategory").value === "__new";
    $("newCategoryField").hidden = !isNew;
    if (isNew) $("newCategory").focus();
  });

  function showPhoto(src) {
    $("photoPreview").hidden = !src;
    $("photoPreview").src = src || "";
    $("photoEmpty").hidden = Boolean(src);
    $("photoLabel").textContent = src ? "Change photo" : "Upload photo";
  }
  // Resize large photos in the browser so uploads stay small.
  $("photoInput").addEventListener("change", async () => {
    const file = $("photoInput").files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return KopiNotice.toast("Choose a PNG, JPEG or WebP photo.", "error");
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      photoData = canvas.toDataURL("image/webp", 0.85);
      if (!photoData.startsWith("data:image/webp")) photoData = canvas.toDataURL("image/jpeg", 0.85);
      showPhoto(photoData);
    } catch {
      KopiNotice.toast("That photo could not be read. Try another file.", "error");
    }
  });

  async function openEditor(product) {
    try {
      await loadStock();
    } catch (error) {
      KopiNotice.toast("Could not load the ingredients. " + error.message, "error");
      return;
    }
    editing = product || null;
    photoData = "";
    form.reset();
    $("itemStatus").textContent = "";
    $("itemDialogTitle").textContent = product ? `Edit ${product.name}` : "Add New Item";
    $("itemCategory").replaceChildren(...data.categories.map(category => new Option(category.name, category.id)), new Option("+ New category…", "__new"));
    $("newCategoryField").hidden = true;
    $("sizeRows").replaceChildren();
    $("choiceRows").replaceChildren();
    const options = product?.options || [];
    const priceOption = options.find(option => option.priceKey);
    const addOns = options.find(option => option.addOnPrice);
    $("itemName").value = product?.name || "";
    $("itemCategory").value = product?.category || (filter !== "all" ? filter : data.categories[0]?.id || "__new");
    $("newCategoryField").hidden = $("itemCategory").value !== "__new";
    $("itemType").value = product?.type || "drink";
    $("itemDescription").value = product?.description || "";
    $("itemAvailable").checked = product ? product.available : true;
    $("sizeLabel").value = priceOption?.label || "Size";
    if (product) Object.entries(product.prices).forEach(([name, price]) => addSizeRow(name, price));
    else addSizeRow("Regular", "");
    syncDefaultSize(priceOption?.defaultValue || "");
    options.filter(option => !option.priceKey && !option.addOnPrice).forEach(option => addChoiceRow(option.label, option.values, option.defaultValue));
    $("addOnsOn").checked = Boolean(addOns);
    $("addOnFields").hidden = !addOns;
    $("addOnPrice").value = addOns?.addOnPrice || 30;
    $("addOnValues").value = addOns?.values.join(", ") || "";
    showPhoto(product ? imageUrl(product.image) : "");
    fillIngredients(product);
    dialog.showModal();
    $("itemName").focus();
  }
  $("addItem").addEventListener("click", () => openEditor(null));

  const list = value => value.split(",").map(part => part.trim()).filter(Boolean);
  function payload() {
    return {
      name: $("itemName").value,
      category: $("itemCategory").value === "__new" ? "" : $("itemCategory").value,
      newCategory: $("itemCategory").value === "__new" ? $("newCategory").value : "",
      type: $("itemType").value,
      description: $("itemDescription").value,
      available: $("itemAvailable").checked,
      sizeLabel: $("sizeLabel").value.trim() || "Size",
      defaultSize: $("defaultSize").value,
      sizes: [...$("sizeRows").querySelectorAll(".menu-row")].map(row => ({
        name: row.querySelector("[data-size-name]").value, price: Number(row.querySelector("[data-size-price]").value)
      })),
      choices: [...$("choiceRows").querySelectorAll(".menu-row")].map(row => ({
        label: row.querySelector("[data-choice-label]").value,
        values: list(row.querySelector("[data-choice-values]").value),
        defaultValue: row.querySelector("[data-choice-default]").value.trim()
      })),
      addOns: $("addOnsOn").checked ? {price: Number($("addOnPrice").value), values: list($("addOnValues").value)} : null,
      imageData: photoData
    };
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const save = $("saveItem");
    save.disabled = true;
    KopiNotice.set($("itemStatus"), "Saving…", "loading");
    try {
      const ingredients = ingredientPayload();
      // A new item must say what it is made of. An older item can be saved without it.
      if (!ingredients && !editing) throw new Error("Add the ingredients of this item.");
      const path = editing ? `/admin/menu/products/${encodeURIComponent(editing.id)}` : "/admin/menu/products";
      const {product} = await KopiApi.request(path, {method: editing ? "PUT" : "POST", body: JSON.stringify({...payload(), ...(ingredients ? {ingredients} : {})})});
      stock = null;
      dialog.close();
      KopiNotice.toast(`${product.name} was saved.`, "success");
      await load();
    } catch (error) {
      KopiNotice.set($("itemStatus"), error.message, "error");
    } finally {
      save.disabled = false;
    }
  });

  // ---------- Archived items ----------
  const archivedDialog = $("archivedDialog");
  function renderArchived() {
    $("archivedList").innerHTML = data.archived.length ? data.archived.map(product => `<li>
        <img src="${esc(imageUrl(product.image))}" alt="">
        <div><strong>${esc(product.name)}</strong><small>${esc(categoryName(product.category))}</small></div>
        <button type="button" class="menu-ghost-btn" data-restore="${esc(product.id)}"><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>Restore</button>
      </li>`).join("") : `<li class="menu-empty">No archived items.</li>`;
  }
  $("openArchived").addEventListener("click", () => { renderArchived(); archivedDialog.showModal(); });
  $("archivedList").addEventListener("click", async event => {
    const button = event.target.closest("[data-restore]");
    if (!button) return;
    button.disabled = true;
    try {
      await KopiApi.request(`/admin/menu/products/${encodeURIComponent(button.dataset.restore)}/archive`, {method: "PATCH", body: JSON.stringify({archived: false})});
      await load();
      renderArchived();
      KopiNotice.toast("Item restored to the menu.", "success");
    } catch (error) {
      button.disabled = false;
      KopiNotice.toast(error.message, "error");
    }
  });

  // ---------- Add category ----------
  const categoryDialog = $("categoryDialog");
  $("addCategory").addEventListener("click", () => {
    $("categoryForm").reset();
    $("categoryStatus").textContent = "";
    categoryDialog.showModal();
    $("categoryName").focus();
  });
  $("categoryForm").addEventListener("submit", async event => {
    event.preventDefault();
    const name = $("categoryName").value.trim();
    if (!name) return KopiNotice.set($("categoryStatus"), "Enter a category name.", "error");
    const button = $("saveCategory");
    button.disabled = true;
    try {
      const {category} = await KopiApi.request("/admin/menu/categories", {method: "POST", body: JSON.stringify({name})});
      categoryDialog.close();
      KopiNotice.toast(`${category.name} was added. Add items to it with Add New Item.`, "success");
      filter = category.id;
      await load();
    } catch (error) {
      KopiNotice.set($("categoryStatus"), error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
  load();
})();
