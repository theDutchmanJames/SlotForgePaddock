'use strict';
const {isDeepStrictEqual}=require('node:util'),crypto=require('node:crypto');
const {validatePackage}=require('./store.cjs'),{boundedStringify}=require('./json-encoding.cjs');
const MAX=32*1024*1024,FILE_MAX=MAX+4096;
const check=(ok,message)=>{if(!ok)throw Error(message);};
function validate(input){
 check(input&&typeof input==='object'&&!Array.isArray(input),'Choose a submission recovery file.');
 check(Object.keys(input).sort().join(',')==='bundle,format,hostId,name,version'&&input.format==='slotforge-submission-recovery'&&input.version===1,'Unsupported submission recovery format.');
 check(typeof input.hostId==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(input.hostId),'Invalid original host identity.');
 check(typeof input.name==='string'&&input.name.length<=200,'Invalid original host name.');
 boundedStringify(input.bundle,MAX,'The original package exceeds 32 MiB.');
 const clean=validatePackage(input.bundle);
 check(isDeepStrictEqual(clean,input.bundle),'Recovery contains unsupported package fields. Nothing was restored.');
 return {hostId:input.hostId,name:input.name,bundle:clean};
}
function envelope(pending){return {format:'slotforge-submission-recovery',version:1,hostId:pending.hostId,name:pending.name,bundle:pending.bundle};}
function encode(pending){const input=envelope(pending);validate(input);return boundedStringify(input,FILE_MAX,'Recovery file exceeds its size limit.');}
function fingerprint(pending){return pending?crypto.createHash('sha256').update(encode(pending)).digest('hex'):null;}
function saved(network){return !!network.pending&&network.recoveryPending===network.pending;}
function assertPreserved(network){check(!network.sending,'Wait for the current submission to finish.');check(!network.pending||(saved(network)&&network.recoveryProof===fingerprint(network.pending)),'Save the pending submission recovery file, retry it, or explicitly discard its retry copy before continuing.');}
function restore(network,input){
 check(!network.sending,'Wait for the current submission to finish.');const pending=validate(input);
 check(!network.pending||fingerprint(network.pending)===fingerprint(pending),'Another submission is pending. Resolve or discard it before opening this recovery file.');
 check(!network.remote||network.remote.id===pending.hostId,'This file belongs to another host. Disconnect the current public connection before opening it.');
 network.pending=pending;network.recoveryProof=fingerprint(pending);network.recoveryPending=pending;network.notify();return network.status();
}
module.exports={MAX,FILE_MAX,validate,encode,fingerprint,saved,assertPreserved,restore};
