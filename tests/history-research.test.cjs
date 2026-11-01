const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{Readable}=require('node:stream');
const model=require('../renderer/history-research-model.js'),web=require('../src/history-web.cjs');
const {Store,makePackage,validatePackage,migrate}=require('../src/store.cjs');
const target={databaseId:'db-a',carId:'car-a'};
function kit(){return model.kit({id:target.databaseId},{id:target.carId,name:'Example livery',maker:'NSR',privateNotes:'SECRET',owner:'PRIVATE',picture:'large image'});}
function filled(){const x=kit();x.sources=[{title:'Race result',url:'https://example.org/result'}];x.research.team={value:'Example Team',sourceUrls:[x.sources[0].url],uncertainty:'Team spelling needs checking.'};x.research.finish={value:'DNF',sourceUrls:[x.sources[0].url],uncertainty:''};return x;}
test('research kit is car-specific, English, private-data free and round-trips as JSON',()=>{
 const k=JSON.parse(JSON.stringify(kit()));assert.deepEqual(k.target,target);assert.equal(k.language,'en');assert.equal(k.reference.name,'Example livery');assert.doesNotMatch(JSON.stringify(k),/SECRET|PRIVATE|large image/);assert.equal(Object.keys(k.research).length,9);assert.match(k.instructions.join(' '),/English/);assert.throws(()=>model.preview(k,target),/No filled/);
});
test('completed research validates identity, version, types, sources and supported fields',()=>{
 assert.equal(model.preview(filled(),target).proposals.length,2);
 for(const mutate of [k=>k.target.carId='different',k=>k.target.databaseId='other',k=>k.version=2,k=>k.language='de',k=>k.research.team.value={},k=>k.research.team.value='x'.repeat(501),k=>k.research.classification.value='Confirmed',k=>k.research.privateNotes={value:'bad'},k=>k.sources[0].url='javascript:alert(1)',k=>k.sources[0].url='https://user:secret@example.org',k=>k.research.team.sourceUrls=['https://unlisted.example.org'],k=>k.research.team.uncertainty='x'.repeat(1001),k=>k.sources=Array(21).fill(k.sources[0])]){const k=filled();mutate(k);assert.throws(()=>model.preview(k,target));}
 const k=filled();k.research=JSON.parse('{"__proto__":{"value":"bad"}}');assert.throws(()=>model.preview(k,target),/Unsupported/);assert.equal({}.value,undefined);
});
test('selective import preserves unselected values and photos, retains provenance and never mutates the preview',()=>{
 const preview=model.preview(filled(),target),before=JSON.stringify(preview),history={team:'Old team',finish:'First',photos:[{id:'photo'}],sources:[]};
 const next=model.merge(history,preview,[0]);assert.equal(next.team,'Example Team');assert.equal(next.finish,'First');assert.deepEqual(next.photos,history.photos);assert.equal(next.sources.length,1);assert.equal(next.evidence[0].method,'external-file');assert.match(next.evidence[0].uncertainty,/spelling/);assert.equal(history.team,'Old team');assert.equal(JSON.stringify(preview),before);assert.throws(()=>model.merge(history,preview,[]),/Select/);
});
test('multiple values for one field require a choice and source overflow is explicit',()=>{
 const p=model.preview(filled(),target);p.proposals.push({...p.proposals[0],value:'Other team'});assert.throws(()=>model.merge({},p,[0,2]),/only one/);
 assert.throws(()=>model.merge({sources:Array.from({length:20},(_,i)=>({title:'',url:`https://example.org/${i}`}))},p,[0]),/exceed 20/);
 assert.throws(()=>model.merge({},p,[-1]),/Invalid/);assert.throws(()=>model.merge({},p,[100]),/Invalid/);
});
test('research evidence survives store persistence and packages; old imports clear stale provenance',()=>{
 const s=new Store(),id=s.mutate('car.save',{data:{name:'Car'}}).result,preview=model.preview(filled(),target);
 s.mutate('car.save',{id,revision:1,data:{realHistory:model.merge({},preview,[0])}});
 const h=s.data.cars[0].realHistory;assert.deepEqual(migrate(s.snapshot()).cars[0].realHistory,h);assert.deepEqual(validatePackage(makePackage(s.data,[id])).cars[0].realHistory,h);
 assert.throws(()=>s.mutate('car.save',{id,revision:1,data:{realHistory:model.merge({},preview,[1])}}),/changed/i);
 s.mutate('car.save',{id,revision:2,data:{realHistory:{team:'Manually replaced'}}});assert.deepEqual(s.data.cars[0].realHistory.evidence,[]);
});
test('generic HTML extracts labelled fields, decodes text and keeps alternatives separate',()=>{
 const p=web.parse('<title>A &amp; B</title><table><tr><th>Team:</th><td>A &amp; B</td></tr><tr><th>Team</th><td>Other entry</td></tr></table><dl><dt>Finishing result</dt><dd>DNF</dd></dl><script>team: fake</script><table hidden><tr><td>Year</td><td>2000</td></tr></table>','https://example.org/page');
 assert.equal(p.sources[0].title,'A & B');assert.equal(p.proposals.filter(p=>p.field==='team').length,2);assert.equal(p.proposals.find(p=>p.field==='finish').value,'DNF');assert.ok(!p.proposals.some(p=>p.field==='year'));assert.ok(p.proposals.every(p=>p.method==='webpage'&&p.sourceUrls[0]==='https://example.org/page'));
});
test('structured metadata is only a proposal, unknown JSON-LD fields do not execute or become claims',()=>{
 const p=web.parse('<meta name="description" content="An example miniature"><script type="application/ld+json">{"@type":"Product","description":"Another description","additionalProperty":[{"@type":"PropertyValue","name":"Race number","value":"12"}]}</script>','https://example.org');
 assert.equal(p.proposals.filter(p=>p.field==='history').length,2);assert.equal(p.proposals.find(p=>p.field==='raceNumber').value,'12');assert.ok(!p.proposals.some(p=>p.field==='classification'));assert.match(p.proposals[0].uncertainty,/confirm/);
 assert.throws(()=>web.parse('<script>alert(1)</script><p>No labelled facts</p>','https://example.org'),/No supported/);
});
test('generic reader bounds input, depth and repeated candidate count',()=>{
 assert.throws(()=>web.parse('x'.repeat(web.MAX_BYTES+1),'https://example.org'),/2 MB/);
 assert.throws(()=>web.parse('<div>'.repeat(130),'https://example.org'),/complex/);
 const p=web.parse(Array.from({length:20},(_,i)=>`<dl><dt>Team</dt><dd>Team ${i}</dd></dl>`).join(''),'https://example.org');assert.equal(p.proposals.length,4);
});
test('web URL guard excludes local, mapped, reserved and private networks',()=>{
 for(const ip of ['0.0.0.0','127.0.0.1','10.0.0.1','192.168.1.2','172.16.0.1','169.254.169.254','100.64.0.1','192.0.2.1','198.18.0.1','224.0.0.1','::1','fe80::1','fc00::1','::ffff:127.0.0.1','2002:7f00:1::1','2001:db8::1','3fff::1'])assert.equal(web.publicAddress(ip),false,ip);
 assert.equal(web.publicAddress('8.8.8.8'),true);assert.equal(web.publicAddress('2606:4700:4700::1111'),true);
 for(const url of ['file:///etc/passwd','http://localhost:1234','https://user:secret@example.org'])assert.throws(()=>web.pageURL(url));
});
function transport(responses,seen=[]){return (url,options,cb)=>{const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{seen.push({url,options});const item=responses.shift(),res=Readable.from(item.chunks||[Buffer.from(item.body||'')]);res.statusCode=item.status||200;res.headers=item.headers||{'content-type':'text/html'};cb(res);});return req;};}
const lookup=async()=>[{address:'8.8.8.8',family:4}];
test('web fetch pins DNS, sends no credentials and follows validated redirects',async()=>{
 const seen=[],page=await web.download('https://example.org/start',{lookup,request:transport([{status:302,headers:{location:'/final'}},{body:'<title>Final</title>'}],seen)});
 assert.equal(page.url,'https://example.org/final');assert.equal(page.html,'<title>Final</title>');assert.equal(seen[0].options.headers.Cookie,undefined);
 seen[0].options.lookup('example.org',{all:true},(err,addresses)=>{assert.equal(err,null);assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]);});
});
test('web fetch rejects mixed DNS results and redirects into a local network',async()=>{
 await assert.rejects(web.download('https://example.org',{lookup:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}],request:()=>{throw Error('must not connect');}}),/public websites/);
 await assert.rejects(web.download('https://example.org',{lookup,request:transport([{status:302,headers:{location:'http://127.0.0.1/'}}])}),/public websites/);
});
test('web fetch rejects unsupported content, HTTP errors, oversize responses and endless redirects',async()=>{
 for(const response of [{status:403},{headers:{'content-type':'application/pdf'}},{headers:{'content-type':'text/html','content-encoding':'gzip'}},{body:'x'.repeat(web.MAX_BYTES+1)}])await assert.rejects(web.download('https://example.org',{lookup,request:transport([response])}));
 await assert.rejects(web.download('https://example.org',{lookup,request:transport(Array(4).fill({status:302,headers:{location:'/again'}}))}),/redirects/);
});
