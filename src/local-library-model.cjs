'use strict';
const crypto=require('node:crypto');
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const fault=(code,message)=>Object.assign(Error(message),{apiCode:code,httpStatus:409});
const identity=(source,transfer)=>'local-'+digest([source,transfer]);
function validate(sub){
 const m=sub.localTransfer;if(m===undefined)return;
 const fail=()=>{throw Error('Invalid local transfer provenance.');};
 if(!m||m.version!==1||!id(m.sourceId)||!id(m.transferId)||!/^[a-f0-9]{64}$/.test(m.hash)||sub.package.packageId!==identity(m.sourceId,m.transferId)||!Array.isArray(m.items)||m.items.length!==sub.package.cars.length||m.items.length>25)fail();
 const seen=new Set();for(const [i,item] of m.items.entries()){
  if(!item||item.itemId!=='item-'+digest(item.timingCarId)||typeof item.timingCarId!=='string'||!item.timingCarId.trim()||item.timingCarId.length>200||seen.has(item.timingCarId)||item.paddockCarId!==sub.package.cars[i].id||!['create','link'].includes(item.action))fail();seen.add(item.timingCarId);
  if(item.action==='link'&&(!Number.isSafeInteger(item.expectedRevision)||item.expectedRevision<1))fail();
  if(item.action==='create'&&item.paddockCarId!=='local-timing-'+digest([m.sourceId,item.timingCarId]))fail();
 }
}
function origin(db,sourceId,timingCarId){
 for(const sub of db.submissions){if(sub.localTransfer?.sourceId!==sourceId)continue;const item=sub.localTransfer.items.find(i=>i.timingCarId===timingCarId);if(item&&sub.outcomes[item.paddockCarId]?.decision!=='reject')return {sub,item};}
 return null;
}
// Called inside the existing submission.review transaction, after its ordinary
// pending checks. A link acknowledges identity only; it never writes car fields.
function accept(db,sub,incoming){
 const item=sub.localTransfer?.items.find(i=>i.paddockCarId===incoming.id);if(!item)return false;
 const car=db.cars.find(c=>c.id===item.paddockCarId);
 if(item.action==='create'){if(car)throw fault('ORIGIN_CONFLICT','This car identity now exists. Reject this transfer and review its link.');return false;}
 if(!car||car.archived||car.revision!==item.expectedRevision)throw fault('TARGET_CHANGED','The selected car changed, was archived or was deleted. Reject this link and review a new transfer in Timing.');
 return true;
}
module.exports={digest,identity,id,validate,origin,accept};
