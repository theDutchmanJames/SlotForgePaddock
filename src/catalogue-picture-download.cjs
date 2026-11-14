'use strict';
const http=require('node:http'),https=require('node:https'),dns=require('node:dns').promises,net=require('node:net');
const {limits,link}=require('./catalogue-pictures-contract.cjs');
const fault=(code,message)=>Object.assign(Error(message),{code});
// Reuse the existing public-address policy, additionally excluding deprecated
// 6to4 relay space. IPv4-mapped IPv6 and translation prefixes are not global-v6.
const relay=new net.BlockList();relay.addSubnet('192.88.99.0',24,'ipv4');
function publicAddress(address){return require('./history-web.cjs').publicAddress(address)&&!(net.isIP(address)===4&&relay.check(address,'ipv4'));}
function url(value){link(value);if(!value)throw fault('INVALID_URL','Enter a direct image URL.');return new URL(value);}
function stopped(){return fault('DOWNLOAD_CANCELLED','Download stopped. Retry when ready.');}
function wait(promise,ms,signal){return new Promise((resolve,reject)=>{let finished=false;const done=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);},abort=()=>done(stopped()),timer=setTimeout(()=>done(fault('DOWNLOAD_TIMEOUT','Image request timed out.')),Math.max(1,ms));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();promise.then(value=>done(null,value),error=>done(error));});}
async function download(value,{signal,lookup=dns.lookup,request,attemptMs=limits.attemptTimeoutMs,totalMs=limits.itemTimeoutMs}={}){
 let target=url(value);const deadline=Date.now()+Math.min(totalMs,limits.itemTimeoutMs);
 for(let redirects=0;redirects<=limits.redirects;redirects++){
  if(signal?.aborted)throw stopped();const attemptDeadline=Math.min(deadline,Date.now()+Math.min(attemptMs,limits.attemptTimeoutMs));
  if(Date.now()>=attemptDeadline)throw fault('DOWNLOAD_TIMEOUT','Image request timed out.');
  const host=target.hostname.replace(/^\[|\]$/g,''),addresses=await wait(Promise.resolve().then(()=>net.isIP(host)?[{address:host,family:net.isIP(host)}]:lookup(host,{all:true,verbatim:true})),attemptDeadline-Date.now(),signal);
  if(!Array.isArray(addresses)||!addresses.length||addresses.some(a=>!publicAddress(a.address)||a.family!==net.isIP(a.address)))throw fault('PRIVATE_ADDRESS','Only public image servers are allowed. Local, private and reserved addresses are blocked.');
  const address=addresses[0];if(Date.now()>=attemptDeadline)throw fault('DOWNLOAD_TIMEOUT','Image request timed out.');
  const result=await new Promise((resolve,reject)=>{
   let req,res,finished=false;const done=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){res?.destroy();req?.destroy();reject(error);}else resolve(value);},abort=()=>done(stopped()),timer=setTimeout(()=>done(fault('DOWNLOAD_TIMEOUT','Image request timed out.')),Math.max(1,attemptDeadline-Date.now()));
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
   try{req=(request||(target.protocol==='https:'?https.request:http.request))(target,{method:'GET',agent:false,maxHeaderSize:16384,rejectUnauthorized:true,headers:{'User-Agent':'SlotForge-Paddock (user-requested catalogue picture)','Accept':'image/png,image/jpeg,image/webp','Accept-Encoding':'identity'},lookup:(_host,options,callback)=>callback(null,...(options?.all?[[address]]:[address.address,address.family]))},response=>{
    res=response;res.on('error',()=>done(fault('DOWNLOAD_INTERRUPTED','The image transfer was interrupted.')));res.on('aborted',()=>done(fault('DOWNLOAD_INTERRUPTED','The image transfer was interrupted.')));
    if([301,302,303,307,308].includes(res.statusCode)){const redirect=res.headers.location;done(null,{redirect});res.destroy();return;}
    if(res.statusCode!==200)return done(fault('HTTP_ERROR','Image server returned HTTP '+res.statusCode+'.'));
    if(res.headers['content-encoding']&&res.headers['content-encoding'].toLowerCase()!=='identity')return done(fault('CONTENT_ENCODING','Compressed HTTP responses are not supported. Choose a direct image link.'));
    if(res.headers['content-length']&&(!/^\d+$/.test(res.headers['content-length'])||Number(res.headers['content-length'])>limits.sourcePhotoBytes))return done(fault('IMAGE_TOO_LARGE','The image exceeds the original-photo size limit.'));
    let size=0;const chunks=[];res.on('data',chunk=>{if(finished)return;size+=chunk.length;if(size>limits.sourcePhotoBytes)return done(fault('IMAGE_TOO_LARGE','The image exceeds the original-photo size limit.'));chunks.push(chunk);});
    res.on('end',()=>{if(!finished)done(null,{bytes:Buffer.concat(chunks)});});
   });req.on('error',()=>done(fault('DOWNLOAD_FAILED','The secure image connection failed. Check the link or retry.')));req.end();}catch{done(fault('DOWNLOAD_FAILED','The image connection failed. Check the link.'));}
  });
  if(Object.hasOwn(result,'redirect')){if(!result.redirect||redirects===limits.redirects)throw fault('REDIRECT_LIMIT','Too many or invalid image redirects.');let next;try{next=url(new URL(result.redirect,target).href);}catch{throw fault('INVALID_REDIRECT','The image server returned an unsupported redirect.');}if(target.protocol==='https:'&&next.protocol==='http:')throw fault('INSECURE_REDIRECT','An HTTPS image cannot redirect to HTTP.');target=next;continue;}
  // Actual bytes, not a MIME header or URL suffix, determine acceptance.
  const picture=require('./photo-import.cjs').originalPhoto(result.bytes);const dimensions=require('./assembly-photo.cjs').admission(picture);
  return {bytes:result.bytes,picture,...dimensions};
 }
}
module.exports={download,publicAddress,url};
