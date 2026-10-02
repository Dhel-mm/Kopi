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
    document.getElementById("todaySales").textContent=peso(data.summary.todaySales);
    document.getElementById("transactionCount").textContent=data.summary.totalTransactions;
    document.getElementById("monthSales").textContent=peso(data.summary.monthSales);
    document.getElementById("filteredSales").textContent="Completed sales matching filters: "+peso(data.filteredSales)+" (canceled orders excluded).";
    rowsEl.innerHTML=data.transactions.map(row=>`<tr>
      <td>#TRX-${row.id}</td><td>${dateTime(row.completedAt||row.canceledAt)}</td>
      <td>${escapeHtml(row.serviceType||row.orderType)}</td><td>${escapeHtml(row.orderNumber)}</td>
      <td>${escapeHtml(row.customer)}</td><td>${escapeHtml(row.payment)}<small> ${escapeHtml(row.paymentStatus||"")}</small></td>
      <td>${peso(row.total)}</td><td><span class="transaction-status ${row.status.toLowerCase()}">${row.status}</span>${row.refundStatus==="Needs staff review"?"<small>Refund needs staff review</small>":""}</td>
      <td>${escapeHtml(row.cashier)}</td></tr>`).join("");
    emptyEl.hidden=data.transactions.length>0;emptyEl.textContent="No transactions match these filters.";
    document.getElementById("transactionRange").textContent=data.matched?"Showing "+((page-1)*data.pageSize+1)+"–"+Math.min(page*data.pageSize,data.matched)+" of "+data.matched:"Showing 0 transactions";
    const buttons=document.querySelectorAll(".pagination button");
    buttons[0].disabled=page<=1;buttons[1].textContent=page+" / "+data.pages;buttons[2].disabled=page>=data.pages;
    status.textContent="Dates use Asia/Manila. Summary cards show today, all records, and the current month.";
  }catch(error){if(requestVersion===version){KopiNotice.set(status,error.message,"error");rowsEl.innerHTML="";emptyEl.hidden=false;emptyEl.textContent="Report unavailable. Retry by applying filters.";}}
}
document.querySelectorAll(".pagination button")[0].addEventListener("click",()=>{page--;refreshTransactions();});
document.querySelectorAll(".pagination button")[2].addEventListener("click",()=>{page++;refreshTransactions();});
searchEl.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(()=>{page=1;refreshTransactions();},250);});
filters.addEventListener("submit",event=>{event.preventDefault();page=1;refreshTransactions();});
document.getElementById("transactionFilter").addEventListener("click",()=>{filters.hidden=!filters.hidden;});
document.getElementById("clearFilters").addEventListener("click",()=>{filters.reset();searchEl.value="";page=1;refreshTransactions();});
document.getElementById("exportReport").addEventListener("click",async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{await KopiApi.download("/admin/transactions/export?"+params(),"kopi-transactions.csv");}
  catch(error){KopiNotice.set(document.getElementById("reportStatus"),error.message,"error");}
  finally{button.disabled=false;}
});
window.addEventListener("focus",refreshTransactions);
refreshTransactions();
