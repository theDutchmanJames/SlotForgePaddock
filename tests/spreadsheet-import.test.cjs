'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const X=require('xlsx'),{Store}=require('../src/store.cjs'),F=require('../src/spreadsheet-fields.cjs'),parser=require('../src/spreadsheet-parser.cjs'),{SpreadsheetImports}=require('../src/spreadsheet-import.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-sheet-'));let store=new Store(path.join(dir,'cars.sqlite'));store.persist(store.data);const service=new SpreadsheetImports({profile:path.join(dir,'profile'),getStore:()=>store});t.after(async()=>{await service.close();fs.rmSync(dir,{recursive:true,force:true});});return {dir,service,get store(){return store;},reopen(){store=new Store(store.file,{deferred:true});},csv(text){const file=path.join(dir,'cars.csv');fs.writeFileSync(file,text);return service.pick(file);}};}
async function finish(service,id){await service.start(id);await service.work?.promise;return service.view(id);}
test('CSV quoting, multiline cells, BOM, semicolons and leading zeros remain intact',()=>{
 const p=parser.parse(Buffer.from('\ufeffName;Reference;Description\r\n"BMW; M1";00085;"Line 1\nLine ""2"""\r\n'),'.csv');assert.equal(p.delimiter,';');assert.deepEqual(p.sheets[0].rows[1].map(c=>c.text),['BMW; M1','00085','Line 1\nLine "2"']);
 assert.equal(parser.parse(Buffer.concat([Buffer.from([255,254]),Buffer.from('Name\tReference\r\nCar\t001','utf16le')]),'.csv').delimiter,'\t');
 assert.throws(()=>parser.parse(Buffer.from('Name\n"unfinished'),'.csv'),/quot|read/i);
});
test('fields cover the editable model, exclude internal machinery, and do not guess ambiguous motor columns',()=>{
 const fields=F.fields([{id:'my-number',label:'My number',type:'number'}]);assert.equal(new Set(fields.map(f=>f.id)).size,fields.length);
 for(const k of require('../src/store.cjs').TEXT_FIELDS)assert.ok(fields.some(f=>f.id===k));
 assert.ok(!fields.some(f=>['id','revision','picture','installations','timing'].includes(f.id)));
 assert.deepEqual(F.suggest(['Manufacturer','Reference','Motor','Factory motor','Current motor','My number'],fields),['maker','reference','','factory.motor','technical.motor','custom.my-number']);
});
test('mapping validates dates, decimal formats, labels, duplicate assignments and ignores blanks',()=>{
 const sheet=parser.parse(Buffer.from('Name;Date;Price;Tags;Factory motor\nCar;15/11/2026;1.234,50;one|two|one;\nBad;31/02/2026;EUR 5;;'),'.csv').sheets[0];
 const config={header:1,mapping:['name','acquired','price','tags','factory.motor'],dateOrder:'dmy',decimal:',',labelSeparator:'|'};
 const rows=F.mapRows(sheet,config,F.fields());assert.deepEqual(rows[0].data,{name:'Car',acquired:'2026-11-15',price:'1234.5',tags:['one','two']});assert.equal(rows[1].errors.length,2);
 assert.throws(()=>F.mapRows(sheet,{...config,mapping:['name','name','','','']},F.fields()),/Two columns/);
 assert.throws(()=>F.mapRows(sheet,{...config,mapping:['id','','','','']},F.fields()),/no longer exists/);
});
test('XLSX reads separate sheets, formatted references and native dates without evaluating formulas',()=>{
 const book=X.utils.book_new(),sheet=X.utils.aoa_to_sheet([['Name','Reference','Date','Price','Formula'],['Car',85,new Date('2026-11-15T00:00:00Z'),12.5,3]]);sheet.B2.z='00000';sheet.E2.f='1+2';X.utils.book_append_sheet(book,sheet,'Cars');X.utils.book_append_sheet(book,X.utils.aoa_to_sheet([['Notes']]),'Other');
 const p=parser.parse(X.write(book,{type:'buffer',bookType:'xlsx'}),'.xlsx');assert.equal(p.sheets.length,2);const row=p.sheets[0].rows[1];assert.equal(row[1].text,'00085');assert.equal(row[2].date,'2026-11-15');assert.equal(row[3].number,12.5);assert.equal(row[4].text,'3');
 assert.throws(()=>parser.parse(Buffer.alloc(parser.MAX_FILE+1),'.xlsx'),/16 MiB/);assert.throws(()=>parser.parse(Buffer.from('not xlsx'),'.xlsx'),/valid/);assert.throws(()=>parser.parse(Buffer.from('Name\nCar'),'.xls'),/xlsx/);
});
test('local review preserves ownership/custom fields and does not save until confirmed',async t=>{
 const f=fixture(t);f.store.mutate('custom.add',{label:'Cabinet',type:'text'});const custom=f.store.data.customFields[0].id;
 let v=await f.csv('Name,Manufacturer,Reference,Owner,Price,Private notes,Cabinet,Factory motor,Current motor\nBMW M1,Sideways,00085,James,35,Private,A2,Factory engine,Replacement engine');
 assert.equal(f.store.data.cars.length,0);assert.equal(v.config.mapping[6],'custom.'+custom);
 v=await f.service.preview(v.id);assert.equal(v.ready,1);assert.equal(f.store.data.cars.length,0);v=await finish(f.service,v.id);assert.equal(v.done,1);assert.equal(v.state,'complete');
 const car=f.store.snapshot().cars[0];assert.equal(car.owner,'James');assert.equal(car.privateNotes,'Private');assert.equal(car.custom[custom],'A2');assert.equal(car.reference,'00085');assert.equal(car.factory.motor,'Factory engine');assert.equal(car.technical.motor,'Replacement engine');
 const again=await f.csv('Name,Manufacturer,Reference,Owner,Price,Private notes,Cabinet,Factory motor,Current motor\nBMW M1,Sideways,00085,James,35,Private,A2,Factory engine,Replacement engine');assert.equal(again.id,v.id);assert.equal(again.done,1);
});
test('existing matches are opt-in, updates preserve blank fields/photos/history and selected fields only',async t=>{
 const f=fixture(t);f.store.mutate('car.save',{data:{name:'Old name',maker:'NSR',reference:'123',owner:'Owner',privateNotes:'Keep',technical:{motor:'Original',rearTyres:'Good'}}});const car=f.store.snapshot().cars[0];
 let v=await f.csv('Name,Manufacturer,Reference,Owner,Private notes,Current motor\nNew name,NSR,123,,Incoming,New motor');v=await f.service.preview(v.id);assert.equal(v.rows[0].choice,'skip');assert.equal(v.rows[0].candidates[0].id,car.id);
 f.service.choose(v.id,[{row:2,choice:car.id,fields:['name']}]);v=await finish(f.service,v.id);assert.equal(v.done,1);const updated=f.store.snapshot().cars[0];assert.equal(updated.id,car.id);assert.equal(updated.name,'New name');assert.equal(updated.owner,'Owner');assert.equal(updated.privateNotes,'Keep');assert.deepEqual(updated.technical,car.technical);assert.deepEqual(updated.photos,car.photos);
});
test('duplicate input rows are excluded from select-unmatched; errors remain skipped',async t=>{
 const f=fixture(t);let v=await f.csv('Name,Manufacturer,Reference,Price\nOne,NSR,1,10\nTwo,NSR,1,20\nThree,NSR,2,30\nBad,NSR,3,money');v=await f.service.preview(v.id);assert.deepEqual(v.rows.map(r=>r.choice),['skip','skip','new','skip']);v=f.service.bulk(v.id,true);assert.equal(v.ready,1);assert.equal((await finish(f.service,v.id)).done,1);
});
test('durable receipts recover a lost reply after process restart without adding a duplicate',async t=>{
 const f=fixture(t);let v=await f.csv('Name,Manufacturer,Reference\nCar,Brand,01');v=await f.service.preview(v.id);const original=f.store.mutateAsync.bind(f.store);f.store.mutateAsync=async(...args)=>{await original(...args);throw Error('Lost acknowledgement');};v=await finish(f.service,v.id);assert.equal(v.done,0);assert.equal(f.store.snapshot().cars.length,1);f.reopen();v=await finish(f.service,v.id);assert.equal(v.done,1);assert.equal(f.store.snapshot().cars.length,1);
});
test('restore protection rejects uncertain retries and retains review',async t=>{
 const f=fixture(t);let v=await f.csv('Name\nCar');v=await f.service.preview(v.id);const snapshot=f.store.snapshot();f.store.replace(snapshot);assert.equal(f.service.view(v.id).recoveryChanged,true);await assert.rejects(f.service.start(v.id),/restored|changed/);assert.equal(f.store.snapshot().cars.length,0);
});
test('500-car deferred import uses one-car writes and persists its progress',async t=>{
 const f=fixture(t);f.reopen();let v=await f.csv('Name,Manufacturer,Reference\n'+Array.from({length:500},(_,i)=>`Car ${i},Maker,${String(i).padStart(5,'0')}`).join('\n'));v=await f.service.preview(v.id);assert.equal(v.ready,500);v=await finish(f.service,v.id);assert.equal(v.done,500);assert.equal(f.store.snapshot().cars.length,500);assert.equal(f.service.list()[0].done,500);
});
test('installed parts block conflicting overrides; review-again permits selecting safe fields',async t=>{
 const f=fixture(t),id=f.store.mutate('car.save',{data:{name:'Original',maker:'NSR',reference:'1'}}).result,part=f.store.mutate('part.save',{data:{name:'Fitted motor',quantity:2,tracking:'quantity'}}).result;
 f.store.mutate('part.install',{carId:id,partId:part,field:'motor',quantity:1});const before=f.store.snapshot();f.reopen();let v=await f.csv('Name,Manufacturer,Reference,Current motor\nNew name,NSR,1,Conflicting motor');v=await f.service.preview(v.id);f.service.choose(v.id,[{row:2,choice:id}]);v=await finish(f.service,v.id);assert.equal(v.done,0);assert.match(v.rows[0].error,/installed|workshop/i);assert.deepEqual(f.store.snapshot().installations,before.installations);
 v=await f.service.recheck(v.id,2);assert.ok(!v.rows[0].attempt);f.service.choose(v.id,[{row:2,choice:id,fields:['name']}]);v=await finish(f.service,v.id);assert.equal(v.done,1);assert.equal(f.store.snapshot().cars[0].name,'New name');assert.equal(f.store.snapshot().cars[0].technical.motor,'Fitted motor');assert.deepEqual(f.store.snapshot().parts,before.parts);
});
test('Dealership import waits for approval and lost acknowledgements resend the exact proposal',async t=>{
 const f=fixture(t),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs'),net=new Network(f.store),club=new Club(f.store,net,f.dir);t.after(()=>{club.close();net.close();});club.enable('Test PC','test password',false);f.service.club=club;
 let v=await f.csv('Name,Manufacturer,Reference,Owner\nImported car,NSR,1,James');v=await f.service.preview(v.id);const receive=club.receiveAsync.bind(club);club.receiveAsync=async input=>{await receive(input);throw Error('Lost dealership reply');};v=await finish(f.service,v.id);assert.equal(v.done,0);assert.equal(f.store.data.cars.length,0);assert.equal(f.store.data.club.proposals.length,1);
 club.receiveAsync=receive;v=await finish(f.service,v.id);assert.equal(v.done,1);assert.equal(v.rows[0].result.status,'submitted');assert.equal(f.store.data.club.proposals.length,1);
 const proposal=f.store.data.club.proposals[0],review=club.preview(proposal.id);await club.reviewAsync({id:proposal.id,token:review.token,decision:'accept'});assert.equal(f.store.snapshot().cars[0].owner,'James');
});
test('invalid selection leaves no stuck worker, and delimiter changes rebuild columns',async t=>{
 const f=fixture(t);let v=await f.csv('Name;Reference\nCar;001');v=await f.service.configure(v.id,{...v.config,delimiter:','});assert.equal(v.headers.length,1);v=await f.service.configure(v.id,{...v.config,delimiter:';'});assert.equal(v.headers.length,2);v=await f.service.preview(v.id);f.service.choose(v.id,[{row:2,choice:'new',fields:['reference']}]);await assert.rejects(f.service.start(v.id),/display name/);assert.equal(f.service.work,null);f.service.choose(v.id,[{row:2,choice:'new',fields:['name']}]);assert.equal((await finish(f.service,v.id)).done,1);
});

