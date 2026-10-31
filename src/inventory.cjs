// Physical stock must remain addressable from both current and historical records.
function references(value,id){
  const pending=[value];
  while(pending.length){const item=pending.pop();if(!item||typeof item!=='object')continue;for(const [key,v] of Object.entries(item)){if((key==='partId'||key==='sourcePartId')&&v===id)return true;if(v&&typeof v==='object')pending.push(v);}}
  return false;
}
function deletion(db,id){
  const part=db.parts.find(p=>p.id===id);if(!part)throw Error('Part not found.');
  const reasons=[];
  for(const [key,label] of [['installations','car installation history'],['assemblies','assemblies or assembly history'],['setups','saved setups'],['tests','performance records'],['jobs','workshop jobs'],['events','car history']])if(references(db[key],id))reasons.push(label);
  if(references(db.parts.filter(p=>p.id!==id),id))reasons.push('stock returned from this part');
  return {id,name:part.name,quantity:part.quantity,revision:db.revision,reasons};
}
function remove(db,p){
  if(p.revision!==db.revision)throw Error('The database changed. Reopen the delete action.');
  const plan=deletion(db,p.id);
  if(plan.reasons.length)throw Error('This part is linked to '+plan.reasons.join(', ')+'. Keep the record to preserve those references.');
  db.parts=db.parts.filter(part=>part.id!==p.id);return p.id;
}
module.exports={deletion,remove};
