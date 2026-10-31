const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {exportJSON,readJSON}=require('../src/files.cjs');
const {Store}=require('../src/store.cjs');
function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-review-'));try{fn(dir);}finally{for(const name of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,name));fs.rmdirSync(dir);}}
test('export preserves unrelated sibling temporary files and replaces only the chosen destination',()=>fixture(dir=>{
  const file=path.join(dir,'cars.json');fs.writeFileSync(file,'old');fs.writeFileSync(file+'.tmp','Unrelated work');exportJSON(file,{cars:['Corvette']});assert.deepEqual(readJSON(file),{cars:['Corvette']});assert.equal(fs.readFileSync(file+'.tmp','utf8'),'Unrelated work');assert.equal(fs.readdirSync(dir).length,2);
}));
test('export protects the database even through a hard-link alias',()=>fixture(dir=>{
  const database=path.join(dir,'database.json'),alias=path.join(dir,'alias.json');fs.writeFileSync(database,'keep');fs.linkSync(database,alias);assert.throws(()=>exportJSON(alias,{replace:true},[database]),/live database/);assert.equal(fs.readFileSync(database,'utf8'),'keep');
}));
test('schema 1 file load is read-only; first successful save retains the legacy recovery copy',()=>fixture(dir=>{
  const file=path.join(dir,'database.json'),source=new Store();source.mutate('car.save',{data:{name:'Legacy car'}});const legacy=source.snapshot();legacy.schema=1;delete legacy.assemblies;fs.writeFileSync(file,JSON.stringify(legacy));const before=fs.readFileSync(file,'utf8');const reopened=new Store(file);assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(reopened.data.schema,9);reopened.mutate('settings.save',{name:'Updated collection'});assert.equal(readJSON(file+'.previous').schema,1);assert.equal(new Store(file).data.cars[0].name,'Legacy car');
}));
