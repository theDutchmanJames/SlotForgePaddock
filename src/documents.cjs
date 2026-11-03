const fs=require('node:fs');
const path=require('node:path');
const TYPES={'.pdf':'application/pdf','.txt':'text/plain','.csv':'text/csv','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.odt':'application/vnd.oasis.opendocument.text','.ods':'application/vnd.oasis.opendocument.spreadsheet','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
const MAX=20*1024*1024;
function check(ok,message){if(!ok)throw Error(message);}
function validateDocument(doc,metadataOnly=false){
  check(doc&&typeof doc.name==='string'&&doc.name.length>0&&doc.name.length<=255&&!/[<>:"/\\|?*\x00-\x1f]/.test(doc.name),'Invalid document filename.');
  const ext=path.extname(doc.name).toLowerCase();check(TYPES[ext]&&doc.mime===TYPES[ext],'Choose PDF, text, CSV, DOCX, XLSX, ODT, ODS or an image.');
  check(Number.isSafeInteger(doc.size)&&doc.size>0&&doc.size<=MAX,'Documents must be between 1 byte and 20 MB.');
  const asset=metadataOnly&&require('./lazy-assets.cjs').property(doc,'data');if(asset){const m=asset.meta;check(!m.photo&&m.canonical&&m.bytes===doc.size&&m.chars===4*Math.ceil(doc.size/3),'Document size or encoding is invalid.');const head=Buffer.from(m.head,'hex');if(ext==='.pdf')check(head.toString('ascii',0,5)==='%PDF-','The file is not a PDF document.');if(['.docx','.xlsx','.odt','.ods'].includes(ext))check(head.subarray(0,4).equals(Buffer.from([80,75,3,4])),'The file is not an Office/OpenDocument archive.');if(ext==='.png')check(head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Invalid PNG document.');if(['.jpg','.jpeg'].includes(ext))check(head[0]===255&&head[1]===216&&head[2]===255,'Invalid JPEG document.');if(ext==='.webp')check(head.toString('ascii',0,4)==='RIFF'&&head.toString('ascii',8,12)==='WEBP','Invalid WebP document.');return null;}
  check(typeof doc.data==='string'&&doc.data.length===4*Math.ceil(doc.size/3)&&/^[A-Za-z0-9+/]+={0,2}$/.test(doc.data),'Invalid document data.');
  const bytes=Buffer.from(doc.data,'base64');check(bytes.length===doc.size&&bytes.toString('base64')===doc.data,'Document size or encoding is invalid.');
  if(ext==='.pdf')check(bytes.subarray(0,5).toString()==='%PDF-','The file is not a PDF document.');
  if(['.docx','.xlsx','.odt','.ods'].includes(ext))check(bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])),'The file is not an Office/OpenDocument archive.');
  if(ext==='.png')check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Invalid PNG document.');
  if(['.jpg','.jpeg'].includes(ext))check(bytes[0]===255&&bytes[1]===216&&bytes[2]===255,'Invalid JPEG document.');
  if(ext==='.webp')check(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP','Invalid WebP document.');
  return bytes;
}
function readDocument(file){const size=fs.statSync(file).size;check(size>0&&size<=MAX,'Choose a document smaller than 20 MB.');const name=path.basename(file),mime=TYPES[path.extname(name).toLowerCase()],doc={name,mime,size,data:fs.readFileSync(file).toString('base64')};validateDocument(doc);return doc;}
module.exports={TYPES,MAX,validateDocument,readDocument};
