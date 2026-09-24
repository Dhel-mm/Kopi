const peso=value=>"₱"+Number(value||0).toFixed(2);
const escapeHtml=value=>String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const ranges=document.querySelectorAll(".range-select");
let reportVersion=0;
function makeChart(id,type) {
  if(typeof Chart==="undefined")return null;
  return new Chart(document.getElementById(id),{
    type,data:{labels:[],datasets:[{data:[],borderColor:"#3d2b16",borderWidth:2,backgroundColor:type==="line"?"#d49b43":["#3d2b16","#d49b43","#f3ddab"],tension:0.25}]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},...(type==="doughnut"?{cutout:"62%"}:{scales:{y:{beginAtZero:true}}})}
  });
}
const salesChart=makeChart("salesChart","line"),orderChart=makeChart("orderSummaryChart","doughnut");
async function refreshDashboard() {
  const version=++reportVersion,status=document.getElementById("dashboardStatus");
  const params=new URLSearchParams();
  ["salesRange","orderRange","productRange"].forEach((key,index)=>params.set(key,ranges[index].selectedIndex===1?"month":"week"));
  try {
    const data=await KopiApi.request("/admin/dashboard?"+params);
    if(version!==reportVersion)return;
    const values=[peso(data.todaySales),data.totalOrders,data.lowStockItems,data.outOfStockItems,data.servedThisWeek];
    document.querySelectorAll(".stat-value").forEach((node,index)=>node.textContent=values[index]);
    const delta=document.querySelector(".stat-delta.positive");
    delta.textContent=data.yesterdaySales>0?((data.todaySales-data.yesterdaySales)/data.yesterdaySales*100).toFixed(1)+"% vs yesterday":"Yesterday: "+peso(data.yesterdaySales);
    document.getElementById("topProducts").innerHTML=data.topProducts.map((row,index)=>`<tr><td>${index+1}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.category)}</td><td>${row.sold}</td><td>${peso(row.grossSales)}</td></tr>`).join("")||'<tr><td colspan="5">No completed sales in this period.</td></tr>';
    document.querySelector(".recent-orders-list").innerHTML=data.recentOrders.map(row=>`<li><span class="order-id">${escapeHtml(row.orderNumber)}</span><span class="order-type">${escapeHtml(row.orderType)}</span><span class="order-amount">${peso(row.total)}</span></li>`).join("")||"<li>No orders yet.</li>";
    document.querySelector(".low-stock-list").innerHTML=data.lowStock.map(row=>`<li><span>${escapeHtml(row.productName)}</span><strong class="${row.status==="Out of Stock"?"critical":""}">${row.quantity} ${escapeHtml(row.measurement)} left</strong></li>`).join("")||"<li>All stock levels are healthy.</li>";
    if(salesChart){salesChart.data.labels=data.salesSeries.map(row=>row.day.slice(5));salesChart.data.datasets[0].data=data.salesSeries.map(row=>row.total);salesChart.update();}
    const counts=["Dine-in","Online","Takeout"].map(type=>data.orderSummary.find(row=>row.type===type)?.count||0);
    if(orderChart){orderChart.data.labels=["Dine-in","Online","Takeout"];orderChart.data.datasets[0].data=counts;orderChart.update();}
    const total=counts.reduce((sum,n)=>sum+n,0);
    document.querySelectorAll(".donut-legend strong").forEach((node,index)=>node.textContent=total?((counts[index]/total)*100).toFixed(1)+"%":"0%");
    let fallback=document.getElementById("salesFallback");
    if(!fallback){fallback=document.createElement("details");fallback.id="salesFallback";document.querySelector(".sales-chart-wrap").after(fallback);}
    fallback.innerHTML="<summary>Daily sales figures</summary><ul>"+data.salesSeries.map(row=>"<li>"+row.day+": "+peso(row.total)+"</li>").join("")+"</ul>";
    status.textContent=data.undatedCompletedOrders?data.undatedCompletedOrders+" historical completed orders have no completion date and are excluded from dated sales.":(!salesChart?"Chart library unavailable. Daily figures and summaries remain available.":"");
  }catch(error){if(version===reportVersion)status.textContent="Could not refresh reports: "+error.message;}
}
ranges.forEach(select=>select.addEventListener("change",refreshDashboard));
window.addEventListener("focus",refreshDashboard);
refreshDashboard();
