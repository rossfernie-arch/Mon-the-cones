import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const PLAYER="11111111-1111-4111-8111-111111111111";
const OTHER="33333333-3333-4333-8333-333333333333";
const RUN="22222222-2222-4222-8222-222222222222";

class FakeDB{
 constructor(rows=[]){this.rows=rows.map((row,index)=>({id:index+1,enemy_hits:0,gull_hits:0,prize_mask:0,...row}));this.runCalls=0}
 prepare(sql){return new FakeStatement(this,sql)}
}
class FakeStatement{
 constructor(db,sql){this.db=db;this.sql=sql;this.args=[]}
 bind(...args){this.args=args;return this}
 async first(){
  if(this.sql.includes("WHERE player_name=?")){let row=this.db.rows.find(r=>r.player_name===this.args[0]);return row?{player_id:row.player_id}:null}
  if(this.sql.includes("WHERE run_id=?")){let row=this.db.rows.find(r=>r.run_id===this.args[0]);return row?{run_id:row.run_id}:null}
  if(this.sql.includes("ABS(ended_at-?)")){let [player,displayName,mode,score,distance,cones,duration,ended]=this.args,row=this.db.rows.find(r=>(r.player_id===player||r.player_name===displayName)&&r.mode===mode&&r.score===score&&r.distance===distance&&r.cones===cones&&r.duration_ms===duration&&Math.abs(r.ended_at-ended)<=5000);return row?{run_id:row.run_id}:null}
  return null
 }
 async run(){
  this.db.runCalls++;let a=this.args;this.db.rows.push({id:this.db.rows.length+1,run_id:a[0],player_id:a[1],player_name:a[2],mode:a[3],level:a[4],score:a[5],distance:a[6],cones:a[7],duration_ms:a[8],prize_mask:a[9],enemy_hits:a[10],gull_hits:a[11],build_version:a[12],ended_at:a[13]});return{success:true}
 }
 async all(){
  let rows=[...this.db.rows];if(this.sql.includes("mode='campaign'")){rows=rows.filter(r=>r.mode==="campaign"&&r.level===this.args[0]&&r.duration_ms>0);rows.sort((a,b)=>a.duration_ms-b.duration_ms||b.score-a.score)}else{rows=rows.filter(r=>r.mode==="adventure"&&r.duration_ms>0&&(r.distance>0||r.score>0));if(this.sql.includes("ORDER BY score DESC"))rows.sort((a,b)=>b.score-a.score||b.distance-a.distance);else rows.sort((a,b)=>b.distance-a.distance||b.score-a.score)}
  let seen=new Set();rows=rows.filter(row=>!seen.has(row.player_id)&&(seen.add(row.player_id),true)).slice(0,50);return{results:rows}
 }
}

const call=(path,{method="GET",body,db=new FakeDB(),headers={}}={})=>worker.fetch(new Request("https://example.test"+path,{method,headers:body?{"Content-Type":"application/json",...headers}:headers,body:body?JSON.stringify(body):undefined}),{DB:db});
const validRun=(patch={})=>({runId:RUN,playerId:PLAYER,displayName:"ABC1234",mode:"adventure",level:null,score:321,distance:250,cones:4,durationMs:12000,prizeMask:0,enemyHits:2,gullHits:1,endedAt:Date.now(),build:"unit-test",...patch});

