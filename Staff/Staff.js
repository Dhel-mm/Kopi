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
      const callFirst=next==="Preparing"&&order.needsPhoneConfirmation;
      const label=delivering?"Confirm delivery & complete":callFirst?"Called customer · start preparing":next==="Preparing"?"Start preparing":next==="Completed"?"Mark as completed":"Hand over for delivery";
      const canReject=order.orderType==="Online"&&order.status==="New";
      // Online Senior Citizen / PWD discount: check the uploaded ID photo first.
      const idPending=order.specialDiscountType&&order.specialDiscountStatus==="Pending verification"&&order.status!=="Canceled";
      const discountBox=order.specialDiscountType?`<section class="prep-discount${idPending?" pending":order.specialDiscountStatus==="Not approved"?" not-approved":""}" aria-label="Senior Citizen / PWD discount">
          <div class="prep-discount-head"><strong><i class="bi bi-person-vcard" aria-hidden="true"></i> ${esc(order.specialDiscountType)} discount</strong>${KopiOrderReview.idStatusHtml(order)}</div>
          <p>${esc(order.specialDiscountName)} · ID ${esc(order.specialDiscountId)}${order.orderType!=="Online"?" — checked at the counter.":idPending?" — open the ID photo and compare the name and ID number before preparing.":order.specialDiscountStatus==="Not approved"?` — discount removed (${money(order.discountRemoved)}). Normal price: ${money(order.total)}.${order.balanceDue?` Rider collects ${money(order.balanceDue)} in cash.`:""}`:" — rider must check this ID on delivery."}</p>
          <div class="review-actions">${order.hasIdProof?`<button type="button" class="review-link-btn" data-view-id="${order.id}"><i class="bi bi-person-vcard" aria-hidden="true"></i> View ID</button>`:""}${idPending?`<button type="button" class="review-link-btn verify" data-verify-id="${order.id}" ${pending.has(order.id)?"disabled":""}><i class="bi bi-patch-check" aria-hidden="true"></i> ID is valid</button><button type="button" class="review-link-btn danger" data-reject-id="${order.id}" ${pending.has(order.id)?"disabled":""}><i class="bi bi-x-octagon" aria-hidden="true"></i> Not approved</button>`:""}</div>
        </section>`:"";
      const review=order.hasPaymentProof||canReject?`<div class="review-actions">${order.hasPaymentProof?`<button type="button" class="review-link-btn" data-proof="${order.id}"><i class="bi bi-image" aria-hidden="true"></i> GCash screenshot</button>`:""}${canReject?`<button type="button" class="review-link-btn danger" data-reject="${order.id}"><i class="bi bi-x-octagon" aria-hidden="true"></i> Reject order</button>`:""}</div>`:"";
      return `<article class="prep-card"><header><div><h2>${esc(order.orderNumber)}</h2><span class="workspace-badge neutral">${esc(order.orderType)} · ${esc(order.serviceType)}</span></div><span class="workspace-badge">${esc(order.status)}</span></header>
        <p class="prep-meta">${esc(order.customer)}<br>${esc(date(order.createdAt))}${order.orderType==="Online"?`<span class="prep-meta-contact"><strong>Address:</strong> <b class="prep-meta-value">${esc(order.address||"Not provided")}</b></span><span class="prep-meta-contact"><strong>Phone No.:</strong> <b class="prep-meta-value">${esc(order.phone||"Not provided")}</b></span>`:""}</p>
        ${KopiOrderReview.flagsHtml(order)}${blocked?KopiOrderReview.waitHtml(order):""}
        ${callFirst?`<p class="payment-wait overdue"><i class="bi bi-telephone-outbound" aria-hidden="true"></i> Flagged cash order. Call or text ${esc(order.phone||"the customer")} to confirm the order and address before preparing. If you cannot reach them, reject the order.</p>`:""}
        ${discountBox}
        <ul>${order.items.map(item=>`<li><strong>${item.quantity} × ${esc(item.name)}</strong><small>${esc(Object.entries(item.options).filter(([,value])=>value).map(([key,value])=>key+": "+value).join(" · "))}</small></li>`).join("")}</ul>
        <footer>${blocked
          ? `<p>GCash reference <strong class="key-value">${esc(order.paymentReference||"not provided")}</strong> · ${money(order.gcashAmount??order.total)}. Check the shop's GCash account before confirming.</p>
        <button type="button" class="workspace-btn" data-verify="${order.id}" ${pending.has(order.id)?"disabled":""}>${pending.has(order.id)?"Updating…":"Confirm GCash received"}</button>`
          : idPending ? `<button type="button" class="workspace-btn" disabled>Verify the ID first</button>
        <p>Check the ${esc(order.specialDiscountType)} ID photo above before preparing this discounted order.</p>`
          : `<button type="button" class="workspace-btn" data-order="${order.id}" data-next="${next}" ${callFirst?'data-call-first="true"':""} ${pending.has(order.id)?"disabled":""}>${pending.has(order.id)?"Updating…":label}</button>`}${review}</footer></article>`;
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
      const proofButton=event.target.closest("[data-proof]");
      if(proofButton) {
        const order=rows.find(row=>row.id===Number(proofButton.dataset.proof));
        if(order) KopiOrderReview.showProof("/workforce/preparation/"+order.id+"/payment-proof",order.orderNumber);
        return;
      }
      const viewIdButton=event.target.closest("[data-view-id]");
      if(viewIdButton) {
        const order=rows.find(row=>row.id===Number(viewIdButton.dataset.viewId));
        if(order) KopiOrderReview.showProof("/workforce/preparation/"+order.id+"/id-proof",order.orderNumber,"id");
        return;
      }
      const idButton=event.target.closest("[data-verify-id],[data-reject-id]");
      if(idButton) {
        if(updating||idButton.disabled)return;
        const valid=idButton.hasAttribute("data-verify-id");
        const id=Number(valid?idButton.dataset.verifyId:idButton.dataset.rejectId);
        const order=rows.find(row=>row.id===id);if(!order)return;
        let body;
        if(valid) {
          const question=`Did you open the ID photo and check that it is a valid ${order.specialDiscountType} ID for ${order.specialDiscountName} with number ${order.specialDiscountId}? Confirm only if they match.`;
          if(!await confirmStatus(order,question))return;
          body={confirmedValid:true};
        } else {
          body=await KopiOrderReview.notApproveDialog(order);
          if(!body)return;
        }
        updating=true;version++;pending.add(id);render();
        try {
          const result=await KopiApi.request("/workforce/preparation/"+id+"/"+(valid?"verify-id":"not-approve-id"),{method:"PATCH",body:JSON.stringify(body)});
          KopiNotice.toast(order.orderNumber+" — "+result.message,"success");
        } catch(error) {KopiNotice.toast(error.message,"error");}
        finally {updating=false;pending.delete(id);await load(true);refresh.focus();}
        return;
      }
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
      const verifyButton=event.target.closest("[data-verify]");
      if(verifyButton) {
        if(updating||verifyButton.disabled)return;
        const id=Number(verifyButton.dataset.verify);
        const order=rows.find(row=>row.id===id);if(!order)return;
        const question=["Open the shop's GCash account. Confirm only if you can see reference number ",{key:order.paymentReference||"(none)"}," for exactly ",{key:money(order.gcashAmount??order.total)},". Has this payment been received?"];
        if(!await confirmStatus(order,question))return;
        updating=true;version++;pending.add(id);render();
        try {
          await KopiApi.request("/workforce/preparation/"+id+"/verify-payment",{method:"PATCH",body:JSON.stringify({confirmedReceived:true})});
          KopiNotice.toast(order.orderNumber+" — GCash payment confirmed","success");
        } catch(error) {KopiNotice.toast(error.message,"error");}
        finally {updating=false;pending.delete(id);await load(true);refresh.focus();}
        return;
      }
      const button=event.target.closest("[data-order]");if(!button||updating||button.disabled)return;
      const id=Number(button.dataset.order),next=button.dataset.next;
      const order=rows.find(row=>row.id===id);if(!order)return;
      if(next==="Out for Delivery") {openDeliveryDialog(order);return;}
      const callFirst=button.dataset.callFirst==="true";
      const question=callFirst?`This cash order is flagged (${(order.riskFlags||[]).map(flag=>flag.label).join(", ")}). Have you called or texted ${order.phone||"the customer"} and confirmed the order and delivery address? Start preparing only if they confirmed.`
        :next==="Preparing"?"Start preparing this order? Ingredients will be treated as consumed."
        :next==="Completed"?(order.orderType==="Online"?"Has the rider delivered the complete order to the customer? Confirm only after delivery has been verified.":"Confirm this in-store order has been prepared and served?")
        :"Confirm this order has been handed to the rider for delivery?";
      if(!await confirmStatus(order,question))return;
      updating=true;version++;pending.add(id);render();
      try {
        await KopiApi.request("/workforce/preparation/"+id+"/status",{method:"PATCH",body:JSON.stringify({status:next,...(order.orderType==="Online"&&next==="Completed"?{deliveryConfirmed:true}:{}),...(callFirst?{customerConfirmed:true}:{})})});
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
