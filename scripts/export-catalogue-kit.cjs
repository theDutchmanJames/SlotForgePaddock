// Keep the standalone AI template identical to Import & Export's download.
const fs=require('node:fs'),path=require('node:path');
const {kit}=require('../src/catalogue-import.cjs');
const target=path.join(__dirname,'..','docs','templates','slotforge-catalogue-kit.json');
fs.mkdirSync(path.dirname(target),{recursive:true});
fs.writeFileSync(target,JSON.stringify(kit(),null,2)+'\n');
console.log('Exported catalogue template to '+target);
