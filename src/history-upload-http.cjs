'use strict';
const T=require('./timing-integration.cjs');
const fail=(code,message,status=400)=>{throw T.fault(code,message,status);};
async function handle(network,req,url,guard){
 const match=url.pathname.match(/^\/v1\/shared-history\/uploads(?:\/([\w-]{1,100})(?:\/(commit|chunks\/([0-9]+)))?)?$/);
 if(!match)fail('NOT_FOUND','Unknown upload route.',404);
 const [,uploadId,child,index]=match;let action;
 if(!uploadId&&req.method==='POST')action='start';else if(uploadId&&!child&&['GET','DELETE'].includes(req.method))action=req.method==='GET'?'status':'cancel';else if(child==='commit'&&req.method==='POST')action='commit';else if(index!==undefined&&req.method==='PUT')action='chunk';else fail('METHOD_NOT_ALLOWED','Unsupported upload method.',405);
 const task={kind:'history-upload',action,...(uploadId?{uploadId}:{}),...(index!==undefined?{index:Number(index)}:{})};
 if(['status','cancel'].includes(action)){
  if([...url.searchParams.keys()].join()!=='recoveryId'||! /^[\w-]{1,100}$/.test(url.searchParams.get('recoveryId')||''))fail('INVALID_QUERY','Supply exactly one recoveryId.');
  task.input={version:1,databaseId:req.headers['x-slotforge-database'],recoveryId:url.searchParams.get('recoveryId'),uploadId};
 }else{
  if(url.search)fail('INVALID_QUERY','Upload mutations accept no query parameters.');
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))fail('INVALID_PAYLOAD','Send UTF-8 application/json.',415);
  if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')fail('INVALID_PAYLOAD','Compressed uploads are unsupported.',415);
  const max=action==='chunk'?352*1024:4096;if(Number(req.headers['content-length'])>max)fail('PAYLOAD_TOO_LARGE','Upload request exceeds its transport limit.',413);
  const chunks=[];let size=0;for await(const b of req.iterator({destroyOnReturn:false})){size+=b.length;if(size>max)fail('PAYLOAD_TOO_LARGE','Upload request exceeds its transport limit.',413);chunks.push(b);}task.bytes=Buffer.concat(chunks);
 }
 let revision;
 const value=await require('./domain-tasks.cjs').run(network.store,task,()=>{guard();revision=network.store.data.revision;});
 // Polls/chunk retries must not announce new results. Historical receipts have
 // durable item decisions, not an operation's duplicate/accepted fields.
 if(action==='commit'&&value.receipt&&network.store.data.revision!==revision)try{network.onChange({kind:Array.isArray(value.receipt.items)?'history-import':'timing'});}catch{}
 return value;
}
module.exports={handle};
