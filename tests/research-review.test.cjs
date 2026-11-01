const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {Store}=require('../src/store.cjs'),{readJSON}=require('../src/files.cjs');
const research=require('../renderer/history-research-model.js'),web=require('../src/history-web.cjs'),pace=require('../renderer/pace-model.js');
test('history text edits omit photographs and removed source links disappear from evidence',()=>{
 const history={team:'Team',photos:[{data:'large image'}],sources:[{title:'Source',url:'https://example.org'}],evidence:[{field:'team',method:'external-file',sourceUrls:['https://example.org'],uncertainty:'Uncertain spelling'}]};
 const text=research.textHistory(history);assert.equal(text.photos,undefined);assert.deepEqual(history.photos,[{data:'large image'}]);
 const retained=research.editedEvidence(history,{team:'Team'},[]);assert.equal(retained.length,1);assert.deepEqual(retained[0].sourceUrls,[]);assert.equal(retained[0].uncertainty,'Uncertain spelling');assert.deepEqual(history.evidence[0].sourceUrls,['https://example.org']);
 assert.deepEqual(research.editedEvidence(history,{team:'Another team'},history.sources),[]);
});
test('reference photos need actual image data and validation failure leaves history untouched',()=>{
 const s=new Store(),id=s.mutate('car.save',{data:{name:'Car'}}).result,before=s.snapshot();
 assert.throws(()=>s.mutate('car.save',{id,revision:1,data:{realHistory:{photos:[{id:'photo',name:'Photo',data:''}]}}}),/image data/);assert.deepEqual(s.data,before);
});
test('JSON imports accept UTF-8 BOM, enforce exact byte limits and reject invalid encoding',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-research-json-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'research.json');
 fs.writeFileSync(file,'\uFEFF{"value":"English"}');assert.deepEqual(readJSON(file),{value:'English'});const length=fs.statSync(file).size;assert.deepEqual(readJSON(file,length),{value:'English'});assert.throws(()=>readJSON(file,length-1),/exceeds/);
 fs.writeFileSync(file,Buffer.from([0xff,0xfe,0x7b]));assert.throws(()=>readJSON(file),/UTF-8/);fs.writeFileSync(file,'```json\n{}\n```');assert.throws(()=>readJSON(file),/Markdown/);
 fs.writeFileSync(file,'{}');const read=fs.readSync;let grew=false;t.mock.method(fs,'readSync',function(...args){if(!grew){grew=true;fs.appendFileSync(file,' '.repeat(40));}return read.apply(this,args);});assert.throws(()=>readJSON(file,16),/exceeds/);
});
test('webpage limits reject tag-dense HTML during parsing and definitions tolerate comments',()=>{
 assert.throws(()=>web.parse('<i></i>'.repeat(100000),'https://example.org'),/complex/);
 const p=web.parse('<dl><dt>Team</dt><!-- comment --><dd>One</dd></dl>','https://example.org');assert.equal(p.proposals[0].value,'One');
});
test('webpage timeouts clean up requests, including DNS stalls and synchronous connection errors',async()=>{
 const lookup=async()=>[{address:'8.8.8.8',family:4}];let destroyed=0;
 await assert.rejects(web.download('https://example.org',{lookup,timeoutMs:20,request:()=>{const r=new EventEmitter();r.end=()=>{};r.destroy=()=>{destroyed++;};return r;}}),/timed out/);assert.equal(destroyed,1);
 await assert.rejects(web.download('https://example.org',{lookup:()=>new Promise(()=>{}),timeoutMs:20,request:()=>assert.fail('must not connect')}),/lookup timed out/);
 await assert.rejects(web.download('https://example.org',{lookup,request:()=>{throw Error('Connection factory failed');}}),/factory failed/);
});
test('lane-only calculations preserve earliest eligible ties without calculating comparison metrics',()=>{
 const laps=[{id:'later',number:2,durationMs:1000,endedAtMs:2000,valid:true,pit:false,recordEligible:true},{id:'earlier',number:1,durationMs:1000,endedAtMs:1000,valid:true,pit:false,recordEligible:true}];
 const record=pace.measured(laps,true),full=pace.measured(laps);assert.deepEqual(record.bestLap,full.bestLap);assert.equal(record.bestLap.id,'earlier');assert.equal(record.median,null);assert.equal(full.median,1000);
});
test('manual overflow is excluded and unrelated cars do not trigger lap parsing',()=>{
 const s=new Store(),id=s.mutate('car.save',{data:{name:'Car'}}).result;s.mutate('test.add',{carId:id,track:'Circuit',lane:'1',best:'1e308'});assert.equal(pace.runs(s.data,id)[0].best,null);assert.deepEqual(pace.laneRecords(s.data,id),[]);
 s.data.timing.sessions.push({payload:{state:'active',participants:[{kind:'physical',carId:'other',get laps(){throw Error('Unrelated laps should not be inspected');}}]}});assert.equal(pace.runs(s.data,id).length,1);
});
