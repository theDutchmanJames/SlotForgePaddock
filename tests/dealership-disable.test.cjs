'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store}=require('../src/store.cjs'),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs');
async function fixture(t,online=false){const root=require('./support/temp-dir.cjs')('disable-club-'),store=new Store(path.join(root,'database.sqlite'));store.mutate('car.save',{data:{name:'Keep this car'}});const network=new Network(store),club=new Club(store,network,root);club.enable('Home','test password');if(online)await network.start();t.after(async()=>{club.close();await network.stop();network.close();fs.rmSync(root,{recursive:true,force:true});});const input=()=>({databaseId:store.data.id,clubId:store.data.club?.id,revision:store.data.revision,recoveryId:require('../src/sqlite-storage.cjs').syncState(store.file).epoch});return {root,store,network,club,input};}

for(const online of [false,true])test('turn off Dealership '+(online?'online':'offline')+' keeps library data, backs up proposals and allows direct local saves',async t=>{
 const {root,store,network,club,input}=await fixture(t,online);await club.propose('car.save',{data:{name:'Pending car'}});
 const shared=await require('../packages/shared-library/index.cjs').open({application:'SlotForge Timing',installationId:'Timing',sharedRoot:path.join(root,'shared'),legacyPaddockPath:store.file});try{
  await require('../src/domain-tasks.cjs').run(store,{kind:'refresh',databaseId:store.data.id});const before=store.snapshot(),identity=input(),start=await shared.status();await club.disableAsync(identity);assert.equal(club.status().role,'personal');assert.equal(store.data.club,null);assert.equal(network.server,null);assert.equal(network.access('test password'),null);
  for(const key of Object.keys(before))if(!['club','revision'].includes(key))assert.deepEqual(store.data[key],before[key],key);
  const staged=path.join(root,'restored.sqlite');require('../src/portable-backup.cjs').stageBackup(club.backupPath,staged);assert.equal(new Store(staged).data.club.proposals[0].status,'pending');assert.equal(new Store(store.file).data.club,null);
  const after=await shared.status();assert.equal(after.databaseId,start.databaseId);assert.equal(after.recoveryId,start.recoveryId);assert.equal((await shared.car(before.cars[0].id)).fields.name,'Keep this car');
  const saved=await club.mutate('car.save',{data:{name:'Direct new car'}},{snapshot:false});assert.notEqual(saved.queued,true);assert.equal((await shared.catalogue()).total,2);
  club.enable('Home again','another password',false);assert.notEqual(store.data.club.id,identity.clubId);assert.equal(store.data.club.proposals.length,0);
 }finally{await shared.close();}
});

test('failed backup and stale confirmation keep dealership metadata and reject unsafe removal',async t=>{
 const {store,network,club,input}=await fixture(t,true),backup=club.backupAsync.bind(club),before=input();club.backupAsync=async()=>{throw Error('Backup disk full');};await assert.rejects(club.disableAsync(before),/disk full/);assert.equal(store.data.club.id,before.clubId);assert(network.server);club.backupAsync=backup;
 store.mutate('car.save',{data:{name:'Changed meanwhile'}});await assert.rejects(club.disableAsync(before),/changed/);assert.equal(store.data.club.id,before.clubId);
 const fresh=input();await assert.rejects(club.disableAsync({...fresh,recoveryId:'old-generation'}),/restored/);club.active=true;await assert.rejects(club.disableAsync(fresh),/original local/);club.active=false;
 club.backupAsync=async(...args)=>{const result=await backup(...args);store.mutate('car.save',{data:{name:'Saved during backup'}});return result;};await assert.rejects(club.disableAsync(fresh),/changed/);assert.equal(store.data.club.id,before.clubId);
});

test('an original library restored without its old device ownership can still exit Dealership Mode',async t=>{
 const {store,club,input}=await fixture(t);club.device.coordinator='old-device';assert.equal(club.coordinator,false);await club.disableAsync(input());assert.equal(store.data.club,null);
});
