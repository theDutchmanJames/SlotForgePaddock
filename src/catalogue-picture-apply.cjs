'use strict';
// Image-only command. Never fetches a URL or edits inventory/configuration fields.
const C=require('./catalogue-pictures-contract.cjs'),P=require('./catalogue-picture-requests.cjs'),lazy=require('./lazy-assets.cjs'),crypto=require('node:crypto');
const fault=(code,message)=>Object.assign(Error(message),{code});
const action='catalogue.picture';
function validate(p){
 if(!p||Object.keys(p).some(k=>!['intent','picture'].includes(k)))throw fault('INVALID_INTENT','Invalid picture-only command.');
 const i=C.validateIntent(p.intent);
 if(!['part','supply'].includes(i.kind)||i.action!=='set'||!i.provenance)throw fault('INVALID_INTENT','Catalogue pictures require a part or supply and recorded image provenance.');
 require('./assembly-photo.cjs').admission(p.picture);
 if(lazy.digest(p.picture)!==i.assetHash||crypto.createHash('sha256').update(Buffer.from(p.picture.split(',')[1],'base64')).digest('hex')!==i.provenance.sourceBytesHash)throw fault('PICTURE_HASH_MISMATCH','The staged image no longer matches the selected original.');
 return i;
}
function current(store,i){return P.withReader(store,(r,active)=>{
 P.identity(active,i);if(active.revision!==store.data.revision)throw fault('QUERY_CHANGED','The collection changed before saving.');
 const bucket=i.kind==='part'?'parts':'supplies',key=JSON.stringify([bucket,'id:'+i.recordId]),record=r.record(key,{assetHandle:true});
 if(!record)throw fault('TARGET_MISSING','This catalogue entry was removed.');
 const versions=r.db.prepare('SELECT path,revision FROM field_versions WHERE record=?').all(key);
 const state={...active,kind:i.kind,recordId:i.recordId,fieldFloor:Number(r.db.prepare("SELECT value FROM state WHERE key='field_floor'").get()?.value||0),pictureVersion:Math.max(0,...versions.filter(v=>v.path==='*'||['picture','pictureProvenance'].includes(JSON.parse(v.path)[0])).map(v=>v.revision)),productHash:C.productHash({kind:i.kind,name:record.name,manufacturer:record.maker,reference:record.reference||'',category:record.category||'',partType:record.partType||''}),pictureHash:require('./assembly-photo.cjs').hash(record)};
 const outcome=C.compareTarget(i,state);if(outcome!=='READY')throw fault(outcome,'The product or photograph changed ('+outcome+'). Create a fresh picture request.');
 return {record,bucket,state};
});}
function prepare(store,p){
 const i=validate(p),{record,bucket,state}=current(store,i),same=state.pictureHash===i.assetHash;
 const result={version:1,databaseId:i.databaseId,recoveryId:i.recoveryId,operationId:i.operationId,requestHash:C.digest(i),kind:i.kind,recordId:i.recordId,status:same?'unchanged':'applied',pictureHash:i.assetHash,revision:store.data.revision+(same?0:1),duplicate:false};C.shape(result,'receipt');
 if(same)return {noop:true,result};
 const afterRecord={...record,picture:p.picture,pictureProvenance:i.provenance,updated:new Date().toISOString()};
 if(!store.deferredState)return store.prepareDraft(store.data,db=>{db[bucket][db[bucket].findIndex(r=>r.id===i.recordId)]=afterRecord;return result;});
 const before={schema:store.data.schema,id:store.data.id,revision:store.data.revision,catalogueRevision:store.data.catalogueRevision,[bucket]:[record]},after={...before,revision:before.revision+1,[bucket]:[afterRecord]};
 return require('./scoped-write.cjs').prepare(store,before,after,result);
}
function command(p){return {id:p.intent.operationId,action,payload:p,databaseId:p.intent.databaseId,epoch:p.intent.recoveryId};}
// Review includes both originals in its admission budget even though its small
// text comparison uses descriptions. This keeps legacy bounded transport safe.
function reviewBudget(store,p){const {record}=current(store,p.intent),meta=lazy.property(record,'picture')?.meta;
 const size=meta?.encodedBytes||Buffer.byteLength(record.picture||'');
 if(size+require('./json-encoding.cjs').byteLength(p)+65536>16*1024*1024)throw fault('PROPOSAL_TOO_LARGE','The existing and proposed pictures exceed the 16 MiB Dealership review limit. Use a smaller image; neither original was changed.');
 return record;
}
module.exports={action,validate,current,prepare,command,reviewBudget};
