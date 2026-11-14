'use strict';
const lazy=require('./lazy-assets.cjs'),sqlite=require('./sqlite-storage.cjs');
const limits=require('./catalogue-pictures-contract.cjs').limits;
const fault=(code,message)=>Object.assign(Error(message),{code});
function admission(picture){
 if(typeof picture!=='string'||!picture||picture.length>limits.encodedPhotoBytes||!require('./json-encoding.cjs').isPhoto(picture))throw fault('INVALID_PHOTO','Choose a PNG, JPEG or WebP photograph within the 12 MiB encoded limit.');
 const bytes=Buffer.from(picture.slice(picture.indexOf(',')+1),'base64'),[width,height]=require('./portal-photo.cjs').dimensions(bytes);
 if(!width||!height||width>limits.dimensionPixels||height>limits.dimensionPixels||width*height>limits.decodedPixels)throw fault('PHOTO_DIMENSIONS','Choose a photograph up to 24 megapixels and 16,384 pixels per side.');
 // Inspect container chunks, not arbitrary compressed bytes, for animation.
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),webp=bytes.toString('ascii',0,4)==='RIFF';
 if(!png&&!webp){for(let offset=2;offset+4<bytes.length;){if(bytes[offset++]!==255)break;while(bytes[offset]===255)offset++;const marker=bytes[offset++];if(marker===218||marker===217)break;if(marker===1||marker>=208&&marker<=215)continue;const size=bytes.readUInt16BE(offset);if(size<2||offset+size>bytes.length)throw fault('INVALID_PHOTO','Incomplete JPEG image.');if(marker===226&&bytes.toString('ascii',offset+2,offset+6)==='MPF\0')throw fault('ANIMATED_PHOTO','Choose a single photograph, not a multi-picture JPEG.');offset+=size;}}
 if(png||webp){let offset=png?8:12,ended=false;while(offset<bytes.length){if(offset+8>bytes.length)throw fault('INVALID_PHOTO','Incomplete image container.');const size=png?bytes.readUInt32BE(offset):bytes.readUInt32LE(offset+4),type=bytes.toString('ascii',offset+(png?4:0),offset+(png?8:4)),end=offset+8+size+(png?4:size%2);if(end>bytes.length)throw fault('INVALID_PHOTO','Incomplete image container.');if(['acTL','ANIM','ANMF'].includes(type)||type==='VP8X'&&size>0&&(bytes[offset+8]&2))throw fault('ANIMATED_PHOTO','Choose a still photograph, not an animated image.');offset=end;if(type==='IEND'){ended=true;if(offset!==bytes.length)throw fault('INVALID_PHOTO','Unexpected image data after the final PNG chunk.');}}if(png&&!ended||webp&&bytes.readUInt32LE(4)+8!==bytes.length)throw fault('INVALID_PHOTO','Incomplete image container.');}
 return {width,height,mime:picture.slice(5,picture.indexOf(';'))};
}
function record(store,id){if(typeof id!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(id))throw fault('ASSEMBLY_NOT_FOUND','Assembly not found.');const a=store.deferredState?store.deferredState.read(r=>r.record(JSON.stringify(['assemblies','id:'+id]),{assetHandle:true})):store.data.assemblies.find(a=>a.id===id);if(!a)throw fault('ASSEMBLY_NOT_FOUND','Assembly not found.');return a;}
function hash(a){return lazy.property(a,'picture')?.meta.hash||(a.picture?lazy.digest(a.picture):null);}
function plan(store,id){const a=record(store,id),state=store.file&&store.expectedIdentity?sqlite.fieldState(store.file,store.expectedIdentity,JSON.stringify(['assemblies','id:'+id]),[JSON.stringify(['picture'])],{replica:true,epoch:store.deferredState?.token.epoch}):null;
 const result={id,name:a.name,dismantled:!!a.dismantled,databaseId:store.data.id,recoveryId:state?.replica?.epoch||state?.epoch||'memory',revision:store.data.revision,pictureHash:hash(a),pictureVersion:Math.max(...Object.values(state?.versions||{picture:0})),fieldFloor:state?.floor||0};lazy.copyProperty(result,'picture',a);return result;
}
function updated(store,p){
 if(!p||Object.keys(p).some(k=>!['id','expected','picture','replaceExisting','removeConfirmed'].includes(k)))throw fault('INVALID_PHOTO_EDIT','Invalid photograph-only edit.');
 const current=plan(store,p.id),expected=p.expected;
 if(!expected||expected.databaseId!==current.databaseId||expected.recoveryId!==current.recoveryId)throw fault('COLLECTION_CHANGED','The collection was replaced. Reopen the photograph editor.');
 if(!Number.isSafeInteger(expected.revision)||expected.revision<current.fieldFloor||expected.revision>current.revision)throw fault('BASELINE_EXPIRED','This photograph editor is out of date. Reopen it.');
 if(expected.pictureHash!==current.pictureHash||current.pictureVersion>expected.revision)throw fault('PICTURE_CHANGED','The assembly photograph changed. Reopen the editor before saving.');
 const a=record(store,p.id);if(a.dismantled)throw fault('ASSEMBLY_RETIRED','This assembly was dismantled. Its historical photograph is retained.');
 if(typeof p.picture==='string'&&(p.picture?lazy.digest(p.picture):null)===current.pictureHash)return {before:a,after:a};
 if(p.picture===''){if(current.pictureHash&&p.removeConfirmed!==true)throw fault('CONFIRM_REMOVAL','Confirm removal of the assembly photograph.');}
 else{admission(p.picture);if(current.pictureHash&&p.replaceExisting!==true)throw fault('CONFIRM_REPLACEMENT','Confirm replacement of the assembly photograph.');}
 return {before:a,after:{...a,picture:p.picture,updated:new Date().toISOString()}};
}
function prepare(store,p){const {before:a,after:b}=updated(store,p);if(a===b)return {noop:true,result:a.id};const before={schema:store.data.schema,id:store.data.id,revision:store.data.revision,catalogueRevision:store.data.catalogueRevision,assemblies:[a]},after={...before,revision:before.revision+1,assemblies:[b]};return require('./scoped-write.cjs').prepare(store,before,after,a.id);}
module.exports={admission,record,hash,plan,updated,prepare};
