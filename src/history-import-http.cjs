'use strict';
const T=require('./timing-integration.cjs'),fail=(code,message,status=400)=>{throw T.fault(code,message,status);};
async function handle(network,req,url,guard){
 const match=url.pathname.match(/^\/v1\/shared-history\/imports(?:\/([a-zA-Z0-9_-]{1,100})\/([a-zA-Z0-9_-]{1,100})(\/cancel)?)?$/);
 if(!match)fail('NOT_FOUND','Unknown historical import route.',404);
 const [,installationId,operationId,cancel]=match;
 const action=req.method==='POST'&&!installationId?'receive':req.method==='GET'&&installationId&&!cancel?'lookup':req.method==='POST'&&cancel?'cancel':null;
 if(!action)fail('METHOD_NOT_ALLOWED','Unsupported historical import method.',405);
 const task={kind:'history-import',action,installationId,operationId};
 if(action==='lookup'){
  if([...url.searchParams.keys()].join()!=='recoveryId'||!/^[a-zA-Z0-9_-]{1,100}$/.test(url.searchParams.get('recoveryId')||''))fail('INVALID_QUERY','Supply exactly one recoveryId.');
  task.input={databaseId:req.headers['x-slotforge-database'],recoveryId:url.searchParams.get('recoveryId')};
 }else{
  if(url.search)fail('INVALID_QUERY','Historical mutations accept no query parameters.');
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||'')||req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')fail('INVALID_PAYLOAD','Send uncompressed UTF-8 application/json.',415);
  const max=action==='receive'?T.MAX_BYTES:8192;if(Number(req.headers['content-length'])>max)fail('PAYLOAD_TOO_LARGE','Historical import request exceeds its transport limit.',413);
  const chunks=[];let size=0;for await(const b of req.iterator({destroyOnReturn:false})){size+=b.length;if(size>max)fail('PAYLOAD_TOO_LARGE','Historical import request exceeds its transport limit.',413);chunks.push(b);}task.bytes=Buffer.concat(chunks);
 }
 const revision=network.store.data.revision;const value=await require('./domain-tasks.cjs').run(network.store,task,guard);
 if(action!=='lookup'&&network.store.data.revision!==revision)try{network.onChange({kind:'history-import'});}catch{}
 return value;
}
module.exports={handle};
