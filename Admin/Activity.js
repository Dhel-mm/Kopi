/* User Activity: records of who changed what. The server writes the records;
   this page only reads them. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"}[c]));
  const when = value => new Date(String(value).replace(" ", "T") + "Z")
    .toLocaleString("en-PH", {timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short"});
  let page = 1, version = 0, searchTimer = null;

  function syncAreas(areas) {
    const select = $("activityArea");
    const chosen = select.value;
    select.replaceChildren(new Option("All Areas", ""), ...areas.map(area => new Option(area, area)));
    select.value = areas.includes(chosen) ? chosen : "";
  }

  async function load() {
    const current = ++version;
    const params = new URLSearchParams({page});
    const filters = {q: $("activitySearch").value.trim(), role: $("activityRole").value, area: $("activityArea").value, from: $("activityFrom").value, to: $("activityTo").value};
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    try {
      const data = await KopiApi.request("/admin/activity?" + params);
      if (current !== version) return;
      page = data.page;
      syncAreas(data.areas);
      $("activityRows").innerHTML = data.rows.map(row => `<tr><td>${esc(when(row.createdAt))}</td><td>${esc(row.userName)}</td><td>${esc(row.role)}</td><td>${esc(row.area)}</td><td>${esc(row.action)}</td><td>${esc(row.details)}</td></tr>`).join("");
      $("activityEmpty").hidden = data.rows.length > 0;
      const first = (data.page - 1) * 25 + 1;
      $("activityRange").textContent = data.total ? `Showing ${first}–${first + data.rows.length - 1} of ${data.total}` : "Showing 0 records";
      $("activityPage").textContent = `${data.page}/${data.pages}`;
      $("activityPrevious").disabled = data.page <= 1;
      $("activityNext").disabled = data.page >= data.pages;
      $("activityStatus").textContent = "";
    } catch (error) {
      if (current === version) KopiNotice.set($("activityStatus"), error.message, "error");
    }
  }

  $("activitySearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { page = 1; load(); }, 250);
  });
  for (const id of ["activityRole", "activityArea", "activityFrom", "activityTo"]) {
    $(id).addEventListener("change", () => { page = 1; load(); });
  }
  $("activityPrevious").addEventListener("click", () => { page--; load(); });
  $("activityNext").addEventListener("click", () => { page++; load(); });
  window.addEventListener("focus", load);
  load();
})();
