(async () => {
  "use strict";
  const user=await KopiWorkplace.ready;
  if(!user)return;
  const {escape:esc,date,money}=KopiWorkplace;
  // When the customer or rider collects an online order; empty means priority.
  const handover=(iso,pickup)=>iso?new Date(iso).toLocaleString("en-PH",{timeZone:"Asia/Manila",weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):pickup?"Priority Pickup":"Priority Delivery";
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
    // question may be text or parts with highlighted values (see OrderReview.js).
    document.getElementById("statusDialogMessage").replaceChildren(KopiOrderReview.highlightedText([order.orderNumber+" — "].concat(question)));
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
    // Ingredients that need attention come first, so low stock is seen right away.
    const urgency={"Out of Stock":0,"Low Stock":1,"In Stock":2};
    const filtered=rows.filter(item=>(!selected||item.status===selected)
      && `${item.productName} ${item.category}`.toLowerCase().includes(term))
      .sort((a,b)=>urgency[a.status]-urgency[b.status]);
    const quantityText=(value,item)=>`${Number(value).toLocaleString("en-PH",{maximumFractionDigits:3})} ${esc(item.measurement)}`;
    document.getElementById("stockRows").innerHTML=filtered.map(item=>`<tr><td>${esc(item.productName)}</td><td>${esc(item.category)}</td><td>${quantityText(item.quantity,item)}</td><td>${quantityText(item.reorderLevel,item)}</td><td><span class="workspace-badge ${item.status==="In Stock"?"good":item.status==="Out of Stock"?"danger":""}">${esc(item.status)}</span></td></tr>`).join("");
    document.getElementById("stockEmpty").hidden=filtered.length>0;
    const countOf=status=>rows.filter(item=>item.status===status).length;
    document.getElementById("stockLowCount").textContent=countOf("Low Stock");
    document.getElementById("stockOutCount").textContent=countOf("Out of Stock");
    document.getElementById("stockTotalCount").textContent=rows.length;
  }
  function renderQueue() {
    const term=search.value.trim().toLowerCase();
    const type=document.getElementById("queueType").value;
    document.getElementById("newCount").textContent=rows.filter(order=>order.status==="New").length;
    document.getElementById("preparingCount").textContent=rows.filter(order=>order.status==="Preparing").length;
    document.getElementById("itemCount").textContent=rows.reduce((sum,order)=>sum+order.items.reduce((n,item)=>n+item.quantity,0),0);
    const filtered=rows.filter(order=>(!status||order.status===status)&&(!type||(type==="Pickup"?order.serviceType==="Pickup":order.orderType===type))
      && `${order.orderNumber} ${order.customer} ${order.items.map(item=>item.name).join(" ")}`.toLowerCase().includes(term));
    document.getElementById("preparationQueue").innerHTML=filtered.map(order=>{
      const blocked=order.payment==="GCash"&&order.paymentStatus!=="Verified";
      // Online pickup: New -> Preparing -> Ready for Pickup -> Completed (picked up and paid).
      const pickup=order.orderType==="Online"&&order.serviceType==="Pickup";
      const delivering=order.orderType==="Online"&&!pickup&&["Out for Delivery","Arrived"].includes(order.status);
      const collecting=pickup&&order.status==="Ready for Pickup";
      const next=order.status==="New"?"Preparing":order.orderType==="In-store"||delivering||collecting?"Completed":pickup?"Ready for Pickup":"Out for Delivery";
      const callFirst=next==="Preparing"&&order.needsPhoneConfirmation;
      const label=delivering?"Confirm delivery & complete":collecting?"Picked up & paid · complete":callFirst?"Called customer · start preparing":next==="Preparing"?"Start preparing":next==="Ready for Pickup"?"Mark ready for pickup":next==="Completed"?"Mark as completed":"Hand over for delivery";
      // What the customer still pays at the counter when they collect a pickup order.
      const dueAtCounter=order.payment==="GCash"?(order.balanceDue||0):order.total;
      const canReject=order.orderType==="Online"&&order.status==="New";
      // Online Senior Citizen / PWD discount: the Cashier checks the uploaded ID photo first.
      const idPending=order.specialDiscountType&&order.specialDiscountStatus==="Pending verification"&&order.status!=="Canceled";
      const discountBox=order.specialDiscountType?`<section class="prep-discount${idPending?" pending":order.specialDiscountStatus==="Not approved"?" not-approved":""}" aria-label="Senior Citizen / PWD discount">
          <div class="prep-discount-head"><strong><i class="bi bi-person-vcard" aria-hidden="true"></i> ${esc(order.specialDiscountType)} discount</strong>${KopiOrderReview.idStatusHtml(order)}</div>
          <p>${esc(order.specialDiscountName)} · ID ${esc(order.specialDiscountId)}${order.orderType!=="Online"?" — checked at the counter.":idPending?" — waiting for the cashier to verify this ID.":order.specialDiscountStatus==="Not approved"?` — discount removed (${money(order.discountRemoved)}). Normal price: ${money(order.total)}.${order.balanceDue?(pickup?` Collect ${money(order.balanceDue)} in cash at the counter.`:` Rider collects ${money(order.balanceDue)} in cash.`):""}`:pickup?" — check this ID at the counter when the customer picks up.":" — rider must check this ID on delivery."}</p>
        </section>`:"";
      const review=canReject?`<div class="review-actions"><button type="button" class="review-link-btn danger" data-reject="${order.id}"><i class="bi bi-x-octagon" aria-hidden="true"></i> Reject order</button></div>`:"";
      return `<article class="prep-card"><header><div><h2>${esc(order.orderNumber)}</h2><span class="workspace-badge neutral">${esc(order.orderType)} · ${esc(order.serviceType)}</span></div><span class="workspace-badge">${esc(order.status)}</span></header>
        <p class="prep-meta">${esc(order.customer)}<br>${esc(date(order.createdAt))}${order.orderType==="Online"?`<span class="prep-meta-contact"><strong>${pickup?"Pickup time":"Rider pickup"}:</strong> <b class="prep-meta-value">${esc(handover(order.scheduledFor,pickup))}</b></span>`:""}${order.orderType==="Online"?`<span class="prep-meta-contact">${pickup?`<strong>Pickup:</strong> <b class="prep-meta-value">Customer collects at the store</b>`:`<strong>Address:</strong> <b class="prep-meta-value">${esc(order.address||"Not provided")}</b>`}</span><span class="prep-meta-contact"><strong>Phone No.:</strong> <b class="prep-meta-value">${esc(order.phone||"Not provided")}</b></span>`:""}</p>
        ${KopiOrderReview.flagsHtml(order)}${blocked?KopiOrderReview.waitHtml(order):""}
        ${callFirst?`<p class="payment-wait overdue"><i class="bi bi-telephone-outbound" aria-hidden="true"></i> Flagged cash order. Call or text ${esc(order.phone||"the customer")} to confirm the order${pickup?" and that they will pick it up":" and address"} before preparing. If you cannot reach them, reject the order.</p>`:""}
        ${discountBox}
        <ul>${order.items.map(item=>`<li><strong>${item.quantity} × ${esc(item.name)}</strong><small>${esc(Object.entries(item.options).filter(([,value])=>value).map(([key,value])=>key+": "+value).join(" · "))}</small></li>`).join("")}</ul>
        <footer>${blocked
          ? `<button type="button" class="workspace-btn" disabled>Waiting for the cashier</button>
        <p>The cashier verifies this GCash payment of ${money(order.gcashAmount??order.total)}. You can start preparing after that.</p>`
          : idPending ? `<button type="button" class="workspace-btn" disabled>Waiting for the cashier</button>
        <p>The cashier verifies the ${esc(order.specialDiscountType)} ID. You can start preparing after that.</p>`
          : `${collecting?`<p class="pickup-collect">${dueAtCounter>0?`Collect <strong class="key-value">${money(dueAtCounter)}</strong> at the counter, then hand over the order.`:"Paid by GCash. Check the order number, then hand over the order."}</p>`:""}<button type="button" class="workspace-btn" data-order="${order.id}" data-next="${next}" data-pickup="${pickup}" ${callFirst?'data-call-first="true"':""} ${pending.has(order.id)?"disabled":""}>${pending.has(order.id)?"Updating…":label}</button>`}${review}</footer></article>`;
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
      const rejectButton=event.target.closest("[data-reject]");
      if(rejectButton) {
        if(updating)return;
        const id=Number(rejectButton.dataset.reject);
        const order=rows.find(row=>row.id===id);if(!order)return;
        const answer=await KopiOrderReview.rejectDialog(order);
        if(!answer)return;
        updating=true;version++;pending.add(id);render();
        try {
          const result=await KopiApi.request("/workforce/preparation/"+id+"/reject",{method:"PATCH",body:JSON.stringify(answer)});
          KopiNotice.toast(order.orderNumber+" — "+result.message,"success");
        } catch(error) {KopiNotice.toast(error.message,"error");}
        finally {updating=false;pending.delete(id);await load(true);refresh.focus();}
        return;
      }
      const button=event.target.closest("[data-order]");if(!button||updating||button.disabled)return;
      const id=Number(button.dataset.order),next=button.dataset.next;
      const order=rows.find(row=>row.id===id);if(!order)return;
      if(next==="Out for Delivery") {openDeliveryDialog(order);return;}
      const callFirst=button.dataset.callFirst==="true";
      const pickup=order.orderType==="Online"&&order.serviceType==="Pickup";
      const due=order.payment==="GCash"?(order.balanceDue||0):order.total;
      const question=callFirst?`This cash order is flagged (${(order.riskFlags||[]).map(flag=>flag.label).join(", ")}). Have you called or texted ${order.phone||"the customer"} and confirmed the order${pickup?"":" and delivery address"}? Start preparing only if they confirmed.`
        :next==="Preparing"?"Start preparing this order? Ingredients will be treated as consumed."
        :next==="Ready for Pickup"?"Is the complete order packed and ready? The customer will be told to come and pick it up."
        :next==="Completed"&&pickup?["Has the customer picked up the complete order",...(due>0?[" and paid ",{key:money(due)}]:[]),"? Confirm only after you handed it over."]
        :next==="Completed"?(order.orderType==="Online"?"Has the rider delivered the complete order to the customer? Confirm only after delivery has been verified.":"Confirm this in-store order has been prepared and served?")
        :"Confirm this order has been handed to the rider for delivery?";
      if(!await confirmStatus(order,question))return;
      updating=true;version++;pending.add(id);render();
      try {
        await KopiApi.request("/workforce/preparation/"+id+"/status",{method:"PATCH",body:JSON.stringify({status:next,...(order.orderType==="Online"&&next==="Completed"?(pickup?{pickupConfirmed:true}:{deliveryConfirmed:true}):{}),...(callFirst?{customerConfirmed:true}:{})})});
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
