'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),T=require('../src/timing-integration.cjs'),A=require('../src/scalable-api.cjs'),schema=require('../src/scalable-schema.cjs'),{fixtures}=require('../tests/support/timing-fixtures.cjs');
const out=path.resolve(__dirname,'../integration-handoff/scalable-v1'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-public-fixtures-'));
try{
 fs.mkdirSync(path.join(out,'fixtures'),{recursive:true});const f=fixtures(),store=new Store(path.join(temp,'database.json'));store.replace(f.store.snapshot());
 const get=route=>A.handle(store,'GET',new URL('http://localhost/v1/scalable'+route),{browse:true,timingResults:true},store.data.id),manifest={};
 const write=(name,value,type)=>{schema.validate(value,type);fs.writeFileSync(path.join(out,'fixtures',name+'.json'),JSON.stringify(value,null,2)+'\n');manifest[name+'.json']=type;return value;};
 write('discovery',get(''),'scalableDiscovery');write('status',get('/status'),'scalableStatus');write('cars',get('/cars'),'scalableCars');write('profile',get('/cars/car-a/profile'),'scalableProfile');
 const cursor=get('/status').cursor;store.mutate('car.save',{id:'car-a',revision:store.data.cars[0].revision,data:{name:'Renamed example'}});write('car-change',get('/changes?kind=cars&cursor='+cursor),'scalableChanges');
 for(const [name,payload]of [['normal',f.normal],['multi-heat',f.multi],['endurance',f.endurance],['correction',f.correction],['withdrawal',f.withdrawal]]){
  const before=get('/status').cursor;T.receive(store,payload);const route='/results/'+payload.source.id+'/'+payload.sessionId,head=write(name+'-session',get(route),'scalableSession');write(name+'-change',get('/changes?kind=results&cursor='+before),'scalableChanges');
  for(const p of payload.participants||[])write(name+'-laps-'+p.id,get(route+'/laps/'+p.id+'?token='+head.resultToken),'scalableLaps');
 }
 write('results',get('/results'),'scalableResults');store.replace(store.snapshot());write('reset-required',get('/changes?kind=cars&cursor='+cursor),'scalableChanges');
 const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';store.mutate('car.save',{id:'car-a',revision:store.data.cars[0].revision,data:{picture:photo}});const picture=get('/cars').cars.find(c=>c.id==='car-a');write('media',get(picture.media.url.slice(A.BASE.length)),'scalableMedia');write('car-with-media',get('/cars'),'scalableCars');
 fs.writeFileSync(path.join(out,'schema.json'),JSON.stringify(schema.schema,null,2)+'\n');fs.writeFileSync(path.join(out,'fixtures','manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log('Exported '+Object.keys(manifest).length+' validated public examples.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
