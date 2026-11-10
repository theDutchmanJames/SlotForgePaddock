'use strict';
const {randomUUID}=require('node:crypto');
const {validateDocument}=require('./documents.cjs');
const allowed=new Set(['application/pdf','image/png','image/jpeg','image/webp']);
const check=(v,m)=>{if(!v)throw Error(m);};
function validate(d,photo){
 check(d.guide===undefined||d.guide===true,'Invalid guide marker.');
 if(!d.guide)return;
 check(allowed.has(d.mime),'Guides must be PDF, PNG, JPEG or WebP files.');
 check(d.carId===null||typeof d.carId==='string','Choose a car or the general reference library.');
 if(Object.hasOwn(d,'picture')){const lazy=require('./lazy-assets.cjs');lazy.copyPhoto({},'picture',d,photo);const asset=lazy.property(d,'picture');check((asset?asset.meta.chars:d.picture.length)<=400000,'Guide preview is too large.');}
}
function mutate(db,action,p,{photo,event,touch}){
 check(p.revision===db.revision,'The database changed. Reopen the guide editor.');
 const old=action==='guide.add'?null:db.documents.find(d=>d.id===p.id&&d.guide);
 check(action==='guide.add'||old,'Guide not found.');
 if(action==='guide.remove'){
  db.documents=db.documents.filter(d=>d.id!==old.id);
  const car=db.cars.find(c=>c.id===old.carId);if(car){touch(car);event(car.id,'document','Guide removed',old.title);}return old.id;
 }
 check(typeof p.title==='string'&&p.title.trim()&&p.title.length<=200,'Enter a guide name (maximum 200 characters).');
 check(p.carId===null||typeof p.carId==='string'&&db.cars.some(c=>c.id===p.carId),'Choose a car or the general reference library.');
 let doc=old;
 if(!doc){
  validateDocument(p.document);check(allowed.has(p.document.mime),'Guides must be PDF, PNG, JPEG or WebP files.');
  check(db.documents.filter(d=>d.guide).length<5000,'Maximum 5,000 guides per collection.');
  doc={id:randomUUID(),guide:true,carId:p.carId,name:p.document.name,mime:p.document.mime,size:p.document.size,data:p.document.data,picture:photo(p.picture||''),category:'Manual / part guide',added:new Date().toISOString()};db.documents.push(doc);
 }
 const previous=doc.carId;doc.title=p.title.trim();doc.carId=p.carId;doc.updated=new Date().toISOString();validate(doc,photo);
 for(const id of new Set([previous,doc.carId].filter(Boolean))){const car=db.cars.find(c=>c.id===id);if(car){touch(car);event(id,'document',action==='guide.add'?'Guide added':'Guide details updated',doc.title);}}
 return doc.id;
}
module.exports={allowed,validate,mutate};