test('spreadsheet grid preserves blank cell alignment and original row numbers after changing headers',async t=>{
 const f=fixture(t);let v=await f.csv('Collection export,,\nName,Manufacturer,Reference\nFirst,,00001\n,NSR,\nThird,Fly,00003');
 v=await f.service.configure(v.id,{...v.config,header:2});
 assert.deepEqual(v.headers,['Name','Manufacturer','Reference']);
 assert.deepEqual(v.previewRows,[{row:3,cells:['First','','00001']},{row:4,cells:['','NSR','']},{row:5,cells:['Third','Fly','00003']}]);
 assert.equal(v.sourceRows,3);assert.equal(f.store.snapshot().cars.length,0);
});

test('review filters paginate across the full import and keep global selection counts',async t=>{
 const f=fixture(t);f.store.mutate('car.save',{data:{name:'Existing',maker:'NSR',reference:'match',owner:'Keep'}});
 let v=await f.csv('Name,Manufacturer,Reference,Price\n'+Array.from({length:85},(_,i)=>`Car ${i},NSR,${i===60?'match':i},${i===82?'bad':'10'}`).join('\n'));
 v=await f.service.preview(v.id);assert.equal(v.rows.length,40);assert.equal(v.counts.create,83);assert.equal(v.counts.matches,1);assert.equal(v.counts.attention,1);
 const second=f.service.view(v.id,40,'new');assert.equal(second.rows.length,40);assert.ok(!second.rows.some(r=>r.row===62));
 let match=f.service.view(v.id,80,'matches');assert.equal(match.offset,0);assert.equal(match.rows[0].row,62);assert.equal(match.ready,83);
 assert.equal(f.service.view(v.id,0,'attention').rows[0].row,84);
 f.service.choose(v.id,[{row:62,choice:match.rows[0].candidates[0].id,fields:['name']}]);
 match=f.service.view(v.id,0,'matches');assert.equal(match.counts.update,1);assert.equal(match.ready,84);assert.equal(match.filteredTotal,1);
 assert.throws(()=>f.service.view(v.id,0,'invented'),/filter/);assert.equal(f.store.snapshot().cars.length,1);
});

