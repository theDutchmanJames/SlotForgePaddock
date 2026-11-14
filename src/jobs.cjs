const {randomUUID}=require('node:crypto');
const w=require('./workshop.cjs');
const jobTypes=require('../renderer/job-types.js');
const {cloneJSON:clone}=require('./json-data.cjs');
const now=()=>new Date().toISOString();
function check(ok,message){if(!ok)throw Error(message);}
const signature=rows=>JSON.stringify(rows.map(i=>[i.partId,i.quantity,i.field||'',i.position||'',i.assemblyId||'']).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
const snapshot=(db,carId)=>({technical:clone(db.cars.find(c=>c.id===carId).technical),installations:clone(w.active(db).filter(i=>i.carId===carId).map(i=>({...i,name:db.parts.find(p=>p.id===i.partId).name})))});
function model(db,id,techFields,{choices=true,requirementsOnly=false}={}){
  const job=db.jobs.find(j=>j.id===id);check(job,'Workshop job not found.');
  if(job.kind==='general'){const car=db.cars.find(c=>c.id===job.carId);return {revision:db.revision,job:clone(job),carName:car.name,remaining:0,actual:snapshot(db,car.id)};}
  const car=db.cars.find(c=>c.id===job.carId),installed=w.active(db).filter(i=>i.carId===car.id),claimed=new Set();
  const options=choices?w.setupOptions({cars:db.cars,parts:db.parts,assemblies:db.assemblies,installations:db.installations,setups:[job.target]},job.target.id):{rows:w.requirements(job.target)};
  // Honour explicit step confirmations before matching remaining original stock.
  // Otherwise an indistinguishable earlier row can steal a later row's fitted part.
  const matchesByKey=new Map();
  for(const explicit of [true,false])for(const r of options.rows){
    if(matchesByKey.has(r.key)||explicit&&!job.accepted[r.key])continue;
    let matches=[];
    if(r.kind==='assembly'){
      for(const a of w.liveAssemblies(db).filter(a=>a.carId===car.id&&w.compatible(a,r))){
        const candidates=installed.filter(i=>i.assemblyId===a.id);
        if(candidates.every(i=>!claimed.has(i.id))&&signature(candidates)===(explicit?job.accepted[r.key]:signature(r.components))){matches=candidates;break;}
      }
    }else{
      const candidate=installed.find(i=>!i.assemblyId&&!claimed.has(i.id)&&i.quantity===r.quantity&&i.field===r.field&&i.position===r.position&&(explicit?signature([i])===job.accepted[r.key]:i.partId===r.partId));if(candidate)matches=[candidate];
    }
    if(matches.length){matchesByKey.set(r.key,matches);matches.forEach(i=>claimed.add(i.id));}
  }
  const rows=options.rows.map(r=>{const matches=matchesByKey.get(r.key)||[];return {...r,done:matches.length>0,actual:matches.map(i=>db.parts.find(p=>p.id===i.partId).name).join(' / '),installationIds:matches.map(i=>i.id)};});
  if(requirementsOnly)return {rows};
  // Tracked component names are derived from stock, including explicit substitutes.
  const tracked=new Set(job.target.installations.map(i=>i.field).filter(Boolean));
  const settings=techFields.filter(key=>!tracked.has(key)&&((job.target.technical[key]||'')||(car.technical[key]||''))).map(key=>({key,target:job.target.technical[key]||'',actual:car.technical[key]||'',done:(job.target.technical[key]||'')===(car.technical[key]||'')}));
  const extras=installed.filter(i=>!claimed.has(i.id));
  const remaining=rows.filter(r=>!r.done).length+settings.filter(s=>!s.done).length+new Set(extras.map(i=>i.assemblyId||i.id)).size;
  return {revision:db.revision,job:clone(job),carName:car.name,rows,settings,extras:clone(extras),remaining,actual:snapshot(db,car.id)};
}
function mutate(db,action,p,techFields){
  check(p.revision===db.revision,'The database changed. Reopen the job to review the current car.');
  if(action==='job.start'){
    check(p.category===undefined||jobTypes.valid(p.category),'Choose a valid job category.');
    check(p.kind===undefined||['general','setup'].includes(p.kind),'Choose a job type.');
    if(p.kind==='general'){
      const car=db.cars.find(c=>c.id===p.carId);check(car,'Choose a car.');require('./car-membership.cjs').physical(car);check(!car.archived,'Restore this car from the archive first.');
      check(!db.jobs.some(j=>j.carId===car.id&&j.status==='active'),'This car already has an active workshop job.');
      check(typeof p.name==='string'&&p.name.trim()&&p.name.length<=200,'Enter a job name (maximum 200 characters).');
      check(p.notes===undefined||typeof p.notes==='string'&&p.notes.length<=20000,'Job notes are too long.');
      const job={id:randomUUID(),kind:'general',category:p.category||'general',carId:car.id,name:p.name.trim(),notes:p.notes||'',baseline:snapshot(db,car.id),status:'active',created:now(),updated:now(),log:[]};
      db.jobs.unshift(job);w.event(db,car.id,'Started workshop job: '+job.name,'Work planned; no physical changes recorded.',{jobId:job.id});return job.id;
    }
    const setup=db.setups.find(s=>s.id===p.setupId);check(setup,'Setup not found.');
    check(p.carId===undefined||p.carId===setup.carId,'Setup does not belong to the selected car.');
    require('./car-membership.cjs').physical(db.cars.find(c=>c.id===setup.carId));check(!db.cars.find(c=>c.id===setup.carId).archived,'Restore this car from the archive first.');
    check(!db.jobs.some(j=>j.carId===setup.carId&&j.status==='active'),'This car already has an active workshop job.');
    const job={id:randomUUID(),category:p.category||'general',carId:setup.carId,setupId:setup.id,name:setup.name,target:clone(setup),status:'active',accepted:{},created:now(),updated:now(),log:[]};
    db.jobs.unshift(job);w.event(db,job.carId,'Started workshop job: '+job.name,'Target saved; no physical changes recorded.',{jobId:job.id});return job.id;
  }
  const job=db.jobs.find(j=>j.id===p.id);check(job&&job.status==='active','This job is already closed or missing.');
  const car=db.cars.find(c=>c.id===job.carId);let note='',change;
  if(action==='job.shopping'){
    check(job.kind!=='general','Use the rebuild editor or add purchases manually for general work.');job.shoppingRequirements=true;require('./shopping-requirements.cjs').job(db,job,now());return job.id;
  }
  if(action==='job.edit'){
    check(Object.keys(p).every(k=>['id','revision','name','notes','category'].includes(k)),'Only the job name, category and planned work can be edited.');
    check(typeof p.name==='string'&&p.name.trim()&&p.name.length<=200,'Enter a job name (maximum 200 characters).');
    check(typeof p.notes==='string'&&p.notes.length<=20000,'Enter job notes (maximum 20,000 characters).');
    check(p.category===undefined||jobTypes.valid(p.category),'Choose a valid job category.');
    const category=p.category??job.category??'general';check(!db.buildDrafts.some(d=>d.data.rebuild?.jobId===job.id)||category==='rebuild','A rebuild draft must keep the Rebuild job category.');
    if(job.name===p.name.trim()&&(job.notes||'')===p.notes&&(job.category||'general')===category)return job.id;
    note=job.name===p.name.trim()?'Updated planned work / instructions.':'Renamed job: '+job.name+' → '+p.name.trim();
    if((job.notes||'')!==p.notes&&!note.startsWith('Updated'))note+='; updated planned work / instructions.';
    if(job.name===p.name.trim()&&(job.notes||'')===p.notes)note='';
    if((job.category||'general')!==category)note+=(note?' ':'')+'Category: '+jobTypes.get(job.category).label+' → '+jobTypes.get(category).label+'.';
    job.name=p.name.trim();job.notes=p.notes;job.category=category;
  }else if(action==='job.note'){
    check(job.kind==='general','Progress notes belong to general workshop jobs.');check(typeof p.note==='string'&&p.note.trim()&&p.note.length<=20000,'Enter a progress note (maximum 20,000 characters).');note=p.note.trim();
  }else
  if(action==='job.cancel'){
    check(p.confirmed===true,'Confirm cancellation. Completed physical work will remain.');const drafts=new Set(db.buildDrafts.filter(d=>d.data.rebuild?.jobId===job.id).map(d=>d.id));for(const draftId of drafts)require('./purchasing.cjs').cancelBuild(db,draftId,now());db.buildDrafts=db.buildDrafts.filter(d=>!drafts.has(d.id));job.status='cancelled';job.finished=now();job.actual=snapshot(db,car.id);note='Cancelled; recorded physical changes retained.';
  }else if(action==='job.complete'){
    check(!db.buildDrafts.some(d=>d.data.rebuild?.jobId===job.id),'Complete this rebuild through Build from Scratch to create its linked successor.');
    check(p.confirmed===true,'Confirm the completed physical configuration.');const plan=db.planning?.jobs.find(x=>x.jobId===job.id);check(!plan?.waiting,'Clear Waiting for parts before completing this job.');check(!plan?.checklist.some(s=>!s.done),'Finish the checklist before completing this job.');check(model(db,job.id,techFields).remaining===0,'There are still outstanding parts, settings or removals.');job.status='completed';job.finished=now();job.actual=snapshot(db,car.id);note='Completed with actual fitted configuration saved.';
  }else{
    check(job.kind!=='general','Use the car page to record parts and specification changes for this job.');
    check(p.confirmed===true,'Confirm that you have made this physical change.');
    if(action==='job.setting'){
      const row=model(db,job.id,techFields).settings.find(r=>r.key===p.key);check(row&&!row.done,'This setting no longer needs changing.');check(!w.active(db).some(i=>i.carId===car.id&&i.field===p.key),'Remove the tracked component in this position first.');change={key:p.key,before:row.actual,after:row.target};car.technical[p.key]=row.target;const brief=value=>value.length>200?value.slice(0,200)+'…':value;note='Adjusted '+p.key+': '+brief(row.actual)+' → '+brief(row.target);
    }else if(action==='job.remove'){
      const row=w.active(db).find(i=>i.id===p.installationId&&i.carId===car.id);check(row,'That component is no longer fitted.');
      if(row.assemblyId){const a=w.liveAssemblies(db).find(a=>a.id===row.assemblyId);note='Returned complete assembly '+a.name+' to Used spares';w.detachAssembly(db,a,'Used spares');}
      else{note='Returned '+row.quantity+' × '+db.parts.find(p=>p.id===row.partId).name+' to Used spares';w.returnPart(db,row);}
    }else if(action==='job.fit'){
      const before=model(db,job.id,techFields),row=before.rows.find(r=>r.key===p.key);check(row,'Target component not found.');
      check(row.choices.some(c=>c.value===p.selection),'This choice is no longer available.');
      const [type,id]=p.selection.split(':');let fitted=[];
      if(row.kind==='assembly'){
        const a=w.liveAssemblies(db).find(a=>a.id===id);check(type==='a'&&a&&w.compatible(a,row),'Choose a compatible assembly.');
        check(!a.carId||a.carId===car.id||p.allowTransfer===true,'Confirm the transfer from the other car.');
        if(a.carId!==car.id)w.installAssembly(db,a,car.id);
        fitted=w.active(db).filter(i=>i.assemblyId===a.id);note='Fitted assembly '+a.name+' for '+row.name;
      }else{
        const i=type==='i'?w.active(db).find(i=>i.id===id&&!i.assemblyId):null,part=db.parts.find(x=>x.id===(i?i.partId:id));
        check(part&&(type==='p'||i),'Component unavailable.');
        const from=i?.carId;check(!i||!before.rows.some(r=>r.key!==row.key&&r.installationIds.includes(i.id)),'This component already fulfils another job step.');
        check(!from||from===car.id||p.allowTransfer===true,'Confirm the transfer from the other car.');
        if(i&&from===car.id&&i.field===row.field&&i.position===row.position)fitted=[i];
        else{
          if(i){w.endInstallation(db,i,'job transfer');if(from!==car.id){w.touch(db,from);w.event(db,from,'Transferred '+part.name,'To '+car.name);}}
          check(w.available(db,part)>=row.quantity,'Insufficient available stock.');
          fitted=[w.addInstallation(db,car.id,part.id,row.quantity,row.field,row.position)];
        }
        note='Fitted '+row.quantity+' × '+part.name+' for '+row.name;
      }
      // A single physical group/installation cannot fulfil two target rows.
      check(!before.rows.some(r=>r.key!==row.key&&r.installationIds.some(id=>fitted.some(i=>i.id===id))),'This component already fulfils another job step.');
      for(const i of fitted)if(i.field)car.technical[i.field]=db.parts.find(p=>p.id===i.partId).name;
      job.accepted[row.key]=signature(fitted);
    }else throw Error('Unknown job operation.');
    w.touch(db,car.id);
  }
  require('./shopping-requirements.cjs').job(db,job,now());
  job.updated=now();job.log.push({date:now(),action,note,...(change?{change}:{}),actual:snapshot(db,car.id)});
  w.event(db,car.id,'Workshop: '+job.name,note,{jobId:job.id,...(change?{change}: {})});return job.id;
}
function validate(db,techFields){
  check(Array.isArray(db.jobs)&&db.jobs.length<=10000,'Invalid workshop jobs.');const ids=new Set(),activeCars=new Set();
  for(const j of db.jobs){
    check(j&&typeof j.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(j.id)&&!Object.hasOwn(Object.prototype,j.id)&&j.id!=='prototype'&&!ids.has(j.id),'Invalid job identity.');ids.add(j.id);
    check(db.cars.some(c=>c.id===j.carId),'Orphan workshop job.');check(j.shoppingRequirements===undefined||typeof j.shoppingRequirements==='boolean','Invalid job shopping preference.');
    check(j.kind===undefined||['general','setup'].includes(j.kind),'Invalid job type.');
    check(j.category===undefined||jobTypes.valid(j.category),'Invalid job category.');
    check(j.notes===undefined||typeof j.notes==='string'&&j.notes.length<=20000,'Invalid job notes.');
    check(['active','completed','cancelled'].includes(j.status)&&typeof j.name==='string'&&j.name.length<=200&&typeof j.created==='string'&&typeof j.updated==='string','Invalid job details.');
    if(j.kind==='general'){
      check(j.name.trim()&&typeof j.notes==='string'&&j.notes.length<=20000&&!j.setupId&&!j.target,'Invalid general job details.');validateSnapshot(db,j.baseline,techFields);
    }else{
    check(db.setups.some(s=>s.id===j.setupId&&s.carId===j.carId),'Orphan workshop job.');
    check(j.target&&j.target.id===j.setupId&&j.target.carId===j.carId&&JSON.stringify(j.target)===JSON.stringify(db.setups.find(s=>s.id===j.setupId)),'Invalid job target snapshot.');
    check(j.accepted&&typeof j.accepted==='object'&&!Array.isArray(j.accepted),'Invalid accepted components.');
    const keys=new Set(w.requirements(j.target).map(r=>r.key));for(const [key,value]of Object.entries(j.accepted))check(keys.has(key)&&typeof value==='string'&&value.length<=100000,'Invalid job component confirmation.');
    }
    check(Array.isArray(j.log)&&j.log.every(e=>e&&typeof e.date==='string'&&typeof e.action==='string'&&typeof e.note==='string'&&e.note.length<=20000&&e.actual),'Invalid job log.');
    for(const e of j.log)if(e.change)check(techFields.includes(e.change.key)&&typeof e.change.before==='string'&&e.change.before.length<=20000&&typeof e.change.after==='string'&&e.change.after.length<=20000,'Invalid job setting change.');
    if(j.status==='active'){check(!activeCars.has(j.carId),'Only one active job is allowed per car.');activeCars.add(j.carId);}else check(typeof j.finished==='string'&&j.actual,'Missing finished job snapshot.');
    for(const snap of [...j.log.map(e=>e.actual),...(j.actual?[j.actual]:[])])validateSnapshot(db,snap,techFields);
  }
}
function validateSnapshot(db,snap,techFields){
  check(snap&&snap.technical&&typeof snap.technical==='object'&&!Array.isArray(snap.technical)&&Array.isArray(snap.installations),'Invalid actual configuration snapshot.');
  for(const [key,value]of Object.entries(snap.technical))check(techFields.includes(key)&&typeof value==='string'&&value.length<=20000,'Invalid snapshot setting.');
  for(const i of snap.installations)check(i&&db.parts.some(p=>p.id===i.partId)&&Number.isSafeInteger(i.quantity)&&i.quantity>0&&typeof i.name==='string'&&i.name.length<=200&&typeof i.field==='string'&&(!i.field||techFields.includes(i.field))&&typeof i.position==='string'&&i.position.length<=160,'Invalid snapshot inventory.');
}
module.exports={model,mutate,validate,snapshot,validateSnapshot};
