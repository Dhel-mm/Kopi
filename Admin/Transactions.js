/* Transaction Management: interval, totals, filters, table and report exports. */
const rowsEl=document.getElementById("transactionRows"),emptyEl=document.getElementById("transactionEmpty");
const searchEl=document.getElementById("transactionSearch"),filters=document.getElementById("reportFilters");
const intervalEl=document.getElementById("txInterval"),fromEl=document.getElementById("reportFrom"),toEl=document.getElementById("reportTo");
const peso=value=>"₱"+Number(value||0).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2});
const escapeHtml=value=>String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
let page=1,version=0,timer;

// Interval dates are Philippine calendar days (UTC+8).
const manilaToday=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const shiftDay=(day,by)=>new Date(Date.parse(day+"T00:00:00Z")+by*86400000).toISOString().slice(0,10);
const longDate=day=>new Date(day+"T00:00:00Z").toLocaleDateString("en-PH",{timeZone:"UTC",dateStyle:"medium"});
function intervalRange() {
  const today=manilaToday(),kind=intervalEl.value;
  if(kind==="today")return {from:today,to:today,label:"Today, "+longDate(today)};
  if(kind==="yesterday"){const day=shiftDay(today,-1);return {from:day,to:day,label:"Yesterday, "+longDate(day)};}
  if(kind==="week"){const start=shiftDay(today,-((new Date(today+"T00:00:00Z").getUTCDay()+6)%7));return {from:start,to:today,label:`This week, ${longDate(start)} – ${longDate(today)}`};}
  if(kind==="month"){const start=today.slice(0,8)+"01";return {from:start,to:today,label:`This month, ${longDate(start)} – ${longDate(today)}`};}
  if(kind==="year"){const start=today.slice(0,5)+"01-01";return {from:start,to:today,label:`This year, ${longDate(start)} – ${longDate(today)}`};}
  if(kind==="custom"){
    const from=fromEl.value,to=toEl.value;
    return {from,to,label:from||to?`${from?longDate(from):"Start"} – ${to?longDate(to):"Today"}`:"All time"};
  }
  return {from:"",to:"",label:"All time"};
}
const params=(extra={})=>{
  const range=intervalRange();
  return new URLSearchParams({page,search:searchEl.value.trim(),from:range.from,to:range.to,status:document.getElementById("reportStatusFilter").value,
    type:document.getElementById("reportType").value,payment:document.getElementById("reportPayment").value,label:range.label,...extra});
};
function dateTime(value) {
  if(!value)return "Date not recorded";
  const date=new Date(value.includes("T")?value:value.replace(" ","T")+"Z");
  return date.toLocaleString("en-PH",{timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"short"});
}
const typeLabel=row=>row.orderType==="Online"?(row.serviceType==="Pickup"?"Online pickup":"Online delivery"):(row.serviceType||row.orderType);
const statusChip=row=>`<span class="transaction-status ${row.status.toLowerCase()}">${row.status==="Canceled"?"Void":escapeHtml(row.status)}</span>`;

function detailRow(row) {
  const discount=Number(row.voucherDiscount||0)+Number(row.specialDiscount||0)+Number(row.vatExempt||0);
  return `<tr class="tx-detail" id="tx-detail-${row.id}" hidden><td colspan="8"><div class="tx-detail-grid">
    <div><span>Transaction ID</span><strong>TRX-${row.id}</strong></div>
    <div><span>Customer</span><strong>${escapeHtml(row.customer)}</strong></div>
    <div><span>Order type</span><strong>${escapeHtml(typeLabel(row))}</strong></div>
    <div><span>Payment</span><strong>${escapeHtml(row.payment)}${row.paymentStatus?` · ${escapeHtml(row.paymentStatus)}`:""}</strong></div>
    <div><span>Subtotal</span><strong>${peso(row.subtotal)}</strong></div>
    <div><span>Discounts</span><strong>${discount?"− "+peso(discount):"None"}</strong></div>
    ${row.cashTendered!=null?`<div><span>Cash received</span><strong>${peso(row.cashTendered)}</strong></div>`:""}
    ${row.refundStatus==="Needs staff review"?`<div class="tx-detail-warn"><span>Refund</span><strong>Needs staff review</strong></div>`:""}
    <div class="tx-detail-action"><button class="receipt-btn" type="button" data-receipt="${row.id}" aria-label="View receipt for ${escapeHtml(row.orderNumber)}"><i class="bi bi-receipt" aria-hidden="true"></i>View receipt</button></div>
  </div></td></tr>`;
}

