/* Daily, monthly and earlier-month sales summary (panel feedback). */
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

  const dateInput = document.getElementById("summaryDate");
  const monthInput = document.getElementById("summaryMonth");
  const monthLabel = document.getElementById("summaryMonthLabel");
  const yearInput = document.getElementById("summaryYear");
  const yearLabel = document.getElementById("summaryYearLabel");
  const status = document.getElementById("salesSummaryStatus");
  const today = manilaToday();
  dateInput.value = today; dateInput.max = today;
  monthInput.value = today.slice(0, 7); monthInput.max = today.slice(0, 7);
  // Kopi; Calamba opened in 2021.
  for (let year = Number(today.slice(0, 4)); year >= 2021; year--) yearInput.add(new Option(String(year), String(year)));
  let period = "day", version = 0, lastQuery = "";

  function query() {
    if (period === "year") return new URLSearchParams({period, year: yearInput.value || today.slice(0, 4)});
    return new URLSearchParams(["day", "week"].includes(period) ? {period, date: dateInput.value || today} : {period, month: monthInput.value || today.slice(0, 7)});
  }

  function setPeriod(next) {
    period = next;
    document.querySelectorAll("[data-summary-period]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.summaryPeriod === period)));
    // Weekly uses the date picker too: any day picks its Monday-to-Sunday week.
    dateInput.closest("label").hidden = !["day", "week"].includes(period);
    dateInput.title = period === "week" ? "Pick any day in the week (Monday to Sunday)" : "";
    monthLabel.hidden = period !== "month";
    yearLabel.hidden = period !== "year";
  }

  function kpi(label, value, note = "", tone = "") {
    return `<article class="sales-kpi ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ""}</article>`;
  }

  function render(data) {
    const unit = data.period;
    const label = data.period === "day" ? longDate(data.start)
      : data.period === "week" ? `Week of ${longDate(data.start)} – ${longDate(data.end)}`
      : data.period === "year" ? data.start.slice(0, 4) : longMonth(data.start.slice(0, 7));
    const partial = data.through < data.end && data.period !== "day" ? ` (through ${longDate(data.through)})` : "";
    document.getElementById("salesSummaryRange").textContent = `${label}${partial} · completed orders`;
    const change = data.previous.change;
    const versus = change == null
      ? (data.previous.netSales ? "" : `No sales in the previous ${unit}`)
      : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change)}% vs previous ${unit} (${peso(data.previous.netSales)})`;
    document.getElementById("salesKpis").innerHTML = [
      kpi("Net sales", peso(data.netSales), versus, change == null ? "" : change < 0 ? "down" : "up"),
      kpi("Gross sales", peso(data.grossSales), "Before discounts"),
      kpi("Discounts given", peso(data.voucherDiscounts + data.specialDiscounts + data.vatExempt),
        `Vouchers ${peso(data.voucherDiscounts)} · SC/PWD ${peso(data.specialDiscounts)} · VAT-exempt ${peso(data.vatExempt)}`),
      kpi("Senior / PWD orders", `${data.seniorOrders} / ${data.pwdOrders}`, "Orders with an ID discount"),
      kpi("Completed orders", String(data.orders), `Average ${peso(data.averageOrder)} per order`),
      kpi("Canceled", String(data.canceledOrders), data.canceledOrders ? `${peso(data.canceledValue)} not collected` : "No canceled orders", data.canceledOrders ? "down" : ""),
      kpi("Total transactions", String(data.transactions), "Completed and canceled orders")
    ].join("");

    const rows = data.period === "day" ? data.series.filter((row, index) => index >= 8 || row.total > 0) : data.series;
    const highest = Math.max(...rows.map(row => row.total), 0);
    document.getElementById("salesSeriesTitle").textContent = {day: "Sales by hour", week: "Sales by day", month: "Sales by day", year: "Sales by month"}[data.period];
    const bars = document.getElementById("salesBars");
    bars.classList.toggle("is-month", data.period === "month");
    bars.setAttribute("aria-label", `${{day: "Hourly", week: "Daily", month: "Daily", year: "Monthly"}[data.period]} net sales. Highest ${peso(highest)}.`);
    bars.innerHTML = highest ? rows.map((row, index) => {
      const short = data.period === "day" ? row.label.slice(0, 2)
        : data.period === "year" ? new Date(row.label + "-01T00:00:00Z").toLocaleDateString("en-PH", {timeZone: "UTC", month: "short"})
        : data.period === "week" ? new Date(row.label + "T00:00:00Z").toLocaleDateString("en-PH", {timeZone: "UTC", weekday: "short", day: "numeric"})
        : String(Number(row.label.slice(8)));
      const showLabel = data.period === "day" ? index % 2 === 0 : ["year", "week"].includes(data.period) ? true : (index === 0 || (index + 1) % 5 === 0);
      return `<div class="sales-bar" title="${escapeHtml(row.label)}: ${peso(row.total)} · ${row.orders} order${row.orders === 1 ? "" : "s"}">
        <span style="height:${Math.max(row.total ? 4 : 0, Math.round(row.total / highest * 100))}%"></span><small>${showLabel ? escapeHtml(short) : ""}</small></div>`;
    }).join("") : `<p class="sales-empty">No completed sales in this period.</p>`;

    const list = (rowsToShow, empty, nameKey, extra) => rowsToShow.length
      ? rowsToShow.map(row => `<li><span>${escapeHtml(row[nameKey])}</span><strong>${extra(row)}</strong></li>`).join("")
      : `<li class="sales-empty">${empty}</li>`;
    document.getElementById("salesPayments").innerHTML = list(data.byPayment, "No sales yet.", "payment", row => `${peso(row.total)} <small>${row.orders}</small>`);
    document.getElementById("salesTypes").innerHTML = list(data.byType, "No sales yet.", "type", row => `${peso(row.total)} <small>${row.orders}</small>`);
    document.getElementById("salesTopItems").innerHTML = list(data.topItems, "No items sold yet.", "name", row => `${row.quantity} sold <small>${peso(row.sales)}</small>`);
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

  document.querySelectorAll("[data-summary-period]").forEach(button => button.addEventListener("click", () => {
    setPeriod(button.dataset.summaryPeriod);
    refresh();
  }));
  dateInput.addEventListener("change", refresh);
  monthInput.addEventListener("change", refresh);
  yearInput.addEventListener("change", refresh);
  document.getElementById("printSummary").addEventListener("click", () => {
    document.body.classList.add("printing-summary");
    window.print();
  });
  window.addEventListener("afterprint", () => document.body.classList.remove("printing-summary"));
  window.addEventListener("focus", () => { if (query().toString() === lastQuery) refresh(); });
  setPeriod("day");
  refresh();
})();