test('previewing a candidate is read-only until the user keeps the row choice',async t=>{
 const f=fixture(t);const id=f.store.mutate('car.save',{data:{name:'Existing',maker:'NSR',reference:'1',owner:'Saved owner'}}).result;
 let v=await f.csv('Name,Manufacturer,Reference,Owner\nUpdated,NSR,1,New owner');v=await f.service.preview(v.id);
 const detail=f.service.detail(v.id,2,id);assert.equal(detail.fields.find(f=>f.id==='owner').before,'Saved owner');assert.equal(detail.row.choice,'skip');
 assert.equal(f.service.view(v.id).rows[0].choice,'skip');assert.equal(f.store.snapshot().cars[0].owner,'Saved owner');
 assert.throws(()=>f.service.detail(v.id,2,'not-a-candidate'),/listed/);
 f.service.choose(v.id,[{row:2,choice:id,fields:['name']}]);await finish(f.service,v.id);assert.equal(f.store.snapshot().cars[0].name,'Updated');assert.equal(f.store.snapshot().cars[0].owner,'Saved owner');
});

test('a completed import can include a previously skipped row without replaying saved cars',async t=>{
 const f=fixture(t);let v=await f.csv('Name,Reference\nFirst,01\nLater,02');v=await f.service.preview(v.id);
 f.service.choose(v.id,[{row:3,choice:'skip'}]);v=await finish(f.service,v.id);assert.equal(v.state,'complete');assert.equal(v.done,1);
 v=f.service.choose(v.id,[{row:3,choice:'new'}]);assert.equal(v.state,'review');assert.equal(v.ready,1);assert.equal(v.done,1);
 v=await finish(f.service,v.id);assert.equal(v.done,2);assert.equal(f.store.snapshot().cars.length,2);
});

