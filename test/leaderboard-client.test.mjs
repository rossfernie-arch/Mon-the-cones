import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const queueAt=html.indexOf("const QUEUE='mtcLeaderboardQueue1'");
const start=html.lastIndexOf("(()=>{'use strict';",queueAt);
const end=html.indexOf("}globalThis.MTCLeaderboard={create};})();",start)+"}globalThis.MTCLeaderboard={create};})();".length;
assert.ok(start>=0&&end>start,"leaderboard client source found");
const source=html.slice(start,end);
const ENDPOINT="https://leaderboard.test";
const PLAYER="11111111-1111-4111-8111-111111111111";

function queued(runId,patch={}){return{runId,playerId:PLAYER,displayName:"ROSS",mode:"adventure",level:null,score:100,distance:80,cones:3,durationMs:5000,prizeMask:0,enemyHits:0,gullHits:0,endedAt:Date.now()-10*86400000,build:"old",status:"pending",attempts:0,...patch}}
function harness({fetchImpl=async()=>new Response(JSON.stringify({ok:true}),{status:201,headers:{"Content-Type":"application/json"}}),initial={}}={}){
 const values=new Map(Object.entries(initial).map(([key,value])=>[key,JSON.stringify(value)])),events={};let id=1;
 const localStorage={getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const context={localStorage,fetch:fetchImpl,Response,Request,Headers,AbortController,URLSearchParams,TextEncoder,Date,Error,Math,JSON,Number,String,Array,Set,Promise,console,setTimeout,clearTimeout,navigator:{onLine:true},crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(id++).padStart(12,"0")}`},addEventListener:(name,listener)=>{events[name]=listener},dispatchEvent:()=>{},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail}}};
 context.globalThis=context;vm.runInNewContext(source,context);return{client:context.MTCLeaderboard.create(ENDPOINT),values,events,context};
}
const submit=client=>client.submit({displayName:"ROSS",mode:"adventure",score:120,distance:90,cones:4,durationMs:6000,enemyHits:1,gullHits:2,endedAt:Date.now()});

test("temporary network failure keeps the run queued",async()=>{let h=harness({fetchImpl:async()=>{throw Error("offline")}}),runId=submit(h.client);await h.client.flush();assert.ok(runId);assert.equal(h.client.pending(),1);let queue=JSON.parse(h.values.get("mtcLeaderboardQueue1"));assert.equal(queue[0].runId,runId);assert.equal(queue[0].status,"offline")});
test("HTTP 409 is visible and retained instead of silently deleted",async()=>{let h=harness({fetchImpl:async()=>new Response(JSON.stringify({ok:false,error:"name_taken",retryable:false}),{status:409,headers:{"Content-Type":"application/json"}})}),runId=submit(h.client);await h.client.flush();assert.equal(h.client.failed(),1);assert.equal(h.client.status(runId).lastError,"name_taken")});
test("a final failure does not block a later valid queued run",async()=>{let first="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",second="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",h=harness({initial:{mtcLeaderboardPlayer1:PLAYER,mtcLeaderboardQueue1:[queued(first),queued(second)]},fetchImpl:async(_url,init)=>{let body=JSON.parse(init.body);return body.runId===first?new Response(JSON.stringify({ok:false,error:"invalid_run",retryable:false}),{status:400,headers:{"Content-Type":"application/json"}}):new Response(JSON.stringify({ok:true}),{status:201,headers:{"Content-Type":"application/json"}})}});await h.client.flush();assert.equal(h.client.failed(),1);assert.equal(h.client.status(first).status,"failed");assert.equal(h.client.status(second),null)});
test("old queued runs survive startup instead of expiring after seven days",()=>{let runId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",h=harness({initial:{mtcLeaderboardPlayer1:PLAYER,mtcLeaderboardQueue1:[queued(runId)]}});assert.equal(h.client.pending(),1);assert.equal(h.client.status(runId).runId,runId)});
test("successful retry removes only the acknowledged run",async()=>{let runId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",h=harness({initial:{mtcLeaderboardPlayer1:PLAYER,mtcLeaderboardQueue1:[queued(runId)]}});await h.client.retry(runId);assert.equal(h.client.pending(),0);assert.deepEqual(JSON.parse(h.values.get("mtcLeaderboardQueue1")),[])});
test("corrupted player identity is regenerated and persisted",()=>{let h=harness({initial:{mtcLeaderboardPlayer1:"broken"}});assert.match(h.client.playerId,/^[0-9a-f-]{36}$/);assert.equal(JSON.parse(h.values.get("mtcLeaderboardPlayer1")),h.client.playerId)});
test("offline configuration still queues a run",async()=>{let h=harness(),offline=h.context.MTCLeaderboard.create(""),runId=submit(offline);let summary=await offline.flush();assert.ok(runId);assert.equal(offline.pending(),1);assert.equal(offline.status(runId).status,"offline");assert.equal(summary.offline,true)});
test("queued result survives close and reopens for a successful retry",async()=>{let first=harness({fetchImpl:async()=>{throw Error("offline")}}),runId=submit(first.client);await first.client.flush();let initial=Object.fromEntries([...first.values].map(([key,value])=>[key,JSON.parse(value)])),second=harness({initial});assert.ok(second.client.status(runId));await second.client.flush();assert.equal(second.client.pending(),0);assert.equal(second.client.status(runId),null)});
