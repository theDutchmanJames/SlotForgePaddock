'use strict';
// Read-only, revision-bound application queries. SQL identifiers and ordering
// expressions are allowlisted; values never become SQL text.
const {DatabaseSync}=require('node:sqlite');
const records=require('./sqlite-records.cjs'),lazy=require('./lazy-assets.cjs');
const buckets=new Set(['cars','parts','events','setups','tests','jobs','installations','assemblies','documents','submissions','supplies','views']);
const fault=(code,message)=>Object.assign(new Error(message),{code});
class Reader {
 constructor(file,expected){
  this.file=file;this.db=new DatabaseSync(file,{readOnly:true,timeout:5000});this.reads=0;
  this.db.function('sf_sort_text',{deterministic:true},value=>String(value||'').toLowerCase());
  try{this.db.exec('BEGIN');const value=this.db.prepare("SELECT value FROM state WHERE key='identity'").get();if(!value)throw fault('QUERY_UNAVAILABLE','This collection has not been saved.');[this.id,this.revision]=JSON.parse(value.value);
   this.epoch=this.db.prepare("SELECT value FROM state WHERE key='change_epoch'").get()?.value;
   if(expected&&(expected.id!==this.id||expected.revision!==this.revision||expected.epoch!==this.epoch))throw fault('QUERY_CHANGED','The collection changed. Refresh this page.');
   this.token={id:this.id,revision:this.revision,epoch:this.epoch};
   require('./car-merge-query.cjs').install(this);
  }catch(e){this.db.close();throw e;}
 }
 close(){this.db.close();}
 record(key,{assetHandle=false}={}){
  const row=this.db.prepare('SELECT json FROM records WHERE key=?').get(key);if(!row)return null;this.reads++;
  const envelope=records.decode(row.json,this.db.prepare('SELECT path,json FROM record_fields WHERE record=?').all(key).map(r=>[r.path,r.json]));
  const expected=new Set(envelope.refs.map(ref=>ref.hash)),actual=new Set(this.db.prepare('SELECT hash FROM asset_refs WHERE record=?').all(key).map(r=>r.hash));if(expected.size!==actual.size||[...expected].some(hash=>!actual.has(hash)))throw Error('Attachment reference integrity check failed.');
  for(const ref of envelope.refs){const row=this.db.prepare('SELECT meta,meta_digest,length(value) size FROM assets WHERE hash=?').get(ref.hash);if(!row)throw Error('Missing attachment.');const meta=JSON.parse(row.meta);if(lazy.digest(row.meta)!==row.meta_digest||!lazy.valid(meta,ref.hash,row.size))throw Error('Attachment metadata integrity check failed.');const asset=lazy.asset(this.file,meta);if(!ref.path.length){envelope.value=assetHandle?asset:asset.read();continue;}let owner=envelope.value;for(const k of ref.path.slice(0,-1)){if(!owner||!Object.hasOwn(owner,k))throw Error('Invalid attachment reference.');owner=owner[k];}if(!owner||!Object.hasOwn(owner,ref.path.at(-1)))throw Error('Invalid attachment reference.');lazy.attach(owner,ref.path.at(-1),asset);}
  return envelope.value;
 }
 one(bucket,id){if(!buckets.has(bucket))throw fault('INVALID_QUERY','Unknown record type.');return this.record(JSON.stringify([bucket,'id:'+id]));}
 scalar(...path){return this.record(JSON.stringify(path));}
 list(bucket,options={}){
  if(!buckets.has(bucket))throw fault('INVALID_QUERY','Unknown record type.');
  const {offset=0,limit=50,sort='order',query='',carId,archived,status,ids,usage=[],matchAll=false}=options;
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200||typeof query!=='string'||query.length>500||!['order','name','maker','updated','date','marque','model','scale','reference','created'].includes(sort)||(options.direction!==undefined&&!['asc','desc'].includes(options.direction))||!Array.isArray(usage)||usage.length>100||usage.some(v=>typeof v!=='string')||ids&&(!Array.isArray(ids)||ids.length>10000||ids.some(v=>typeof v!=='string')))throw fault('INVALID_QUERY','Invalid record query.');
  const where=['r.bucket=?'],params=[JSON.stringify([bucket])];
  for(const [field,value] of Object.entries({category:options.category,partType:options.partType,partId:options.partId,removed:options.removed})){if(value!==undefined){where.push(`json_extract(q.aux,'$.${field}')=?`);params.push(typeof value==='boolean'?Number(value):value);}}if(options.hasField)where.push("json_extract(q.aux,'$.field')<>''");if(options.owned){where.push("json_extract(q.aux,'$.quantity')>0");}if(options.types){if(!Array.isArray(options.types)||options.types.length>20)throw fault('INVALID_QUERY','Invalid event types.');where.push('q.type IN ('+options.types.map(()=>'?').join(',')+')');params.push(...options.types);}if(carId!==undefined){where.push('q.car_id=?');params.push(carId);}
  if(options.guides){where.push("EXISTS (SELECT 1 FROM record_fields f WHERE f.record=r.key AND f.path='[\"guide\"]' AND f.json='true')");}
  if(options.generalGuide)where.push('q.car_id IS NULL');
  if(options.guideQuery){if(typeof options.guideQuery!=='string'||options.guideQuery.length>500)throw fault('INVALID_QUERY','Invalid guide search.');where.push("EXISTS (SELECT 1 FROM record_fields f WHERE f.record=r.key AND f.path IN ('[\"title\"]','[\"name\"]') AND instr(sf_sort_text(json_extract(f.json,'$')),?)>0)");params.push(options.guideQuery.toLowerCase());}
  if(options.maker!==undefined){if(typeof options.maker!=='string')throw fault('INVALID_QUERY','Invalid manufacturer.');where.push('q.maker=?');params.push(options.maker.toLowerCase());}
  if(options.unowned)where.push("json_extract(q.aux,'$.quantity')=0");
  if(archived!==undefined){where.push('q.archived=?');params.push(archived?1:0);}
  if(status!==undefined){where.push('q.status=?');params.push(status);}
  if(ids){if(!ids.length)return {rows:[],total:0,nextOffset:null,token:this.token};where.push(`r.identity IN (${ids.map(()=>'?').join(',')})`);params.push(...ids.map(id=>'id:'+id));}
  if(query){where.push('instr(q.search,?)>0');params.push(query.toLowerCase());}
  if(usage.length){const checks=usage.map(()=>"EXISTS (SELECT 1 FROM json_each(q.usage) u WHERE u.value=?)");where.push('('+checks.join(matchAll?' AND ':' OR ')+')');params.push(...usage);}
  // The manifest is the authoritative order for compatibility with existing
  // collection exports. JSON_each visits only record references, never bodies.
  const from=` FROM records r JOIN query_records q ON q.key=r.key WHERE ${where.join(' AND ')}`;
  const total=this.db.prepare('SELECT count(*) n'+from).get(...params).n;
  let keys=[];
  if(!options.countOnly){
   if(sort==='order'){
    // Fix the loop order: otherwise SQLite can scan all manifest ordinals for
    // every matching record (quadratic at thousands of cars/history entries).
    // CROSS JOIN still uses the equality predicates and primary-key lookups.
    const sql=`WITH ordinals AS MATERIALIZED (SELECT json_extract(a.value,'$.record') key,CAST(a.key AS INTEGER) position
     FROM json_each((SELECT m.value FROM json_each((SELECT value FROM state WHERE key='manifest'),'$.object') m WHERE json_extract(m.value,'$[0]')=?),'$[1].array') a)
     SELECT r.key FROM ordinals o CROSS JOIN records r ON r.key=o.key CROSS JOIN query_records q ON q.key=r.key WHERE ${where.join(' AND ')} ORDER BY o.position LIMIT ? OFFSET ?`;
    keys=this.db.prepare(sql).all(bucket,...params,limit,offset);
   }else {
    const scalar=['marque','model','scale','reference','created'].includes(sort);
    const expression=scalar?`COALESCE((SELECT sf_sort_text(json_extract(f.json,'$')) FROM record_fields f WHERE f.record=r.key AND f.path='["${sort}"]'),'')`:`q.${sort}`;
    const direction=options.direction?.toUpperCase()||(['date','updated','created'].includes(sort)?'DESC':'ASC');
    keys=this.db.prepare('SELECT r.key'+from+` ORDER BY (${expression}='') ASC,${expression} ${direction},r.identity ASC LIMIT ? OFFSET ?`).all(...params,limit,offset);
   }
  }
  return {rows:keys.map(r=>options.idsOnly?JSON.parse(r.key)[1].slice(3):this.record(r.key)),total,nextOffset:offset+keys.length<total?offset+keys.length:null,token:this.token};
 }
 count(bucket,options={}){return this.list(bucket,{...options,countOnly:true}).total;}
 reminders(){return this.db.prepare(`WITH ordinals AS MATERIALIZED (SELECT json_extract(a.value,'$.record') key,CAST(a.key AS INTEGER) ordinal FROM json_each((SELECT m.value FROM json_each((SELECT value FROM state WHERE key='manifest'),'$.object') m WHERE json_extract(m.value,'$[0]')='events'),'$[1].array') a), ranked AS (SELECT q.key,q.car_id,q.due,row_number() OVER(PARTITION BY q.car_id,q.task ORDER BY q.rank DESC,o.ordinal) n FROM query_records q JOIN ordinals o ON o.key=q.key WHERE q.bucket='["events"]' AND q.type='maintenance') SELECT ranked.key,ranked.due FROM ranked JOIN query_records c ON c.key=json_array('cars','id:'||ranked.car_id) WHERE n=1 AND ranked.due<>'' AND c.archived=0 ORDER BY ranked.due,ranked.key`).all();}
 summary(){
  const rows=this.db.prepare('SELECT * FROM query_totals').all();
  const sum=(bucket,field,filter=()=>true)=>rows.filter(r=>r.bucket===JSON.stringify([bucket])&&filter(r)).reduce((n,r)=>n+(r[field]||0),0),reminders=this.reminders(),fitted=sum('installations','fitted');
  return {cars:sum('cars','n',r=>!r.archived),parts:sum('parts','owned'),catalogue:sum('parts','n'),available:sum('parts','quantity')-fitted-sum('assemblies','reserved'),jobs:sum('jobs','n',r=>r.status==='active'),incoming:sum('submissions','incoming'),maintenance:reminders.length,due:reminders.filter(r=>r.due<=require('../renderer/domain.js').today()).length};
 }
}
function read(store,expected,fn){if(!store.file||store.expectedIdentity===null)throw fault('QUERY_UNAVAILABLE','Save this collection before querying it.');const reader=new Reader(store.file,expected);try{if(reader.id!==store.data.id||reader.revision!==store.data.revision)throw fault('QUERY_CHANGED','The collection is being saved. Refresh this page.');const value=fn(reader);return {value,token:reader.token,recordReads:reader.reads};}finally{reader.close();}}
module.exports={Reader,read,fault};
