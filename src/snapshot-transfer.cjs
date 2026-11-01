// Each window keeps a small history of snapshots it has received. A request
// names its exact baseline; a missing/evicted baseline falls back to a full
// snapshot. This is an IPC optimisation only, not a network protocol change.
const {delta}=require('./club-model.cjs');
class SnapshotTransfer {
 constructor(){this.clear();}
 clear(){this.history=[];}
 encode(result,known,dataPath){
  if(!result.data)return result;
  const data=result.data,base=this.history.find(s=>s.data.id===known?.databaseId&&s.data.revision===known?.revision&&s.path===known?.dataPath&&s.path===dataPath&&s.data.id===data.id);
  const output=base?{...result,data:null,dataPatch:{databaseId:base.data.id,revision:base.data.revision,dataPath,changes:delta(base.data,data)}}:result;
  this.history=this.history.filter(s=>!(s.path===dataPath&&s.data.id===data.id&&s.data.revision===data.revision));
  this.history.push({path:dataPath,data});while(this.history.length>4)this.history.shift();
  return output;
 }
}
module.exports={SnapshotTransfer};
