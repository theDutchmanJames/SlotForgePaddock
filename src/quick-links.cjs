'use strict';
// Personal shortcuts belong to the desktop profile, never the collection or Review.
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const DEFAULTS=[
  ['slot-it','Slot.it','https://catalog.slot.it/en/','brands'],
  ['nsr','NSR','https://nsrslot.com/en/ricambi-2/','brands'],
  ['scaleauto','ScaleAuto','https://scaleauto-slot.com/1-32-spare-parts/','brands'],
  ['revoslot','Revoslot','https://revoslotcars.com/','brands'],
  ['avantslot','AvantSlot','https://avantslot.com/catalogo/35-repuestos','brands'],
  ['thunderslot','ThunderSlot','https://www.thunderslot.com/en/home-en/','brands'],
  ['carrera','Carrera','https://carrera-toys.com/en-eu/collections/landing-page-evolution-ar-pimcore-import','brands'],
  ['scalextric','Scalextric','https://uk.scalextric.com/','brands'],
  ['ninco','Ninco','https://www.ninco.com/en/2047-slot','brands'],
  ['fly','Fly Car Model · Slotcar-Union','https://www.slotcar-union.com/en/628-fly-car-model','brands'],
  ['pioneer','Pioneer','https://www.pioneerslotcars.com/','brands'],
  ['brm','BRM','https://www.brmmodelcars.com/','brands'],
  ['policar','Policar','https://policar.it/','brands'],
  ['sloting-plus','Sloting Plus','https://www.sloting.com/en','brands'],
  ['slotinvasion','SlotInvasion','https://www.slotinvasion.de/','brands'],
  ['sideways','Sideways / Racer · Slotcar Boutique','https://www.slotcar-boutique.com/fr/18-sideways-racer-','brands'],
  ['slotcar-union','Slotcar-Union','https://www.slotcar-union.com/en/314-spare-parts','shops'],
  ['pendle','Pendle Slot Racing','https://www.pendleslotracing.co.uk/spares.html','shops'],
  ['criccrac','Cric Crac','https://www.criccrac.com/','shops'],
  ['evotec','EvotecShop','https://evotecshop.com/nl/','shops'],
  ['slotfun','Slotfun.de','https://www.slotfun.de/','shops'],
  ['electric-dreams','Electric Dreams','https://www.electricdreams.com/Shop/slot-car-parts-c-3/','shops'],
  ['slot-car-corner','Slot Car Corner','https://slotcarcorner.com/','shops'],
  ['ortmann','Ortmann','http://reifenotto.de/','shops'],
  ['professor-motor','Professor Motor','https://www.professormotor.com/Product-Categories-s/1808.htm','shops']
].map(([id,name,url,group])=>Object.freeze({id:'default-'+id,name,url,group,hidden:false}));
Object.freeze(DEFAULTS);
function webURL(value){
  if(typeof value!=='string'||value.length>2048||/[\u0000-\u0020\u007f]/.test(value)||!/^https?:\/\//i.test(value))throw Error('Enter a complete http:// or https:// website address without spaces.');
  let url;try{url=new URL(value);}catch{throw Error('Enter a valid website address.');}
  if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password)throw Error('Use a website address without a username or password.');
  return url.href;
}
function validateLinks(links){
  if(!Array.isArray(links)||links.length>225)throw Error('Quick Links supports up to 200 personal links.');
  const ids=new Set(),defaults=new Set(DEFAULTS.map(x=>x.id));
  const result=links.map(link=>{
    if(!link||typeof link!=='object'||typeof link.id!=='string'||(!defaults.has(link.id)&&!/^personal-[a-f0-9-]{36}$/.test(link.id))||ids.has(link.id))throw Error('Invalid or duplicate Quick Link identifier.');
    ids.add(link.id);
    if(typeof link.name!=='string'||!link.name.trim()||link.name.trim().length>100||/[\u0000-\u001f\u007f]/.test(link.name))throw Error('Give each link a name of 1–100 characters.');
    if(!['brands','shops','personal'].includes(link.group)||typeof link.hidden!=='boolean')throw Error('Invalid Quick Link group or visibility.');
    return {id:link.id,name:link.name.trim(),url:webURL(link.url),group:link.group,hidden:link.hidden};
  });
  if(result.filter(x=>!defaults.has(x.id)).length>200)throw Error('Quick Links supports up to 200 personal links.');
  // Missing bundled entries reappear; hiding is explicit and can be undone.
  return [...result,...DEFAULTS.filter(x=>!ids.has(x.id)).map(x=>({...x}))];
}
class QuickLinks{
  constructor(folder,{openExternal}={}){this.file=path.join(folder,'quick-links.json');this.openExternal=openExternal;}
  read(){
    let raw;try{if(fs.statSync(this.file).size>1024*1024)throw Error('Quick Links preferences are too large.');raw=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch(e){if(e.code==='ENOENT')return {revision:'initial',links:DEFAULTS.map(x=>({...x})),defaults:DEFAULTS};throw Error('Cannot read Quick Links preferences. The saved file has been kept. '+e.message);}
    if(raw.version!==1||typeof raw.revision!=='string')throw Error('Unsupported Quick Links preferences; the saved file has been kept.');
    return {revision:raw.revision,links:validateLinks(raw.links),defaults:DEFAULTS};
  }
  save(payload){
    const current=this.read();
    if(payload?.revision!==current.revision)throw Error('Quick Links changed in another window. Reopen Manage links before saving.');
    const links=validateLinks(payload.links),revision=randomUUID(),tmp=this.file+'.tmp';
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    let fd;try{fd=fs.openSync(tmp,'w',0o600);fs.writeFileSync(fd,JSON.stringify({version:1,revision,links},null,2));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,this.file);}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch(e){if(e.code!=='ENOENT')throw e;}}
    return this.read();
  }
  async open(id){
    const link=this.read().links.find(x=>x.id===id&&!x.hidden);
    if(!link)throw Error('This Quick Link is no longer available. Reopen the menu.');
    await this.openExternal(webURL(link.url));return {opened:true};
  }
}
module.exports={QuickLinks,DEFAULTS,webURL,validateLinks};
