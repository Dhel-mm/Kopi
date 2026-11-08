/* Shared order-review helpers for Admin Operations and the Staff queue:
   risk flags, GCash waiting time, receipt screenshot and Senior Citizen / PWD
   ID photo viewer, and the reject dialogs (panel feedback on fake orders,
   delayed GCash and discount IDs). */
window.KopiOrderReview = (() => {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const reasons = [
    ["unreachable", "Customer cannot be reached by phone"],
    ["address", "Address is incomplete or cannot be found"],
    ["duplicate", "Duplicate order"],
    ["suspicious", "Order looks fake or suspicious"],
    ["other", "Other reason (write a note)"]
  ];

  function flagsHtml(order) {
    const flags = order.riskFlags || [];
    if (!flags.length && !order.customerConfirmedAt) return "";
    const chips = flags.map(flag => `<span class="risk-flag" data-flag="${esc(flag.code)}"><i class="bi bi-flag-fill" aria-hidden="true"></i>${esc(flag.label)}</span>`).join("");
    const confirmed = order.customerConfirmedAt ? `<span class="risk-flag confirmed"><i class="bi bi-telephone-check-fill" aria-hidden="true"></i>Customer confirmed by phone</span>` : "";
    return `<div class="risk-flags" aria-label="Order checks">${chips}${confirmed}</div>`;
  }

  function waitHtml(order) {
    const wait = order.paymentWait;
    if (!wait) return "";
    const minutes = wait.minutes < 60 ? `${wait.minutes} min` : `${Math.floor(wait.minutes / 60)} h ${wait.minutes % 60} min`;
    return wait.overdue
      ? `<p class="payment-wait overdue"><i class="bi bi-hourglass-bottom" aria-hidden="true"></i> GCash not yet confirmed after ${esc(minutes)}. Check the shop's GCash history again, then call the customer at ${esc(order.phone || "their number")}. Do not prepare until the money is received.</p>`
      : `<p class="payment-wait"><i class="bi bi-hourglass-split" aria-hidden="true"></i> Waiting for GCash payment · ${esc(minutes)}. Transfers can be delayed; check again before confirming. Follow up after ${esc(wait.followUpMinutes)} minutes.</p>`;
  }

  function dialogShell(className, label) {
    const dialog = document.createElement("dialog");
    dialog.className = `workspace-dialog review-dialog ${className}`;
    dialog.setAttribute("aria-label", label);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
    return dialog;
  }

  // kind "gcash": receipt screenshot. kind "id": Senior Citizen / PWD ID photo.
  async function showProof(path, orderNumber, kind = "gcash") {
    const id = kind === "id";
    const title = id ? "Senior Citizen / PWD ID" : "GCash screenshot";
    const dialog = dialogShell("proof-dialog", `${title} for ${orderNumber}`);
    dialog.innerHTML = `<header><h2>${title} · ${esc(orderNumber)}</h2><button class="close-panel" type="button" aria-label="Close ${id ? "ID photo" : "screenshot"}"><i class="bi bi-x-lg" aria-hidden="true"></i></button></header>
      <p class="review-note">${id
        ? "Check that the photo shows a real Senior Citizen (OSCA) or PWD ID card, that the name and ID number match what the customer typed, and that the ID is not expired. Ask to see the same card on delivery or at pickup."
        : "A screenshot can be edited. Confirm only after the same reference and amount appear in the shop's own GCash transaction history."}</p>
      <dl class="id-proof-details" hidden></dl>
      <div class="proof-image" role="status">Loading ${id ? "ID photo" : "screenshot"}…</div>`;
    dialog.querySelector("header button").addEventListener("click", () => dialog.close());
    dialog.showModal();
    try {
      const data = await KopiApi.request(path);
      if (id) {
        const details = dialog.querySelector(".id-proof-details");
        details.innerHTML = `<div><dt>Type</dt><dd>${esc(data.type)}</dd></div><div><dt>Name typed</dt><dd>${esc(data.name)}</dd></div>
          <div><dt>ID number typed</dt><dd>${esc(data.idNumber)}</dd></div><div><dt>Status</dt><dd>${esc(data.status || "Pending verification")}</dd></div>`;
        details.hidden = false;
      }
      const image = document.createElement("img");
      image.alt = id ? `${data.type || "Discount"} ID photo uploaded by the customer for ${orderNumber}` : `GCash receipt screenshot uploaded by the customer for ${orderNumber}`;
      image.src = data.image;
      dialog.querySelector(".proof-image").replaceChildren(image);
    } catch (error) {
      dialog.querySelector(".proof-image").textContent = error.message;
    }
  }

  // Builds text with highlighted values (bold, gold) safely, without HTML.
  // parts: ["plain text", {key: "highlighted text"}, ...]
  function highlightedText(parts) {
    const fragment = document.createDocumentFragment();
    for (const part of [].concat(parts)) {
      if (part && typeof part === "object") {
        const strong = document.createElement("strong");
        strong.className = "key-value";
        strong.textContent = part.key;
        fragment.append(strong);
      } else fragment.append(document.createTextNode(String(part ?? "")));
    }
    return fragment;
  }

  // Confirmation dialog used when verifying a GCash payment.
  function confirmDialog(title, parts, confirmLabel = "Confirm") {
    return new Promise(resolve => {
      const dialog = dialogShell("confirm-dialog", title);
      dialog.innerHTML = `<form method="dialog">
        <header><h2></h2><button class="close-panel" type="submit" value="cancel" aria-label="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button></header>
        <p class="review-note confirm-message"></p>
        <div class="workspace-dialog-actions">
          <button class="workspace-btn secondary" type="submit" value="cancel">Go back</button>
          <button class="workspace-btn" type="submit" value="confirm"></button>
        </div></form>`;
      dialog.querySelector("h2").textContent = title;
      dialog.querySelector(".confirm-message").append(highlightedText(parts));
      dialog.querySelector("button[value=confirm]").textContent = confirmLabel;
      let answered = false;
      dialog.querySelector("form").addEventListener("submit", event => {
        answered = true;
        resolve(event.submitter?.value === "confirm");
      });
      dialog.addEventListener("close", () => { if (!answered) resolve(false); });
      dialog.showModal();
    });
  }

  // Status chip for the Senior Citizen / PWD box (Operations and Staff).
  function idStatusHtml(order) {
    const status = order.specialDiscountStatus || "Verified";
    const tone = status === "Verified" ? "verified" : status === "Not approved" ? "rejected" : "pending";
    const label = order.orderType === "In-store" && status === "Verified" ? "Checked at the counter" : status === "Verified" ? "ID verified" : status === "Not approved" ? "Discount not approved" : "ID needs checking";
    return `<span class="id-status ${tone}"><i class="bi ${tone === "verified" ? "bi-patch-check-fill" : tone === "rejected" ? "bi-x-octagon-fill" : "bi-hourglass-split"}" aria-hidden="true"></i>${esc(label)}</span>`;
  }

  // The ID is not approved: the order is kept, but at the normal price.
  function notApproveDialog(order) {
    const removed = Number(order.specialDiscount || 0) + Number(order.vatExempt || 0);
    const normal = Number(order.total || 0) + removed;
    const peso = value => "₱" + value.toFixed(2);
    return new Promise(resolve => {
      const dialog = dialogShell("reject-dialog", `Discount not approved for ${order.orderNumber}`);
      dialog.innerHTML = `<form method="dialog">
        <header><h2>Not approve the discount for ${esc(order.orderNumber)}?</h2><button class="close-panel" type="submit" value="cancel" aria-label="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button></header>
        <p class="review-note">Use this when the ID photo is unclear, the name or ID number does not match, or the card is not valid. <strong>The order is not canceled.</strong> The ${esc(order.specialDiscountType)} discount of ${peso(removed)} is removed, the order goes back to the normal price of <strong>${peso(normal)}</strong>, and the customer is notified.${order.payment === "GCash" ? ` The customer paid by GCash, so the remaining ${peso(removed)} is paid by GCash or in cash ${order.serviceType === "Pickup" ? "at the counter" : "to the rider"}.` : ""}</p>
        <label class="workspace-field">What was wrong? (optional, shown to the customer)<textarea name="note" maxlength="200" rows="2" placeholder="e.g. The name on the ID does not match."></textarea></label>
        <div class="workspace-dialog-actions">
          <button class="workspace-btn secondary" type="submit" value="cancel">Go back</button>
          <button class="workspace-btn danger" type="submit" value="confirm">Remove discount and notify customer</button>
        </div></form>`;
      const form = dialog.querySelector("form");
      let answered = false;
      form.addEventListener("submit", event => {
        if (event.submitter?.value !== "confirm") return;
        answered = true;
        resolve({note: form.note.value.trim()});
      });
      dialog.addEventListener("close", () => { if (!answered) resolve(null); });
      dialog.showModal();
    });
  }

  // The discount was removed, so the customer sends the difference by GCash.
  function balanceDialog(order) {
    const amount = "₱" + Number(order.balanceDue || 0).toFixed(2);
    const qr = /^\/(Admin|Cashier|Staff)\//.test(window.location.pathname) ? "../Customer/HomePic/gcash-payment-qr.jpg" : "HomePic/gcash-payment-qr.jpg";
    return new Promise(resolve => {
      const dialog = dialogShell("reject-dialog balance-dialog", `Remaining balance for ${order.orderNumber}`);
      dialog.innerHTML = `<form method="dialog" novalidate>
        <header><h2>GCash balance for ${esc(order.orderNumber)}</h2><button class="close-panel" type="submit" value="cancel" aria-label="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button></header>
        <p class="review-note">The discount was not approved, so the customer still owes <strong class="key-value">${amount}</strong>. Ask them to send it using the shop's QR code, then check the shop's GCash account.</p>
        <p class="balance-qr"><a href="${qr}" target="_blank" rel="noopener"><img src="${qr}" alt="Shop GCash QR code" loading="lazy"></a></p>
        <label class="workspace-field">GCash reference number<input name="reference" inputmode="numeric" maxlength="13" autocomplete="off" placeholder="13-digit Ref No."></label>
        <label class="balance-check"><input type="checkbox" name="received"> I saw ${amount} with this reference in the shop's GCash account.</label>
        <p class="workspace-status" role="status" aria-live="polite"></p>
        <div class="workspace-dialog-actions">
          <button class="workspace-btn secondary" type="submit" value="cancel">Go back</button>
          <button class="workspace-btn" type="submit" value="confirm">Record GCash payment</button>
        </div></form>`;
      const form = dialog.querySelector("form");
      form.reference.addEventListener("input", () => { form.reference.value = form.reference.value.replace(/\D/g, "").slice(0, 13); });
      let answered = false;
      form.addEventListener("submit", event => {
        if (event.submitter?.value !== "confirm") return;
        const status = form.querySelector("[role=status]");
        if (!/^[0-9]{13}$/.test(form.reference.value)) {
          event.preventDefault();
          KopiNotice.set(status, "Enter the 13-digit GCash reference number.", "error");
          form.reference.focus();
          return;
        }
        if (!form.received.checked) {
          event.preventDefault();
          KopiNotice.set(status, "Check the shop's GCash account, then tick the box.", "error");
          return;
        }
        answered = true;
        resolve({reference: form.reference.value, confirmedReceived: true});
      });
      dialog.addEventListener("close", () => { if (!answered) resolve(null); });
      dialog.showModal();
    });
  }

  function rejectDialog(order) {
    return new Promise(resolve => {
      const dialog = dialogShell("reject-dialog", `Reject ${order.orderNumber}`);
      dialog.innerHTML = `<form method="dialog">
        <header><h2>Reject ${esc(order.orderNumber)}?</h2><button class="close-panel" type="submit" value="cancel" aria-label="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button></header>
        <p class="review-note">Use this for an order you cannot confirm — for example a fake address or a phone number that does not answer. Reserved ingredients return to stock and the customer sees the reason when they open the website.${order.payment === "GCash" && order.paymentStatus === "Verified" ? " <strong>The GCash payment was already received, so a refund must be sent separately.</strong>" : ""}</p>
        <fieldset class="reject-reasons"><legend>Reason</legend>
          ${reasons.map(([value, label], index) => `<label><input type="radio" name="reason" value="${value}" ${index === 0 ? "checked" : ""}> ${esc(label)}</label>`).join("")}
        </fieldset>
        <label class="workspace-field">Note for the customer (optional, required for “Other”)<textarea name="note" maxlength="200" rows="2"></textarea></label>
        <p class="workspace-status" role="status" aria-live="polite"></p>
        <div class="workspace-dialog-actions">
          <button class="workspace-btn secondary" type="submit" value="cancel">Keep order</button>
          <button class="workspace-btn danger" type="submit" value="confirm">Reject order</button>
        </div></form>`;
      const form = dialog.querySelector("form");
      let answered = false;
      form.addEventListener("submit", event => {
        if (event.submitter?.value !== "confirm") return;
        const reason = form.reason.value, note = form.note.value.trim();
        if (reason === "other" && note.length < 5) {
          event.preventDefault();
          KopiNotice.set(form.querySelector("[role=status]"), "Write a short note explaining the reason.", "error");
          form.note.focus();
          return;
        }
        answered = true;
        resolve({reason, note});
      });
      dialog.addEventListener("close", () => { if (!answered) resolve(null); });
      dialog.showModal();
    });
  }

  return {flagsHtml, waitHtml, showProof, idStatusHtml, rejectDialog, notApproveDialog, balanceDialog, highlightedText, confirmDialog};
})();
