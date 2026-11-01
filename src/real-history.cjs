// Optional research about the full-size car represented by a model.
// This is separate from the slotcar's maintenance and race history.
const classifications=['Unverified','Real Racing Car','Fantasy Livery','Tribute Livery','Road / Show Car'];
const fields=['team','drivers','event','year','raceNumber','qualifying','finish','history'];
function check(ok,message){if(!ok)throw Error(message);}
function text(value,max){check(typeof value==='string'&&value.length<=max,'Invalid real-car history text.');return value;}
function url(value){text(value,2000);if(!value)return '';let parsed;try{parsed=new URL(value);}catch{throw Error('Enter a complete http:// or https:// source link.');}check(['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password,'Use an HTTP or HTTPS source link without login details.');return value;}
function clean(input,photo,ident){
  check(input&&typeof input==='object'&&!Array.isArray(input),'Invalid real-car history.');
  const classification=input.classification??'Unverified';check(classifications.includes(classification),'Choose a supported livery classification.');
  const out={classification};for(const field of fields)out[field]=text(input[field]??'',field==='history'?20000:500);
  out.evidence=require('../renderer/history-research-model.js').evidence(input.evidence??[]);
  const sources=input.sources??[],photos=input.photos??[];
  check(Array.isArray(sources)&&sources.length<=20,'Maximum 20 history sources.');
  out.sources=sources.map(s=>{check(s&&typeof s==='object','Invalid history source.');const link=url(s.url);check(link,'A source needs a link.');return {title:text(s.title??'',200),url:link};});
  check(Array.isArray(photos)&&photos.length<=8,'Maximum eight real-car photographs.');const ids=new Set();
  if(Object.hasOwn(input,'photos'))out.photos=photos.map(p=>{check(p&&typeof p==='object','Invalid history photograph.');const id=ident(p.id);check(!ids.has(id),'Duplicate history photograph.');ids.add(id);check(p.data,'A reference photograph needs image data.');return {id,name:text(p.name,200),data:photo(p.data),caption:text(p.caption??'',1000),sourceUrl:url(p.sourceUrl??'')};});
  return out;
}
module.exports={classifications,fields,url,clean};
