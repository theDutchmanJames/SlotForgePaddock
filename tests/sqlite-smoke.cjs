const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({win,store,js,wait,click,qa,dialog,media})=>{
 const {nativeImage}=require('electron'),bytes=nativeImage.createFromPath(path.join(__dirname,'../assets/icon.png')).resize({width:2048,height:2048}).toPNG(),file=path.join(qa,'sqlite-original.png');fs.writeFileSync(file,bytes);
 const id=store.mutate('car.save',{data:{name:'Full-resolution SQLite car'}}).result,oldOpen=dialog.showOpenDialog,oldSave=dialog.showSaveDialog,oldMessage=dialog.showMessageBox;
 try{
  await js(`(async()=>{acceptSnapshot((await api('read')).data);switchCollection('local');page='Cars';carId=${JSON.stringify(id)};section='Photos & documents';render()})()`);
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});await click('[data-action="main-photo"]');await wait(`!!document.querySelector('.photo-grid img')&&document.querySelector('.photo-grid img').naturalWidth===2048`);
  const original='data:image/png;base64,'+bytes.toString('base64');assert.equal(store.data.cars.find(c=>c.id===id).picture,original);
  const url=await js(`db.cars.find(c=>c.id===${JSON.stringify(id)}).picture`);assert.equal(media.expand(url),original);
  const size=await js(`new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve([image.naturalWidth,image.naturalHeight]);image.onerror=()=>reject(Error('Thumbnail failed to load'));image.src=${JSON.stringify(url+'?thumbnail=1')};})`);assert.deepEqual(size,[480,480]);
  const exportFile=path.join(qa,'sqlite-original-export.json');dialog.showSaveDialog=async()=>({canceled:false,filePath:exportFile});await js(`api('file','export',{ids:[${JSON.stringify(id)}]})`);assert.equal(JSON.parse(fs.readFileSync(exportFile)).cars[0].picture,original);
  const before=store.snapshot();store.mutate('settings.save',{name:'SQLite previous revision test'});const previousFile=path.join(qa,'sqlite-previous-export.json');dialog.showSaveDialog=async()=>({canceled:false,filePath:previousFile});await js(`api('file','backup-previous')`);assert.deepEqual(JSON.parse(fs.readFileSync(previousFile)).database,before);
  assert.equal(new (require('../src/store.cjs').Store)(store.file).data.cars.find(c=>c.id===id).picture,original);
  const recoveryDir=path.join(path.dirname(store.file),'recovery-backups'),recoveries=()=>fs.existsSync(recoveryDir)?fs.readdirSync(recoveryDir).sort():[],priorRecoveries=recoveries();
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[previousFile]});
  dialog.showMessageBox=async()=>{store.mutate('settings.save',{name:'Changed while restore confirmation was open'});return {response:1};};
  assert.match(await js(`api('file','restore').then(()=>'',e=>e.message)`),/collection changed/i);
  assert.equal(store.data.settings.name,'Changed while restore confirmation was open');assert.deepEqual(recoveries(),priorRecoveries);
 }finally{dialog.showOpenDialog=oldOpen;dialog.showSaveDialog=oldSave;dialog.showMessageBox=oldMessage;}
 return ['SQLite keeps imported 2048px photos byte-for-byte; the desktop displays full originals and 480px thumbnails','car export retains original image bytes; previous-revision export is a complete restorable backup','restore rechecks collection before creating recovery backup or replacing data'];
};