test('scrollable source preview reaches every row in bounded chunks and rejects stale layouts',async t=>{
 const f=fixture(t);let v=await f.csv('Name,Reference\n'+Array.from({length:5000},(_,i)=>`Car ${i+1},${String(i+1).padStart(5,'0')}`).join('\n'));
 assert.equal(v.previewTotal,5000);assert.equal(v.previewRows.length,80);
 for(const offset of [0,80,2480,4960]){const page=f.service.previewRows(v.id,offset,v.previewToken);assert.ok(page.rows.length<=80);assert.equal(page.rows[0].row,offset+2);assert.equal(page.rows[0].cells[0],'Car '+(offset+1));}
 const tail=f.service.previewRows(v.id,4960,v.previewToken);assert.equal(tail.rows.at(-1).row,5001);assert.equal(tail.rows.at(-1).cells[1],'05000');
 assert.throws(()=>f.service.previewRows(v.id,-1,v.previewToken),/preview row/);assert.throws(()=>f.service.previewRows(v.id,5001,v.previewToken),/preview row/);
 const old=v;v=await f.service.configure(v.id,{...v.config,header:2});assert.throws(()=>f.service.previewRows(v.id,80,old.previewToken),/layout changed/);assert.equal(v.previewRows[0].row,3);
 assert.equal(f.store.snapshot().cars.length,0);
});
