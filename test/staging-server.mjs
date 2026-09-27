import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import worker from "../cloudflare-worker/src/index.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const port=Number(process.env.PORT)||8773;
class MemoryDB{
 constructor(){this.rows=[]}
 prepare(sql){return new Statement(this,sql)}
}
class Statement{
 constructor(db,sql){this.db=db;this.sql=sql;this.args=[]}
 bind(...args){this.args=args;return this}
 async first(){
  if(this.sql.includes("WHERE player_name=?")){let row=this.db.rows.find(r=>r.player_name===this.args[0]);return row?{player_id:row.player_id}:null}
  if(this.sql.includes("WHERE run_id=?")){let row=this.db.rows.find(r=>r.run_id===this.args[0]);return row?{run_id:row.run_id}:null}
  if(this.sql.includes("ABS(ended_at-?)")){let [player,name,mode,score,distance,cones,duration,ended]=this.args,row=this.db.rows.find(r=>(r.player_id===player||r.player_name===name)&&r.mode===mode&&r.score===score&&r.distance===distance&&r.cones===cones&&r.duration_ms===duration&&Math.abs(r.ended_at-ended)<=5000);return row?{run_id:row.run_id}:null}
  return null
 }
 async run(){let a=this.args;this.db.rows.push({id:this.db.rows.length+1,run_id:a[0],player_id:a[1],player_name:a[2],mode:a[3],level:a[4],score:a[5],distance:a[6],cones:a[7],duration_ms:a[8],prize_mask:a[9],enemy_hits:a[10],gull_hits:a[11],build_version:a[12],ended_at:a[13]});return{success:true}}
 async all(){let rows=[...this.db.rows];if(this.sql.includes("mode='campaign'")){rows=rows.filter(r=>r.mode==='campaign'&&r.level===this.args[0]&&r.duration_ms>0).sort((a,b)=>a.duration_ms-b.duration_ms||b.score-a.score)}else{rows=rows.filter(r=>r.mode==='adventure'&&r.duration_ms>0&&(r.distance>0||r.score>0));rows.sort(this.sql.includes("ORDER BY score DESC")?(a,b)=>b.score-a.score||b.distance-a.distance:(a,b)=>b.distance-a.distance||b.score-a.score)}let seen=new Set();return{results:rows.filter(row=>!seen.has(row.player_id)&&(seen.add(row.player_id),true)).slice(0,50)}}
}
const db=new MemoryDB();
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".png":"image/png",".json":"application/json; charset=utf-8"};
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,`http://127.0.0.1:${port}`);
 if(url.pathname==="/qa/state"){res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({rows:db.rows},null,2));return}
 if(url.pathname.startsWith("/v1/")||url.pathname==="/health"){
  let chunks=[];for await(const chunk of req)chunks.push(chunk);let body=chunks.length?Buffer.concat(chunks):undefined;
  let request=new Request(url,{method:req.method,headers:req.headers,body:req.method==="GET"||req.method==="HEAD"?undefined:body}),response=await worker.fetch(request,{DB:db});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return
 }
 let relative=url.pathname==="/"?"index.html":decodeURIComponent(url.pathname.slice(1)),file=path.resolve(root,relative);if(!file.startsWith(root))throw Error("invalid path");let data=await fs.readFile(file);
 if(relative==="index.html")data=Buffer.from(data.toString("utf8").replace("https://mon-the-cones-leaderboard.rossfernie.workers.dev",`http://127.0.0.1:${port}`));res.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream","Cache-Control":"no-store"});res.end(data)
 }catch(error){res.writeHead(error.code==="ENOENT"?404:500,{"Content-Type":"text/plain"});res.end(error.message)}});
server.listen(port,"127.0.0.1",()=>console.log(`Leaderboard staging: http://127.0.0.1:${port}/leaderboard-qa.html`));
