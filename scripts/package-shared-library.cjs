'use strict';
// Reproducible source artifact: both apps execute the same engine, never the
// other installed application's files. No profile/database is included.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),destination=path.resolve(process.argv[2]||path.join(root,'dist','shared-library-engine'));
if(fs.existsSync(destination)&&fs.readdirSync(destination).length)throw Error('Choose an empty package destination. Existing content will not be deleted.');
fs.mkdirSync(destination,{recursive:true});
for(const folder of ['src','renderer'])fs.cpSync(path.join(root,folder),path.join(destination,'engine',folder),{recursive:true,filter:file=>fs.statSync(file).isDirectory()||/\.(?:cjs|js|json)$/.test(file)});
for(const file of ['index.cjs','CONTRACT.md'])fs.copyFileSync(path.join(root,'packages','shared-library',file),path.join(destination,file));
fs.cpSync(path.join(root,'tests','fixtures','contracts','car-merges-v1'),path.join(destination,'merge-contract'),{recursive:true,filter:file=>fs.statSync(file).isDirectory()||/\.(?:md|json)$/.test(file)});
fs.copyFileSync(path.join(root,'LICENSE'),path.join(destination,'LICENSE'));
fs.writeFileSync(path.join(destination,'package.json'),JSON.stringify({name:'@slotforge/shared-library',version:'1.0.0',main:'index.cjs',private:true,license:'SEE LICENSE IN LICENSE'},null,2)+'\n');
const files=[];function walk(folder){for(const name of fs.readdirSync(folder).sort()){const file=path.join(folder,name);if(fs.statSync(file).isDirectory())walk(file);else files.push({path:path.relative(destination,file).split(path.sep).join('/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}}walk(destination);fs.writeFileSync(path.join(destination,'MANIFEST.json'),JSON.stringify({engineVersion:'1.0.0',files},null,2)+'\n');console.log(JSON.stringify({destination,files:files.length}));
