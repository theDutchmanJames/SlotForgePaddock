// Artificial examples only: this script never opens a user's collection.
const fs=require('node:fs'),path=require('node:path');
const {fixtures}=require('../tests/support/timing-fixtures.cjs');
const timing=require('../src/timing-integration.cjs'),telemetry=require('../src/telemetry-export.cjs'),contract=require('../src/timing-schema.cjs');
const root=path.join(__dirname,'..','integration-handoff','telemetry-v1');
fs.mkdirSync(path.join(root,'fixtures'),{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n');
fs.copyFileSync(path.join(__dirname,'..','LICENSE'),path.join(root,'LICENSE'));
const schema={...contract.schema,$id:'https://slotforge.invalid/contracts/telemetry-v1.schema.json',title:'SlotForge Paddock Telemetry read API v1',anyOf:['telemetryIndex','telemetryResult','telemetryStatus','telemetryEvent','telemetryChanges','status','error'].map(name=>({$ref:'#/$defs/'+name}))};
write('telemetry-v1.schema.json',schema);
const read=(f,route)=>telemetry.handle(f.store.data,'GET',new URL(route,'http://localhost'),{timingResults:true},f.store.data.id);
const accept=(f,p)=>{timing.receive(f.store,p);f.store.data.timing.sessions.find(r=>r.payload.source.id===p.source.id&&r.payload.sessionId===p.sessionId).receivedAt='2026-11-01T12:00:00.000Z';};
for(const name of ['normal','multi-heat','endurance','correction','withdrawal']){
  const f=fixtures();if(['correction','withdrawal'].includes(name))accept(f,f.normal);
  accept(f,f[{'multi-heat':'multi'}[name]||name]);
  const index=read(f,'/v1/telemetry/results'),entry=index.entries[0];
  write('fixtures/'+name+'-index.json',index);
  write('fixtures/'+name+'-result.json',read(f,'/v1/telemetry/results/'+entry.sourceId+'/'+entry.sessionId+'?snapshot='+index.snapshot));
}
const f=fixtures();for(const p of [f.normal,f.multi,f.endurance])accept(f,p);
const index=read(f,'/v1/telemetry/results');
write('fixtures/index.json',index);
write('fixtures/filtered-car-b.json',read(f,'/v1/telemetry/results?carId=car-b'));
write('fixtures/change-status.json',read(f,'/v1/telemetry/status'));
write('fixtures/change-event.json',{version:1,databaseId:f.store.data.id,snapshot:index.snapshot});
write('fixtures/changes.json',{version:1,databaseId:f.store.data.id,changeToken:index.changeToken,changed:true});
write('fixtures/unchanged.json',{version:1,databaseId:f.store.data.id,changeToken:index.changeToken,changed:false});
write('fixtures/host-status.json',{protocol:2,id:f.store.data.id,revision:f.store.data.revision,catalogueRevision:f.store.data.catalogueRevision,name:f.store.data.settings.name,permissions:{browse:true,submit:true,timingResults:true,club:true},capabilities:{...timing.capabilities(),telemetry:telemetry.capability}});
for(const [name,code,error]of [['snapshot-changed','SNAPSHOT_CHANGED','Paddock results changed during transfer. Refresh to try again.'],['wrong-database','DATABASE_MISMATCH','A different database is at this address.'],['missing-session','SESSION_NOT_FOUND','This session no longer exists.']])write('fixtures/'+name+'.json',{error,code});
// Keep the existing Timing schema in sync with its additive capability metadata.
fs.writeFileSync(path.join(root,'..','timing-v1','timing-v1.schema.json'),JSON.stringify(contract.schema,null,2)+'\n');
console.log('Exported Telemetry schema and artificial fixtures to '+root);
