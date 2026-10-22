(async () => {
  "use strict";
  const user = await KopiWorkplace.ready;
  if (!user) return;
  const {escape:esc,money,date} = KopiWorkplace;
  const dialog = document.createElement("dialog");
  dialog.className="workspace-dialog";
  dialog.setAttribute("aria-labelledby","receiptTitle");
  dialog.innerHTML=`<header><h2 id="receiptTitle">Order receipt</h2><button class="close-panel" type="button" aria-label="Close receipt"><i class="bi bi-x-lg" aria-hidden="true"></i></button></header><div class="workspace-receipt"></div>`;
  document.body.append(dialog);
  dialog.querySelector("header button").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("click",event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});

  async function receipt(id) {
    try {
      const {order} = await KopiApi.request("/workforce/orders/"+encodeURIComponent(id));
      const discount = Math.max(0,order.subtotal-order.total);
      const special = order.specialDiscountType ? `<p class="receipt-line"><span>VAT exemption (12%)</span><span>− ${money(order.vatExempt)}</span></p>
        <p class="receipt-line"><span>${esc(order.specialDiscountType)} discount (20%)</span><span>− ${money(order.specialDiscount)}</span></p>
        <p class="receipt-line"><small>${esc(order.specialDiscountType)} ID ${esc(order.specialDiscountId)} · ${esc(order.specialDiscountName)}</small></p>` : "";
      dialog.querySelector(".workspace-receipt").innerHTML=`<h3>Kopi; Calamba</h3>
        <p><strong>${esc(order.orderNumber)}</strong> · ${esc(order.serviceType)}</p>
        <p>${esc(order.customer || "Walk-in Customer")}<br>${esc(date(order.createdAt))}</p>
        <p>Status: <strong>${esc(order.status)}</strong><br>Payment: ${esc(order.payment)} · ${esc(order.paymentStatus === "Verified" ? "Paid" : order.paymentStatus)}</p>
        <ul>${order.items.map(item=>`<li><div class="receipt-line"><span>${item.quantity} × ${esc(item.name)}</span><strong>${money(item.price*item.quantity)}</strong></div><small>${esc(Object.values(item.options).filter(Boolean).join(" · "))}</small></li>`).join("")}</ul>
        <p class="receipt-line"><span>Subtotal</span><span>${money(order.subtotal)}</span></p>
        ${special}<p class="receipt-line"><span>Total discounts</span><span>− ${money(discount)}</span></p>
        <p class="receipt-line receipt-total"><span>Total</span><span>${money(order.total)}</span></p>
        ${order.payment === "Cash" ? `<p class="receipt-line"><span>Cash received</span><span>${money(order.cashTendered)}</span></p><p class="receipt-line"><span>Cash change</span><strong>${money(order.cashChange)}</strong></p>` : ""}
        <p class="workspace-receipt-note">Order record only. Payment confirmation is shown separately above. Thank you for choosing Kopi; Calamba.</p>`;
      if (!dialog.open) dialog.showModal();
    } catch(error) {KopiNotice.toast(error.message,"error");if(error.status===401)window.location.replace("../login.html");}
  }
  if (document.body.dataset.page==="orders") {
    document.addEventListener("kopi:pos-saved",event=>receipt(event.detail.orderId));
    // Keep a single POS implementation for Admin and Cashier pricing/customizers.
    const script=document.createElement("script");script.src="../Admin/Orders.js";
    script.onerror=()=>KopiNotice.toast("The order form could not load. Refresh this page to try again.","error");
    document.body.append(script);
    return;
  }

  let orders=[],page=1,loading=false;
  const pageSize=10;
  const search=document.getElementById("historySearch");
  const filter=document.getElementById("historyStatus");
  const message=document.getElementById("historyMessage");
  function render() {
    const term=search.value.trim().toLowerCase();
    const found=orders.filter(order=>(!filter.value||order.status===filter.value)
      && `${order.orderNumber} ${order.customer||""}`.toLowerCase().includes(term));
    const pages=Math.max(1,Math.ceil(found.length/pageSize));page=Math.min(page,pages);
    document.getElementById("historyRows").innerHTML=found.slice((page-1)*pageSize,page*pageSize).map(order=>
      `<tr><td>${esc(order.orderNumber)}</td><td>${esc(order.customer||"Walk-in Customer")}</td><td>${esc(order.serviceType)}</td><td>${order.itemCount||0}</td><td>${money(order.total)}</td><td>${esc(order.payment)}</td><td><span class="workspace-badge ${order.status==="Completed"?"good":order.status==="Canceled"?"danger":""}">${esc(order.status)}</span></td><td>${esc(date(order.createdAt))}</td><td><button class="workspace-btn secondary" type="button" data-receipt="${order.id}" aria-label="View receipt ${esc(order.orderNumber)}"><i class="bi bi-receipt" aria-hidden="true"></i> View</button></td></tr>`).join("");
    document.getElementById("historyEmpty").hidden=found.length>0;
    document.getElementById("historyRange").textContent=found.length?`${(page-1)*pageSize+1}–${Math.min(page*pageSize,found.length)} of ${found.length} orders`:"0 orders";
    document.getElementById("historyPage").textContent=`${page}/${pages}`;
    document.getElementById("historyPrevious").disabled=page<=1;
    document.getElementById("historyNext").disabled=page>=pages;
  }
  async function load() {
    if(loading)return;loading=true;
    const refresh=document.getElementById("refreshHistory");refresh.disabled=true;
    try {
      orders=(await KopiApi.request("/workforce/orders")).orders;render();
      KopiNotice.set(message,"Order history is up to date.","success");
    } catch(error) {KopiNotice.set(message,error.message,"error");if(error.status===401)window.location.replace("../login.html");}
    finally {loading=false;refresh.disabled=false;}
  }
  document.getElementById("historyRows").addEventListener("click",async event=>{
    const button=event.target.closest("[data-receipt]");if(!button)return;
    button.disabled=true;await receipt(button.dataset.receipt);button.disabled=false;
  });
  search.addEventListener("input",()=>{page=1;render();});
  filter.addEventListener("change",()=>{page=1;render();});
  document.getElementById("historyPrevious").addEventListener("click",()=>{page--;render();});
  document.getElementById("historyNext").addEventListener("click",()=>{page++;render();});
  document.getElementById("refreshHistory").addEventListener("click",load);
  setInterval(()=>{if(document.visibilityState==="visible")load();},30000);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")load();});
  load();
})();
