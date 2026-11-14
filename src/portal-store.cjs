'use strict';
const {DatabaseSync}=require('node:sqlite');
const fault=(code,message,httpStatus=400)=>Object.assign(Error(message),{code,httpStatus});
function identity(store,expected){
 const token=store.deferredState?.token||require('./sqlite-storage.cjs').syncState(store.file);
 if(store.data.id!==expected.databaseId||token.epoch!==expected.recoveryId)throw fault('PORTAL_COLLECTION_CHANGED','The collection changed. Reopen Paddock Portal on the computer.',409);
 if(store.data.club?.replica)throw fault('PORTAL_UNAVAILABLE','Open the original local collection to use Paddock Portal.',409);
}
function operation(id){if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw fault('INVALID_UPLOAD','Invalid upload identity.');return 'portal_'+id;}
function fields(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['operationId','manufacturer','model','reference','picture'].includes(k)))throw fault('INVALID_UPLOAD','Send only the Portal car fields.');
 const data={};for(const key of ['manufacturer','model','reference']){const value=input[key]??'';if(typeof value!=='string'||value.length>200||/[\x00-\x1f\x7f]/.test(value))throw fault('INVALID_FIELD','Use at most 200 characters per field.');data[key]=value.trim();}
 if(!data.manufacturer||!data.model)throw fault('REQUIRED_FIELDS','Enter a manufacturer and model.');
 const picture=input.picture,bytes=photo(picture);
 return {id:operation(input.operationId),data:{name:data.model,maker:data.manufacturer,model:data.model,reference:data.reference,picture},bytes};
}
function photo(picture){
 if(typeof picture!=='string'||picture.length>12*1024*1024)throw fault('PHOTO_TOO_LARGE','The original photo exceeds approximately 9 MiB. Choose a smaller copy.',413);
 const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(picture||'');if(!match)throw fault('INVALID_PHOTO','Choose a JPEG, PNG or WebP photograph. HEIC is not supported.');
 const bytes=Buffer.from(match[2],'base64');if(bytes.toString('base64')!==match[2])throw fault('INVALID_PHOTO','The photograph was not transferred correctly.');
 if(require('./photo-import.cjs').originalPhoto(bytes)!==picture)throw fault('INVALID_PHOTO','The photo format does not match its contents.');require('./portal-photo.cjs').check(bytes);
 return bytes;
}
function create(store,input,expected){identity(store,expected);const p=fields(input);const command={id:p.id,action:'car.save',payload:{data:p.data},databaseId:expected.databaseId,epoch:expected.recoveryId};const saved=require('./command-receipts.cjs').execute(store,command);return {carId:saved.result,duplicate:saved.duplicate};}
function receipt(store,id,expected){
 identity(store,expected);const db=new DatabaseSync(store.file,{readOnly:true,timeout:5000});try{
  db.exec('BEGIN');const state=Object.fromEntries(db.prepare("SELECT key,value FROM state WHERE key IN ('identity','change_epoch')").all().map(r=>[r.key,r.value]));
  if(JSON.parse(state.identity)[0]!==expected.databaseId||state.change_epoch!==expected.recoveryId)throw fault('PORTAL_COLLECTION_CHANGED','The collection was replaced. Check Paddock before sending again.',409);
  const key=operation(id);if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='command_receipts'").get())return {found:false};
  const row=db.prepare('SELECT epoch,result FROM command_receipts WHERE id=?').get(key);if(!row)return {found:false};
  if(row.epoch!==expected.recoveryId)throw fault('PORTAL_COLLECTION_CHANGED','The saved upload belongs to an earlier collection.',409);
  const result=require('./command-receipts.cjs').decodeResult(row.result);return {found:true,...(typeof result==='string'?{carId:result}:result)};
 }finally{db.close();}
}
function batch(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['operationId','carId','revision','photos'].includes(k))||!Array.isArray(input.photos)||input.photos.length<1||input.photos.length>5)throw fault('INVALID_PHOTOS','Choose between one and five photos.');
 carIdentity(input);operation(input.operationId);
 for(const item of input.photos){if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['name','data'].includes(k))||typeof item.name!=='string'||!item.name.trim()||item.name.length>200||/[\x00-\x1f\x7f]/.test(item.name))throw fault('INVALID_PHOTOS','Use a valid photo name.');photo(item.data);}
 return input;
}
function carIdentity(input){if(typeof input?.carId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.carId)||!Number.isSafeInteger(input.revision)||input.revision<1)throw fault('INVALID_CAR','Select a car again.');}
function selected(reader,input){carIdentity(input);const c=reader.one('cars',input.carId);if(!c)throw fault('CAR_NOT_FOUND','This car was deleted. Select a car again.',409);if(reader.merges.identity(c.id).state!=='current')throw fault('CAR_MERGED','This car was merged. Select a car again.',409);if(require('./car-membership.cjs').isWishlist(c))throw fault('CAR_WISHLIST','This car is on the Wishlist. Mark it as purchased in Paddock before using Portal.',409);if(c.archived||c.rebuild?.to)throw fault('CAR_ARCHIVED','This car was archived or rebuilt. Select a car again.',409);if(c.revision!==input.revision)throw fault('CAR_CHANGED','This car changed. Select it again before uploading.',409);return c;}
function append(store,input,expected){
 identity(store,expected);batch(input);const C=require('./command-receipts.cjs'),S=require('./scoped-write.cjs');
 const command={id:operation(input.operationId),action:'portal.photos',payload:input,databaseId:expected.databaseId,epoch:expected.recoveryId};
 const saved=C.execute(store,command,()=>{
  store.deferredState.read(r=>selected(r,input));
  const scope=S.context(store,'car.favourite',{id:input.carId}),before=scope.data,c=before.cars[0];
  if(c.photos.length+input.photos.length>40)throw fault('PHOTO_CAPACITY','This car can hold 40 gallery photos. Remove some in Paddock or choose fewer photos.',409);
  const photos=[...c.photos,...input.photos.map(p=>({id:require('node:crypto').randomUUID(),name:p.name,data:p.data}))];
  scope.mutate('car.save',{id:c.id,revision:c.revision,data:{photos}},{snapshot:false});
  return S.prepare(store,before,scope.data,{carId:c.id,count:input.photos.length});
 });return {...saved.result,duplicate:saved.duplicate};
}
function read(store,input,expected){
 identity(store,expected);
 return store.deferredState.read(r=>{
  if(input.kind==='thumbnail'){const c=selected(r,input);return {picture:c.picture||''};}
  const offset=input.offset??0,query=input.query??'';
  if(!Number.isSafeInteger(offset)||offset<0||offset>10000||typeof query!=='string'||query.length>200)throw fault('INVALID_QUERY','Use a shorter search.');
  if(offset&&input.revision!==r.revision)throw fault('LIST_CHANGED','The collection changed. Search again to refresh the list.',409);
  const where=`q.bucket='["cars"]' AND q.archived=0 AND NOT EXISTS(SELECT 1 FROM record_fields membership WHERE membership.record=q.key AND membership.path='["collectionStatus"]' AND membership.json='"wishlist"') AND (?='' OR EXISTS(SELECT 1 FROM record_fields f WHERE f.record=q.key AND f.path IN ('["name"]','["maker"]','["model"]','["reference"]') AND instr(sf_sort_text(json_extract(f.json,'$')),?)>0))`;
  const params=[query.toLowerCase(),query.toLowerCase()],total=r.db.prepare('SELECT count(*) n FROM query_records q WHERE '+where).get(...params).n;
  const keys=r.db.prepare('SELECT q.key FROM query_records q WHERE '+where+' ORDER BY q.name,q.key LIMIT 20 OFFSET ?').all(...params,offset);
  const cars=keys.map(row=>r.record(row.key)).filter(c=>!c.rebuild?.to&&r.merges.identity(c.id).state==='current').map(c=>({id:c.id,revision:c.revision,name:c.name,maker:c.maker||'',model:c.model||'',reference:c.reference||'',hasPicture:!!(require('./lazy-assets.cjs').property(c,'picture')||c.picture),remaining:Math.max(0,40-c.photos.length)}));
  return {cars,total,revision:r.revision,nextOffset:offset+keys.length<total?offset+keys.length:null};
 });
}
module.exports={fields,photo,batch,append,read,create,receipt,identity,operation,fault};
