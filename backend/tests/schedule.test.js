// Pickup and rider handover times: customers type a date and time, limited to
// opening hours (Tuesday to Sunday, 4:00 PM to 11:00 PM, Philippine time).
// Isolated test databases only.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const schedule=require("../services/schedule");
const {fixture,customer,body}=require("./fixtures");
const {createOrderWorkflow}=require("../services/orderWorkflow");

// A Manila wall-clock time as a real instant (Manila is UTC+8 all year).
const manila=(day,hour,minute=0)=>new Date(Date.UTC(2026,9,day,hour-8,minute));
const typed=(day,time)=>`2026-10-${day}T${time}:00+08:00`;
const SUNDAY=25,MONDAY=26,TUESDAY=27;

test("test dates fall on the expected weekdays",()=>{
  assert.equal(new Date(Date.UTC(2026,9,SUNDAY)).getUTCDay(),0);
  assert.equal(new Date(Date.UTC(2026,9,MONDAY)).getUTCDay(),1);
  assert.equal(new Date(Date.UTC(2026,9,TUESDAY)).getUTCDay(),2);
});

test("as soon as possible is offered only while open, with time to prepare before closing",()=>{
  assert.equal(schedule.asapAvailable(manila(TUESDAY,17)),true);
  assert.equal(schedule.asapAvailable(manila(TUESDAY,22,30)),true);
  assert.equal(schedule.asapAvailable(manila(TUESDAY,22,45)),false);
  assert.equal(schedule.asapAvailable(manila(TUESDAY,15,59)),false);
  assert.equal(schedule.asapAvailable(manila(MONDAY,18)),false);
});

test("the page gets the allowed date range, opening hours and earliest time",()=>{
  const sunday=schedule.options(manila(SUNDAY,12));
  assert.deepEqual([sunday.minDate,sunday.maxDate,sunday.openTime,sunday.closeTime],["2026-10-25","2026-10-31","16:00","23:00"]);
  assert.deepEqual(sunday.earliest,{date:"2026-10-25",time:"16:00"});
  assert.equal(sunday.asap,false);
  // While open, the earliest time is 30 minutes away, rounded up to 5 minutes.
  assert.deepEqual(schedule.options(manila(TUESDAY,17,12)).earliest,{date:"2026-10-27",time:"17:45"});
  // After closing on Sunday, Monday is skipped.
  assert.deepEqual(schedule.options(manila(SUNDAY,23,30)).earliest,{date:"2026-10-27",time:"16:00"});
});

test("typed times are accepted only during opening hours",()=>{
  const now=manila(SUNDAY,12);
  for (const [time,iso] of [[typed(TUESDAY,"16:00"),manila(TUESDAY,16)],[typed(TUESDAY,"19:07"),manila(TUESDAY,19,7)],[typed(TUESDAY,"23:00"),manila(TUESDAY,23)]]) {
    assert.equal(schedule.resolve(time,now),iso.toISOString());
  }
  assert.throws(()=>schedule.resolve(typed(MONDAY,"18:00"),now),/closed on Mondays/);
  assert.throws(()=>schedule.resolve(typed(TUESDAY,"15:59"),now),/between 4:00 PM and 11:00 PM/);
  assert.throws(()=>schedule.resolve(typed(TUESDAY,"23:01"),now),/between 4:00 PM and 11:00 PM/);
  assert.throws(()=>schedule.resolve(typed(TUESDAY,"10:00"),now),/between 4:00 PM and 11:00 PM/);
  // At least 30 minutes ahead, and no further than 7 days.
  assert.throws(()=>schedule.resolve(typed(TUESDAY,"17:20"),manila(TUESDAY,17)),/at least 30 minutes/);
  assert.equal(schedule.resolve(typed(TUESDAY,"17:30"),manila(TUESDAY,17)),manila(TUESDAY,17,30).toISOString());
  assert.equal(schedule.resolve("2026-10-31T18:00:00+08:00",now),new Date(Date.UTC(2026,9,31,10)).toISOString());
  assert.throws(()=>schedule.resolve("2026-11-01T18:00:00+08:00",now),/within the next 7 days/);
  for (const bad of ["tomorrow","2026-10-27T18:00:30+08:00",42]) {
    assert.throws(()=>schedule.resolve(bad,now),/valid date and time/);
  }
});

test("as soon as possible and a missing choice depend on whether the shop is open",()=>{
  assert.equal(schedule.resolve("ASAP",manila(TUESDAY,18)),null);
  assert.equal(schedule.resolve(undefined,manila(TUESDAY,18)),null);
  assert.equal(schedule.resolve("",manila(MONDAY,18)),manila(TUESDAY,16).toISOString());
  assert.throws(()=>schedule.resolve("ASAP",manila(MONDAY,18)),/closed right now/);
});

test("online orders save the chosen time; in-store orders have none",()=>{
  const db=fixture();
  try {
    const workflow=createOrderWorkflow(db,{now:()=>manila(MONDAY,18)});
    const delivery=workflow.create(body({timeSlot:typed(TUESDAY,"20:15")}),customer);
    assert.equal(delivery.scheduledFor,manila(TUESDAY,20,15).toISOString());
    const pickup=workflow.create(body({serviceType:"Pickup",address:"",timeSlot:typed(TUESDAY,"16:00")}),customer);
    assert.equal(pickup.scheduledFor,manila(TUESDAY,16).toISOString());
    assert.throws(()=>workflow.create(body({timeSlot:"ASAP"}),customer),/closed right now/);
    assert.throws(()=>workflow.create(body({timeSlot:typed(MONDAY,"20:00")}),customer),/closed on Mondays/);
    assert.equal(workflow.create(body(),customer).scheduledFor,manila(TUESDAY,16).toISOString());
    const open=createOrderWorkflow(db,{now:()=>manila(TUESDAY,18)});
    assert.equal(open.create(body({timeSlot:"ASAP"}),customer).scheduledFor,null);
    const store=open.create({...body({serviceType:"Takeout",timeSlot:typed(TUESDAY,"20:00")}),address:"",phone:""},{id:2,role:"Admin"},true);
    assert.equal(store.scheduledFor,null);
  } finally {db.close();}
});
