(async () => {
  "use strict";
  const user=await KopiWorkplace.ready;
  if(!user)return;
  const {escape:esc,date,money}=KopiWorkplace;
  const orderTime=value=>new Intl.DateTimeFormat("en-PH",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Manila"})
    .format(new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value)?value:value.replace(" ","T")+"Z"));
  const stockPage=document.body.dataset.page==="stock";
  const prefix=stockPage?"stock":"queue";
  const message=document.getElementById(prefix+"Message");
  const search=document.getElementById(prefix+"Search");
  const refresh=document.getElementById(stockPage?"refreshStock":"refreshQueue");
  let rows=[],status="",version=0,loading=false,updating=false;
  const pending=new Set();
  const statusDialog=document.getElementById("statusDialog");
  const deliveryDialog=document.getElementById("deliveryDialog");
  let deliveryOrder=null,deliverySaving=false;
  function confirmStatus(order, question) {
    document.getElementById("statusDialogMessage").textContent=order.orderNumber+" — "+question;
    statusDialog.returnValue="cancel";
    return new Promise(resolve=>{
      statusDialog.addEventListener("close",()=>resolve(statusDialog.returnValue==="confirm"),{once:true});
      statusDialog.showModal();
    });
  }
  function openDeliveryDialog(order) {
    deliveryOrder=order;
    document.getElementById("deliveryOrderDetails").innerHTML=`
      <p>Order ${esc(order.orderNumber)}</p>
      <p>Customer: ${esc(order.customer)}</p><p>Items: ${order.items.reduce((total,item)=>total+item.quantity,0)}</p>
      <p>Total: ${money(order.total)}</p><p>Payment: ${esc(order.payment)}</p>
      ${order.payment==="GCash"?`<p>Reference: ${esc(order.paymentReference||"Not provided")}</p><p>Payment status: ${esc(order.paymentStatus)}</p>`:""}
      <p>Order Time: ${esc(orderTime(order.createdAt))}</p>
      <p>Address:<br>${esc(order.address||"Not provided")}</p><p>Phone No.:<br>${esc(order.phone||"Not provided")}</p>`;
    const fee=document.getElementById("riderFee"),link=document.getElementById("riderTrackingLink");
    fee.value=order.riderFee ?? "";link.value=order.trackingUrl||"";link.setCustomValidity("");
    document.getElementById("deliveryFormStatus").textContent="";
    deliveryDialog.showModal();fee.focus();
  }

  function renderStock() {
    const term=search.value.trim().toLowerCase();
    const selected=document.getElementById("stockStatus").value;
    const filtered=rows.filter(item=>(!selected||item.status===selected)
      && `${item.productName} ${item.category}`.toLowerCase().includes(term));
    document.getElementById("stockRows").innerHTML=filtered.map(item=>`<tr><td>${esc(item.productName)}</td><td>${esc(item.category)}</td><td>${Number(item.quantity).toLocaleString("en-PH",{maximumFractionDigits:3})} ${esc(item.measurement)}</td><td><span class="workspace-badge ${item.status==="In Stock"?"good":item.status==="Out of Stock"?"danger":""}">${esc(item.status)}</span></td></tr>`).join("");
    document.getElementById("stockEmpty").hidden=filtered.length>0;
  }
  function renderQueue() {
    const term=search.value.trim().toLowerCase();
    const type=document.getElementById("queueType").value;
    document.getElementById("newCount").textContent=rows.filter(order=>order.status==="New").length;
    document.getElementById("preparingCount").textContent=rows.filter(order=>order.status==="Preparing").length;
    document.getElementById("itemCount").textContent=rows.reduce((sum,order)=>sum+order.items.reduce((n,item)=>n+item.quantity,0),0);
    const filtered=rows.filter(order=>(!status||order.status===status)&&(!type||order.orderType===type)
      && `${order.orderNumber} ${order.customer} ${order.items.map(item=>item.name).join(" ")}`.toLowerCase().includes(term));
    document.getElementById("preparationQueue").innerHTML=filtered.map(order=>{
      const blocked=order.payment==="GCash"&&order.paymentStatus!=="Verified";
      const delivering=order.orderType==="Online"&&["Out for Delivery","Arrived"].includes(order.status);
      const next=order.status==="New"?"Preparing":order.orderType==="In-store"||delivering?"Completed":"Out for Delivery";
      const label=delivering?"Confirm delivery & complete":next==="Preparing"?"Start preparing":next==="Completed"?"Mark as completed":"Hand over for delivery";
      return `<article class="prep-card"><header><div><h2>${esc(order.orderNumber)}</h2><span class="workspace-badge neutral">${esc(order.orderType)} · ${esc(order.serviceType)}</span></div><span class="workspace-badge">${esc(order.status)}</span></header>
        <p class="prep-meta">${esc(order.customer)}<br>${esc(date(order.createdAt))}</p>
        ${order.orderType==="Online" ? `<dl class="prep-contact"><div><dt>Address:</dt><dd>${esc(order.address||"Not provided")}</dd></div><div><dt>Phone No.:</dt><dd>${esc(order.phone||"Not provided")}</dd></div></dl>` : ""}
        <ul>${order.items.map(item=>`<li><strong>${item.quantity} × ${esc(item.name)}</strong><small>${esc(Object.entries(item.options).filter(([,value])=>value).map(([key,value])=>key+": "+value).join(" · "))}</small></li>`).join("")}</ul>
        <footer><button type="button" class="workspace-btn" data-order="${order.id}" data-next="${next}" ${blocked||pending.has(order.id)?"disabled":""}>${blocked?"Waiting for payment verification":pending.has(order.id)?"Updating…":label}</button>
        ${blocked?"<p>Ask the administrator to verify this GCash payment.</p>":""}</footer></article>`;
    }).join("");
    document.getElementById("queueEmpty").hidden=filtered.length>0;
  }
  const render=stockPage?renderStock:renderQueue;
  async function load(force=false) {
    if((loading||updating||statusDialog?.open)&&!force)return;
    const current=++version;loading=true;refresh.disabled=true;
    try {
      const data=await KopiApi.request(stockPage?"/workforce/stock":"/workforce/preparation");
      if(current!==version)return;
      rows=stockPage?data.items:data.orders;render();
      KopiNotice.set(message,"Updated just now.","success");
    } catch(error) {
      if(current===version)KopiNotice.set(message,error.message+" Use Refresh to try again.","error");
      if(error.status===401)window.location.replace("../login.html");
    } finally {if(current===version){loading=false;refresh.disabled=false;}}
  }
  search.addEventListener("input",render);
  refresh.addEventListener("click",()=>load());
  if(stockPage)document.getElementById("stockStatus").addEventListener("change",render);
  else {
    document.getElementById("queueType").addEventListener("change",render);
    document.querySelectorAll("[data-status]").forEach(button=>button.addEventListener("click",()=>{
      status=button.dataset.status;
      document.querySelectorAll("[data-status]").forEach(other=>{const active=other===button;other.classList.toggle("active",active);other.setAttribute("aria-pressed",String(active));});render();
    }));
    document.getElementById("preparationQueue").addEventListener("click",async event=>{
      const button=event.target.closest("[data-order]");if(!button||updating||button.disabled)return;
      const id=Number(button.dataset.order),next=button.dataset.next;
      const order=rows.find(row=>row.id===id);if(!order)return;
      if(next==="Out for Delivery") {openDeliveryDialog(order);return;}
      const question=next==="Preparing"?"Start preparing this order? Ingredients will be treated as consumed."
        :next==="Completed"?(order.orderType==="Online"?"Has the rider delivered the complete order to the customer? Confirm only after delivery has been verified.":"Confirm this in-store order has been prepared and served?")
        :"Confirm this order has been handed to the rider for delivery?";
      if(!await confirmStatus(order,question))return;
      updating=true;version++;pending.add(id);render();
      try {
        await KopiApi.request("/workforce/preparation/"+id+"/status",{method:"PATCH",body:JSON.stringify({status:next,...(order.orderType==="Online"&&next==="Completed"?{deliveryConfirmed:true}:{})})});
        KopiNotice.toast(order.orderNumber+" — "+next,"success");
      } catch(error) {KopiNotice.toast(error.message,"error");}
      finally {updating=false;pending.delete(id);await load(true);refresh.focus();}
    });
    const closeDelivery=()=>{if(!deliverySaving)deliveryDialog.close();};
    document.getElementById("closeDeliveryDialog").addEventListener("click",closeDelivery);
    document.getElementById("cancelDelivery").addEventListener("click",closeDelivery);
    deliveryDialog.addEventListener("cancel",event=>{if(deliverySaving)event.preventDefault();});
    document.getElementById("riderTrackingLink").addEventListener("input",event=>event.target.setCustomValidity(""));
    document.getElementById("useDemoTrackingLink").addEventListener("click",()=>{
      const link=document.getElementById("riderTrackingLink");
      link.value="https://share.lalamove.com/?demo=kopi-calamba";
      link.setCustomValidity("");
      link.focus();
    });
    document.getElementById("deliveryForm").addEventListener("submit",async event=>{
      event.preventDefault();
      if(!deliveryOrder||deliverySaving)return;
      const fee=Number(document.getElementById("riderFee").value);
      const trackingUrl=KopiDeliveryInfo.trackingUrl(document.getElementById("riderTrackingLink").value);
      document.getElementById("riderTrackingLink").setCustomValidity(trackingUrl?"":"Paste a valid HTTPS Lalamove live tracking/share link.");
      if(!event.currentTarget.reportValidity())return;
      deliverySaving=true;event.currentTarget.querySelector("fieldset")?.setAttribute("disabled","");
      const submit=event.currentTarget.querySelector('[type="submit"]');submit.disabled=true;
      try {
        await KopiApi.request(`/workforce/preparation/${deliveryOrder.id}/delivery`,{method:"PUT",body:JSON.stringify({fee,trackingUrl,revision:deliveryOrder.deliveryRevision||0})});
        await KopiApi.request(`/workforce/preparation/${deliveryOrder.id}/status`,{method:"PATCH",body:JSON.stringify({status:"Out for Delivery"})});
        deliveryDialog.close();KopiNotice.toast(deliveryOrder.orderNumber+" — delivery details sent.","success");
        await load(true);
      } catch(error) {KopiNotice.set(document.getElementById("deliveryFormStatus"),error.message,"error");}
      finally {deliverySaving=false;submit.disabled=false;}
    });
  }
  setInterval(()=>{if(document.visibilityState==="visible")load();},15000);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")load();});
  load();
})();
