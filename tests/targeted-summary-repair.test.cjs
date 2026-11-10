'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {Store}=require('../src/store.cjs'),S=require('../src/sqlite-storage.cjs'),T=require('../src/timing-integration.cjs');
const totals=require('../src/query-totals.cjs'),performance=require('../src/query-performance.cjs');
function sql(file,fn){const db=new DatabaseSync(file);try{return fn(db);}finally{db.close();}}
function dump(db){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM '+name).all().map(row=>JSON.stringify(row)).sort()]);}
function objects(db){return db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();}
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-targeted-repair-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const f=require('./support/timing-fixtures.cjs').fixtures(),store=new Store(path.join(dir,'db.sqlite'));store.replace(f.store.snapshot());T.receive(store,f.multi);
 await store.mutateAsync('work.add',{carId:'car-a',title:'Keep receipt',type:'maintenance'},{commandId:'kept-receipt',snapshot:false});
 return {...f,store};
}
function summaries(db){return {totals:db.prepare('SELECT * FROM query_totals ORDER BY bucket,status,archived').all(),performance:db.prepare('SELECT * FROM query_performance ORDER BY car_id').all()};}
function checkFutureWrites(store,f){
 store.mutate('car.save',{data:{name:'After repair'}});
 for(const input of [f.normal,f.correction,f.withdrawal])T.receive(store,input);
 sql(store.file,db=>{
  const before=summaries(db);db.exec('BEGIN');try{totals.rebuild(db);performance.rebuild(db);assert.deepEqual(summaries(db),before);}finally{db.exec('ROLLBACK');}
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 });
}
const missingObjects=[['totals','table','query_totals'],...['insert','update','delete'].map(op=>['totals','trigger','query_totals_'+op]),['performance','table','query_performance'],['performance','table','query_performance_dirty'],...['insert','update','delete'].map(op=>['performance','trigger','query_performance_'+op])];
for(const [family,type,name]of missingObjects)test('repair '+name+' without loading source bodies or rebuilding unrelated summaries',async t=>{
 const f=await fixture(t),file=f.store.file;
 const before=sql(file,db=>dump(db)),healthy=family==='totals'?['query_performance','query_performance_dirty']:['query_totals'];
 const guards=[];
 sql(file,db=>{
  if(family==='totals')db.exec('UPDATE query_totals SET n=n+100');else db.exec("UPDATE query_performance SET json='{}'");
  db.exec('DROP '+type+' '+name);
  for(const table of [...healthy,'query_records','query_laps','query_car_results'])for(const op of ['INSERT','UPDATE','DELETE']){
   const guard='protect_'+table+'_'+op;guards.push(guard);db.exec(`CREATE TRIGGER ${guard} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'Unrelated rows rewritten'); END;`);
  }
 });
 const read=t.mock.method(S,'read',()=>{throw Error('Full source load during summary repair');});
 let opened;try{opened=new Store(file,{deferred:true});}finally{read.mock.restore();}
 assert.ok(opened.deferredState);assert.equal(opened.deferredState.stats.loadedSections.includes('timing'),false);
 sql(file,db=>{
  assert.deepEqual(dump(db),before);assert.ok(require('../src/query-index.cjs').objectsReady(db));
  for(const guard of guards){assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(guard));db.exec('DROP TRIGGER '+guard);}
 });
 checkFutureWrites(opened,f);
});

for(const family of ['totals','performance','both'])test(family+' repair failure rolls back all changes and succeeds on retry',async t=>{
 const f=await fixture(t),file=f.store.file,original=sql(file,dump);
 sql(file,db=>{
  if(family!=='performance')db.exec('DROP TRIGGER query_totals_update');
  if(family!=='totals')db.exec('DROP TRIGGER query_performance_update');
 });
 const before=sql(file,dump),schema=sql(file,objects),module=family==='totals'?totals:performance,rebuild=module.rebuild;
 const injection=t.mock.method(module,'rebuild',db=>{rebuild(db);throw Error('Interrupted repair');});
 try{assert.throws(()=>S.upgrade(file,f.store.expectedIdentity),/Interrupted repair/);}finally{injection.mock.restore();}
 assert.deepEqual(sql(file,dump),before);assert.deepEqual(sql(file,objects),schema);
 const opened=await Store.open(file);assert.ok(opened.deferredState);assert.deepEqual(sql(file,dump),original);checkFutureWrites(opened,f);
});

test('background opening repairs summaries while preserving the healthy family',async t=>{
 const f=await fixture(t),file=f.store.file,before=sql(file,dump);
 sql(file,db=>db.exec("DROP TRIGGER query_performance_delete; CREATE TRIGGER keep_totals BEFORE INSERT ON query_totals BEGIN SELECT RAISE(ABORT,'Totals rebuilt'); END;"));
 const read=t.mock.method(S,'read',()=>{throw Error('Caller loaded collection');}),upgrade=t.mock.method(S,'upgrade',()=>{throw Error('Caller repaired collection');});
 let opened;try{opened=await Store.open(file);}finally{read.mock.restore();upgrade.mock.restore();}
 assert.ok(opened.deferredState);assert.deepEqual(sql(file,dump),before);assert.ok(sql(file,db=>db.prepare("SELECT 1 FROM sqlite_master WHERE name='keep_totals'").get()));
});

test('v7 upgrade builds performance without recreating healthy collection totals',async t=>{
 const f=await fixture(t),file=f.store.file;
 sql(file,db=>db.exec("UPDATE state SET value='7' WHERE key='query_index_version'; DROP TABLE query_performance; CREATE TRIGGER keep_totals BEFORE INSERT ON query_totals BEGIN SELECT RAISE(ABORT,'Totals rebuilt'); END;"));
 const opened=await Store.open(file);assert.ok(opened.deferredState);
 sql(file,db=>{assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='keep_totals'").get());assert.equal(db.prepare("SELECT value FROM state WHERE key='query_index_version'").get().value,'8');});
});
