/* Sales Report: daily, weekly, monthly and yearly sales in plain numbers. */
(() => {
  "use strict";
  const peso = value => "₱" + Number(value || 0).toLocaleString("en-PH", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const manilaToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const shiftMonth = (month, by) => {
    const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
    return date.toISOString().slice(0, 7);
  };
  const longDate = value => new Date(value + "T00:00:00Z").toLocaleDateString("en-PH", {timeZone: "UTC", dateStyle: "long"});
  const longMonth = value => new Date(value + "-01T00:00:00Z").toLocaleDateString("en-PH", {timeZone: "UTC", month: "long", year: "numeric"});

  const intervalEl = document.getElementById("reportInterval");
  const dateInput = document.getElementById("summaryDate");
  const monthInput = document.getElementById("summaryMonth");
  const status = document.getElementById("salesSummaryStatus");
  const today = manilaToday();
  const shiftDay = (day, by) => new Date(Date.parse(day + "T00:00:00Z") + by * 86400000).toISOString().slice(0, 10);
  dateInput.value = today; dateInput.max = today;
  monthInput.value = today.slice(0, 7); monthInput.max = today.slice(0, 7);
  let version = 0, lastQuery = "", lastData = null;

  // Each interval maps to the server's daily, weekly, monthly or yearly summary.
  function query() {
    const kind = intervalEl.value, month = today.slice(0, 7), year = Number(today.slice(0, 4));
    const choice = {
      today: {period: "day", date: today},
      yesterday: {period: "day", date: shiftDay(today, -1)},
      week: {period: "week", date: today},
      lastweek: {period: "week", date: shiftDay(today, -7)},
      month: {period: "month", month},
      lastmonth: {period: "month", month: shiftMonth(month, -1)},
      year: {period: "year", year: String(year)},
      lastyear: {period: "year", year: String(year - 1)},
      pickday: {period: "day", date: dateInput.value || today},
      pickmonth: {period: "month", month: monthInput.value || month}
    }[kind] || {period: "day", date: today};
    return new URLSearchParams(choice);
  }

  function syncPickers() {
    document.getElementById("summaryDateLabel").hidden = intervalEl.value !== "pickday";
    document.getElementById("summaryMonthLabel").hidden = intervalEl.value !== "pickmonth";
  }

  function kpi(icon, label, value, note = "", tone = "") {
    return `<article class="sales-kpi ${tone}"><i class="bi ${icon}" aria-hidden="true"></i><div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ""}</div></article>`;
  }
  const percent = (part, whole) => whole ? Math.round(part / whole * 100) : 0;
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

  // One plain-language sentence so the numbers are easy to read at a glance.
  function story(data, label) {
    const unit = {day: "day", week: "week", month: "month", year: "year"}[data.period];
    if (!data.orders) {
      return `No completed orders for ${label} yet.${data.canceledOrders ? ` ${plural(data.canceledOrders, "order")} ${data.canceledOrders === 1 ? "was" : "were"} canceled.` : ""}`;
    }
    const change = data.previous.change;
    const trend = change == null ? "" : change === 0 ? `, the same as the previous ${unit}`
      : `, ${Math.abs(change)}% ${change > 0 ? "more" : "less"} than the previous ${unit}`;
    const payment = data.byPayment[0];
    const top = data.topItems[0];
    return `${label}: ${plural(data.orders, "completed order")} brought in ${peso(data.netSales)}${trend}. `
      + (payment ? `Most money came through ${payment.payment} (${percent(payment.total, data.netSales)}%). ` : "")
      + (top ? `${top.name} was the best seller with ${top.quantity} sold.` : "")
      + (data.canceledOrders ? ` ${plural(data.canceledOrders, "order")} ${data.canceledOrders === 1 ? "was" : "were"} canceled.` : "");
  }

  function render(data) {
    lastData = data;
    const unit = data.period;
    const label = data.period === "day" ? longDate(data.start)
      : data.period === "week" ? `Week of ${longDate(data.start)} – ${longDate(data.end)}`
      : data.period === "year" ? data.start.slice(0, 4) : longMonth(data.start.slice(0, 7));
    const partial = data.through < data.end && data.period !== "day" ? ` (through ${longDate(data.through)})` : "";
    document.getElementById("salesSummaryRange").textContent = `${label}${partial} · completed orders`;
    document.getElementById("salesStory").textContent = story(data, label);
    const change = data.previous.change;
    const versus = change == null
      ? (data.previous.netSales ? "" : `No sales in the previous ${unit}`)
      : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change)}% vs previous ${unit} (${peso(data.previous.netSales)})`;
    const discounts = data.voucherDiscounts + data.specialDiscounts + data.vatExempt;
    document.getElementById("salesKpis").innerHTML = [
      kpi("bi-cash-stack", "Net sales", peso(data.netSales), versus || "Money from completed orders after discounts", change == null ? "" : change < 0 ? "down" : "up"),
      kpi("bi-bag-check", "Completed orders", String(data.orders), `Average ${peso(data.averageOrder)} per order`),
      kpi("bi-tag", "Discounts given", peso(discounts), discounts ? `Vouchers ${peso(data.voucherDiscounts)} · SC/PWD ${peso(data.specialDiscounts + data.vatExempt)}` : "No discounts this period"),
      kpi("bi-x-circle", "Canceled", String(data.canceledOrders), data.canceledOrders ? `${peso(data.canceledValue)} not collected` : "No canceled orders", data.canceledOrders ? "down" : "")
    ].join("");
    document.getElementById("salesKpisMinor").innerHTML = [
      kpi("bi-receipt", "Gross sales", peso(data.grossSales), "Before discounts"),
      kpi("bi-person-vcard", "Senior / PWD orders", `${data.seniorOrders} / ${data.pwdOrders}`, "Orders with an ID discount"),
      kpi("bi-list-check", "Total transactions", String(data.transactions), "Completed and canceled orders")
    ].join("");

    const rows = data.period === "day" ? data.series.filter((row, index) => index >= 8 || row.total > 0) : data.series;
    const highest = Math.max(...rows.map(row => row.total), 0);
    document.getElementById("salesSeriesTitle").textContent = {day: "Sales by hour", week: "Sales by day", month: "Sales by day", year: "Sales by month"}[data.period];
    document.getElementById("salesAxisTop").textContent = peso(highest).replace(".00", "");
    const bars = document.getElementById("salesBars");
    bars.classList.toggle("is-month", data.period === "month");
    bars.setAttribute("aria-label", `${{day: "Hourly", week: "Daily", month: "Daily", year: "Monthly"}[data.period]} net sales. Highest ${peso(highest)}.`);
    bars.innerHTML = highest ? rows.map((row, index) => {
      const short = data.period === "day" ? row.label.slice(0, 2)
        : data.period === "year" ? new Date(row.label + "-01T00:00:00Z").toLocaleDateString("en-PH", {timeZone: "UTC", month: "short"})
        : data.period === "week" ? new Date(row.label + "T00:00:00Z").toLocaleDateString("en-PH", {timeZone: "UTC", weekday: "short", day: "numeric"})
        : String(Number(row.label.slice(8)));
      const showLabel = data.period === "day" ? index % 2 === 0 : ["year", "week"].includes(data.period) ? true : (index === 0 || (index + 1) % 5 === 0);
      const tip = `${row.label}: ${peso(row.total)} · ${plural(row.orders, "order")}`;
      return `<div class="sales-bar" title="${escapeHtml(tip)}">
        <span style="height:${Math.max(row.total ? 4 : 0, Math.round(row.total / highest * 100))}%"><em>${row.total ? escapeHtml(peso(row.total).replace(".00", "")) : ""}</em></span><small>${showLabel ? escapeHtml(short) : ""}</small></div>`;
    }).join("") : `<p class="sales-empty">No completed sales in this period.</p>`;

    // Each payment method and order type as a share of net sales.
    const share = (list, key) => list.length ? list.map(row => {
      const pct = percent(row.total, data.netSales);
      return `<li><div class="sales-share-row"><span>${escapeHtml(row[key])}</span><strong>${peso(row.total)}</strong></div>
        <div class="sales-meter" role="img" aria-label="${pct}% of net sales"><span style="width:${pct}%"></span></div>
        <small>${pct}% of sales · ${plural(row.orders, "order")}</small></li>`;
    }).join("") : `<li class="sales-empty">No sales yet.</li>`;
    const insights = data.insights || {};
    const insight = (icon, label, value, note) => `<article class="sales-insight"><i class="bi ${icon}" aria-hidden="true"></i><div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div></article>`;
    document.getElementById("salesInsights").innerHTML = [
      insight("bi-cup-straw", "Items sold", String(insights.itemsSold || 0), data.orders ? `About ${insights.itemsPerOrder} per order` : "No orders yet"),
      insight("bi-clock", "Busiest hour", insights.peakHour?.label || "—", insights.peakHour ? plural(insights.peakHour.orders, "order") : "No orders yet"),
      ...(data.period === "day" ? [] : [insight("bi-calendar-week", "Busiest day", insights.busiestDay?.label || "—", insights.busiestDay ? `${peso(insights.busiestDay.total)} in sales` : "No orders yet")]),
      insight("bi-ticket-perforated", "Vouchers used", String(insights.vouchersUsed || 0), insights.vouchersUsed ? `${peso(data.voucherDiscounts)} off in total` : "No vouchers used"),
      insight("bi-people", "Online customers", String(insights.onlineCustomers || 0), insights.onlineCustomers ? `${insights.returningCustomers || 0} came back from before` : "No online orders yet")
    ].join("");
    const categoryTotal = (data.byCategory || []).reduce((sum, row) => sum + row.sales, 0);
    document.getElementById("salesCategories").innerHTML = (data.byCategory || []).length ? data.byCategory.map(row => {
      const pct = percent(row.sales, categoryTotal);
      return `<li><div class="sales-share-row"><span>${escapeHtml(row.category)}</span><strong>${peso(row.sales)}</strong></div>
        <div class="sales-meter" role="img" aria-label="${pct}% of item sales"><span style="width:${pct}%"></span></div>
        <small>${pct}% of item sales · ${row.quantity} sold</small></li>`;
    }).join("") : `<li class="sales-empty">No items sold yet.</li>`;
    document.getElementById("salesPayments").innerHTML = share(data.byPayment, "payment");
    document.getElementById("salesTypes").innerHTML = share(data.byType, "type");
    const mostSold = Math.max(...data.topItems.map(row => row.quantity), 0);
    document.getElementById("salesTopItems").innerHTML = data.topItems.length ? data.topItems.map((row, index) => `<li>
        <span class="sales-rank">${index + 1}</span>
        <div><div class="sales-share-row"><span>${escapeHtml(row.name)}</span><strong>${row.quantity} sold</strong></div>
        <div class="sales-meter"><span style="width:${percent(row.quantity, mostSold)}%"></span></div><small>${peso(row.sales)} in item sales</small></div>
      </li>`).join("") : `<li class="sales-empty">No items sold yet.</li>`;
  }

  async function refresh() {
    const current = ++version;
    lastQuery = query().toString();
    status.textContent = "Loading sales summary…";
    try {
      const data = await KopiApi.request("/admin/reports/summary?" + lastQuery);
      if (current !== version) return;
      render(data);
      status.textContent = "";
    } catch (error) {
      if (current === version) KopiNotice.set(status, error.message, "error");
    }
  }

  intervalEl.addEventListener("change", () => {
    syncPickers();
    try { localStorage.setItem("kopi_report_interval", intervalEl.value); } catch {}
    refresh();
  });
  dateInput.addEventListener("change", refresh);
  monthInput.addEventListener("change", refresh);

  const exportBtn = document.getElementById("exportBtn"), exportMenu = document.getElementById("exportMenu");
  function setExportMenu(open) {
    exportMenu.hidden = !open;
    exportBtn.setAttribute("aria-expanded", String(open));
    if (open) exportMenu.querySelector("button").focus();
  }
  exportBtn.addEventListener("click", () => setExportMenu(exportMenu.hidden));
  document.addEventListener("click", event => { if (!exportMenu.hidden && !event.target.closest(".tx-export")) setExportMenu(false); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !exportMenu.hidden) { setExportMenu(false); exportBtn.focus(); } });
  exportMenu.addEventListener("click", async event => {
    const item = event.target.closest("[data-export]");
    if (!item) return;
    setExportMenu(false);
    if (item.dataset.export === "print") {
      document.body.classList.add("printing-summary");
      window.print();
      return;
    }
    if (item.dataset.export === "json") {
      if (!lastData) return KopiNotice.set(status, "The report is still loading.", "error");
      const file = new Blob([JSON.stringify({generatedAt: new Date().toISOString(), ...lastData}, null, 2)], {type: "application/json"});
      const link = Object.assign(document.createElement("a"), {href: URL.createObjectURL(file), download: `kopi-sales-${lastData.start}.json`});
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      return;
    }
    exportBtn.disabled = true;
    try { await KopiApi.download("/admin/reports/summary/export?" + query(), "kopi-sales-summary.csv"); KopiNotice.toast("Report downloaded.", "success"); }
    catch (error) { KopiNotice.set(status, error.message, "error"); }
    finally { exportBtn.disabled = false; }
  });
  window.addEventListener("afterprint", () => document.body.classList.remove("printing-summary"));
  window.addEventListener("focus", () => { if (query().toString() === lastQuery) refresh(); });
  try {
    const saved = localStorage.getItem("kopi_report_interval");
    if (saved && [...intervalEl.options].some(option => option.value === saved)) intervalEl.value = saved;
  } catch {}
  syncPickers();
  refresh();
})();
