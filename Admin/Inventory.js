const rowsEl = document.getElementById("inventoryRows");
const searchEl = document.getElementById("inventorySearch");
const categoryEl = document.getElementById("categoryFilter");

let inventory = [];
let query = "";

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

function displayMeasurement(item) {
  const amount = Number(item.initialQuantity);

  if (item.measurement === "g" && amount >= 1000) {
    return `${amount / 1000} kg`;
  }

  if (item.measurement === "ml" && amount >= 1000) {
    return `${amount / 1000} L`;
  }

  return `${amount} ${item.measurement}`;
}

function packageStock(item) {
  const packageCount = item.initialQuantity
    ? Math.round(Number(item.quantity) / Number(item.initialQuantity) * 1000) / 1000
    : 0;

  return `${Number(item.quantity).toLocaleString()} ${item.measurement} available (${packageCount} package equivalent${packageCount === 1 ? "" : "s"})`;
}

function filteredInventory() {
  return inventory.filter(item => {
    const categoryMatches =
      categoryEl.value === "All" || item.category === categoryEl.value;

    const searchMatches =
      !query ||
      `${item.productName} ${item.category}`
        .toLowerCase()
        .includes(query);

    return categoryMatches && searchMatches;
  });
}

function populateCategories() {
  const selected = categoryEl.value;

  categoryEl.innerHTML = `<option value="All">All Categories</option>`;

  [...new Set(inventory.map(item => item.category))]
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

  rowsEl.innerHTML = visible.map(item => `
    <tr>
      <td>${escapeHtml(item.productName)}</td>
      <td>${escapeHtml(item.category)}</td>
      <td>${packageStock(item)}</td>
      <td>${displayMeasurement(item)} / package</td>
      <td>
        <span class="stock-status ${statusClass(item.status)}">
          ${escapeHtml(item.status)}
        </span>
      </td>
      <td>
        <div class="inventory-actions">
          <button
            class="add-item-stock"
            type="button"
            data-add="${item.id}"
            aria-label="Add stock">
            <i class="bi bi-plus-lg"></i>
          </button>

          <button
            class="set-stock"
            type="button"
            data-edit="${item.id}"
            aria-label="Set stock">
            <i class="bi bi-pencil-fill"></i>
          </button>
          <button type="button" data-movements="${item.id}" aria-label="View stock movements for ${escapeHtml(item.productName)}" title="Stock movement history"><i class="bi bi-clock-history"></i></button>
        </div>
      </td>
    </tr>
  `).join("");

  document.getElementById("inventoryEmpty").hidden = visible.length !== 0;
  document.getElementById("inventoryRange").textContent =
    `Showing ${visible.length} of ${inventory.length} products`;

  rowsEl.querySelectorAll("[data-add]").forEach(button => {
    button.addEventListener("click", () => {
      addStock(Number(button.dataset.add));
    });
  });

  rowsEl.querySelectorAll("[data-edit]").forEach(button => {
    button.addEventListener("click", () => {
      setStock(Number(button.dataset.edit));
    });
  });
}

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
    document.getElementById("inventoryEmpty").textContent = error.message;
  }
}

async function addStock(id) {
  const item = inventory.find(entry => entry.id === id);
  if (!item) return;

  const value = window.prompt(
    `Add stock for ${item.productName} in ${item.measurement}. One package = ${item.initialQuantity} ${item.measurement}:`,
    item.initialQuantity
  );

  if (value === null || !Number.isFinite(Number(value)) || Number(value) <= 0) {
    return;
  }

  try {
    await KopiApi.request(`/admin/inventory/${id}/add-stock`, {
      method: "PATCH",
      body: JSON.stringify({
        amount: Number(value)
      })
    });

    refreshInventory();
  } catch (error) {
    alert(error.message);
  }
}

async function setStock(id) {
  const item = inventory.find(entry => entry.id === id);
  if (!item) return;

  const value = window.prompt(
    `Set AVAILABLE stock for ${item.productName} (${item.measurement}). Exclude ingredients already reserved for open orders:`,
    item.quantity
  );

  if (value === null || !value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0) {
    return;
  }

  try {
    await KopiApi.request(`/admin/inventory/${id}/set-stock`, {
      method: "PATCH",
      body: JSON.stringify({
        quantity: Number(value)
      })
    });

    refreshInventory();
  } catch (error) {
    alert(error.message);
  }
}

async function addProduct() {
  const productName = window.prompt("Product name:");
  if (!productName?.trim()) return;

  const sku = productName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const category = window.prompt("Category:", "Other") || "Other";
  const quantity = window.prompt("Starting stock quantity:", "0");
  const measurement = window.prompt("Measurement (g, ml, pcs):", "pcs") || "pcs";
  const initialQuantity = window.prompt("Amount in ONE full package, in the same unit (for example 1000 ml in a carton):", quantity || "1");

  if (quantity === null || initialQuantity === null || !Number.isFinite(Number(quantity))) return;

  try {
    await KopiApi.request("/admin/inventory", {
      method: "POST",
      body: JSON.stringify({
        sku,
        productName: productName.trim(),
        category: category.trim(),
        quantity: Number(quantity),
        initialQuantity: Number(initialQuantity),
        measurement: measurement.trim(),
        lowStockLevel: Number(quantity) * 0.25
      })
    });

    refreshInventory();
  } catch (error) {
    alert(error.message);
  }
}

searchEl.addEventListener("input", () => {
  query = searchEl.value.trim().toLowerCase();
  render();
});

categoryEl.addEventListener("change", render);

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
    document.getElementById("recipeSummary").textContent=error.message;
  }
}
function addRecipeRow(term = {}) {
  const row=document.createElement("div");
  row.className="recipe-line";
  const item=inventory.find(item=>item.sku===term.sku);
  row.innerHTML=`
    <label>Ingredient<select data-sku required>
      <option value="">Choose inventory product</option>
      ${term.sku&&!item?`<option value="${escapeHtml(term.sku)}" selected>Missing: ${escapeHtml(term.sku)}</option>`:""}
      ${inventory.map(entry=>`<option value="${escapeHtml(entry.sku)}" ${entry.sku===term.sku?"selected":""}>${escapeHtml(entry.productName)} (${escapeHtml(entry.measurement)})</option>`).join("")}
    </select></label>
    <label>Amount<input data-amount type="number" min="0.001" step="0.001" required value="${Number(term.amount)||""}"></label>
    <label>Unit<select data-unit><option>g</option><option>ml</option><option>pcs</option></select></label>
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
  } catch(error) { document.getElementById("recipeIssues").textContent=error.message; }
  finally { button.disabled=false; }
});
