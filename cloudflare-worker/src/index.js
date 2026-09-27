const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
const MAX_BODY_BYTES=4096;
const MAX_FUTURE_SKEW_MS=86400000;
const NAME_RE=/^[A-Za-z0-9]{1,7}$/;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BLOCKED=new Set(["FUCK","FUCKER","FUCKIN","FUCKING","SHIT","SHITE","BITCH","BASTARD","CUNT","CUNTS","DICK","DICKS","COCK","COCKS","PISS","PISSED","WANK","WANKER","WANKERS","TWAT","ARSE","ARSEHOLE","ASSHOLE","SLUT","WHORE"]);
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","X-Content-Type-Options":"nosniff","Cache-Control":"no-store"}});
const fail=(error,status,field,message)=>json({ok:false,error,field,retryable:false,message},status);
const name=value=>typeof value==="string"&&NAME_RE.test(value)?value.toUpperCase():null;
const uuid=value=>typeof value==="string"&&UUID_RE.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;

export default {async fetch(request,env){
 try{
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  const url=new URL(request.url);
  if(url.pathname==="/health")return json({ok:true,service:"mon-the-cones-leaderboard",version:"3"});
  if(url.pathname==="/v1/name"&&request.method==="GET")return nameAvailability(url,env);
  if(url.pathname==="/v1/runs"&&request.method==="POST")return submit(request,env);
  if(url.pathname==="/v1/leaderboard"&&request.method==="GET")return board(url,env);
  return json({ok:false,error:"not_found",retryable:false},404);
 }catch(error){
  console.error("Leaderboard request failed",error);
  return json({ok:false,error:"internal_error",retryable:true,message:"Leaderboard temporarily unavailable."},500);
 }
}};

async function parseBody(request){
 const declared=Number(request.headers.get("Content-Length")||0);
 if(Number.isFinite(declared)&&declared>MAX_BODY_BYTES)return{response:fail("request_too_large",413,"body","Submission is too large.")};
 let raw;try{raw=await request.text()}catch{return{response:fail("invalid_body",400,"body","Submission could not be read.")}}
 if(new TextEncoder().encode(raw).length>MAX_BODY_BYTES)return{response:fail("request_too_large",413,"body","Submission is too large.")};
 try{return{body:JSON.parse(raw)}}catch{return{response:fail("invalid_json",400,"body","Submission is not valid JSON.")}}
}

async function nameAvailability(url,env){
 const displayName=name(url.searchParams.get("displayName")),playerId=url.searchParams.get("playerId")||"";
 if(!displayName)return fail("invalid_identity",400,"displayName","Use 1–7 letters or numbers.");
 if(!uuid(playerId))return fail("invalid_identity",400,"playerId","Player identity is invalid.");
 if(BLOCKED.has(displayName))return fail("name_blocked",400,"displayName","Choose another player name.");
 const existing=await env.DB.prepare("SELECT player_id FROM scores WHERE player_name=? LIMIT 1").bind(displayName).first();
 return json({ok:true,displayName,available:true,used:!!existing,owned:!!existing&&existing.player_id===playerId});
}

