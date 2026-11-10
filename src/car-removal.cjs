'use strict';
const workshop=require('./workshop.cjs');
function plan(db,id){
 const car=db.cars.find(c=>c.id===id);if(!car)throw Error('Car not found.');
 const counts=Object.fromEntries(['setups','tests','jobs','events','documents','installations'].map(k=>[k,db[k].filter(x=>x.carId===id).length]));
 return {id,name:car.name,revision:db.revision,counts,loosePieces:db.installations.filter(i=>i.carId===id&&!i.removed&&!i.assemblyId).reduce((n,i)=>n+i.quantity,0),assemblies:db.assemblies.filter(a=>a.carId===id&&!a.dismantled).length};
}
function checkRebuild(db,id){if(db.cars.find(c=>c.id===id)?.rebuild||db.cars.some(c=>c.rebuild?.from?.id===id||c.rebuild?.to?.id===id))throw Error('Keep linked rebuild records to preserve the car’s history. Archive this car instead.');}
function remove(db,p){
 const preview=plan(db,p.id);checkRebuild(db,p.id);if(p.revision!==db.revision)throw Error('The collection changed. Review deletion again.');
 if(p.confirmName!==preview.name||p.confirmed!==true)throw Error('Type the exact car name and confirm permanent deletion.');
 for(const a of db.assemblies.filter(a=>a.carId===p.id&&!a.dismantled))workshop.detachAssembly(db,a,'Used assemblies');
 for(const i of db.installations.filter(i=>i.carId===p.id&&!i.removed))workshop.returnPart(db,i,'Used spares');
 const jobs=new Set(db.jobs.filter(j=>j.carId===p.id).map(j=>j.id));
  db.buildDrafts=db.buildDrafts.filter(d=>d.data.rebuild?.carId!==p.id);
 for(const key of ['cars','setups','tests','jobs','events','documents','installations'])db[key]=db[key].filter(x=>key==='cars'?x.id!==p.id:x.carId!==p.id);
 for(const a of db.assemblies)if(a.carId===p.id)a.carId=null;
 db.planning.jobs=db.planning.jobs.filter(j=>!jobs.has(j.jobId));
 // Retain purchase history, but detach its deleted job.
 for(const s of db.planning.shopping)if(jobs.has(s.jobId))s.jobId=null;
 for(const s of db.planning.shelves)s.carIds=s.carIds.filter(id=>id!==p.id);
 db.planning.focus=db.planning.focus.filter(f=>f.carId!==p.id);
 if(db.settings.showroomFeaturedId===p.id)db.settings.showroomFeaturedId='';
 return p.id;
}
module.exports={plan,remove};
