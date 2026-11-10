'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process'),asar=require('@electron/asar');
const project=path.resolve(__dirname,'..');
for(const release of [false,true])for(const enabled of [false,true])test(`QA archive gate verification: release=${release}, prepared=${enabled}`,async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-package-gates-')),qa=path.join(root,'.qa/installed-history');
 t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('sf-package-gates-'));fs.rmSync(root,{recursive:true,force:true});});
 for(const name of ['scripts/verify-installed-history.cjs','tests/support/history-gates.cjs','tests/support/installed-history-bootstrap.cjs']){const dest=path.join(root,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(project,name),dest);}
 for(const role of ['paddock','timing']){
  const base=path.join(qa,role),input=path.join(base,'original'),prepared=path.join(base,'prepared'),gates=role==='paddock'?['src/rich-history-gate.cjs','src/historical-approval-gate.cjs']:['paddock-rich-gate.js'];
  for(const dir of [input,prepared])fs.mkdirSync(dir,{recursive:true});
  const meta={name:role,version:'0.0.0',main:role==='paddock'?'src/main.cjs':'main.js'};
  fs.writeFileSync(path.join(input,'package.json'),JSON.stringify(meta));fs.writeFileSync(path.join(prepared,'package.json'),JSON.stringify({...meta,main:'installed-history-bootstrap.cjs',installedQaRole:role}));
  fs.copyFileSync(path.join(project,'tests/support/installed-history-bootstrap.cjs'),path.join(prepared,'installed-history-bootstrap.cjs'));
  for(const name of gates)for(const [dir,value]of [[input,release],[prepared,enabled]]){const dest=path.join(dir,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,`'use strict';\nconst VERIFIED = ${value};\nmodule.exports=Object.freeze({enabled:()=>VERIFIED});\n`);}
  await asar.createPackage(input,path.join(base,'original-app.asar'));const archive=path.join(base,'win-unpacked/resources/app.asar');fs.mkdirSync(path.dirname(archive),{recursive:true});await asar.createPackage(prepared,archive);
 }
 const env={...process.env,NODE_PATH:path.join(project,'node_modules')};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,[path.join(root,'scripts/verify-installed-history.cjs')],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:15000});assert.ifError(result.error);
 if(enabled){assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(fs.readFileSync(path.join(qa,'verified-package-manifest.json'))).length,2);
  // Identical archives are insufficient if both omit a required gate.
  const base=path.join(qa,'paddock');for(const dir of ['original','prepared'])fs.unlinkSync(path.join(base,dir,'src/rich-history-gate.cjs'));
  await asar.createPackage(path.join(base,'original'),path.join(base,'original-app.asar'));await asar.createPackage(path.join(base,'prepared'),path.join(base,'win-unpacked/resources/app.asar'));
  const missing=spawnSync(process.execPath,[path.join(root,'scripts/verify-installed-history.cjs')],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:15000});assert.ifError(missing.error);assert.notEqual(missing.status,0);assert.match(missing.stderr,/Required compiled gate missing/);
 }
 else{assert.notEqual(result.status,0);assert.match(result.stderr,/AssertionError/);assert.equal(fs.existsSync(path.join(qa,'verified-package-manifest.json')),false);}
});