async function refreshTransactions() {
  const requestVersion=++version,status=document.getElementById("reportStatus");
  status.textContent="Loading…";
  try {
    const data=await KopiApi.request("/admin/transactions?"+params());
    if(requestVersion!==version)return;
    page=data.page;
    document.getElementById("statCount").textContent=data.totals.transactions.toLocaleString("en-PH");
    document.getElementById("statVoid").textContent=data.totals.canceled.toLocaleString("en-PH");
    document.getElementById("statAmount").textContent=peso(data.totals.amount);
    document.getElementById("statAverage").textContent=peso(data.totals.averageOrder);
    rowsEl.innerHTML=data.transactions.map(row=>`<tr>
      <td><strong>${escapeHtml(row.orderNumber)}</strong></td>
      <td class="tx-date">${escapeHtml(dateTime(row.completedAt||row.canceledAt))}</td>
      <td>${escapeHtml(row.cashier)}</td>
      <td class="tx-items" title="${escapeHtml(row.items||"")}">${escapeHtml(row.items||"—")}</td>
      <td class="num"><strong>${peso(row.total)}</strong></td>
      <td class="num">${row.cashChange!=null?peso(row.cashChange):"—"}</td>
      <td>${statusChip(row)}</td>
      <td class="actions"><button class="tx-expand" type="button" data-expand="${row.id}" aria-expanded="false" aria-controls="tx-detail-${row.id}" aria-label="Show details for ${escapeHtml(row.orderNumber)}"><i class="bi bi-chevron-down" aria-hidden="true"></i></button></td>
    </tr>${detailRow(row)}`).join("");
    emptyEl.hidden=data.transactions.length>0;emptyEl.textContent="No transactions in this interval. Try another interval or clear the filters.";
    document.getElementById("transactionRange").textContent=data.matched?"Showing "+((page-1)*data.pageSize+1)+"–"+Math.min(page*data.pageSize,data.matched)+" of "+data.matched:"Showing 0 transactions";
    const buttons=document.querySelectorAll(".pagination button");
    buttons[0].disabled=page<=1;buttons[1].textContent=page+" / "+data.pages;buttons[2].disabled=page>=data.pages;
    status.textContent="";
  }catch(error){if(requestVersion===version){KopiNotice.set(status,error.message,"error");rowsEl.innerHTML="";emptyEl.hidden=false;emptyEl.textContent="Report unavailable. Check the dates and try again.";}}
}
document.querySelectorAll(".pagination button")[0].addEventListener("click",()=>{page--;refreshTransactions();});
document.querySelectorAll(".pagination button")[2].addEventListener("click",()=>{page++;refreshTransactions();});
searchEl.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(()=>{page=1;refreshTransactions();},250);});
filters.addEventListener("submit",event=>{event.preventDefault();page=1;refreshTransactions();});
filters.addEventListener("change",event=>{if(event.target.matches("select")){page=1;refreshTransactions();}});
try{const saved=localStorage.getItem("kopi_tx_interval");if(saved&&[...intervalEl.options].some(option=>option.value===saved&&saved!=="custom"))intervalEl.value=saved;else intervalEl.value="today";}catch{intervalEl.value="today";}
intervalEl.addEventListener("change",()=>{
  document.getElementById("txCustom").hidden=intervalEl.value!=="custom";
  try{localStorage.setItem("kopi_tx_interval",intervalEl.value);}catch{}
  if(intervalEl.value==="custom"){const today=manilaToday();fromEl.max=toEl.max=today;if(!fromEl.value)fromEl.value=today.slice(0,8)+"01";if(!toEl.value)toEl.value=today;}
  page=1;refreshTransactions();
});
[fromEl,toEl].forEach(input=>input.addEventListener("change",()=>{page=1;refreshTransactions();}));

// Expand a row to see the transaction details and its receipt.
rowsEl.addEventListener("click",event=>{
  const toggle=event.target.closest("[data-expand]");if(!toggle)return;
  const detail=document.getElementById("tx-detail-"+toggle.dataset.expand),open=detail.hidden;
  detail.hidden=!open;toggle.setAttribute("aria-expanded",String(open));
  toggle.closest("tr").classList.toggle("is-open",open);
});

