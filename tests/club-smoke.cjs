const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store}=require('../src/store.cjs'),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs');
module.exports=async({win,store,network,js,wait,click,fill,submit,qa})=>{
 const checks=[],club=network.club;
 await click('[data-action="nav"][data-id="Connections"]');
 await click('[data-action="club-enable"]');await fill({name:'Main club computer',password:'race',confirm:'race'});
 await js(`document.querySelector('[name="confirmed"]').checked=true`);
 const start=network.start.bind(network);network.start=async()=>{throw Error('Test listener unavailable');};
 try{await submit();}finally{network.start=start;}
 assert.equal(club.coordinator,true);assert.equal(club.device.hostPassword,'race');
 assert.match(await js(`document.querySelector('#toast').innerText`),/settings saved.*could not start/);
 await click('[data-action="club-start"]');
 checks.push('failed first hosting start retains the saved setup and offers a working retry');
 assert.equal(club.coordinator,true);await wait(`document.body.innerText.includes('Dealership Mode')`);assert.equal(network.clubCode,'race');assert.equal(network.hostingMode,'dealership');assert.equal(await js("!!document.querySelector('[data-action=\"set-host-password\"]')"),false);await click('[data-action="club-stop"]');await click('[data-action="club-start"]');assert.equal(network.clubCode,'race');fs.writeFileSync(path.join(qa,'dealership-password-host.png'),(await win.webContents.capturePage()).toPNG());checks.push('Dealership Mode starts with one remembered password and separate hosting controls');
 await click('[data-action="nav"][data-id="Cars"]');await click('[data-action="add-car"]');
 await fill({name:'Club review UI car',maker:'NSR','technical.motor':'21.5k RPM'});await submit();
 assert.ok(!store.data.cars.some(c=>c.name==='Club review UI car'));
 await wait(`page==='Review'&&reviewTab==='Club changes'&&!!document.querySelector('[data-action="club-compare"]')`);
 await click('[data-action="club-compare"]');await wait(`document.querySelector('#modal-form').innerText.includes('Club review UI car')`);
 fs.writeFileSync(path.join(qa,'club-review-dark.png'),(await win.webContents.capturePage()).toPNG());
 await js(`db.settings.theme='light';applyTheme()`);win.setSize(960,760);
 fs.writeFileSync(path.join(qa,'club-review-light-small.png'),(await win.webContents.capturePage()).toPNG());
 assert.equal(await js(`document.documentElement.scrollWidth>innerWidth+1`),false);
 win.setSize(1440,980);await js(`db.settings.theme='dark';applyTheme()`);
 await fill({decision:'accept'});await submit();assert.ok(store.data.cars.some(c=>c.name==='Club review UI car'));
 checks.push('car creation queues and approval commits from Review UI');
 const car=store.data.cars.find(c=>c.name==='Club review UI car');
 await club.mutate('car.save',{id:car.id,revision:car.revision,data:{name:'Rejected name'}});
 await click('[data-action="club-review"]');await click('[data-action="club-compare"]');await fill({decision:'reject'});await submit();
 assert.equal(store.data.cars.find(c=>c.id===car.id).name,'Club review UI car');checks.push('dealership computer rejects a proposed edit without changing the car');
 const folder=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'paddock-club-ui-'));
 const remoteStore=new Store(path.join(folder,'database.json'));remoteStore.mutate('car.save',{data:{name:'Remote club Lexus'}});
 const remoteNet=new Network(remoteStore),remoteClub=new Club(remoteStore,remoteNet,folder);
 try{
  remoteClub.enable('Other club dealership computer','Club test password');await remoteNet.start();
  await click('[data-action="nav"][data-id="Connections"]');
  // The local dealership computer can keep its collection and open another club copy.
  await js(`clubJoin()`);await fill({address:'127.0.0.1:'+remoteNet.port,name:'Club laptop',code:remoteNet.clubCode});await submit();
  await wait(`clubState.active&&clubState.state==='connected'`);assert.equal(club.cache.data.cars[0].name,'Remote club Lexus');
  assert.ok(store.data.cars.some(c=>c.id===car.id));checks.push('joining preserves the separate local collection');
  fs.writeFileSync(path.join(qa,'club-connections.png'),(await win.webContents.capturePage()).toPNG());
  club.disconnect();remoteStore.mutate('car.save',{id:remoteStore.data.cars[0].id,revision:1,data:{name:'New official Lexus'}});
  await click('[data-action="club-join"]');await fill({address:'127.0.0.1:'+remoteNet.port,name:'Club laptop',code:remoteNet.clubCode});await submit();
  await wait(`document.querySelector('.club-outdated')&&!!document.querySelector('[data-action="club-update"]')`);
  assert.equal(club.cache.data.cars[0].name,'Remote club Lexus');
  fs.writeFileSync(path.join(qa,'club-outdated.png'),(await win.webContents.capturePage()).toPNG());
  await click('[data-action="club-update"]');await submit();assert.equal(club.cache.data.cars[0].name,'New official Lexus');
  assert.ok(fs.existsSync(club.backupPath));checks.push('outdated copy requires explicit update and writes recovery backup');
  await click('[data-action="nav"][data-id="Cars"]');await click('[data-action="add-car"]');await fill({name:'Proposed by laptop'});await submit();
  assert.ok(remoteStore.data.club.proposals.some(p=>p.payload.data.name==='Proposed by laptop'));
  await wait(`page==='Review'&&!document.querySelector('[data-action="club-compare"]')`);checks.push('connected member proposes changes without gaining review authority');
  await click('[data-action="club-connections"]');await click('[data-action="club-personal"]');await wait(`!clubState.active`);
  assert.ok(store.data.cars.some(c=>c.id===car.id));checks.push('switching back restores the local collection view');
 }finally{club.disconnect();if(club.device.pair&&!club.device.outbox.length)club.leave();remoteClub.close();await remoteNet.stop();remoteNet.close();fs.rmSync(folder,{recursive:true,force:true});}
 return checks;
};
