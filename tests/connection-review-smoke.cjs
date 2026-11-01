const assert=require('node:assert/strict');
module.exports=async({win,store,network,js,wait,click,fill})=>{
 const checks=[],settle=()=>wait('!databaseChangeReading&&!databaseChangeTimer&&!pendingDatabaseChange');
 await settle();await js(`source='local';page='Cars';carId=null;render()`);
 const snapshot=store.snapshot.bind(store);let copies=0;store.snapshot=()=>{copies++;return snapshot();};
 try{
  store.mutate('custom.add',{label:'Shared inspection rating',type:'choice'});copies=0;
  for(let n=0;n<20;n++)win.webContents.send('sf:changed',{kind:'club'});
  await wait('db.revision==='+store.data.revision);await settle();
  assert.equal(copies,1);assert.equal(await js(`collectionMeta.columns.some(c=>c.label==='Shared inspection rating')`),true);
  checks.push('burst refresh updates custom-field metadata with one snapshot');
  copies=0;for(let n=0;n<20;n++)win.webContents.send('sf:changed',{kind:'club'});
  await new Promise(r=>setTimeout(r,180));await settle();assert.equal(copies,0);
  checks.push('unchanged notification bursts do not transfer another snapshot');
 }finally{store.snapshot=snapshot;}

 await click('[data-action="add-car"]');await fill({name:'Keep my unsaved editor text'});
 store.mutate('custom.add',{label:'Another shared field',type:'text'});win.webContents.send('sf:changed',{kind:'club'});
 await wait('db.revision==='+store.data.revision);await settle();
 assert.equal(await js(`document.querySelector('#dialog').open&&document.querySelector('[name="name"]').value==='Keep my unsaved editor text'`),true);
 await js(`document.querySelector('#dialog').close();modalSubmit=null;render()`);
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

 await click('[data-action="nav"][data-id="Connections"]');
 assert.equal(await js(`document.querySelector('#main .panel').classList.contains('club-connections')`),true);
 assert.match(await js(`document.querySelector('.club-connections h2').innerText`),/Dealership Mode/);
 assert.equal(await js(`!!document.querySelector('.connection-cards')`),true);
 for(const theme of ['dark','light']){
  await js(`db.settings.theme=${JSON.stringify(theme)};render()`);win.setSize(960,760);
  assert.equal(await js('document.documentElement.scrollWidth>innerWidth+1'),false);
 }
 win.setSize(1440,980);await js(`db.settings.theme='dark';render()`);
 checks.push('Dealership card leads Connections in dark and light layouts');
 return checks;
};
