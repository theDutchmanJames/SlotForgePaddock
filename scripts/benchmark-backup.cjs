// Explicit opt-in disposable transport benchmark. validate:false tests only
// the archive/storage layer. Use qualify-large-active.cjs for domain acceptance.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const B=require('../src/portable-backup.cjs'),{Store}=require('../src/store.cjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
if(process.argv[2]==='--child'){
 const [action,source,destination]=process.argv.slice(3);const start=performance.now();
 if(action==='stage')B.stageBackup(source,destination,{validate:false});else if(action==='export')B.exportBackup(source,destination);else B.verify(source);
 console.log(JSON.stringify({action,seconds:(performance.now()-start)/1000,peakRssMiB:process.resourceUsage().maxRSS/1024}));
}else{
 const count=Number(process.argv[2]||272);if(!Number.isSafeInteger(count)||count<1||count>512)throw Error('Choose 1–512 attachments (8 MiB each).');
 const root=path.resolve(__dirname,'..','.qa');fs.mkdirSync(root,{recursive:true});B.space(root,count*8*1024*1024*5+256*1024*1024);
 const dir=fs.mkdtempSync(path.join(root,'backup-benchmark-')),archive=path.join(dir,'source.sfpbackup'),stage=path.join(dir,'stage.sqlite'),output=path.join(dir,'roundtrip.sfpbackup');
 const seed=new Store(path.join(dir,'seed.sqlite'));seed.mutate('car.save',{data:{name:'Transport fixture'}});B.exportBackup(seed.file,archive);
 const db=new DatabaseSync(archive);db.exec('BEGIN');const meta=Object.fromEntries(db.prepare('SELECT name,value FROM metadata').all().map(x=>[x.name,x.value])),manifest=JSON.parse(meta.manifest),cars=manifest.object.find(x=>x[0]==='cars')[1].array,template=JSON.parse(db.prepare('SELECT json FROM records WHERE key=?').get(cars[0].record).json).value;
 const png=fs.readFileSync(path.join(__dirname,'../assets/icon.png')),padding=Buffer.alloc(6*1024*1024-png.length-4);let assetsBytes=0;
 for(let i=0;i<count;i++){
  const tail=Buffer.alloc(4);tail.writeUInt32BE(i);const asset='data:image/png;base64,'+Buffer.concat([png,padding,tail]).toString('base64'),id=hash(asset),key=JSON.stringify(['cars','id:large-'+i]),json=JSON.stringify({value:{...template,id:'large-'+i,name:'Large '+i,picture:null},refs:[{path:['picture'],hash:id}]});
  db.prepare('INSERT INTO assets VALUES(?,?)').run(id,Buffer.from(asset));db.prepare('INSERT INTO records VALUES(?,?,?)').run(key,json,hash(json));cars.push({record:key});assetsBytes+=Buffer.byteLength(asset);
 }
 meta.manifest=JSON.stringify(manifest);meta.recordCount=String(db.prepare('SELECT count(*) n FROM records').get().n);meta.assetCount=String(count);const digest=crypto.createHash('sha256');digest.update(JSON.stringify([2,meta.created,meta.identity,meta.manifest]));for(const r of db.prepare('SELECT key,digest FROM records ORDER BY key').iterate())digest.update(JSON.stringify([r.key,r.digest]));for(const a of db.prepare('SELECT hash,length(value) size FROM assets ORDER BY hash').iterate())digest.update(JSON.stringify([a.hash,a.size]));meta.digest=digest.digest('hex');for(const [k,v]of Object.entries(meta))db.prepare('UPDATE metadata SET value=? WHERE name=?').run(v,k);db.exec('COMMIT');db.close();
 const runs=[];for(const [action,source,destination]of [['stage',archive,stage],['export',stage,output],['verify',output,'']]){const child=spawnSync(process.execPath,[__filename,'--child',action,source,destination],{encoding:'utf8',maxBuffer:1024*1024});if(child.status!==0)throw Error(child.stderr||child.stdout);const result=JSON.parse(child.stdout.trim());runs.push(result);console.log(JSON.stringify(result));}
 // Both archives must represent identical record envelopes and exact originals.
 const a=new DatabaseSync(archive),b=new DatabaseSync(output),list=d=>d.prepare('SELECT key,digest FROM records ORDER BY key').all();require('node:assert/strict').deepEqual(list(a),list(b));require('node:assert/strict').deepEqual(a.prepare('SELECT hash,length(value) size FROM assets ORDER BY hash').all(),b.prepare('SELECT hash,length(value) size FROM assets ORDER BY hash').all());a.close();b.close();
 let activeLimit='opened successfully';try{new Store(stage);}catch(e){if(!/200 M(?:i)?B/.test(e.message))throw e;activeLimit=e.message;}
 const result={attachments:count,assetMiB:assetsBytes/1048576,archiveMiB:fs.statSync(archive).size/1048576,runs,activeLimit,scope:'Transport/staging benchmark; see qualify-large-active.cjs for active workflows'};fs.writeFileSync(path.join(root,'phase7-backup-benchmark-'+count+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 // Only remove the explicitly created workspace fixture directory.
 if(path.dirname(dir)!==root||!path.basename(dir).startsWith('backup-benchmark-'))throw Error('Unsafe cleanup path');fs.rmSync(dir,{recursive:true,force:true});
}
