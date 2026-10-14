import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const read=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
test('fresh database applies all sequential migrations',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(read('0001_initial.sql'));
  db.exec(read('0002_reliability.sql'));
  const columns=db.prepare('PRAGMA table_info(scores)').all().map(row=>row.name);
  for(const field of ['enemy_hits','gull_hits','build_version'])assert.ok(columns.includes(field),field);
  db.prepare('INSERT INTO scores(run_id,player_id,player_name,mode,score,ended_at) VALUES(?,?,?,?,?,?)').run('id1','player1','BAMPOT','adventure',100,123);
  const row=db.prepare('SELECT enemy_hits,gull_hits FROM scores WHERE run_id=?').get('id1');
  assert.equal(row.enemy_hits,0);assert.equal(row.gull_hits,0);
 }finally{db.close()}
});
test('upgrade migration preserves records in historical pre-v3 database',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(read('0001_initial.sql'));
  db.prepare('INSERT INTO scores(run_id,player_id,player_name,mode,score,ended_at) VALUES(?,?,?,?,?,?)').run('historical','player1','BAMPOT','adventure',400,123);
  db.exec(read('0002_reliability.sql'));
  assert.equal(db.prepare("SELECT score FROM scores WHERE run_id='historical'").get().score,400);
 }finally{db.close()}
});