/* ---------- Export menu ---------- */
const exportBtn=document.getElementById("exportBtn"),exportMenu=document.getElementById("exportMenu");
function setExportMenu(open){exportMenu.hidden=!open;exportBtn.setAttribute("aria-expanded",String(open));if(open)exportMenu.querySelector("button").focus();}
exportBtn.addEventListener("click",()=>setExportMenu(exportMenu.hidden));
document.addEventListener("click",event=>{if(!exportMenu.hidden&&!event.target.closest(".tx-export"))setExportMenu(false);});
document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!exportMenu.hidden){setExportMenu(false);exportBtn.focus();}});

const reportDialog=document.getElementById("reportDialog"),reportBody=document.getElementById("reportBody");
function reportHtml(data,label) {
  const completed=data.transactions.filter(row=>row.status==="Completed");
  const byPayment=Object.entries(completed.reduce((all,row)=>{all[row.payment]=(all[row.payment]||0)+Number(row.total);return all;},{}));
  return `<div class="tx-report-brand"><img src="../Customer/HomePic/Logo.png" alt=""><div><h3>Kopi; Calamba</h3><p>Transaction report · ${escapeHtml(label)}</p><small>Generated ${escapeHtml(dateTime(data.generatedAt))} · Philippine time</small></div></div>
    <div class="tx-report-totals">
      <div><span>Total transactions</span><strong>${data.totals.transactions}</strong><small>${data.totals.completed} completed · ${data.totals.canceled} void</small></div>
      <div><span>Total amount</span><strong>${peso(data.totals.amount)}</strong><small>Completed orders only</small></div>
      <div><span>Average order</span><strong>${peso(data.totals.averageOrder)}</strong><small>Per completed order</small></div>
    </div>
    ${byPayment.length?`<p class="tx-report-split">${byPayment.map(([payment,total])=>`${escapeHtml(payment)}: <strong>${peso(total)}</strong>`).join(" · ")}</p>`:""}
    ${data.transactions.length?`<table class="tx-report-table"><thead><tr><th>Order ID</th><th>Date &amp; Time</th><th>Cashier</th><th>Items</th><th>Payment</th><th class="num">Total</th><th class="num">Change</th><th>Status</th></tr></thead><tbody>
      ${data.transactions.map(row=>`<tr><td>${escapeHtml(row.orderNumber)}</td><td>${escapeHtml(dateTime(row.completedAt||row.canceledAt))}</td><td>${escapeHtml(row.cashier)}</td><td>${escapeHtml(row.items||"")}</td><td>${escapeHtml(row.payment)}</td><td class="num">${peso(row.total)}</td><td class="num">${row.cashChange!=null?peso(row.cashChange):"—"}</td><td>${row.status==="Canceled"?"Void":escapeHtml(row.status)}</td></tr>`).join("")}
    </tbody></table>`:`<p class="transaction-empty">No transactions in this interval.</p>`}`;
}
async function openReport(print) {
  const label=intervalRange().label;
  reportBody.textContent="Loading report…";
  if(!reportDialog.open)reportDialog.showModal();
  try{
    const data=await KopiApi.request("/admin/transactions/report?"+params());
    reportBody.innerHTML=reportHtml(data,label);
    if(print)printReport();
  }catch(error){KopiNotice.set(reportBody,error.message,"error");}
}
function printReport(){document.body.classList.add("printing-report");window.print();}
document.getElementById("printFullReport").addEventListener("click",printReport);
document.getElementById("closeReport").addEventListener("click",()=>reportDialog.close());
exportMenu.addEventListener("click",async event=>{
  const item=event.target.closest("[data-export]");if(!item)return;
  setExportMenu(false);
  const kind=item.dataset.export;
  if(kind==="print")return openReport(true);
  if(kind==="preview")return openReport(false);
  const names={report:"kopi-transaction-report.csv",csv:"kopi-transactions.csv",json:"kopi-transactions.json"};
  exportBtn.disabled=true;
  try{await KopiApi.download("/admin/transactions/export?"+params({format:kind}),names[kind]);KopiNotice.toast("Report downloaded.","success");}
  catch(error){KopiNotice.set(document.getElementById("reportStatus"),error.message,"error");}
  finally{exportBtn.disabled=false;}
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
window.addEventListener("afterprint",()=>document.body.classList.remove("printing-receipt","printing-report"));
window.addEventListener("focus",refreshTransactions);
refreshTransactions();
