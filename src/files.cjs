const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
function readJSON(file){if(fs.statSync(file).size>256*1024*1024)throw new Error('File exceeds 256 MB.');return JSON.parse(fs.readFileSync(file,'utf8'));}
function sameFile(a,b){
  const normal=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
  if(normal(a)===normal(b))return true;
  if(fs.existsSync(a)&&fs.existsSync(b)){const x=fs.statSync(a),y=fs.statSync(b);return x.dev===y.dev&&x.ino===y.ino;}
  return false;
}
function exportBytes(destination,bytes,protectedFiles=[]){
  if(protectedFiles.some(file=>sameFile(file,destination)))throw new Error('Choose an export location outside the live database files.');
  const temp=path.join(path.dirname(destination),'.slotforge-export-'+randomUUID()+'.tmp');let fd;
  try{fd=fs.openSync(temp,'wx');fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,destination);}
  finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
  return {path:destination};
}
function exportJSON(destination,content,protectedFiles=[]){return exportBytes(destination,JSON.stringify(content),protectedFiles);}
module.exports={readJSON,exportJSON,exportBytes};
