'use strict';
// Private export workflow. No collection writes, network access or photo bodies.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const C=require('./catalogue-pictures-contract.cjs'),{Reader}=require('./sqlite-query.cjs');
const fault=(code,message)=>Object.assign(Error(message),{code});
const normal=value=>String(value||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const field=(name)=>`COALESCE((SELECT json_extract(f.json,'$') FROM record_fields f WHERE f.record=r.key AND f.path='${JSON.stringify([name])}'),'')`;
const projection=`SELECT r.key,substr(r.identity,4) id,CASE r.bucket WHEN '["parts"]' THEN 'part' ELSE 'supply' END kind,
 ${field('name')} name,${field('maker')} manufacturer,${field('reference')} reference,${field('category')} category,${field('partType')} partType,
 (EXISTS(SELECT 1 FROM json_each(r.json,'$.refs') a WHERE json_extract(a.value,'$.path')='["picture"]') OR length(${field('picture')})>0) hasPicture
 FROM records r WHERE r.bucket IN ('["parts"]','["supplies"]')`;
function withReader(store,fn){const r=new Reader(store.file);try{r.db.function('sf_picture_normal',{deterministic:true},normal);const replica=JSON.parse(r.db.prepare("SELECT value FROM state WHERE key='replica_sync'").get()?.value||'null');return fn(r,{databaseId:r.id,recoveryId:replica?.epoch||r.epoch,revision:r.revision});}finally{r.close();}}
function identity(actual,expected){if(!expected||actual.databaseId!==expected.databaseId||actual.recoveryId!==expected.recoveryId)throw fault('COLLECTION_CHANGED','The collection was replaced or changed. Open Illustrated Catalogue again.');}
function filters(f={}){
 for(const key of ['manufacturer','category','query'])if(f[key]!==undefined&&(typeof f[key]!=='string'||f[key].length>500))throw fault('INVALID_QUERY','Invalid picture-request filter.');
 if(f.kind!==undefined&&!['','part','supply'].includes(f.kind)||f.missing!==undefined&&typeof f.missing!=='boolean')throw fault('INVALID_QUERY','Invalid picture-request filter.');
 const where=['sf_picture_normal(manufacturer)<>\'\''],args=[];
 if(f.manufacturer){where.push('sf_picture_normal(manufacturer)=?');args.push(normal(f.manufacturer));}
 if(f.kind){where.push('kind=?');args.push(f.kind);}
 if(f.category){where.push('category=?');args.push(f.category);}
 if(f.missing!==false)where.push('hasPicture=0');
 if(f.query){where.push("instr(sf_picture_normal(name||' '||reference||' '||partType),?)>0");args.push(normal(f.query));}
 return {sql:`WITH products AS (${projection}) SELECT * FROM products WHERE ${where.join(' AND ')}`,args};
}
function browse(store,p={}){return withReader(store,(r,active)=>{
 if(p.expected)identity(active,p.expected);
 const offset=p.offset||0;if(!Number.isSafeInteger(offset)||offset<0)throw fault('INVALID_QUERY','Invalid page.');
 const f=filters(p.filters),total=r.db.prepare(`SELECT count(*) n FROM (${f.sql})`).get(...f.args).n;
 const rows=r.db.prepare(f.sql+' ORDER BY sf_picture_normal(name),kind,id LIMIT 40 OFFSET ?').all(...f.args,offset).map(({key,...row})=>row);
 const manufacturers=r.db.prepare(`SELECT min(manufacturer) name FROM (${projection}) WHERE sf_picture_normal(manufacturer)<>'' GROUP BY sf_picture_normal(manufacturer) ORDER BY sf_picture_normal(manufacturer)`).all().map(x=>x.name);
 const categories=r.db.prepare(`SELECT DISTINCT category FROM (${projection}) WHERE sf_picture_normal(manufacturer)=? ORDER BY category`).all(normal(p.filters?.manufacturer)).map(x=>x.category).filter(Boolean);
 return {...active,rows,total,offset,next:offset+rows.length<total?offset+rows.length:null,manufacturers,categories};
});}
function select(store,p){return withReader(store,(r,active)=>{identity(active,p.expected);if(!p.filters?.manufacturer)throw fault('MANUFACTURER_REQUIRED','Choose one manufacturer.');const f=filters(p.filters),rows=r.db.prepare(f.sql+' ORDER BY kind,id LIMIT 10001').all(...f.args);if(rows.length>10000)throw fault('TOO_MANY_ITEMS','Select at most 10,000 entries per export. Narrow the filters.');return rows.map(x=>({kind:x.kind,id:x.id}));});}
function prepare(store,p){return withReader(store,(r,active)=>{
 identity(active,p.expected);
 if(active.revision!==p.expected.revision)throw fault('SELECTION_CHANGED','The collection changed. Apply filters to refresh the selection before exporting.');
 if(!Array.isArray(p.selected)||!p.selected.length||p.selected.length>10000||!normal(p.manufacturer))throw fault('INVALID_SELECTION','Choose a manufacturer and 1–10,000 entries.');
 const seen=new Set(),rows=[];
 for(const target of p.selected){if(!target||!['part','supply'].includes(target.kind)||typeof target.id!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(target.id))throw fault('INVALID_SELECTION','Invalid product selection.');const key=JSON.stringify([target.kind==='part'?'parts':'supplies','id:'+target.id]);if(seen.has(key))throw fault('INVALID_SELECTION','A product was selected twice.');seen.add(key);
  const record=r.record(key,{assetHandle:true});if(!record)throw fault('TARGET_MISSING','A selected product was removed. Refresh the selection.');
  if(normal(record.maker)!==normal(p.manufacturer))throw fault('PRODUCT_CHANGED','A selected manufacturer changed. Refresh the selection.');
  const row={itemId:randomUUID(),kind:target.kind,name:record.name,manufacturer:record.maker,reference:record.reference||'',category:record.category||'',partType:record.partType||'',productPageUrl:'',imageUrl:'',imagePageUrl:'',notes:''};
  const product=record.catalogue?.product;
  if(product&&normal(product.manufacturer)===normal(row.manufacturer)&&product.reference===row.reference&&product.name===row.name){try{C.link(product.sourceUrl||'');row.productPageUrl=product.sourceUrl||'';}catch{}}
  const pictureHash=require('./assembly-photo.cjs').hash(record);
  if(pictureHash&&p.includeExisting!==true)throw fault('PICTURE_CHANGED','A selected entry already has a picture. Refresh or explicitly include existing pictures.');
  rows.push({row,target:{itemId:row.itemId,kind:target.kind,recordId:target.id,expected:{revision:active.revision,productHash:C.productHash(row),pictureHash}}});
 }
 const journals=[];
 for(let i=0;i<rows.length;i+=C.limits.itemsPerFile){const chunk=rows.slice(i,i+C.limits.itemsPerFile),request={format:'slotforge-catalogue-images',version:1,requestId:randomUUID(),databaseId:active.databaseId,recoveryId:active.recoveryId,manufacturer:rows[0].row.manufacturer,createdAt:new Date().toISOString(),instructions:C.instructions,items:chunk.map(x=>x.row)};const journal={version:1,request,targets:chunk.map(x=>x.target)};C.validateJournal(journal);if(Buffer.byteLength(JSON.stringify(request,null,2))>C.limits.fileBytes)throw fault('FILE_TOO_LARGE','Select fewer products per export.');journals.push(journal);}
 return journals;
});}
function inspect(store,p){return withReader(store,(r,active)=>{
 C.validateJournal(p.journal);identity(active,p.journal.request);const floor=Number(r.db.prepare("SELECT value FROM state WHERE key='field_floor'").get()?.value||0),version=r.db.prepare('SELECT path,revision FROM field_versions WHERE record=?');
 return {active,rows:p.journal.targets.map(t=>{const key=JSON.stringify([t.kind==='part'?'parts':'supplies','id:'+t.recordId]),record=r.record(key,{assetHandle:true});if(!record)return {itemId:t.itemId,current:null};const row={kind:t.kind,name:record.name,manufacturer:record.maker,reference:record.reference||'',category:record.category||'',partType:record.partType||''};const pictureVersion=Math.max(0,...version.all(key).filter(v=>v.path==='*'||JSON.parse(v.path)[0]==='picture'||JSON.parse(v.path)[0]==='pictureProvenance').map(v=>v.revision));return {itemId:t.itemId,current:{...active,kind:t.kind,recordId:t.recordId,fieldFloor:floor,pictureVersion,productHash:C.productHash(row),pictureHash:require('./assembly-photo.cjs').hash(record)}};})};
 });}
function previewSource(store,p){return withReader(store,(r,active)=>{identity(active,p.expected);if(!['part','supply'].includes(p.kind)||typeof p.recordId!=='string')throw Error('Invalid photo target.');const record=r.record(JSON.stringify([p.kind==='part'?'parts':'supplies','id:'+p.recordId]),{assetHandle:true});if(!record||require('./assembly-photo.cjs').hash(record)!==p.pictureHash)throw Error('The current photograph changed.');const lazy=require('./lazy-assets.cjs'),asset=lazy.property(record,'picture');if(asset&&asset.meta.encodedBytes>C.limits.encodedPhotoBytes)throw Error('The existing original is too large for a bounded preview.');const picture=record.picture;if(!picture)throw Error('No current picture.');require('./assembly-photo.cjs').admission(picture);return picture;});}
class Journal {
 constructor(profile){fs.mkdirSync(profile,{recursive:true});this.file=path.join(profile,'catalogue-picture-requests.sqlite');}
 use(fn){const db=new DatabaseSync(this.file,{timeout:5000});try{const version=db.prepare('PRAGMA user_version').get().user_version;if(version>3)throw fault('JOURNAL_VERSION','These picture requests need a newer Paddock version.');db.exec("PRAGMA synchronous=FULL");if(version===0)db.exec("CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,database_id TEXT NOT NULL,recovery_id TEXT NOT NULL,created TEXT NOT NULL,state TEXT NOT NULL,descriptor TEXT NOT NULL) STRICT; PRAGMA user_version=1");if(version<2)db.exec("CREATE TABLE IF NOT EXISTS picture_jobs(request_id TEXT PRIMARY KEY,data TEXT NOT NULL) STRICT; PRAGMA user_version=2");if(version<3)db.exec("PRAGMA user_version=3");return fn(db);}finally{db.close();}}
 save(journals){for(const j of journals)C.validateJournal(j);return this.use(db=>{db.exec('BEGIN IMMEDIATE');try{const usage=db.prepare('SELECT count(*) n,COALESCE(sum(length(CAST(descriptor AS BLOB))),0) bytes FROM requests').get(),texts=journals.map(j=>JSON.stringify(j));if(usage.n+journals.length>C.limits.activeRequests||usage.bytes+db.prepare('SELECT COALESCE(sum(length(CAST(data AS BLOB))),0) n FROM picture_jobs').get().n+texts.reduce((n,t)=>n+Buffer.byteLength(t),0)>C.limits.journalBytes)throw fault('JOURNAL_FULL','Picture requests are full. Discard requests you no longer need before exporting more.');const add=db.prepare("INSERT INTO requests VALUES(?,?,?,?,'awaiting-response',?)");journals.forEach((j,i)=>add.run(j.request.requestId,j.request.databaseId,j.request.recoveryId,j.request.createdAt,texts[i]));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}});}
 list(databaseId){return this.use(db=>db.prepare("SELECT id,database_id databaseId,recovery_id recoveryId,created,state,json_extract(descriptor,'$.request.manufacturer') manufacturer,json_array_length(descriptor,'$.request.items') count FROM requests WHERE (? IS NULL OR database_id=?) ORDER BY created DESC,id").all(databaseId??null,databaseId??null));}
 get(id,active){return this.use(db=>{const row=db.prepare('SELECT * FROM requests WHERE id=?').get(id);if(!row)throw fault('REQUEST_NOT_FOUND','Saved picture request not found.');const j=C.validateJournal(JSON.parse(row.descriptor));identity(j.request,active);return j;});}
 discard(id,databaseId){return this.use(db=>{const result=db.prepare("DELETE FROM requests WHERE id=? AND database_id=? AND state='awaiting-response'").run(id,databaseId);if(result.changes!==1)throw fault('REQUEST_BUSY','Only an unprocessed picture request can be discarded.');});}
}
function exportBundle(folder,journals,protectedFiles=[]){
 // Each export gets a new directory; no existing files can be overwritten.
 const destination=path.join(folder,'SlotForge-picture-requests-'+randomUUID());
 try{fs.mkdirSync(destination);for(const [index,j] of journals.entries()){C.validateJournal(j);require('./files.cjs').exportBytes(path.join(destination,String(index+1).padStart(3,'0')+'-of-'+String(journals.length).padStart(3,'0')+'-'+j.request.requestId+'.json'),JSON.stringify(j.request,null,2),protectedFiles);}require('./files.cjs').exportBytes(path.join(destination,'AI-INSTRUCTIONS.txt'),C.instructions,protectedFiles);return {path:destination,files:journals.length,items:journals.reduce((n,j)=>n+j.request.items.length,0)};}catch(e){throw fault('EXPORT_FAILED','The export could not finish. Saved requests are retained; use Saved picture requests to export them again.');}
}
// Catalogue queries/export preparation run outside Electron's main event loop.
let running=0;
function run(file,method,p,{signal}={}){if(!['browse','select','prepare','inspect','previewSource'].includes(method))return Promise.reject(fault('INVALID_QUERY','Unknown picture query.'));if(running>=2)return Promise.reject(fault('REQUEST_BUSY','A picture request is already being prepared.'));running++;return new Promise((resolve,reject)=>{let worker,timer,done=false;const finish=(error,value)=>{if(done)return;done=true;running--;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker?.terminate();error?reject(error):resolve(value);};const abort=()=>finish(fault('QUERY_CANCELLED','Picture query was cancelled.'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}try{worker=new (require('node:worker_threads').Worker)(__filename,{workerData:{cataloguePictures:true,file,method,p}});timer=setTimeout(()=>finish(fault('QUERY_TIMEOUT','Picture preparation timed out. Narrow the selection and try again.')),60000);worker.once('message',message=>finish(message.error?fault(message.code||'QUERY_FAILED',message.error):null,message.value));worker.once('error',error=>finish(error));worker.once('exit',()=>{if(!done)finish(fault('QUERY_FAILED','Picture preparation stopped. Try again.'));});}catch(error){finish(error);}});}
module.exports={browse,select,prepare,inspect,previewSource,Journal,exportBundle,normal,withReader,identity,run};
const {isMainThread,workerData,parentPort}=require('node:worker_threads');
if(!isMainThread&&workerData?.cataloguePictures===true){try{if(!['browse','select','prepare','inspect','previewSource'].includes(workerData.method))throw Error('Invalid picture query.');parentPort.postMessage({value:module.exports[workerData.method]({file:workerData.file},workerData.p)});}catch(error){parentPort.postMessage({error:error.message,code:error.code});}}
