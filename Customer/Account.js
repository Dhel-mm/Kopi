const logoutBtn = document.querySelector(".logout-btn");
const logoutToast = document.getElementById("logoutToast");
const sidebarToggle = document.querySelector(".sidebar-toggle");
const accountSidebar = document.querySelector(".account-sidebar");
const menuItems = document.querySelectorAll(".menu-item");
const panels = document.querySelectorAll(".account-panel");
const desktopTitle = document.querySelector(".desktop-title");
const mobileTitle = document.querySelector(".mobile-title");
const profileForm = document.getElementById("profileForm");
const feedbackForm = document.getElementById("feedbackForm");

const panelTitles = {
  profile: { desktop: "My Account", mobile: "My Account" },
  orders: { desktop: "My Orders", mobile: "My Orders" },
  feedback: { desktop: "Feedback", mobile: "Feedback" },
  about: { desktop: "About Kopi;", mobile: "About Kopi;" }
};

function showPanel(panelId) {
  const target = document.getElementById(panelId);
  if (!target) return;

  panels.forEach(panel => {
    panel.hidden = panel !== target;
  });

  menuItems.forEach(item => {
    item.classList.toggle(
      "selected",
      item.getAttribute("href") === `#${panelId}`
    );
  });

  if (panelTitles[panelId]) {
    desktopTitle.textContent = panelTitles[panelId].desktop;
    mobileTitle.textContent = panelTitles[panelId].mobile;
  }
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

function showProfileName(user) {
  const heading = document.getElementById("profileFullName");
  if (heading) heading.textContent = [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ") || "Your account";
}

async function loadProfile() {
  try {
    const data = await KopiApi.request("/me");
    const user = data.user;
    showProfileName(user);

    if (profileForm?.elements.firstName) {
      profileForm.elements.firstName.value = user.firstName || "";
      profileForm.elements.lastName.value = user.lastName || "";
      profileForm.elements.email.value = user.email || "";
      profileForm.elements.phone.value = user.phone || "";
      KopiProfile.avatar(document.getElementById("profileAvatar"),user.avatar);
    }
  } catch (error) {
    KopiNotice.set(document.getElementById("profileStatus"),error.message,"error");
    if(error.status===401) window.location.replace("../login.html");
  }
}

async function loadMyOrders() {
  const target = document.getElementById("customerOrders");

  if (!target) return;

  try {
    const data = await KopiApi.request("/orders/my");

    if (!data.orders.length) {
      target.innerHTML = `
        <p class="order-card-heading">
          You have no orders yet. Browse the Menu to place one.
        </p>
      `;
      return;
    }

    target.innerHTML = data.orders.map(order => {
      const trackingLink = !["Canceled", "Completed"].includes(order.status) && order.orderType === "Online" && order.trackingUrl
        ? KopiDeliveryInfo.trackingUrl(order.trackingUrl) : null;
      const hasRiderFee = order.status !== "Canceled" && order.orderType === "Online" && order.deliveryRevision > 0 &&
        typeof order.riderFee === "number" && Number.isFinite(order.riderFee);
      return `
      <article class="order-card">
        <div class="order-meta">
          <h2 class="order-id">${escapeHtml(order.orderNumber)}</h2>
          <div class="order-date">
            <span>${new Date(order.createdAt.includes("T") ? order.createdAt : order.createdAt.replace(" ","T")+"Z").toLocaleString("en-PH",{timeZone:"Asia/Manila"})}</span>
            <span>${escapeHtml(order.orderType)}</span>
          </div>
        </div>

        <div class="order-summary">
          <span class="order-status" data-status="${escapeHtml(order.status)}">${escapeHtml(order.status)}</span>
          <div class="order-amounts">
            <div class="order-total"><span>Order total</span><strong>₱${Number(order.total || 0).toFixed(2)}</strong></div>
            ${hasRiderFee ? `<div class="order-total order-rider-fee"><span>Lalamove Delivery Fee</span><strong>₱${order.riderFee.toFixed(2)}</strong><small>Pay directly to the rider · not included in order total</small></div>` : ""}
          </div>
        </div>
        ${order.payment === "GCash" ? `
          <div class="order-payment"><p><img class="gcash-logo" src="HomePic/gcash.png" alt="" width="26" height="26">Payment: GCash — ${escapeHtml(order.paymentStatus || "Pending verification")}</p>
          <p>Reference: ${escapeHtml(order.paymentReference || "Not provided")}</p>
          ${order.status === "Canceled" ? `<p class="order-cancellation-reason">${escapeHtml(order.cancellationReason || "If you already sent payment, contact the shop about a refund. Canceling an order does not automatically refund GCash.")}</p>` : ""}
          </div>
        ` : ""}

        <div class="order-actions">
          ${trackingLink ? `<a class="outline-btn track-order-btn" href="${escapeHtml(trackingLink)}" target="_blank" rel="noopener noreferrer">Track</a>` : ""}
          ${order.status === "New"
            ? `<button class="outline-btn cancel-order-btn" type="button" data-order-id="${order.id}">Cancel Order</button>`
            : order.status === "Preparing" ? `<span class="order-cancel-note">Being prepared. To cancel, please contact the shop.</span>` : ""}
        </div>
      </article>
    `; }).join("");

    target.querySelectorAll("[data-order-id]").forEach(button => {
      button.addEventListener("click", async () => {
        const order = data.orders.find(entry => String(entry.id) === button.dataset.orderId);
        if (!order || !await confirmOrderCancellation(order)) return;
        button.disabled = true;
        try {
          await KopiApi.request(
            `/orders/${button.dataset.orderId}/cancel`,
            { method: "PATCH" }
          );

          await loadMyOrders();
        } catch (error) {
          KopiNotice.toast(error.message, "error");
          button.disabled = false;
        }
      });
    });
  } catch (error) {
    target.innerHTML = `<p class="order-card-heading">${escapeHtml(error.message)}</p>`;
  }
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async event => {
    event.preventDefault();

    try { await KopiApi.logout(); }
    catch { KopiNotice.toast("Signed out in this browser. The server could not revoke other sessions; reconnect and sign out again if needed."); }

    if (logoutToast) {
      logoutToast.classList.add("show");

      setTimeout(() => {
        window.location.href = "../login.html";
      }, 800);
    } else {
      window.location.href = "../login.html";
    }
  });
}

window.addEventListener("kopi:delivery-updated", () => {
  if (!document.getElementById("orders")?.hidden) loadMyOrders();
});

sidebarToggle?.addEventListener("click", () => {
  const isOpen = accountSidebar.classList.toggle("is-open");
  sidebarToggle.setAttribute("aria-expanded", String(isOpen));
});

menuItems.forEach(item => {
  item.addEventListener("click", event => {
    event.preventDefault();

    const panelId = item.getAttribute("href").slice(1);
    showPanel(panelId);
    history.replaceState(null, "", `#${panelId}`);

    accountSidebar.classList.remove("is-open");
    sidebarToggle?.setAttribute("aria-expanded", "false");

    if (panelId === "orders") {
      loadMyOrders();
    }
  });
});

profileForm?.addEventListener("submit",async event=>{
  event.preventDefault();
  const button=profileForm.querySelector('[type="submit"]'),status=document.getElementById("profileStatus");
  button.disabled=true;
  try {
    const result=await KopiProfile.save(profileForm);
    status.textContent=result.message;
    profileForm.elements.email.readOnly=true;
    profileForm.elements.phone.readOnly=true;
    if (result.user) showProfileName(result.user);
  }catch(error){KopiNotice.set(status,error.message,"error");}
  finally{button.disabled=false;}
});
document.getElementById("editEmail").addEventListener("click",()=>{
  profileForm.elements.email.readOnly=false;profileForm.elements.email.focus();
  document.getElementById("profileStatus").textContent="Enter your current password, then Save changes, to update your email.";
});
document.getElementById("editPhone")?.addEventListener("click",()=>{
  profileForm.elements.phone.readOnly=false;
  profileForm.elements.phone.focus();
  KopiNotice.set(document.getElementById("profileStatus"),"Enter your 11-digit phone number, then click Save changes.","info");
});
const photoInput=document.getElementById("profilePhotoFile");
document.getElementById("uploadPhoto").addEventListener("click",()=>photoInput.click());
photoInput.addEventListener("change",async()=>{
  if(!photoInput.files.length)return;
  const button=document.getElementById("uploadPhoto");button.disabled=true;
  try {
    const result=await KopiProfile.upload(photoInput.files[0]);
    KopiProfile.avatar(document.getElementById("profileAvatar"),result.avatar);
    document.getElementById("profileStatus").textContent=result.message;
  }catch(error){KopiNotice.set(document.getElementById("profileStatus"),error.message,"error");}
  finally{button.disabled=false;photoInput.value="";}
});
document.getElementById("removePhoto").addEventListener("click",async event=>{
  const button=event.currentTarget;button.disabled=true;
  try {
    const result=await KopiApi.request("/me/avatar",{method:"DELETE"});
    KopiProfile.avatar(document.getElementById("profileAvatar"),null);
    document.getElementById("profileStatus").textContent=result.message;
  }catch(error){KopiNotice.set(document.getElementById("profileStatus"),error.message,"error");}
  finally{button.disabled=false;}
});

let selectedRating = 0;

document.querySelectorAll(".star").forEach(star => {
  star.addEventListener("click", () => {
    selectedRating = Number(star.dataset.rating);

    document.querySelectorAll(".star").forEach(item => {
      const active = Number(item.dataset.rating) <= selectedRating;
      item.textContent = active ? "★" : "☆";
      item.classList.toggle("selected", active);
    });

    const ratingText = document.getElementById("ratingText");
    if (ratingText) ratingText.textContent = `${selectedRating} / 5`;
  });
});

feedbackForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const submitButton = feedbackForm.querySelector('[type="submit"]');
  if (submitButton.disabled) return;

  const improveComment = document.getElementById("improve").value.trim();
  const likedComment = document.getElementById("love").value.trim();
  const visitFrequency = document.getElementById("visit").value.trim();
  const additionalComment = document.getElementById("comments").value.trim();

  if (!selectedRating || !improveComment || !likedComment || !visitFrequency) {
    KopiNotice.toast("Please complete the rating and every feedback field.");
    return;
  }

  submitButton.disabled = true;
  try {
    const data = await KopiApi.request("/feedback", {
      method: "POST",
      body: JSON.stringify({
        rating: selectedRating,
        improveComment,
        likedComment,
        visitFrequency,
        additionalComment
      })
    });

    KopiNotice.toast(data.message);
    feedbackForm.reset();
    selectedRating = 0;
    document.getElementById("ratingText").textContent="Click a star to rate";

    document.querySelectorAll(".star").forEach(star => {
      star.textContent = "☆";
      star.classList.remove("selected");
    });
  } catch (error) {
    KopiNotice.toast(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

const initialPanel = window.location.hash
  ? window.location.hash.slice(1)
  : "profile";

showPanel(initialPanel);
loadProfile();
loadMyOrders();

window.addEventListener("focus", () => {
  // Do not replace unsaved profile fields when returning from another window.
  if (!document.getElementById("orders").hidden) loadMyOrders();
});


setInterval(()=>{if(!document.hidden&&!document.getElementById("orders").hidden)loadMyOrders();},30000);
function confirmOrderCancellation(order) {
  if (document.getElementById("cancelOrderDialog")) return Promise.resolve(false);
  return new Promise(resolve => {
    const previousFocus = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.id = "cancelOrderDialog";
    dialog.className = "cancel-order-dialog";
    dialog.setAttribute("aria-labelledby", "cancelOrderTitle");
    dialog.setAttribute("aria-describedby", "cancelOrderMessage");
    const title = document.createElement("h2");
    title.id = "cancelOrderTitle";
    title.textContent = "Cancel order";
    const message = document.createElement("p");
    message.id = "cancelOrderMessage";
    message.textContent = "Cancel this order? You can cancel only before the shop starts preparing it.";
    if (order.payment === "GCash") {
      const contact = document.createElement("a");
      contact.href = "https://www.facebook.com/kopiest2021";
      contact.target = "_blank";
      contact.rel = "noopener noreferrer";
      contact.textContent = "Contact the shop";
      message.append(" ", contact, " for any GCash refund.");
    }
    const actions = document.createElement("div");
    actions.className = "cancel-dialog-actions";
    const keep = document.createElement("button");
    keep.type = "button";
    keep.className = "keep-order-btn";
    keep.textContent = "Keep order";
    keep.addEventListener("click", () => dialog.close("keep"));
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "confirm-cancel-btn";
    confirm.textContent = "Yes, cancel order";
    confirm.addEventListener("click", () => dialog.close("confirm"));
    actions.append(keep, confirm);
    dialog.append(title, message, actions);
    dialog.addEventListener("close", () => {
      const confirmed = dialog.returnValue === "confirm";
      dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(confirmed);
    }, {once: true});
    document.body.append(dialog);
    dialog.showModal();
    keep.focus();
  });
}