async function submit(request,env){
 const parsed=await parseBody(request);if(parsed.response)return parsed.response;const body=parsed.body||{};
 const displayName=name(body.displayName),mode=body.mode==="adventure"||body.mode==="campaign"?body.mode:null;
 if(!uuid(body.runId))return fail("invalid_identity",400,"runId","Run identity is invalid.");
 if(!uuid(body.playerId))return fail("invalid_identity",400,"playerId","Player identity is invalid.");
 if(!displayName)return fail("invalid_identity",400,"displayName","Use 1–7 letters or numbers.");
 if(BLOCKED.has(displayName))return fail("name_blocked",400,"displayName","Choose another player name.");
 if(!mode)return fail("invalid_mode",400,"mode","Run mode is invalid.");
 for(const field of ["score","distance","cones","durationMs","prizeMask","enemyHits","gullHits","endedAt"]){
  const fallback=["prizeMask","enemyHits","gullHits"].includes(field)?0:undefined,value=body[field]??fallback;
  if(!integer(value))return fail(field==="endedAt"?"invalid_ended_at":"invalid_run",400,field,`${field} must be a non-negative integer.`);
 }
 if(body.score>1e7)return fail("implausible_run",422,"score","Score is outside the supported range.");
 if(body.distance>1e6)return fail("implausible_run",422,"distance","Distance is outside the supported range.");
 if(body.cones>1e5)return fail("implausible_run",422,"cones","Cone count is outside the supported range.");
 if(body.durationMs>86400000)return fail("implausible_run",422,"durationMs","Duration is outside the supported range.");
 if(body.prizeMask>7)return fail("invalid_run",400,"prizeMask","Prize mask is invalid.");
 if(body.enemyHits>1e5||body.gullHits>1e5)return fail("implausible_run",422,"enemyHits","Hit count is outside the supported range.");
 if(body.endedAt>Date.now()+MAX_FUTURE_SKEW_MS)return fail("invalid_ended_at",422,"endedAt","Run end time is too far in the future.");
 const level=mode==="campaign"&&Number.isInteger(body.level)&&body.level>=1&&body.level<=5?body.level:null;
 if(mode==="campaign"&&!level)return fail("invalid_level",400,"level","Campaign level must be between 1 and 5.");
 const duplicate=await env.DB.prepare("SELECT run_id FROM scores WHERE run_id=? LIMIT 1").bind(body.runId).first();
 if(duplicate)return json({ok:true,duplicate:true,runId:duplicate.run_id});
 if(body.recovery===true){
  const recovered=await env.DB.prepare("SELECT run_id FROM scores WHERE (player_id=? OR player_name=?) AND mode=? AND score=? AND distance=? AND cones=? AND duration_ms=? AND ABS(ended_at-?)<=5000 LIMIT 1").bind(body.playerId,displayName,mode,body.score,body.distance,body.cones,body.durationMs,body.endedAt).first();
  if(recovered)return json({ok:true,duplicate:true,recovered:true,runId:recovered.run_id});
 }
 const build=typeof body.build==="string"&&body.build?body.build.slice(0,60):"unknown";
 await env.DB.prepare("INSERT INTO scores(run_id,player_id,player_name,mode,level,score,distance,cones,duration_ms,prize_mask,enemy_hits,gull_hits,build_version,ended_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(body.runId,body.playerId,displayName,mode,level,body.score,body.distance,body.cones,body.durationMs,body.prizeMask||0,body.enemyHits||0,body.gullHits||0,build,body.endedAt).run();
 return json({ok:true,runId:body.runId},201);
}

async function board(url,env){
 const modeValue=url.searchParams.get("mode"),mode=modeValue==="adventure"||modeValue==="campaign"?modeValue:null;
 if(!mode)return fail("invalid_mode",400,"mode","Leaderboard mode is invalid.");
 const metricValue=url.searchParams.get("metric")||"distance",metric=metricValue==="score"||metricValue==="distance"||metricValue==="time"?metricValue:null;
 if(!metric||mode==="adventure"&&metric==="time"||mode==="campaign"&&metric!=="time")return fail("invalid_metric",400,"metric","Leaderboard metric is invalid.");
 const requestedPlayer=url.searchParams.get("playerId")||"",playerId=uuid(requestedPlayer)?requestedPlayer:"";
 let sql,args=[];
 if(mode==="campaign"){
  const level=Number(url.searchParams.get("level"));if(!Number.isInteger(level)||level<1||level>5)return fail("invalid_level",400,"level","Campaign level must be between 1 and 5.");
  sql="SELECT * FROM (SELECT scores.*,ROW_NUMBER() OVER(PARTITION BY player_id ORDER BY duration_ms ASC,score DESC,ended_at ASC,id ASC) AS player_row FROM scores WHERE mode='campaign' AND level=? AND duration_ms>0) WHERE player_row=1 ORDER BY duration_ms ASC,score DESC,ended_at ASC LIMIT 50";args=[level];
 }else{
  const order=metric==="score"?"score DESC,distance DESC,ended_at ASC,id ASC":"distance DESC,score DESC,ended_at ASC,id ASC";
  sql=`SELECT * FROM (SELECT scores.*,ROW_NUMBER() OVER(PARTITION BY player_id ORDER BY ${order}) AS player_row FROM scores WHERE mode='adventure' AND duration_ms>0 AND (distance>0 OR score>0)) WHERE player_row=1 ORDER BY ${order} LIMIT 50`;
 }
 const statement=env.DB.prepare(sql);const{results=[]}=args.length?await statement.bind(...args).all():await statement.all();
 const entries=results.map(row=>({playerId:row.player_id,displayName:row.player_name,score:row.score,distance:row.distance,cones:row.cones,durationMs:row.duration_ms,prizeMask:row.prize_mask,enemyHits:row.enemy_hits||0,gullHits:row.gull_hits||0,level:row.level}));
 const own=entries.findIndex(entry=>entry.playerId===playerId);return json({ok:true,entries,ownRank:own<0?null:own+1});
}
