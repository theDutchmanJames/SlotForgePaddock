(function(root){
  const domain=typeof module==='object'&&module.exports?require('./domain.js'):root.slotforgeDomain;
  function summary(db,day=domain.today()){
    const incoming=db.submissions.filter(s=>s.status==='pending').flatMap(s=>s.package.cars.filter(c=>!s.outcomes[c.id]));
    const jobs=db.jobs.filter(j=>j.status==='active');
    const maintenance=domain.reminders(db.events).filter(e=>db.cars.some(c=>c.id===e.carId&&!c.archived));
    const due=maintenance.filter(e=>e.nextDue<=day),upcoming=maintenance.filter(e=>e.nextDue>day);
    return {incoming,jobs,maintenance,due,upcoming,attention:incoming.length+due.length,day};
  }
  // Technical values are independent choices, not one all-or-nothing object.
  function incomingFields(incoming,existing){
    return Object.keys(incoming).filter(k=>!['id','sharedSetups'].includes(k)).flatMap(k=>k==='technical'
      ?Object.keys(incoming.technical).map(field=>({key:'technical.'+field,field,before:existing?.technical?.[field],after:incoming.technical[field]}))
      :[{key:k,field:k,before:existing?.[k],after:incoming[k]}]).filter(r=>JSON.stringify(r.before??'')!==JSON.stringify(r.after));
  }
  function selection(incoming,fields){
    const allowed=Object.keys(incoming).filter(k=>!['id','sharedSetups'].includes(k)),out={};
    fields??=allowed;
    if(!Array.isArray(fields)||fields.length>256||new Set(fields).size!==fields.length)throw Error('Invalid submitted fields.');
    for(const key of fields){
      if(typeof key!=='string')throw Error('Invalid submitted field.');
      if(key.startsWith('technical.')){
        const field=key.slice(10);
        if(!Object.hasOwn(incoming.technical||{},field))throw Error('Invalid submitted technical field.');
        (out.technical??={})[field]=incoming.technical[field];
      }else{
        if(!allowed.includes(key))throw Error('Invalid submitted field.');
        out[key]=key==='technical'?{...incoming.technical}:incoming[key];
      }
    }
    return out;
  }
  function stockConflicts(db,car,technical={}){
    if(!car)return [];
    return db.installations.filter(i=>i.carId===car.id&&!i.removed&&i.field&&Object.hasOwn(technical,i.field)&&technical[i.field]!==car.technical[i.field]&&technical[i.field]!==db.parts.find(p=>p.id===i.partId)?.name);
  }
  function proposalContext(db,proposal){
    if(proposal.action==='catalogue.picture'){const i=proposal.payload?.intent,r=(i?.kind==='part'?db.parts:db.supplies)?.find(r=>r.id===i?.recordId);return {carId:'',name:r?.name||'Catalogue picture',picture:r?.picture||'',detail:'Illustrated catalogue photograph',renamedTo:''};}
    const p=proposal.payload||{},action=proposal.action||'',record=action==='job.start'&&p.setupId?(db.setups||[]).find(r=>r.id===p.setupId)
      :action.startsWith('job.')||action.startsWith('planning.job.')?(db.jobs||[]).find(r=>r.id===(action.startsWith('planning.job.')?p.jobId:p.id))
      :action.startsWith('setup.')?(db.setups||[]).find(r=>r.id===p.id)
      :(action.startsWith('document.')||action.startsWith('guide.'))?(db.documents||[]).find(r=>r.id===p.id)
      :action==='part.remove'?(db.installations||[]).find(r=>r.id===p.id)
      :action.startsWith('assembly.')?(db.assemblies||[]).find(r=>r.id===p.id):null;
    const carId=p.carId||(action.startsWith('car.')?p.id:record?.carId),car=(db.cars||[]).find(c=>c.id===carId);
    const name=car?.name||(action==='car.save'?p.data?.name:action==='build.create'?p.name:'')||'';
    const part=action.startsWith('part.')?(db.parts||[]).find(r=>r.id===(action==='part.remove'?record?.partId:p.partId||p.id)):null;
    return {carId:car?.id||'',name:name||(carId?'Car no longer in collection':part?.name||record?.title||record?.name||p.title||(action==='part.deleteMany'?((p.ids||[]).length+' catalogue entries'):'')||p.data?.name||''),picture:car?.picture||'',detail:p.title||p.name||record?.title||record?.name||part?.name||'',renamedTo:action==='car.save'&&car&&p.data?.name&&p.data.name!==car.name?p.data.name:''};
  }
  const api={summary,incomingFields,selection,stockConflicts,proposalContext};if(typeof module==='object'&&module.exports)module.exports=api;else root.ReviewModel=api;
})(globalThis);
