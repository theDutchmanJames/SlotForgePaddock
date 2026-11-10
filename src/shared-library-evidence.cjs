'use strict';
const zlib=require('node:zlib'),T=require('./timing-integration.cjs');
const MAX=200*1024*1024,CHUNK=1024*1024;
function encode(value){const json=JSON.stringify(value);if(json===undefined||Buffer.byteLength(json)>MAX)throw Object.assign(Error('Original evidence exceeds the preservation limit.'),{code:'ORIGINAL_TOO_LARGE'});const bytes=zlib.gzipSync(json),chunks=[];for(let i=0;i<bytes.length;i+=CHUNK)chunks.push({data:bytes.subarray(i,i+CHUNK).toString('base64')});return {hash:T.digest(value),encoding:'gzip-json-chunks-v1',chunks};}
function decode(row){
 let bytes;if(row.encoding==='gzip-json-v1')bytes=Buffer.from(row.data,'base64');else if(row.encoding==='gzip-json-chunks-v1'&&Array.isArray(row.chunks)&&row.chunks.length>0&&row.chunks.length<=202){bytes=Buffer.concat(row.chunks.map(c=>{if(typeof c.data!=='string'||c.data.length>Math.ceil(CHUNK/3)*4)throw Error('Invalid original evidence chunk.');return Buffer.from(c.data,'base64');}));}else throw Error('Unsupported original evidence encoding.');
 let value=JSON.parse(zlib.gunzipSync(bytes,{maxOutputLength:MAX}).toString('utf8'));if(T.digest(value)!==(row.baseHash||row.hash))throw Object.assign(Error('Original evidence failed its integrity check.'),{code:'ORIGINAL_INTEGRITY'});
 if(row.overrides){value={...value,...row.overrides};if(T.digest(value)!==row.hash)throw Object.assign(Error('Companion fields failed their integrity check.'),{code:'ORIGINAL_INTEGRITY'});}return value;
}
module.exports={encode,decode};
