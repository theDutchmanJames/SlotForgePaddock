'use strict';
// Opt-in active collection qualification. Synthetic QA files only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const B=require('../src/portable-backup.cjs'),{Store}=require('../src/store.cjs'),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
async function active(file){
 const lazy=require('../src/lazy-assets.cjs'),T=require('../src/timing-integration.cjs'),V=require('../src/view-query.cjs'),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs'),f=require('../tests/support/timing-fixtures.cjs').fixtures();
 const started=performance.now(),s=new Store(file),openMs=performance.now()-started;assert.equal(lazy.stats().reads,0);const usageDB=new DatabaseSync(file,{readOnly:true});let size;try{size=s.storageUsage(usageDB);}finally{usageDB.close();}assert.ok(size.logicalBytes>200*1024*1024);assert.ok(size.metadataBytes<1024*1024);assert.equal(size.logicalLimit,null);
 const car=s.data.cars.find(c=>c.id==='large-0');await s.mutateAsync('car.save',{id:car.id,revision:car.revision,data:{name:'Edited above old cap'}},{snapshot:false});assert.ok(s.lastWrite.submittedRecords<10);
 const part=s.mutate('part.save',{data:{name:'Large collection motor',quantity:3,tracking:'quantity'}}).result;s.mutate('part.install',{carId:'car-a',partId:part,quantity:1,field:'motor'});s.mutate('work.add',{carId:'car-a',type:'maintenance',title:'Large collection service'});assert.ok(s.lastWrite.submittedRecords<10);
 T.receive(s,f.normal);assert.equal(T.receive(s,f.normal).duplicate,true);T.receive(s,f.correction);T.receive(s,f.withdrawal);assert.equal(V.view(s,{page:'Cars',carId:'car-a',section:'Performance'}).cars[0].id,'car-a');assert.equal(lazy.stats().reads,0);
 const net=new Network(s),club=new Club(s,net,path.dirname(file)),clientFolder=path.join(path.dirname(file),'client');fs.mkdirSync(clientFolder);const cs=new Store(path.join(clientFolder,'local.sqlite')),cn=new Network(cs),cc=new Club(cs,cn,clientFolder);
 try{
  await club.enableAsync('Large host','1234');await net.start();const address='127.0.0.1:'+net.port;
  const general=await club.mutate('work.add',{carId:'car-a',type:'modification',title:'Reviewed above old cap'},{snapshot:false});assert.equal(general.queued,true);const p=s.data.club.proposals[0];assert.equal(p.baselineVersion,1);const preview=club.preview(p.id);assert.equal(preview.conflict,false);await club.reviewAsync({id:p.id,token:preview.token,decision:'accept'});assert.equal(lazy.stats().reads,0);
  await cc.connect({address,code:'1234',name:'Large client'});assert.equal(cc.cache.data.cars.length,s.data.cars.length);assert.equal(lazy.stats().reads,0);cc.disconnect();let bytes=0;const request=cc.request.bind(cc);cc.request=async(...args)=>{const result=await request(...args);bytes+=Buffer.byteLength(JSON.stringify(result));return result;};
  const selected=s.data.cars.find(c=>c.id==='large-0');await s.mutateAsync('car.save',{id:selected.id,revision:selected.revision,data:{livery:'After sync'}},{snapshot:false});await cc.connect({address,code:'1234',name:'Large client'});assert.equal(cc.cache.data.cars.find(c=>c.id===selected.id).livery,'After sync');assert.ok(bytes<100000);assert.ok(cc.cache.lastWrite.submittedRecords<12);assert.equal(lazy.stats().reads,0);
  const reopened=new Store(file);assert.equal(reopened.data.cars.find(c=>c.id===selected.id).livery,'After sync');assert.equal(T.receive(reopened,f.withdrawal).duplicate,true);
  const asset=lazy.property(reopened.data.cars.find(c=>c.id==='large-0'),'picture');assert.equal(lazy.digest(asset.read()),asset.meta.hash);
  return {openMs:+openMs.toFixed(1),logicalMiB:size.logicalBytes/1048576,metadataMiB:size.metadataBytes/1048576,cars:s.data.cars.length,catchupBytes:bytes,copySubmittedRecords:cc.cache.lastWrite.submittedRecords,originalReadsBeforeExplicitRead:0,checks:['open above 200 MiB','targeted edit','stock installation','maintenance','Timing duplicate/correction/withdrawal','general reviewed change','full localhost sync','incremental catch-up','restart','exact original hash']};
 }finally{club.close();cc.close();await net.stop();net.close();cn.close();}
}
(async()=>{
 if(process.argv[2]==='--child'){const [action,source,destination]=process.argv.slice(3),start=performance.now();let result;
  if(action==='stage')result=B.stageBackup(source,destination);else if(action==='export')result=B.exportBackup(source,destination);else if(action==='active')result=await active(source);else result=B.verify(source);
  console.log(JSON.stringify({action,seconds:(performance.now()-start)/1000,peakRssMiB:process.resourceUsage().maxRSS/1024,result}));return;
 }
 const count=Number(process.argv[2]||272);if(!Number.isSafeInteger(count)||count<26||count>512)throw Error('Choose 26–512 synthetic photos (8 MiB each).');const root=path.resolve(__dirname,'..','.qa');fs.mkdirSync(root,{recursive:true});B.space(root,count*8*1024*1024*8+512*1024*1024);
 const dir=fs.mkdtempSync(path.join(root,'active-benchmark-')),archive=path.join(dir,'source.sfpbackup'),stage=path.join(dir,'stage.sqlite'),output=path.join(dir,'roundtrip.sfpbackup');
 const seed=new Store(path.join(dir,'seed.sqlite'));seed.replace(require('../tests/support/timing-fixtures.cjs').fixtures().store.snapshot());B.exportBackup(seed.file,archive);
 const db=new DatabaseSync(archive);db.exec('BEGIN');const meta=Object.fromEntries(db.prepare('SELECT name,value FROM metadata').all().map(x=>[x.name,x.value])),manifest=JSON.parse(meta.manifest),cars=manifest.object.find(x=>x[0]==='cars')[1].array,template=JSON.parse(db.prepare('SELECT json FROM records WHERE key=?').get(cars[0].record).json).value;
 const png=fs.readFileSync(path.join(__dirname,'../assets/icon.png')),padding=Buffer.alloc(6*1024*1024-png.length-4);let assetsBytes=0;
 for(let i=0;i<count;i++){
  const tail=Buffer.alloc(4);tail.writeUInt32BE(i);const asset='data:image/png;base64,'+Buffer.concat([png,padding,tail]).toString('base64'),id=hash(asset),key=JSON.stringify(['cars','id:large-'+i]),json=JSON.stringify({value:{...template,id:'large-'+i,name:'Large '+i,picture:null},refs:[{path:['picture'],hash:id}]});
  db.prepare('INSERT INTO assets VALUES(?,?)').run(id,Buffer.from(asset));db.prepare('INSERT INTO records VALUES(?,?,?)').run(key,json,hash(json));cars.push({record:key});assetsBytes+=Buffer.byteLength(asset);
 }
 meta.manifest=JSON.stringify(manifest);meta.recordCount=String(db.prepare('SELECT count(*) n FROM records').get().n);meta.assetCount=String(count);const digest=crypto.createHash('sha256');digest.update(JSON.stringify([2,meta.created,meta.identity,meta.manifest]));for(const r of db.prepare('SELECT key,digest FROM records ORDER BY key').iterate())digest.update(JSON.stringify([r.key,r.digest]));for(const a of db.prepare('SELECT hash,length(value) size FROM assets ORDER BY hash').iterate())digest.update(JSON.stringify([a.hash,a.size]));meta.digest=digest.digest('hex');for(const [k,v]of Object.entries(meta))db.prepare('UPDATE metadata SET value=? WHERE name=?').run(v,k);db.exec('COMMIT');db.close();

 const runs=[];for(const [action,source,destination]of [['stage',archive,stage],['active',stage,''],['export',stage,output],['stage',output,path.join(dir,'restored.sqlite')]]){const child=spawnSync(process.execPath,[__filename,'--child',action,source,destination],{encoding:'utf8',maxBuffer:1024*1024});if(child.status!==0)throw Error(child.stderr||child.stdout);const result=JSON.parse(child.stdout.trim());runs.push(result);console.log(JSON.stringify(result));}
 const result={attachments:count,assetMiB:assetsBytes/1048576,runs,scope:'Active SQLite collection, validated portable restore, localhost host/client. Not physical LAN or native macOS/Linux.'};fs.writeFileSync(path.join(root,'phase8-active-'+count+'.json'),JSON.stringify(result,null,2));
 if(path.dirname(dir)!==root||!path.basename(dir).startsWith('active-benchmark-'))throw Error('Unsafe cleanup path');fs.rmSync(dir,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exitCode=1;});
