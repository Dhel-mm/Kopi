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
      ...data.categories.filter(category => counts.get(category.id)).map(category => [category.id, category.name, counts.get(category.id)])];
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
        <button type="button" class="menu-toggle ${product.available ? "on" : "off"}" data-toggle="${esc(product.id)}" aria-pressed="${product.available}" title="Click to mark ${product.available ? "unavailable" : "available"}"><i aria-hidden="true"></i>${status}</button>
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
    if (archive && !window.confirm(`Archive ${product.name}? It leaves the menu, but past orders keep it. You can restore it from Archived.`)) return;
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
  $("sizeRows").addEventListener("input", () => syncDefaultSize());
  for (const rows of [$("sizeRows"), $("choiceRows")]) {
    rows.addEventListener("click", event => {
      const remove = event.target.closest("[data-remove]");
      if (!remove) return;
      remove.closest(".menu-row").remove();
      syncDefaultSize();
    });
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

  function openEditor(product) {
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
      const path = editing ? `/admin/menu/products/${encodeURIComponent(editing.id)}` : "/admin/menu/products";
      const {product} = await KopiApi.request(path, {method: editing ? "PUT" : "POST", body: JSON.stringify(payload())});
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

  document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
  load();
})();
