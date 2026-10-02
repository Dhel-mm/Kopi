const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../Admin/Dashboard.js'),'utf8');

function dashboard({empty=false,missingLibrary=false,requestError=false}={}) {
  const nodes=new Map(),charts=[];
  function node(key) {
    if(!nodes.has(key))nodes.set(key,{textContent:'',innerHTML:'',selectedIndex:0,
      setAttribute(name,value){this[name]=value;},addEventListener(){},closest(){return null;},after(){}});
    return nodes.get(key);
  }
  const ranges=[node('range1'),node('range2'),node('range3')];
  const stats=Array.from({length:5},(_,i)=>node('stat'+i));
  const legend=Array.from({length:3},(_,i)=>node('legend'+i));
  const context={URLSearchParams,console,
    document:{getElementById:node,querySelector:node,createElement:()=>node('created'),
      querySelectorAll:selector=>selector==='.range-select'?ranges:selector==='.stat-value'?stats:legend},
    window:{addEventListener(){}},KopiNotice:{set(target,message){target.textContent=message;}},
    KopiApi:{async request(){
      if(requestError)throw Error('Test connection failure');
      return {todaySales:120,totalOrders:2,yesterdaySales:0,lowStockItems:0,outOfStockItems:0,servedThisWeek:1,
        topProducts:[],recentOrders:[],lowStock:[],salesSeries:[{day:'2026-09-28',total:empty?0:120}],
        orderSummary:empty?[]:[{type:'Online',count:2}]};
    }}
  };
  if(!missingLibrary)context.Chart=class{
    constructor(canvas,config){Object.assign(this,config);this.config=config;charts.push(this);}
    update(){this.updated=true;}
  };
  vm.runInNewContext(source,context);
  return {charts,nodes,stats,legend};
}

test('Dashboard bundles pinned Chart.js locally instead of relying on a CDN',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../../Admin/Dashboard.html'),'utf8');
  assert.match(html,/src="vendor\/chart\.umd-4\.4\.4\.js"/);
  assert.doesNotMatch(html,/src="https:[^"]*chart\.js/);
  assert.equal(require('../../Admin/vendor/chart.umd-4.4.4.js').version,'4.4.4');
});

test('Dashboard updates both charts and labels their actual report values',async()=>{
  const {charts,nodes,legend}=dashboard();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(charts.length,2);
  assert.equal(charts[0].data.datasets[0].data[0],120);
  assert.equal(charts[1].data.datasets[0].data[1],2);
  assert.equal(legend[1].textContent,'100.0%');
  assert.match(nodes.get('salesChart')['aria-label'],/120.00/);
  assert.ok(charts.every(chart=>chart.updated));
});

test('Empty periods draw a neutral ring and no-sales message without inventing data',async()=>{
  const {charts,legend}=dashboard({empty:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(charts[0].options.plugins.emptyState.message,'No completed sales');
  assert.equal(charts[1].options.plugins.emptyState.message,'No orders');
  assert.ok(charts[1].data.datasets[0].data.every(count=>count===0));
  assert.ok(legend.every(node=>node.textContent==='0%'));
  let arcs=0,message;
  const chart=charts[1];
  chart.ctx={save(){},restore(){},beginPath(){},arc(){arcs++;},stroke(){},fillText(text){message=text;}};
  chart.chartArea={left:0,right:160,top:0,bottom:160};
  chart.plugins[0].afterDraw(chart,{},chart.options.plugins.emptyState);
  assert.equal(arcs,1);assert.equal(message,'No orders');
});

test('Library failure preserves summaries and API errors replace the loading message',async()=>{
  const missing=dashboard({missingLibrary:true}),failed=dashboard({requestError:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(missing.stats[0].textContent,'₱120.00');
  assert.match(missing.nodes.get('dashboardStatus').textContent,/Charts could not load/);
  assert.ok(failed.charts.every(chart=>chart.options.plugins.emptyState.message==='Report unavailable'));
  assert.match(failed.nodes.get('dashboardStatus').textContent,/Test connection failure/);
});
