const conversionDialog = document.getElementById("conversionDialog");
const conversionIngredient = document.getElementById("conversionIngredient");
const conversionUnit = document.getElementById("conversionRecipeUnit");
const conversionStatus = document.getElementById("conversionStatus");
let unitConversions = [];
let previousConversionUnit = "ml";
const conversionUnits = {L:{base:"ml",scale:1000},kg:{base:"g",scale:1000},g:{base:"g",scale:1},ml:{base:"ml",scale:1},pcs:{base:"pcs",scale:1}};

async function refreshConversions() {
  try {
    const data = await KopiApi.request("/admin/inventory/unit-conversions");
    unitConversions = data.conversions;
    const estimates = unitConversions.filter(row=>row.isEstimate).length;
    document.getElementById("conversionSummary").textContent = estimates
      ? estimates+" recipe conversions are starter estimates. Review them under Recipe weight, volume and piece conversions."
      : "Set full package sizes and stock labels in Ingredient unit conversion.";
    const selected = conversionIngredient.value;
    conversionIngredient.innerHTML = inventory.map(item=>`<option value="${escapeHtml(item.sku)}">${escapeHtml(item.productName)} — stock in ${escapeHtml(item.measurement)}</option>`).join("");
    if (inventory.some(item=>item.sku===selected)) conversionIngredient.value=selected;
    document.getElementById("packageConversionList").innerHTML = inventory.map(item =>
      `<li><strong>${escapeHtml(item.productName)}</strong>: ${escapeHtml(displayMeasurement(item,item.initialQuantity))} = 1 ${escapeHtml(item.packageUnit || "package")}</li>`
    ).join("") || "<li>No inventory products yet.</li>";
    document.getElementById("conversionList").innerHTML = unitConversions.map(row=>
      `<li><strong>${escapeHtml(row.productName)}</strong>: ${row.recipeAmount} ${escapeHtml(row.recipeUnit)} = ${row.stockAmount} ${escapeHtml(row.stockUnit)} <span class="conversion-tag">${row.isEstimate?"STARTER ESTIMATE":"Measured"}</span></li>`
    ).join("") || "<li>No saved conversions.</li>";
  } catch(error) { KopiNotice.set(document.getElementById("conversionSummary"),error.message,"error"); }
}

function renderConversion() {
  const item = inventory.find(entry=>entry.sku===conversionIngredient.value);
  if (!item) return;
  conversionUnit.value = item.initialQuantity >= 1000 && item.measurement === "ml" ? "L"
    : item.initialQuantity >= 1000 && item.measurement === "g" ? "kg" : item.measurement;
  previousConversionUnit = conversionUnit.value;
  document.getElementById("conversionRecipeAmount").value = item.initialQuantity / conversionUnits[conversionUnit.value].scale;
  document.getElementById("conversionStockAmount").value = 1;
  document.getElementById("conversionStockUnit").value = item.packageUnit || "package";
  document.getElementById("conversionCurrentStock").textContent = `Currently available: ${packageStock(item)} · ${displayMeasurement(item)}`;
  document.getElementById("conversionMeasured").checked = false;
  conversionStatus.textContent = "Enter the measurement of full packages. Partly used packages stay counted until empty.";
  renderPhysicalConversion(true);
}

function renderPhysicalConversion(changeIngredient=false) {
  const item=inventory.find(entry=>entry.sku===conversionIngredient.value);
  if (!item) return;
  const unit=document.getElementById("physicalRecipeUnit");
  for (const option of unit.options) option.disabled=option.value===item.measurement;
  if (changeIngredient) unit.value=unitConversions.find(row=>row.sku===item.sku)?.recipeUnit || Array.from(unit.options).find(option=>!option.disabled).value;
  const saved=unitConversions.find(row=>row.sku===item.sku && row.recipeUnit===unit.value);
  document.getElementById("physicalConversionIngredient").textContent=item.productName;
  document.getElementById("physicalRecipeAmount").value=saved?.recipeAmount ?? "";
  document.getElementById("physicalStockAmount").value=saved?.stockAmount ?? "";
  document.getElementById("physicalStockUnit").value=item.measurement;
  document.getElementById("physicalMeasured").checked=false;
  document.getElementById("physicalConversionStatus").textContent=saved?.isEstimate ? "Starter estimate: replace with your measured amounts." : "Enter measured equivalent amounts for this ingredient.";
}

document.getElementById("openConversions").addEventListener("click",async()=>{
  await refreshConversions();
  renderConversion(true);
  conversionDialog.showModal();
});
document.getElementById("closeConversions").addEventListener("click",()=>conversionDialog.close());
conversionIngredient.addEventListener("change",()=>renderConversion(true));
conversionUnit.addEventListener("change",()=>{
  const before=conversionUnits[previousConversionUnit],next=conversionUnits[conversionUnit.value];
  const input=document.getElementById("conversionRecipeAmount");
  if (before.base===next.base && input.value!=="") input.value=Number((Number(input.value)*before.scale/next.scale).toFixed(9));
  else input.value="";
  previousConversionUnit=conversionUnit.value;
  document.getElementById("conversionMeasured").checked=false;
});
document.getElementById("conversionForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const button=document.getElementById("saveConversion");
  button.disabled=true;
  try {
    await KopiApi.request("/admin/inventory/package-conversion/"+encodeURIComponent(conversionIngredient.value),{
      method:"PUT",
      body:JSON.stringify({
        recipeAmount:Number(document.getElementById("conversionRecipeAmount").value),
        recipeUnit:conversionUnit.value,
        stockAmount:Number(document.getElementById("conversionStockAmount").value),
        stockUnit:document.getElementById("conversionStockUnit").value.trim(),
        confirmedMeasured:document.getElementById("conversionMeasured").checked
      })
    });
    await refreshInventory();
    await refreshConversions();
    renderConversion();
    KopiNotice.set(conversionStatus,"Package conversion saved. Stock labels and counts are updated; the remaining measurement is unchanged.","success");
  } catch(error) { KopiNotice.set(conversionStatus,error.message,"error"); }
  finally { button.disabled=false; }
});

document.getElementById("physicalRecipeUnit").addEventListener("change",()=>renderPhysicalConversion());
document.getElementById("physicalConversionForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const button=document.getElementById("savePhysicalConversion");
  const status=document.getElementById("physicalConversionStatus");
  button.disabled=true;
  try {
    await KopiApi.request("/admin/inventory/unit-conversions/"+encodeURIComponent(conversionIngredient.value)+"/"+document.getElementById("physicalRecipeUnit").value,{
      method:"PUT",body:JSON.stringify({
        recipeAmount:Number(document.getElementById("physicalRecipeAmount").value),
        stockAmount:Number(document.getElementById("physicalStockAmount").value),
        confirmedMeasured:document.getElementById("physicalMeasured").checked
      })
    });
    await refreshConversions();
    await refreshRecipes();
    KopiNotice.set(status,"Measured equivalent saved. Existing stock and order deductions are unchanged.","success");
  } catch(error) {KopiNotice.set(status,error.message,"error");}
  finally {button.disabled=false;}
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
  } catch(error) { KopiNotice.set(list,error.message,"error"); }
});
document.getElementById("closeMovements").addEventListener("click",()=>movementDialog.close());
if (inventory.length) refreshConversions();
