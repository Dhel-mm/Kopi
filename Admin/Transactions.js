const rowsEl=document.getElementById("transactionRows"),emptyEl=document.getElementById("transactionEmpty");
const searchEl=document.getElementById("transactionSearch"),filters=document.getElementById("reportFilters");
const peso=value=>"₱"+Number(value||0).toFixed(2);
const escapeHtml=value=>String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
let page=1,version=0,timer;
const params=()=>new URLSearchParams({page,search:searchEl.value.trim(),from:document.getElementById("reportFrom").value,to:document.getElementById("reportTo").value,status:document.getElementById("reportStatusFilter").value,type:document.getElementById("reportType").value,payment:document.getElementById("reportPayment").value});
function dateTime(value) {
  if(!value)return "Date not recorded";
  const date=new Date(value.includes("T")?value:value.replace(" ","T")+"Z");
  return date.toLocaleString("en-PH",{timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"short"});
}
async function refreshTransactions() {
  const requestVersion=++version,status=document.getElementById("reportStatus");
  status.textContent="Loading…";
  try {
    const data=await KopiApi.request("/admin/transactions?"+params());
    if(requestVersion!==version)return;
    page=data.page;
    document.getElementById("filteredSales").textContent="Completed sales matching filters: "+peso(data.filteredSales)+" (canceled orders excluded).";
    rowsEl.innerHTML=data.transactions.map(row=>`<tr>
      <td>#TRX-${row.id}</td><td>${dateTime(row.completedAt||row.canceledAt)}</td>
      <td>${escapeHtml(row.serviceType||row.orderType)}</td><td>${escapeHtml(row.orderNumber)}</td>
      <td>${escapeHtml(row.customer)}</td><td>${escapeHtml(row.payment)}<small> ${escapeHtml(row.paymentStatus||"")}</small></td>
      <td>${peso(row.total)}</td><td><span class="transaction-status ${row.status.toLowerCase()}">${row.status}</span>${row.refundStatus==="Needs staff review"?"<small>Refund needs staff review</small>":""}</td>
      <td><button class="receipt-btn" type="button" data-receipt="${row.id}" aria-label="View receipt for ${escapeHtml(row.orderNumber)}"><i class="bi bi-receipt" aria-hidden="true"></i>View</button></td></tr>`).join("");
    emptyEl.hidden=data.transactions.length>0;emptyEl.textContent="No transactions match these filters.";
    document.getElementById("transactionRange").textContent=data.matched?"Showing "+((page-1)*data.pageSize+1)+"–"+Math.min(page*data.pageSize,data.matched)+" of "+data.matched:"Showing 0 transactions";
    const buttons=document.querySelectorAll(".pagination button");
    buttons[0].disabled=page<=1;buttons[1].textContent=page+" / "+data.pages;buttons[2].disabled=page>=data.pages;
    status.textContent="";
  }catch(error){if(requestVersion===version){KopiNotice.set(status,error.message,"error");rowsEl.innerHTML="";emptyEl.hidden=false;emptyEl.textContent="Report unavailable. Retry by applying filters.";}}
}
document.querySelectorAll(".pagination button")[0].addEventListener("click",()=>{page--;refreshTransactions();});
document.querySelectorAll(".pagination button")[2].addEventListener("click",()=>{page++;refreshTransactions();});
searchEl.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(()=>{page=1;refreshTransactions();},250);});
filters.addEventListener("submit",event=>{event.preventDefault();page=1;refreshTransactions();});
document.getElementById("transactionFilter").addEventListener("click",event=>{filters.hidden=!filters.hidden;event.currentTarget.setAttribute("aria-expanded",String(!filters.hidden));});
document.getElementById("clearFilters").addEventListener("click",()=>{filters.reset();searchEl.value="";page=1;refreshTransactions();});
document.getElementById("exportReport").addEventListener("click",async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{await KopiApi.download("/admin/transactions/export?"+params(),"kopi-transactions.csv");}
  catch(error){KopiNotice.set(document.getElementById("reportStatus"),error.message,"error");}
  finally{button.disabled=false;}
});
/* ---------- Order receipt (same details as the cashier's receipt) ---------- */
const receiptDialog=document.getElementById("receiptDialog"),receiptBody=document.getElementById("receiptBody");
const optionText=options=>Object.values(options||{}).filter(Boolean).join(" · ");
function receiptHtml(order) {
  const line=(label,value,cls="")=>`<p class="receipt-line ${cls}"><span>${label}</span><span>${value}</span></p>`;
  const discount=Math.max(0,order.subtotal-order.total);
  const paid=order.paymentStatus==="Verified"?"Paid":order.paymentStatus;
  return `<div class="tx-receipt-brand"><img src="../Customer/HomePic/Logo.png" alt=""><div><h3>Kopi; Calamba</h3><p>72 Villanueva Subdivision Camia St.<br>Brgy. Lingga Calamba, Laguna</p></div></div>
    <p><strong>${escapeHtml(order.orderNumber)}</strong> · TRX-${order.id} · ${escapeHtml(order.serviceType||order.orderType)}</p>
    <p>${escapeHtml(order.customer||"Walk-in Customer")}<br>${escapeHtml(dateTime(order.createdAt))}</p>
    <p>Status: <strong>${escapeHtml(order.status)}</strong><br>Payment: ${escapeHtml(order.payment)} · ${escapeHtml(paid||"")}${order.paymentReference?`<br>Reference: ${escapeHtml(order.paymentReference)}`:""}</p>
    ${order.orderType==="Online"?`<p>Deliver to: ${escapeHtml(order.address||"Not provided")}<br>Phone: ${escapeHtml(order.phone||"Not provided")}</p>`:""}
    <ul>${order.items.map(item=>`<li>${line(`${item.quantity} × ${escapeHtml(item.name)}`,`<strong>${peso(item.price*item.quantity)}</strong>`)}${optionText(item.options)?`<small>${escapeHtml(optionText(item.options))}</small>`:""}</li>`).join("")}</ul>
    ${line("Subtotal",peso(order.subtotal))}
    ${order.voucherDiscount>0?line(`Voucher${order.voucher?" ("+escapeHtml(order.voucher)+")":""}`,"− "+peso(order.voucherDiscount)):""}
    ${order.specialDiscountType&&order.specialDiscountStatus==="Not approved"?`<p class="receipt-line"><small>${escapeHtml(order.specialDiscountType)} discount not approved (ID photo not verified) · ${peso(order.discountRemoved)} removed</small></p>`:""}
    ${order.specialDiscountType&&order.specialDiscountStatus!=="Not approved"?line("VAT exemption (12%)","− "+peso(order.vatExempt))+line(`${escapeHtml(order.specialDiscountType)} discount (20%)`,"− "+peso(order.specialDiscount))+`<p class="receipt-line"><small>${escapeHtml(order.specialDiscountType)} ID ${escapeHtml(order.specialDiscountId)} · ${escapeHtml(order.specialDiscountName)}</small></p>`:""}
    ${line("Total discounts","− "+peso(discount))}
    ${line("Total",peso(order.total),"receipt-total")}
    ${order.payment==="Cash"&&order.cashTendered!=null?line("Cash received",peso(order.cashTendered))+line("Cash change",`<strong>${peso(order.cashChange)}</strong>`):""}
    ${order.status==="Canceled"?`<p class="tx-receipt-note">${escapeHtml(order.cancellationReason||"This order was canceled.")}${order.refundStatus==="Needs staff review"?" Refund needs staff review.":""}</p>`:""}
    <p class="tx-receipt-note">Handled by: ${escapeHtml(order.cashier)}. Thank you for choosing Kopi; Calamba.</p>`;
}
rowsEl.addEventListener("click",async event=>{
  const button=event.target.closest("[data-receipt]");if(!button)return;
  button.disabled=true;
  receiptBody.textContent="Loading receipt…";
  if(!receiptDialog.open)receiptDialog.showModal();
  try{const {order}=await KopiApi.request("/admin/orders/"+encodeURIComponent(button.dataset.receipt)+"/receipt");receiptBody.innerHTML=receiptHtml(order);}
  catch(error){KopiNotice.set(receiptBody,error.message,"error");}
  finally{button.disabled=false;}
});
document.getElementById("closeReceipt").addEventListener("click",()=>receiptDialog.close());
receiptDialog.addEventListener("click",event=>{if(event.target!==receiptDialog)return;const r=receiptDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)receiptDialog.close();});
document.getElementById("printReceipt").addEventListener("click",()=>{document.body.classList.add("printing-receipt");window.print();});
window.addEventListener("afterprint",()=>document.body.classList.remove("printing-receipt"));
window.addEventListener("focus",refreshTransactions);
refreshTransactions();
