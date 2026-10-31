// Regenerate the public contract and artificial examples from the implementation.
const fs=require('node:fs'),path=require('node:path');
const {fixtures}=require('../tests/support/timing-fixtures.cjs');
const contract=require('../src/timing-schema.cjs'),timing=require('../src/timing-integration.cjs'),model=require('../renderer/timing-results-model.js');
const root=path.join(__dirname,'..','integration-handoff','timing-v1');
fs.mkdirSync(path.join(root,'fixtures'),{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n');
write('timing-v1.schema.json',contract.schema);
const f=fixtures();write('fixtures/demo-database.json',f.store.snapshot());
write('fixtures/profile-car-a.json',f.profiles[0]);write('fixtures/profile-car-b.json',f.profiles[1]);
for(const [name,key]of [['normal','normal'],['multi-heat','multi'],['endurance','endurance'],['correction','correction'],['withdrawal','withdrawal']])write('fixtures/'+name+'.json',f[key]);
const withSummary=structuredClone(f.normal);withSummary.participants[0].summary=model.statistics(withSummary,withSummary.participants[0]);write('fixtures/normal-with-summary.json',withSummary);
for(const [name,key]of [['normal','normal'],['correction','correction'],['withdrawal','withdrawal']]){const r=timing.receive(f.store,f[key]);r.receivedAt='2026-10-31T10:05:00.000Z';write('fixtures/'+name+'-response.json',r);}
const duplicate=timing.receive(f.store,f.withdrawal);duplicate.receivedAt='2026-10-31T10:05:00.000Z';write('fixtures/duplicate-response.json',duplicate);
write('fixtures/status-response.json',{protocol:2,id:f.store.data.id,revision:f.store.data.revision,name:f.store.data.settings.name,permissions:{browse:true,submit:false,timingResults:true},capabilities:timing.capabilities()});
write('fixtures/conflict-response.json',{error:'This revision already exists with different content.',code:'REVISION_CONFLICT'});
write('fixtures/stale-response.json',{error:'A newer session revision is already stored.',code:'STALE_REVISION'});
write('fixtures/discovery-request.json',{type:'slotforge-discover',version:1,nonce:'0123456789abcdef0123456789abcdef'});
write('fixtures/discovery-response.json',{type:'slotforge-host',version:1,nonce:'0123456789abcdef0123456789abcdef',id:f.store.data.id,name:f.store.data.settings.name,port:54321});
console.log('Exported Timing v1 schema and artificial fixtures to '+root);