test("health identifies Worker v3",async()=>{let response=await call("/health");assert.equal(response.status,200);assert.equal((await response.json()).version,"3")});
test("name check enforces seven ASCII alphanumerics",async()=>{let response=await call(`/v1/name?displayName=ABC1234&playerId=${PLAYER}`);assert.equal(response.status,200);for(const bad of ["ABCDEFGH","ROSS!","ÅBC"]){response=await call(`/v1/name?displayName=${encodeURIComponent(bad)}&playerId=${PLAYER}`);assert.equal(response.status,400)}});
test("an existing display name does not reject a regenerated player id",async()=>{let db=new FakeDB([{player_name:"ROSS",player_id:OTHER}]),response=await call(`/v1/name?displayName=ROSS&playerId=${PLAYER}`,{db}),data=await response.json();assert.equal(response.status,200);assert.equal(data.available,true);assert.equal(data.used,true)});
test("valid Adventure submission stores every gameplay field",async()=>{let db=new FakeDB(),response=await call("/v1/runs",{method:"POST",body:validRun(),db});assert.equal(response.status,201);assert.equal(db.rows.length,1);assert.equal(db.rows[0].enemy_hits,2);assert.equal(db.rows[0].gull_hits,1);assert.equal(db.rows[0].build_version,"unit-test")});
test("valid high and small Adventure results are accepted",async()=>{let db=new FakeDB(),high=await call("/v1/runs",{method:"POST",body:validRun({score:9999999,distance:999999,cones:99999,durationMs:86399999}),db}),small=await call("/v1/runs",{method:"POST",body:validRun({runId:"66666666-6666-4666-8666-666666666666",score:0,distance:1,cones:0,durationMs:1}),db});assert.equal(high.status,201);assert.equal(small.status,201)});
test("duplicate run id is idempotent",async()=>{let db=new FakeDB();await call("/v1/runs",{method:"POST",body:validRun(),db});let response=await call("/v1/runs",{method:"POST",body:validRun(),db}),data=await response.json();assert.equal(response.status,200);assert.equal(data.duplicate,true);assert.equal(db.rows.length,1)});
test("recovery submission detects an equivalent accepted run",async()=>{let original=validRun(),db=new FakeDB();await call("/v1/runs",{method:"POST",body:original,db});let response=await call("/v1/runs",{method:"POST",body:validRun({runId:"44444444-4444-4444-8444-444444444444",endedAt:original.endedAt+1000,recovery:true}),db}),data=await response.json();assert.equal(response.status,200);assert.equal(data.recovered,true);assert.equal(db.rows.length,1)});
test("invalid values return machine-readable fields and never write",async()=>{let db=new FakeDB();for(const patch of [{displayName:"ABCDEFGH"},{score:-1},{prizeMask:8},{endedAt:Date.now()+172800000}]){let response=await call("/v1/runs",{method:"POST",body:validRun(patch),db}),data=await response.json();assert.ok([400,422].includes(response.status));assert.equal(data.retryable,false);assert.ok(data.field)}assert.equal(db.runCalls,0)});
test("campaign submissions require a real level",async()=>{let response=await call("/v1/runs",{method:"POST",body:validRun({mode:"campaign",level:99})});assert.equal(response.status,400);assert.equal((await response.json()).error,"invalid_level")});
test("valid Campaign completion is accepted",async()=>{let db=new FakeDB(),response=await call("/v1/runs",{method:"POST",body:validRun({mode:"campaign",level:1,score:0,distance:2100,prizeMask:7}),db});assert.equal(response.status,201);assert.equal(db.rows[0].level,1);assert.equal(db.rows[0].prize_mask,7)});
test("Adventure boards ignore zero-value name checks and keep same-name players",async()=>{let db=new FakeDB([
 {run_id:"a",player_id:PLAYER,player_name:"ROSS",mode:"adventure",score:100,distance:90,cones:1,duration_ms:5000,ended_at:1},
 {run_id:"b",player_id:PLAYER,player_name:"ROSS",mode:"adventure",score:200,distance:150,cones:2,duration_ms:6000,ended_at:2},
 {run_id:"c",player_id:OTHER,player_name:"ROSS",mode:"adventure",score:180,distance:170,cones:3,duration_ms:6500,ended_at:3},
 {run_id:"d",player_id:"55555555-5555-4555-8555-555555555555",player_name:"ZERO",mode:"adventure",score:0,distance:0,cones:0,duration_ms:0,ended_at:4}
 ]);let response=await call("/v1/leaderboard?mode=adventure&metric=distance",{db}),data=await response.json();assert.deepEqual(data.entries.map(r=>r.distance),[170,150]);assert.deepEqual(data.entries.map(r=>r.displayName),["ROSS","ROSS"])});
test("Adventure score board uses score rather than distance",async()=>{let db=new FakeDB([{run_id:"a",player_id:PLAYER,player_name:"A",mode:"adventure",score:1000,distance:100,cones:1,duration_ms:5000,ended_at:1},{run_id:"b",player_id:OTHER,player_name:"B",mode:"adventure",score:900,distance:500,cones:2,duration_ms:6000,ended_at:2}]),response=await call("/v1/leaderboard?mode=adventure&metric=score",{db}),data=await response.json();assert.deepEqual(data.entries.map(r=>r.score),[1000,900])});
test("campaign board returns one fastest run per player",async()=>{let db=new FakeDB([
 {run_id:"a",player_id:PLAYER,player_name:"A",mode:"campaign",level:1,score:0,distance:2100,cones:3,duration_ms:90000,ended_at:1},
 {run_id:"b",player_id:PLAYER,player_name:"A",mode:"campaign",level:1,score:0,distance:2100,cones:4,duration_ms:80000,ended_at:2},
 {run_id:"c",player_id:OTHER,player_name:"B",mode:"campaign",level:1,score:0,distance:2100,cones:4,duration_ms:85000,ended_at:3}
 ]);let response=await call("/v1/leaderboard?mode=campaign&metric=time&level=1",{db}),data=await response.json();assert.deepEqual(data.entries.map(r=>r.durationMs),[80000,85000])});
