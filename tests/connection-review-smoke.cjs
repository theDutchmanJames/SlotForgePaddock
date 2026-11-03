const assert=require('node:assert/strict');
module.exports=async({win,store,network,js,wait,click,fill})=>{
 const checks=[],settle=()=>wait('!databaseChangeReading&&!databaseChangeTimer&&!pendingDatabaseChange');
 await settle();await js(`source='local';page='Cars';carId=null;render()`);
 const snapshot=store.snapshot.bind(store);let copies=0;store.snapshot=()=>{copies++;return snapshot();};
 try{
  store.mutate('custom.add',{label:'Shared inspection rating',type:'choice'});copies=0;
  for(let n=0;n<20;n++)win.webContents.send('sf:changed',{kind:'club'});
  await wait('db.revision==='+store.data.revision);await settle();
  assert.equal(copies,0);assert.equal(await js(`collectionMeta.columns.some(c=>c.label==='Shared inspection rating')`),true);
  checks.push('burst refresh updates custom-field metadata through a bounded SQL page');
  copies=0;for(let n=0;n<20;n++)win.webContents.send('sf:changed',{kind:'club'});
  await new Promise(r=>setTimeout(r,180));await settle();assert.equal(copies,0);
  checks.push('unchanged notification bursts do not transfer another snapshot');
 }finally{store.snapshot=snapshot;}

 await click('[data-action="add-car"]');await fill({name:'Keep my unsaved editor text'});
 store.mutate('custom.add',{label:'Another shared field',type:'text'});win.webContents.send('sf:changed',{kind:'club'});
 await wait('!!pendingDatabaseChange');
 assert.equal(await js(`document.querySelector('#dialog').open&&document.querySelector('[name="name"]').value==='Keep my unsaved editor text'`),true);
 await js(`document.querySelector('#dialog').close();modalSubmit=null;render()`);await wait('db.revision==='+store.data.revision);await settle();
 checks.push('background refresh preserves open form values');

 // The main process can switch stores before the explicit reload finishes.
 // A background response must not apply the new store in the old UI context.
 const club=network.club,active=club.active,id=store.data.id;
 try{
  club.active=true;win.webContents.send('sf:changed',{kind:'club'});
  await new Promise(r=>setTimeout(r,180));await settle();
  assert.equal(await js('db.id'),id);
 }finally{club.active=active;await js('reloadClub()');}
 checks.push('background reads cannot mix collection data and storage contexts');

 await js(`window.reviewRealApi=api;window.reviewInitHeld=false;api=async(...args)=>{const result=await window.reviewRealApi(...args);if(args[0]==='read'&&!window.reviewInitHeld){window.reviewInitHeld=true;await new Promise(resolve=>window.releaseReviewInit=resolve);}return result;};db=null;init();true`);
 try{
  await wait('!!window.releaseReviewInit');store.mutate('custom.add',{label:'Arrived during startup',type:'text'});
  win.webContents.send('sf:changed',{kind:'club'});await new Promise(r=>setTimeout(r,100));
  await js('window.releaseReviewInit();true');await wait('db?.revision==='+store.data.revision);await settle();
 }finally{await js('api=window.reviewRealApi;delete window.reviewRealApi;delete window.releaseReviewInit;delete window.reviewInitHeld;');}
 checks.push('notifications arriving during the initial read are applied after startup');

 // Save through the actual preload/main IPC path. The renderer must rebuild
 // the patch against the snapshot captured before the asynchronous request.
 await js(`(async()=>{source='local';await reloadClub();})()`);
 const first=store.data.cars[0];
 if(first){
  const picture=first.picture;
  const queued=await js(`(async()=>{const r=await api('mutate','car.save',{id:${JSON.stringify(first.id)},revision:db.cars.find(c=>c.id===${JSON.stringify(first.id)}).revision,data:{name:'IPC refresh checked'}});acceptSnapshot(r.data);if(r.club)clubState=r.club;return !!r.queued;})()`);
  assert.equal(store.data.cars.find(c=>c.id===first.id).name,queued?first.name:'IPC refresh checked');
  if(queued)assert.equal(store.data.club.proposals[0].payload.data.name,'IPC refresh checked');
  assert.equal(await js(`db.cars.find(c=>c.id===${JSON.stringify(first.id)}).picture`),picture);
  assert.equal(await js('db.revision'),store.data.revision);
  checks.push('saving through preload rebuilds the updated snapshot and retains photos');
 }

 await click('[data-action="nav"][data-id="Connections"]');
 assert.equal(await js(`document.querySelector('#main .panel').classList.contains('club-connections')`),true);
 assert.match(await js(`document.querySelector('.club-connections h2').innerText`),/Dealership Mode/);
 assert.equal(await js(`!!document.querySelector('.connection-cards')`),!network.club.coordinator);
 for(const theme of ['dark','light']){
  await js(`db.settings.theme=${JSON.stringify(theme)};render()`);win.setSize(960,760);
  assert.equal(await js('document.documentElement.scrollWidth>innerWidth+1'),false);
 }
 win.setSize(1440,980);await js(`db.settings.theme='dark';render()`);
 checks.push('Dealership card leads Connections in dark and light layouts');
 return checks;
};
