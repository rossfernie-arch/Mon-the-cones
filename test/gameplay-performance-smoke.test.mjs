import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import vm from "node:vm";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");

function between(startMarker,endMarker){
 const start=html.indexOf(startMarker),end=html.indexOf(endMarker,start);
 assert.ok(start>=0&&end>start,`source markers found: ${startMarker}`);
 return html.slice(start,end);
}

test("the inline game script remains valid JavaScript",()=>{
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1]);
 assert.equal(scripts.length,1);
 assert.doesNotThrow(()=>new vm.Script(scripts[0],{filename:"index.html:inline-game.js"}));
});

test("initial HTML is small and every extracted artwork file is intact",t=>{
 const bytes=Buffer.byteLength(html),names=[...html.matchAll(/\.\/assets\/embedded\/([a-f0-9]{16}\.(?:webp|png|jpg))/g)].map(m=>m[1]);
 assert.ok(bytes<250_000,`index.html must remain below 250KB: ${bytes}`);
 assert.equal(names.length,18,"all audited embedded images have external references");
 for(const name of names){
  const data=fs.readFileSync(new URL(`../assets/embedded/${name}`,import.meta.url));
  assert.ok(data.length>100,`asset is not empty: ${name}`);
  assert.equal(crypto.createHash("sha256").update(data).digest("hex").slice(0,16),name.slice(0,16),"content-hashed asset unchanged");
 }
 t.diagnostic(`index.html=${bytes} bytes; extracted asset refs=${names.length}`);
});
test("Adventure difficulty progresses monotonically and keeps reaction floors",()=>{
 const source=between("// ADVENTURE_PROGRESSION_START","// ADVENTURE_PROGRESSION_END");
 const context={Math,Number};context.globalThis=context;
 vm.runInNewContext(`${source};globalThis.profile=adventureProfileForMeters`,context);
 const distances=[0,1_000,5_000,10_000,15_000,25_000,50_000];
 const profiles=distances.map(context.profile);
 for(let i=1;i<profiles.length;i++){
  assert.ok(profiles[i].speed>=profiles[i-1].speed,"speed must not fall with distance");
  assert.ok(profiles[i].reactionMs<=profiles[i-1].reactionMs,"reaction time must not rise with distance");
  assert.ok(profiles[i].hazardGap<=profiles[i-1].hazardGap,"hazard gap must not rise with distance");
  assert.ok(profiles[i].density>=profiles[i-1].density,"hazard density must not fall with distance");
 }
 for(const profile of profiles){
  assert.ok(profile.speed<=317);
  assert.ok(profile.reactionMs>=620);
  assert.ok(profile.reaction>=205);
  assert.ok(profile.hazardGap>=225);
  assert.ok(profile.density<=3);
 }
});

test("held-jump integration stays close across the supported frame caps",()=>{
 const first=Number(html.match(/hero\.vy=power==='leap'\?-\d+:-([\d.]+)/)?.[1]);
 const holdAcceleration=Number(html.match(/hero\.vy-=([\d.]+)\*dt/)?.[1]);
 const gravity=Number(html.match(/hero\.vy=Math\.min\(\d+,hero\.vy\+([\d.]+)\*dt\)/)?.[1]);
 const holdWindow=Number(html.match(/hero\.holdTime<([\d.]+)/)?.[1]);
 const coyote=Number(html.match(/hero\.coyote=([\d.]+)/)?.[1]);
 const buffer=Number(html.match(/hero\.buffer=([\d.]+)/)?.[1]);
 for(const value of [first,holdAcceleration,gravity,holdWindow,coyote,buffer])assert.ok(Number.isFinite(value));
 assert.ok(coyote>=.1,"coyote time remains at least 100 ms");
 assert.ok(buffer>=.1,"jump buffering remains at least 100 ms");
 function simulate(fps){
  const dt=1/fps;let y=0,vy=-first,heldFor=0,apex=0,airtime=0;
  while(airtime<2){
   if(vy<0&&heldFor<holdWindow){vy-=holdAcceleration*dt;heldFor+=dt}
   vy+=gravity*dt;y+=vy*dt;airtime+=dt;apex=Math.min(apex,y);
   if(y>=0&&airtime>.1)return{height:-apex,airtime};
  }
  throw Error("jump did not land");
 }
 const envelopes=[60,45,30,25].map(simulate),heights=envelopes.map(item=>item.height),times=envelopes.map(item=>item.airtime);
 assert.ok(Math.max(...heights)-Math.min(...heights)<6,"jump height diverged by frame rate");
 assert.ok(Math.max(...times)-Math.min(...times)<.06,"airtime diverged by frame rate");
});

test("authored route connectors retain safe entrances, exits, and clearances",()=>{
 const source=between("const ROUTE_CHUNKS=","function applyRouteChunk");
 const context={};context.globalThis=context;
 vm.runInNewContext(`${source};globalThis.routes=ROUTE_CHUNKS;globalThis.validate=validateRouteChunk`,context);
 const entries=Object.entries(context.routes);
 assert.equal(entries.length,13);
 for(const [name,route] of entries){
  assert.equal(context.validate(route),true,name);
  assert.equal(route.entry,"ground",`${name} entrance`);
  assert.equal(route.exit,"ground",`${name} exit`);
  assert.ok(route.firstDecision>=240,`${name} gives too little first-decision notice`);
  for(const piece of route.pieces){
   assert.ok(piece.dx>=0&&piece.dx+(piece.width||0)<=route.width,`${name} piece stays inside route`);
   if(piece.kind==="routeCeiling")assert.ok(piece.height-piece.thickness>=80,`${name} ground clearance`);
  }
 }
});

test("character animation rectangles fit their declared atlases",()=>{
 const source=between("const characterRects=","const characterSprites=");
 const context={};context.globalThis=context;
 vm.runInNewContext(`${source};globalThis.rects=characterRects`,context);
 const atlasSizes=[[1448,1086],[1448,1086],[1536,1024],[1448,1086]],minimumFrames=[13,12,12,12];
 assert.equal(context.rects.length,4);
 context.rects.forEach((frames,index)=>{
  assert.ok(frames.length>=minimumFrames[index],`character ${index} has all referenced states`);
  const [width,height]=atlasSizes[index];
  for(const [x,y,w,h] of frames){
   assert.ok(x>=0&&y>=0&&w>0&&h>0,`character ${index} frame dimensions are positive`);
   assert.ok(x+w<=width&&y+h<=height,`character ${index} frame fits atlas`);
  }
 });
 const run=fs.readFileSync(new URL("../assets/courtney/courtney-run-cycle-v3.png",import.meta.url));
 assert.equal(run.toString("ascii",1,4),"PNG");
 assert.deepEqual([run.readUInt32BE(16),run.readUInt32BE(20)],[1448,362]);
});
