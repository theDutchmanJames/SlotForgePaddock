'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{DatabaseSync}=require('node:sqlite');
const {Store}=require('../src/store.cjs');
test('every missing lookup index is repaired without rewriting source, receipts or healthy projections',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-index-repair-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const f=require('./support/timing-fixtures.cjs').fixtures(),s=new Store(path.join(dir,'db.sqlite'));s.replace(f.store.snapshot());require('../src/timing-integration.cjs').receive(s,f.multi);await s.mutateAsync('work.add',{carId:'car-a',title:'Receipt',type:'maintenance'},{commandId:'repair-receipt',snapshot:false});
 let db=new DatabaseSync(s.file);const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name),dump=d=>tables.map(name=>[name,d.prepare('SELECT * FROM '+name).all()]);const before=dump(db);
 const indexes=db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name").all().map(r=>r.name);assert.equal(indexes.length,14);
 for(const table of ['query_records','query_laps','query_performance'])for(const op of ['INSERT','UPDATE','DELETE'])db.exec(`CREATE TRIGGER protect_${table}_${op} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'Healthy rows rewritten'); END;`);db.close();
 for(const name of indexes){db=new DatabaseSync(s.file);db.exec('DROP INDEX '+name);db.close();const opened=await Store.open(s.file);assert.ok(opened.deferredState);db=new DatabaseSync(s.file);assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(name));assert.deepEqual(dump(db),before);db.close();}
 db=new DatabaseSync(s.file);const plan=db.prepare('EXPLAIN QUERY PLAN SELECT json FROM query_laps WHERE key=? AND participant=? ORDER BY ended,position LIMIT 10').all('session','entry');assert.ok(plan.some(r=>r.detail.includes('query_lap_order')));assert.ok(!plan.some(r=>r.detail.includes('TEMP B-TREE')));db.close();
});
