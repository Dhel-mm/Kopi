const peso=value=>"₱"+Number(value||0).toFixed(2);
const escapeHtml=value=>String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const ranges=document.querySelectorAll(".range-select");
let reportVersion=0;
// An empty period shows a message, never fake orders.
const emptyState = {
  id: "emptyState",
  afterDraw(chart, args, options) {
    if (chart.data.datasets[0].data.some(value => Number(value) > 0)) return;
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const { left, right, top, bottom } = chartArea;
    const x = (left + right) / 2;
    const y = (top + bottom) / 2;
    ctx.save();
    ctx.fillStyle = "#796c5b";
    ctx.font = '12px "Poppins", Arial, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(options.message, x, y, Math.max(1, right - left - 12));
    ctx.restore();
  }
};

function makeChart(id,type) {
  if(typeof Chart==="undefined")return null;
  try {
    return new Chart(document.getElementById(id), {
      type,
      plugins: [emptyState],
      data: {
        labels: [],
        datasets: [{
          data: [], borderColor: "#3d2b16", borderWidth: type === "bar" ? 0 : 2,
          backgroundColor: type === "line" ? "#d49b43" : ["#3d2b16", "#d49b43", "#f3ddab"],
          pointRadius: 3, tension: 0.25, borderRadius: type === "bar" ? 6 : 0, maxBarThickness: 56
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, emptyState: { message: "Loading…" } },
        // Room above the highest value, so it never looks like a full (100%) graph.
        scales: { y: { beginAtZero: true, grace: "20%", ticks: type === "bar" ? { precision: 0 } : { callback: value => peso(value) } } }
      }
    });
  } catch (error) {
    console.error("Could not initialize " + id, error);
    return null;
  }
}
const salesChart=makeChart("salesChart","line"),orderChart=makeChart("orderSummaryChart","bar");
async function refreshDashboard() {
  const version=++reportVersion,status=document.getElementById("dashboardStatus");
  const params=new URLSearchParams();
  ["salesRange","orderRange","productRange"].forEach((key,index)=>params.set(key,ranges[index].selectedIndex===1?"month":"week"));
  try {
    const data=await KopiApi.request("/admin/dashboard?"+params);
    if(version!==reportVersion)return;
    const values=[peso(data.todaySales),data.totalOrders,data.lowStockItems,data.outOfStockItems,data.servedThisWeek];
    document.querySelectorAll(".stat-value").forEach((node,index)=>node.textContent=values[index]);
    const delta=document.getElementById("todaySalesDelta");
    const change=Number(data.todaySales)-Number(data.yesterdaySales);
    delta.className="stat-delta "+(data.yesterdaySales>0&&change<0?"danger":"positive");
    // The difference in pesos, not a percent.
    delta.textContent=data.yesterdaySales>0?(change<0?"− ":"+ ")+peso(Math.abs(change))+" vs yesterday":"Yesterday: "+peso(data.yesterdaySales);
    document.getElementById("topProducts").innerHTML=data.topProducts.map((row,index)=>`<tr><td>${index+1}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.category)}</td><td>${row.sold}</td><td>${peso(row.grossSales)}</td></tr>`).join("")||'<tr><td colspan="5">No completed sales in this period.</td></tr>';
    document.querySelector(".recent-orders-list").innerHTML=data.recentOrders.map(row=>`<li><span class="order-id">${escapeHtml(row.orderNumber)}</span><span class="order-type">${escapeHtml(row.orderType)}</span><span class="order-amount">${peso(row.total)}</span></li>`).join("")||"<li>No orders yet.</li>";
    document.querySelector(".low-stock-list").innerHTML=data.lowStock.map(row=>`<li><span>${escapeHtml(row.productName)}</span><strong class="${row.status==="Out of Stock"?"critical":""}">${row.quantity} ${escapeHtml(row.measurement)} left</strong></li>`).join("")||"<li>All stock levels are healthy.</li>";
    if(salesChart){salesChart.data.labels=data.salesSeries.map(row=>row.day.slice(5));salesChart.data.datasets[0].data=data.salesSeries.map(row=>row.total);salesChart.options.plugins.emptyState.message="No completed sales";salesChart.update();}
    const counts=["Dine-in","Online","Takeout"].map(type=>data.orderSummary.find(row=>row.type===type)?.count||0);
    if(orderChart){
      orderChart.data.labels=["Dine-in","Online","Takeout"];orderChart.data.datasets[0].data=counts;orderChart.options.plugins.emptyState.message="No orders";
      // A few orders should not look like a full bar: the scale goes past the biggest count.
      orderChart.options.scales.y.suggestedMax=Math.max(5,Math.ceil(Math.max(...counts)*1.25));
      orderChart.update();
    }
    const total=counts.reduce((sum,n)=>sum+n,0);
    document.getElementById("salesChart").setAttribute("aria-label", "Sales overview: " + data.salesSeries.map(row=>row.day+": "+peso(row.total)).join(", "));
    document.getElementById("orderSummaryChart").setAttribute("aria-label", total ? ["Dine-in","Online","Takeout"].map((type,index)=>type+": "+counts[index]).join(", ") : "No orders in this period");
    // Number of orders of each type, not a share of 100%.
    document.querySelectorAll(".donut-legend strong").forEach((node,index)=>node.textContent=counts[index]+(counts[index]===1?" order":" orders"));
    let fallback=document.getElementById("salesFallback");
    if(!fallback){fallback=document.createElement("details");fallback.id="salesFallback";document.querySelector(".sales-chart-wrap").after(fallback);}
    fallback.innerHTML="<summary>Daily sales figures</summary><ul>"+data.salesSeries.map(row=>"<li>"+row.day+": "+peso(row.total)+"</li>").join("")+"</ul>";
    const messages=[];
    if(data.undatedCompletedOrders)messages.push(data.undatedCompletedOrders+" historical completed orders have no completion date and are excluded from dated sales.");
    if(!salesChart||!orderChart)messages.push("Charts could not load. Refresh the page; daily figures and summaries remain available.");
    status.textContent=messages.join(" ");
  }catch(error){
    if(version!==reportVersion)return;
    for(const chart of [salesChart,orderChart]){
      if(chart){chart.options.plugins.emptyState.message="Report unavailable";chart.update();}
    }
    KopiNotice.set(status,"Could not refresh reports: "+error.message,"error");
  }
}
ranges.forEach(select=>{
  const wrapper=select.closest(".range-select-wrap");
  select.addEventListener("focus",()=>wrapper?.classList.add("is-open"));
  select.addEventListener("blur",()=>wrapper?.classList.remove("is-open"));
  select.addEventListener("change",refreshDashboard);
});
window.addEventListener("focus",refreshDashboard);
refreshDashboard();
