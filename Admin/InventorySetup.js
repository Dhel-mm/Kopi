const conversionDialog = document.getElementById("conversionDialog");
const conversionIngredient = document.getElementById("conversionIngredient");
const conversionUnit = document.getElementById("conversionRecipeUnit");
const conversionStatus = document.getElementById("conversionStatus");
let unitConversions = [];

async function refreshConversions() {
  try {
    const data = await KopiApi.request("/admin/inventory/unit-conversions");
    unitConversions = data.conversions;
    const estimates = unitConversions.filter(row=>row.isEstimate).length;
    document.getElementById("conversionSummary").textContent = estimates
      ? estimates+" starter conversions are ESTIMATES. Use Measured conversions to replace them. Newly added ingredients start with zero stock."
      : "Saved conversions are marked as measured. New ingredients need actual stock added before ordering.";
    const selected = conversionIngredient.value;
    conversionIngredient.innerHTML = inventory.map(item=>`<option value="${escapeHtml(item.sku)}">${escapeHtml(item.productName)} — stock in ${escapeHtml(item.measurement)}</option>`).join("");
    if (inventory.some(item=>item.sku===selected)) conversionIngredient.value=selected;
    document.getElementById("conversionList").innerHTML = unitConversions.map(row=>
      `<li><strong>${escapeHtml(row.productName)}</strong>: ${row.recipeAmount} ${escapeHtml(row.recipeUnit)} = ${row.stockAmount} ${escapeHtml(row.stockUnit)} <span class="conversion-tag">${row.isEstimate?"STARTER ESTIMATE":"Measured"}</span></li>`
    ).join("") || "<li>No saved conversions.</li>";
  } catch(error) { document.getElementById("conversionSummary").textContent=error.message; }
}

function renderConversion(changeIngredient=false) {
  const item = inventory.find(entry=>entry.sku===conversionIngredient.value);
  if (!item) return;
  for (const option of conversionUnit.options) option.disabled = option.value===item.measurement;
  if (changeIngredient) {
    conversionUnit.value = unitConversions.find(row=>row.sku===item.sku)?.recipeUnit ||
      Array.from(conversionUnit.options).find(option=>!option.disabled).value;
  }
  const saved = unitConversions.find(row=>row.sku===item.sku && row.recipeUnit===conversionUnit.value);
  document.getElementById("conversionRecipeAmount").value = saved?.recipeAmount ?? "";
  document.getElementById("conversionStockAmount").value = saved?.stockAmount ?? "";
  document.getElementById("conversionStockUnit").value = item.measurement;
  document.getElementById("conversionMeasured").checked = false;
  conversionStatus.textContent = saved?.isEstimate ? "This is a starter estimate, not a measured shop quantity." : "Enter your measured equivalent amounts.";
}

document.getElementById("openConversions").addEventListener("click",async()=>{
  await refreshConversions();
  renderConversion(true);
  conversionDialog.showModal();
});
document.getElementById("closeConversions").addEventListener("click",()=>conversionDialog.close());
conversionIngredient.addEventListener("change",()=>renderConversion(true));
conversionUnit.addEventListener("change",()=>renderConversion());
document.getElementById("conversionForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const button=document.getElementById("saveConversion");
  button.disabled=true;
  try {
    await KopiApi.request("/admin/inventory/unit-conversions/"+encodeURIComponent(conversionIngredient.value)+"/"+conversionUnit.value,{
      method:"PUT",
      body:JSON.stringify({
        recipeAmount:Number(document.getElementById("conversionRecipeAmount").value),
        stockAmount:Number(document.getElementById("conversionStockAmount").value),
        confirmedMeasured:document.getElementById("conversionMeasured").checked
      })
    });
    await refreshConversions();
    await refreshRecipes();
    conversionStatus.textContent="Measured conversion saved. Existing order deductions are unchanged.";
  } catch(error) { conversionStatus.textContent=error.message; }
  finally { button.disabled=false; }
});

const movementDialog=document.getElementById("movementDialog");
rowsEl.addEventListener("click",async event=>{
  const button=event.target.closest("[data-movements]");
  if (!button) return;
  const item=inventory.find(row=>row.id===Number(button.dataset.movements));
  if (!item) return;
  document.getElementById("movementTitle").textContent=item.productName+" — movements";
  const list=document.getElementById("movementList");
  list.textContent="Loading…";
  movementDialog.showModal();
  try {
    const data=await KopiApi.request("/admin/inventory/"+item.id+"/movements");
    list.innerHTML=data.movements.length
      ? '<ul class="stock-movements">'+data.movements.map(row=>`<li><strong>${row.changeAmount>0?"+":""}${row.changeAmount} ${escapeHtml(item.measurement)}</strong><span>${escapeHtml(row.reason)}</span><small>${escapeHtml(row.orderNumber||"Stock adjustment")} · ${escapeHtml(row.createdAt)} UTC</small></li>`).join("")+"</ul>"
      : "No stock movements recorded yet.";
  } catch(error) { list.textContent=error.message; }
});
document.getElementById("closeMovements").addEventListener("click",()=>movementDialog.close());
if (inventory.length) refreshConversions();
