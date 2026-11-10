'use strict';
const path=require('node:path'),{DatabaseSync}=require('node:sqlite');
// Read acknowledgements belong to this installation. Results themselves remain
// in the collection, committed by the existing Timing transaction. The inbox is
// derived from those durable results, so a crash between delivery and notice
// cannot lose a notice. No lap arrays or complete collection are loaded here.
class ResultInbox {
 constructor(profile){
  this.file=path.join(profile,'result-review.sqlite');this.db=new DatabaseSync(this.file,{timeout:5000});
  try{this.db.exec('CREATE TABLE IF NOT EXISTS seen(database_id TEXT NOT NULL,source TEXT NOT NULL,session TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(database_id,source,session)) STRICT');}catch(error){this.db.close();throw error;}this.generation=0;
 }
 attach(reader){if(!reader.resultInboxAttached){reader.db.prepare('ATTACH DATABASE ? AS result_review').run(this.file);reader.resultInboxAttached=true;}}
 read(reader,offset=null){try{return this.readPage(reader,offset);}catch{return {total:0,error:'Race-result notices could not be read. Your saved results remain available in each car’s Performance section. Restart Paddock and check the profile storage.'};}}
 readPage(reader,offset=null){
  const cacheKey=JSON.stringify([reader.token,this.generation]);
  if(offset===null&&this.cache?.key===cacheKey)return {total:this.cache.total};
  this.attach(reader);
  const from=`FROM query_sessions s INDEXED BY query_session_notice LEFT JOIN result_review.seen a ON a.database_id=? AND a.source=s.source AND a.session=s.session WHERE a.hash IS NULL OR a.hash<>json_extract(s.json,'$.contentHash')`;
  const total=reader.db.prepare('SELECT count(*) n '+from).get(reader.id).n;this.cache={key:cacheKey,total};
  if(offset===null)return {total};
  const rows=reader.db.prepare(`SELECT s.source,s.session,json_extract(s.json,'$.contentHash') hash,s.received,
   json_extract(s.json,'$.lastName') name,json_extract(s.json,'$.payload.revision') revision,json_extract(s.json,'$.payload.state') state,
   (SELECT json_extract(p.value,'$.carId') FROM json_each(s.json,'$.payload.participants') p WHERE json_extract(p.value,'$.kind')='physical' LIMIT 1) primaryCar,json_extract(s.json,'$.payload.track.name') track,json_extract(s.json,'$.carIds') cars,
   json_array_length(s.json,'$.history') corrections ${from} ORDER BY s.received DESC,s.key LIMIT 20 OFFSET ?`).all(reader.id,offset);
  return {total,rows:rows.map(row=>({...row,cars:JSON.parse(row.cars||'[]')}))};
 }
 seen(databaseId,p){
  for(const key of ['source','session','hash'])if(typeof p?.[key]!=='string'||!p[key]||p[key].length>256)throw Error('Invalid result acknowledgement.');
  if(!/^[a-f0-9]{64}$/.test(p.hash))throw Error('Invalid result hash.');
  // Acknowledge only the hash displayed. A correction arriving during reading
  // remains unseen; this action never modifies or approves a race result.
  this.db.prepare('INSERT INTO seen VALUES(?,?,?,?) ON CONFLICT(database_id,source,session) DO UPDATE SET hash=excluded.hash').run(databaseId,p.source,p.session,p.hash);this.generation++;this.cache=null;
 }
 close(){this.db.close();}
}
module.exports={ResultInbox};
