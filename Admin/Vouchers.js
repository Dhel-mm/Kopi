(() => {
  const toggle = document.getElementById("toggleVouchers");
  const card = document.getElementById("voucherCard");
  const close = document.getElementById("closeVouchers");
  const form = document.getElementById("voucherForm");
  const fields = document.getElementById("voucherFields");
  const code = document.getElementById("adminVoucherCode");
  const amount = document.getElementById("adminVoucherAmount");
  const active = document.getElementById("adminVoucherActive");
  const save = document.getElementById("saveVoucher");
  const cancel = document.getElementById("cancelVoucherEdit");
  const list = document.getElementById("voucherList");
  const status = document.getElementById("voucherStatus");
  let editing = null;
  let busy = false;

  toggle.addEventListener("click", () => {
    if (card.open) return;
    card.showModal();
    toggle.setAttribute("aria-expanded", "true");
    code.focus();
    refresh().catch(error => KopiNotice.set(status, error.message, "error"));
  });
  close.addEventListener("click", () => { if (!busy) card.close(); });
  card.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  card.addEventListener("close", () => {
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus();
  });

  function reset() {
    editing = null;
    form.reset();
    code.readOnly = false;
    save.textContent = "Add voucher";
    cancel.hidden = true;
  }

  async function refresh() {
    const data = await KopiApi.request("/admin/vouchers");
    list.replaceChildren();
    for (const voucher of data.vouchers) {
      const row = document.createElement("li");
      const description = document.createElement("div");
      const name = document.createElement("strong");
      const details = document.createElement("small");
      name.textContent = voucher.code;
      if (voucher.used) name.className = "voucher-used-code";
      details.textContent = `₱${voucher.amount.toFixed(2)} off · ${voucher.used ? "Used" : (voucher.active ? "Active" : "Inactive")}`;
      description.append(name, details);
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "voucher-button";
      edit.textContent = voucher.used ? "Remove" : "Edit";
      edit.setAttribute("aria-label", (voucher.used ? "Remove voucher " : "Edit voucher ") + voucher.code);
      edit.addEventListener("click", async () => {
        if (busy) return;
        if (voucher.used) {
          if (!window.confirm(`Remove used voucher ${voucher.code} from the list? Its order history will be kept, and the code cannot be reused.`)) return;
          busy = true;
          fields.disabled = close.disabled = edit.disabled = true;
          try {
            await KopiApi.request("/admin/vouchers/" + encodeURIComponent(voucher.code), {method: "DELETE"});
            if (editing === voucher.code) reset();
            KopiNotice.set(status, "Used voucher removed. Its order history is preserved.", "success");
            try { await refresh(); }
            catch { KopiNotice.set(status, "Voucher removed. Reload to refresh the list.", "warning"); }
          } catch (error) { KopiNotice.set(status, error.message, "error"); }
          finally { busy = false; fields.disabled = close.disabled = edit.disabled = false; }
          return;
        }
        editing = voucher.code;
        code.value = voucher.code;
        code.readOnly = true;
        amount.value = voucher.amount.toFixed(2);
        active.checked = voucher.active;
        save.textContent = "Save changes";
        cancel.hidden = false;
        status.textContent = "";
        amount.focus();
      });
      row.append(description, edit);
      list.append(row);
    }
    if (!data.vouchers.length) list.textContent = "No vouchers yet. Add your first code above.";
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true;
    fields.disabled = true;
    close.disabled = true;
    KopiNotice.set(status, "Saving voucher…", "loading");
    try {
      await KopiApi.request("/admin/vouchers" + (editing ? "/" + encodeURIComponent(editing) : ""), {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({code: code.value.trim().toUpperCase(), amount: Number(amount.value), active: active.checked})
      });
      reset();
      KopiNotice.set(status, "Voucher saved. Available for new online and in-store orders when active.", "success");
      try { await refresh(); }
      catch { KopiNotice.set(status, "Voucher saved, but the list could not refresh. Reload to see it.", "warning"); }
    } catch (error) {
      KopiNotice.set(status, error.message, "error");
    } finally {
      busy = false;
      fields.disabled = false;
      close.disabled = false;
    }
  });
  cancel.addEventListener("click", () => { reset(); status.textContent = ""; });
  refresh().catch(error => {
    list.textContent = "Voucher list unavailable.";
    KopiNotice.set(status, error.message, "error");
  });
})();
