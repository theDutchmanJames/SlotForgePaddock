'use strict';
const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
// Object member order belongs to the shape. Each scalar/array value is stored
// separately, so changing one scalar updates one field rather than its neighbours.
// Arrays remain bounded values here; large lap arrays need their dedicated reader.
function split(json){
 const envelope=JSON.parse(json),fields=[];
 function visit(value,path=[]){
  if(value&&typeof value==='object'&&!Array.isArray(value))return {object:Object.keys(value).map(key=>[key,visit(value[key],[...path,key])])};
  const key=JSON.stringify(path);fields.push([key,JSON.stringify(value)]);return {field:key};
 }
 return {header:JSON.stringify({shape:visit(envelope.value),refs:envelope.refs,digest:hash(json)}),fields,digest:hash(json)};
}
function reconstruct(header,fields){
 const entry=JSON.parse(header);if(!Object.hasOwn(entry,'shape'))return {value:entry,json:header};
 const values=new Map(fields),used=new Set();
 function visit(shape){
  if(Object.hasOwn(shape,'field')){if(!values.has(shape.field)||used.has(shape.field))throw Error('SQLite field reference integrity check failed.');used.add(shape.field);return JSON.parse(values.get(shape.field));}
  if(Array.isArray(shape.object))return Object.fromEntries(shape.object.map(([key,node])=>[key,visit(node)]));
  throw Error('Invalid SQLite field shape.');
 }
 const value={value:visit(entry.shape),refs:entry.refs},json=JSON.stringify(value);
 if(used.size!==values.size||hash(json)!==entry.digest)throw Error('SQLite field integrity check failed.');
 return {value,json};
}
function merge(header,fields){return reconstruct(header,fields).json;}
function decode(header,fields){return reconstruct(header,fields).value;}
module.exports={split,merge,decode,hash};
