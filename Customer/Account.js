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
  profile: { desktop: "Profile", mobile: "My Account" },
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

async function loadProfile() {
  try {
    const data = await KopiApi.request("/me");
    const user = data.user;

    if (profileForm?.elements.firstName) {
      profileForm.elements.firstName.value = user.firstName || "";
      profileForm.elements.lastName.value = user.lastName || "";
      profileForm.elements.email.value = user.email || "";
      profileForm.elements.phone.value = user.phone || "";
      KopiProfile.avatar(document.getElementById("profileAvatar"),user.avatar);
    }
  } catch (error) {
    document.getElementById("profileStatus").textContent = error.message;
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

    target.innerHTML = data.orders.map(order => `
      <article class="order-card">
        <div class="order-meta">
          <h2 class="order-id">${escapeHtml(order.orderNumber)}</h2>
          <div class="order-date">
            <span>${new Date(order.createdAt.includes("T") ? order.createdAt : order.createdAt.replace(" ","T")+"Z").toLocaleString("en-PH",{timeZone:"Asia/Manila"})}</span>
            <span>${escapeHtml(order.orderType)}</span>
          </div>
        </div>

        <div class="order-card-heading">
          Order Status: ${escapeHtml(order.status)}
        </div>

        <p>Total: ₱${Number(order.total || 0).toFixed(2)}</p>
        ${order.payment === "GCash" ? `
          <p>Payment: GCash — ${escapeHtml(order.paymentStatus || "Pending verification")}</p>
          <p>Reference: ${escapeHtml(order.paymentReference || "Not provided")}</p>
          ${order.status === "Canceled" ? "<p>If you already sent payment, contact the shop about a refund. Canceling an order does not automatically refund GCash.</p>" : ""}
        ` : ""}

        <div class="order-actions">
          ${["New", "Preparing"].includes(order.status)
            ? `<button class="outline-btn cancel-order-btn" type="button" data-order-id="${order.id}">Cancel Order</button>`
            : ""}
        </div>
      </article>
    `).join("");

    target.querySelectorAll("[data-order-id]").forEach(button => {
      button.addEventListener("click", async () => {
        if (!window.confirm("Cancel this order? If preparation has started, ingredients remain deducted. Contact the shop for any GCash refund.")) return;
        button.disabled = true;
        try {
          await KopiApi.request(
            `/orders/${button.dataset.orderId}/cancel`,
            { method: "PATCH" }
          );

          await loadMyOrders();
        } catch (error) {
          alert(error.message);
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
    catch { alert("Signed out in this browser. The server could not revoke other sessions; reconnect and sign out again if needed."); }

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
  }catch(error){status.textContent=error.message;}
  finally{button.disabled=false;}
});
document.getElementById("editEmail").addEventListener("click",()=>{
  profileForm.elements.email.readOnly=false;profileForm.elements.email.focus();
  document.getElementById("profileStatus").textContent="Enter your current password, then Save changes, to update your email.";
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
  }catch(error){document.getElementById("profileStatus").textContent=error.message;}
  finally{button.disabled=false;photoInput.value="";}
});
document.getElementById("removePhoto").addEventListener("click",async event=>{
  const button=event.currentTarget;button.disabled=true;
  try {
    const result=await KopiApi.request("/me/avatar",{method:"DELETE"});
    KopiProfile.avatar(document.getElementById("profileAvatar"),null);
    document.getElementById("profileStatus").textContent=result.message;
  }catch(error){document.getElementById("profileStatus").textContent=error.message;}
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
    alert("Please complete the rating and every feedback field.");
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

    alert(data.message);
    feedbackForm.reset();
    selectedRating = 0;
    document.getElementById("ratingText").textContent="Click a star to rate";

    document.querySelectorAll(".star").forEach(star => {
      star.textContent = "☆";
      star.classList.remove("selected");
    });
  } catch (error) {
    alert(error.message);
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
