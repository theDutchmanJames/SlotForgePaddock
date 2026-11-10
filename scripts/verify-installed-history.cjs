'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),asar=require('@electron/asar');
const root=path.resolve(__dirname,'../.qa/installed-history'),hash=b=>crypto.createHash('sha256').update(b).digest('hex'),result=[],allowCandidate=process.argv.includes('--candidate');
for(const role of ['paddock','timing']){
 const base=path.join(root,role),original=path.join(base,'original-app.asar'),qualified=path.join(base,'win-unpacked/resources/app.asar'),gates=role==='paddock'?['src/historical-approval-gate.cjs','src/rich-history-gate.cjs']:['paddock-rich-gate.js'];
 const files=asar.listPackage(original).map(f=>f.replace(/^[/\\]/,'').replaceAll('\\','/')),next=asar.listPackage(qualified).map(f=>f.replace(/^[/\\]/,'').replaceAll('\\','/'));
 for(const gate of gates)assert(files.includes(gate),'Required compiled gate missing: '+role+' '+gate);
 assert.deepEqual(next.filter(f=>f!=='installed-history-bootstrap.cjs').sort(),[...files].sort(),'No additional application files');
 let sourceFiles=0,unpackedFiles=0;const changes=[];
 for(const file of files){const native=path.normalize(file),stat=asar.statFile(original,native);if(stat.files)continue;if(stat.unpacked){unpackedFiles++;continue;}sourceFiles++;
  const before=asar.extractFile(original,native),after=asar.extractFile(qualified,native);
  // Check gate values even when the archive bytes did not change. Otherwise a
  // failed preparation could leave both copies closed and still pass review.
  if(gates.includes(file)){assert.equal(after.toString(),require('../tests/support/history-gates.cjs').compile(before.toString(),true));if(!before.equals(after))changes.push(file);continue;}
  if(before.equals(after))continue;changes.push(file);
  if(file==='package.json'){const a=JSON.parse(before),b=JSON.parse(after);assert.equal(b.installedQaRole,role);assert.equal(b.main,'installed-history-bootstrap.cjs');delete b.installedQaRole;b.main=a.main;assert.deepEqual(b,a);}
  else if(allowCandidate&&role==='timing'&&file==='sqlite-paddock.js')assert.equal(after.toString(),before.toString().replace('reads:h.reads===true,statistics:h.statistics===true','reads:h.reads===true,statistics:h.statistics===true,...(h.richWrites===true?{richWrites:true}:{})'));
  else throw Error('Unexpected package source change '+role+' '+file);
 }
 assert.equal(asar.extractFile(qualified,'installed-history-bootstrap.cjs').toString(),fs.readFileSync(path.join(__dirname,'../tests/support/installed-history-bootstrap.cjs'),'utf8'));
 result.push({role,originalSha256:hash(fs.readFileSync(original)),qualifiedSha256:hash(fs.readFileSync(qualified)),sourceFilesCompared:sourceFiles,unpackedFilesNotCompared:unpackedFiles,changes});
}
fs.writeFileSync(path.join(root,'verified-package-manifest.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
