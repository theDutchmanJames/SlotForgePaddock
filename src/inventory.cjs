// Physical stock must remain addressable from both current and historical records.
function references(value,id){
  const pending=[value];
  while(pending.length){const item=pending.pop();if(!item||typeof item!=='object')continue;for(const key of Object.keys(item)){if(require('./lazy-assets.cjs').property(item,key))continue;const v=item[key];if((key==='partId'||key==='sourcePartId')&&v===id)return true;if(v&&typeof v==='object')pending.push(v);}}
  return false;
}
function deletion(db,id){
  const part=db.parts.find(p=>p.id===id);if(!part)throw Error('Part not found.');
  const reasons=[];if(references(db.planning?.shopping,id))reasons.push('shopping list or purchase history');
  for(const [key,label] of [['installations','car installation history'],['assemblies','assemblies or assembly history'],['setups','saved setups'],['tests','performance records'],['jobs','workshop jobs'],['events','car history'],['buildDrafts','saved build drafts']])if(references(db[key],id))reasons.push(label);
  if(references(db.parts.filter(p=>p.id!==id),id))reasons.push('stock returned from this part');
  return {id,name:part.name,quantity:part.quantity,revision:db.revision,reasons};
}
function remove(db,p){
  if(p.revision!==db.revision)throw Error('The database changed. Reopen the delete action.');
  const plan=deletion(db,p.id);
  if(plan.reasons.length)throw Error('This part is linked to '+plan.reasons.join(', ')+'. Keep the record to preserve those references.');
  db.parts=db.parts.filter(part=>part.id!==p.id);return p.id;
}
function deletions(db,ids){
 if(!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw Error('Select between 1 and 200 unique parts.');
 const selected=new Set(ids),linked=new Map(ids.map(id=>[id,new Set()]));
 const scan=(value,label,owner)=>{const pending=[value];while(pending.length){const item=pending.pop();if(!item||typeof item!=='object')continue;for(const key of Object.keys(item)){if(require('./lazy-assets.cjs').property(item,key))continue;const v=item[key];if((key==='partId'||key==='sourcePartId')&&selected.has(v)&&v!==owner)linked.get(v).add(label);if(v&&typeof v==='object')pending.push(v);}}};
 for(const [key,label]of [['installations','car installation history'],['assemblies','assemblies or assembly history'],['setups','saved setups'],['tests','performance records'],['jobs','workshop jobs'],['events','car history'],['buildDrafts','saved build drafts']])scan(db[key],label);
 scan(db.planning?.shopping,'shopping list or purchase history');for(const p of db.parts)scan(p,'stock returned from this part',p.id);
 const byId=new Map(db.parts.map(p=>[p.id,p]));
 const rows=ids.map(id=>{const part=byId.get(id);if(!part)throw Error('Part not found.');return {id,name:part.name,quantity:part.quantity,reasons:[...(part.quantity>0?['owned stock']:[]),...linked.get(id)]};});
 return {revision:db.revision,eligible:rows.filter(r=>!r.reasons.length),blocked:rows.filter(r=>r.reasons.length)};
}
function removeMany(db,p){
 if(p.revision!==db.revision)throw Error('The database changed. Reopen the delete action.');
 if(p.confirmed!==true)throw Error('Confirm deletion of the reviewed catalogue entries.');
 const plan=deletions(db,p.ids);if(plan.blocked.length)throw Error('Some parts have stock or linked records. Review the selection again.');
 const ids=new Set(p.ids);db.parts=db.parts.filter(p=>!ids.has(p.id));return p.ids;
}
module.exports={deletion,remove,deletions,removeMany};
