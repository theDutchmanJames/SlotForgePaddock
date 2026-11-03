const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
function readJSON(file,maxBytes=256*1024*1024){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<=0)throw Error('Invalid JSON file limit.');
  const fd=fs.openSync(file,'r'),chunks=[];let total=0;
  try{
    const stat=fs.fstatSync(fd);if(!stat.isFile())throw Error('Choose a JSON file.');
    const tooLarge=()=>Error(`File exceeds ${maxBytes/(1024*1024)} MB.`);
    if(stat.size>maxBytes)throw tooLarge();
    // Bound the read itself as well as the stat: the file may grow while open.
    for(;;){const chunk=Buffer.alloc(Math.min(65536,maxBytes-total+1)),size=fs.readSync(fd,chunk,0,chunk.length,null);if(!size)break;total+=size;if(total>maxBytes)throw tooLarge();chunks.push(chunk.subarray(0,size));}
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw Error('Save the JSON file as UTF-8 text.');}
    try{return JSON.parse(text);}catch{throw Error('Invalid JSON. Choose the completed .json file without Markdown code fences.');}
  }finally{fs.closeSync(fd);}
}
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
function exportJSON(destination,content,protectedFiles=[]){const text=require('./json-encoding.cjs').boundedStringify(content,256*1024*1024,'JSON export exceeds 256 MiB. Use a portable backup, or export fewer cars.');return exportBytes(destination,text,protectedFiles);}
module.exports={readJSON,exportJSON,exportBytes,sameFile};
