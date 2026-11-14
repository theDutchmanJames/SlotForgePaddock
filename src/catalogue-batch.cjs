'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const catalogue=require('./catalogue-import.cjs');
const limits=Object.freeze({files:64,fileBytes:16*1024*1024,totalBytes:64*1024*1024,products:5000,productBytes:16*1024*1024});
const normal=v=>String(v||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const check=(ok,message)=>{if(!ok)throw Error(message);};
function combine(files){
  check(Array.isArray(files)&&files.length>0&&files.length<=limits.files,'Choose between 1 and 64 catalogue files.');
  const products=[],sources=[],conflicts=[],coverage=[],identities=new Map();let count=0,bytes=0,collapsed=0;
  for(const file of files){
    const input=file.input,name=file.name;
    check(input?.format==='slotforge-catalogue'&&input.version===1,name+': expected a Standard Catalogue version 1 JSON file. Import picture catalogues separately.');
    check(Array.isArray(input.products)&&input.products.length>0,name+': no products to import.');
    count+=input.products.length;check(count<=limits.products,'Combined catalogues exceed 5,000 product rows. Import fewer files together.');
    if(typeof input.coverageNotes==='string')coverage.push({name,notes:input.coverageNotes.slice(0,8000)});
    for(const [row,raw]of input.products.entries()){
      bytes+=Buffer.byteLength(JSON.stringify(raw))+1;check(bytes<=limits.productBytes,'Combined product information exceeds 16 MiB. Import fewer files together.');
      const validated=catalogue.validateProduct(raw,row),p=validated.product,source={file:name,row:row+1};
      // Invalid products remain available for correction, with all original fields.
      const key=p?.manufacturer&&(p.reference||p.name)?JSON.stringify([p.kind,normal(p.manufacturer),p.reference?'ref':'name',normal(p.reference||p.name)]):null;
      const hash=validated.errors.length?null:createHash('sha256').update(JSON.stringify(p)).digest('hex');
      let group=key&&identities.get(key);
      if(!group){const index=products.length;products.push(raw);sources.push([source]);group={index,variants:[{product:raw,sources:[source]}],hashes:new Map(hash?[[hash,0]]:[])};if(key)identities.set(key,group);continue;}
      sources[group.index].push(source);
      if(hash&&group.hashes.has(hash)){group.variants[group.hashes.get(hash)].sources.push(source);collapsed++;continue;}
      if(hash)group.hashes.set(hash,group.variants.length);
      group.variants.push({product:raw,sources:[source]});products[group.index]=null;
      if(group.variants.length===2)conflicts.push({index:group.index,variants:group.variants});
    }
  }
  const input={format:'slotforge-catalogue',version:1,products};catalogue.parse(input);
  return {name:files.length===1?files[0].name:files.length+' catalogue files',input,sources,conflicts,coverage,files:files.map(f=>f.name),originalRows:count,collapsed};
}
async function readFiles(paths){
  check(Array.isArray(paths)&&paths.length>0&&paths.length<=limits.files,'Choose between 1 and 64 catalogue files.');
  const files=[];let total=0;
  for(const filename of paths){const name=path.basename(filename);let handle;
    try{handle=await fs.open(filename,'r');const stat=await handle.stat();check(stat.isFile(),'Not a regular file.');check(stat.size<=limits.fileBytes,'File exceeds 16 MiB.');check(total+stat.size<=limits.totalBytes,'Selected files exceed 64 MiB. Import fewer files together.');
      const buffer=Buffer.alloc(Math.min(limits.fileBytes,limits.totalBytes-total)+1);let length=0;
      while(length<buffer.length){const r=await handle.read(buffer,length,buffer.length-length,null);if(!r.bytesRead)break;length+=r.bytesRead;}
      check(length<=limits.fileBytes,'File exceeds 16 MiB.');total+=length;check(total<=limits.totalBytes,'Selected files exceed 64 MiB. Import fewer files together.');
      files.push({name,input:JSON.parse(buffer.subarray(0,length).toString('utf8').replace(/^\uFEFF/,''))});
    }catch(e){throw Error(name+': '+e.message);}finally{await handle?.close();}
  }
  return files;
}
module.exports={limits,combine,readFiles};
