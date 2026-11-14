'use strict';
const {randomUUID}=require('node:crypto');
const P=require('./purchasing.cjs'),W=require('./workshop.cjs');
const check=(ok,message)=>{if(!ok)throw Error(message);};
const whole=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000000;
const iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const identity=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)&&!Object.hasOwn(Object.prototype,v)&&v!=='prototype';
const quantity=v=>{check(typeof v==='number'||typeof v==='string'&&/^\d+$/.test(v),'Enter a whole quantity.');const n=Number(v);check(whole(n)&&n>0,'Enter a positive whole quantity.');return n;};
function validPrice(p){check(p&&Number.isSafeInteger(p.minor)&&p.minor>=0&&p.minor<=1000000000&&typeof p.currency==='string'&&/^[A-Z]{3}$/.test(p.currency),'Enter a valid unit price and three-letter currency.');}
function price(value,currency){
 check(typeof value==='string'&&typeof currency==='string','Enter a price and currency.');
 if(!value.trim()){check(!currency.trim(),'Enter a unit price or clear both price and currency.');return null;}
 check(/^\d{1,8}(\.\d{1,2})?$/.test(value.trim()),'Use a non-negative unit price with up to two decimal places.');
 const [units,cents='']=value.trim().split('.'),p={minor:Number(units)*100+Number(cents.padEnd(2,'0')),currency:currency.trim().toUpperCase()};validPrice(p);return p;
}
const corrections=p=>p.receiptCorrections===undefined?[]:p.receiptCorrections;
const history=line=>!!(line.purchase?.receipts?.length||line.purchase?.legacyReceived||line.purchase?.orderLog?.length||line.purchase?.receiptCorrections?.length);
function validate(line,ids){
 const p=line.purchase;if(p.price!==undefined)validPrice(p.price);
 let corrected=0,restored=0;const byReceipt=new Map(p.receipts.map(r=>[r.id,r])),quantities=new Map(),orders=new Map();
 check(Array.isArray(corrections(p))&&corrections(p).length<=10000,'Too many receipt corrections.');
 for(const c of corrections(p)){
  const r=byReceipt.get(c?.receiptId);check(c&&identity(c.id)&&!ids.has(c.id)&&r&&whole(c.quantity)&&c.quantity>0&&whole(c.fromOrdered)&&c.fromOrdered<=c.quantity&&whole(c.restoredOrdered)&&c.restoredOrdered<=c.fromOrdered&&iso(c.date)&&typeof c.reason==='string'&&c.reason.trim()&&c.reason.length<=2000,'Invalid receipt correction.');ids.add(c.id);
  quantities.set(r.id,(quantities.get(r.id)||0)+c.quantity);orders.set(r.id,(orders.get(r.id)||0)+c.fromOrdered);
  check(quantities.get(r.id)<=r.quantity&&orders.get(r.id)<=r.fromOrdered,'Receipt correction exceeds original receipt.');corrected+=c.quantity;restored+=c.restoredOrdered;
 }
 for(const r of p.receipts){if(r.price!==undefined)validPrice(r.price);if(r.supplier!==undefined)check(typeof r.supplier==='string'&&r.supplier.length<=200,'Invalid receipt supplier.');}
 if(p.orderLog!==undefined||p.orderBaseline!==undefined){
  check(whole(p.orderBaseline)&&Array.isArray(p.orderLog)&&p.orderLog.length<=10000,'Invalid order history.');let ordered=p.orderBaseline;
  for(const e of p.orderLog){check(e&&identity(e.id)&&!ids.has(e.id)&&['ordered','cancelled'].includes(e.type)&&whole(e.quantity)&&e.quantity>0&&iso(e.date)&&typeof e.supplier==='string'&&e.supplier.length<=200,'Invalid order event.');ids.add(e.id);if(e.price!==undefined)validPrice(e.price);ordered+=e.type==='ordered'?e.quantity:-e.quantity;}
  ordered-=p.receipts.reduce((n,r)=>n+r.fromOrdered,0);ordered+=restored;check(ordered===p.ordered,'Order history does not match outstanding orders.');
 }
 return corrected;
}
function initialiseLog(p){if(p.orderLog===undefined){p.orderBaseline=p.ordered+p.receipts.reduce((n,r)=>n+r.fromOrdered,0)-corrections(p).reduce((n,c)=>n+c.restoredOrdered,0);p.orderLog=[];}}
function event(line,type,n,stamp){const p=line.purchase;initialiseLog(p);check(p.orderLog.length<10000,'Too many order events.');p.orderLog.push({id:randomUUID(),type,quantity:n,date:stamp,supplier:line.supplier,...(p.price?{price:{...p.price}}:{})});}
function entries(db,input){
 check(Array.isArray(input)&&input.length>0&&input.length<=200,'Select between 1 and 200 purchase lines.');const seen=new Set();
 return input.map(x=>{check(x&&typeof x.id==='string'&&!seen.has(x.id),'Duplicate or invalid purchase selection.');seen.add(x.id);const line=db.planning.shopping.find(l=>l.id===x.id);check(line,'A selected purchase no longer exists.');return {line,quantity:quantity(x.quantity)};});
}
function mutate(db,action,input,stamp){
 P.upgrade(db);check(input.confirmed===true,'Check the quantities and confirm this purchasing action.');
 if(action==='planning.receipt.correct')return correct(db,input,stamp);
 const rows=entries(db,input.entries);
 if(action==='planning.order.place'||action==='planning.order.cancel'){
  const cancel=action.endsWith('cancel');
  for(const {line,quantity:n}of rows){const limit=cancel?line.purchase.ordered:P.counts(line).toBuy;check(n<=limit,cancel?'Cancellation exceeds the outstanding order.':'Order quantity exceeds the quantity to buy.');event(line,cancel?'cancelled':'ordered',n,stamp);line.purchase.ordered+=cancel?-n:n;line.updated=stamp;
   if(cancel&&line.purchase.requirement&&line.purchase.requirement.state!=='active')P.requirement(line,0,stamp);
  }
  require('./shopping-requirements.cjs').refresh(db,stamp);return rows.map(r=>r.line.id);
 }
 check(action==='planning.delivery.receive','Unknown purchasing action.');
 // Receive the complete user allocation before recalculating any plan's shortage.
 for(const {line,quantity:n}of rows){
  check(line.purchase.item.kind!=='free','Choose a stock record for each free-text item before receiving.');
  check(n<=line.quantity-line.received,'Delivery exceeds a selected purchase quantity.');
  const item=line.purchase.item;
  if(item.kind==='part'){
   const part=db.parts.find(p=>p.id===item.id);check(part&&!W.assemblyForPart(db,part.id),'Choose loose stock rather than an assembly component.');check(part.tracking!=='individual'||part.quantity+n<=1,'An individual identity can contain only one item.');part.quantity+=n;part.updated=stamp;
  }else{
   const supply=db.supplies.find(s=>s.id===item.id);check(supply,'Workshop supply no longer exists.');supplyStock(supply,n,stamp);
  }
  P.receipt(line,n,stamp);
 }
 require('./shopping-requirements.cjs').refresh(db,stamp);return rows.map(r=>r.line.id);
}
function supplyStock(supply,amount,stamp){const before=Object.fromEntries(['kind','quantity','remaining','minimum','unit'].map(k=>[k,supply[k]]));supply.quantity+=amount;supply.updated=stamp;supply.history.push({date:stamp,before,after:{...before,quantity:supply.quantity}});}
function correct(db,input,stamp){
 const line=db.planning.shopping.find(l=>l.id===input.id),p=line?.purchase,r=p?.receipts.find(r=>r.id===input.receiptId),n=quantity(input.quantity);
 check(r,'Choose a recorded receipt. Legacy received totals have no individual receipt to correct.');
 check(typeof input.reason==='string'&&input.reason.trim()&&input.reason.length<=2000,'Explain the receipt correction (maximum 2,000 characters).');
 check(typeof input.restoreOrdered==='boolean','Choose whether the ordered portion should return to outstanding orders.');
 const prior=corrections(p).filter(c=>c.receiptId===r.id);check(n<=r.quantity-prior.reduce((n,c)=>n+c.quantity,0),'Correction exceeds the remaining received quantity.');check(corrections(p).length<10000,'Too many receipt corrections.');
 if(p.item.kind==='part'){const part=db.parts.find(part=>part.id===p.item.id);check(part&&W.available(db,part)>=n,'Not enough loose stock to reverse this receipt. Fitted or reserved parts cannot be removed by a receipt correction.');part.quantity-=n;part.updated=stamp;}
 else{const supply=db.supplies.find(s=>s.id===p.item.id);check(supply&&supply.quantity>=n,'Not enough owned supply items to reverse this receipt.');supplyStock(supply,-n,stamp);}
 const fromOrdered=Math.min(n,r.fromOrdered-prior.reduce((n,c)=>n+c.fromOrdered,0)),restoredOrdered=input.restoreOrdered?fromOrdered:0;
 initialiseLog(p);p.receiptCorrections??=[];p.receiptCorrections.push({id:randomUUID(),receiptId:r.id,quantity:n,fromOrdered,restoredOrdered,reason:input.reason.trim(),date:stamp});line.received-=n;p.ordered+=restoredOrdered;line.updated=stamp;
 if(p.requirement&&p.requirement.state!=='active')P.requirement(line,0,stamp);
 require('./shopping-requirements.cjs').refresh(db,stamp);return line.id;
}
function totals(lines){const currencies=new Map();let unknown=0;for(const line of lines){const p=line.purchase,counts=P.counts(line);if(!p?.price){unknown++;continue;}let sum=currencies.get(p.price.currency);if(!sum){sum={toBuy:0n,ordered:0n,received:0n};currencies.set(p.price.currency,sum);}for(const key of Object.keys(sum))sum[key]+=BigInt(counts[key])*BigInt(p.price.minor);}return {unknown,currencies:[...currencies].sort(([a],[b])=>a.localeCompare(b)).map(([currency,sums])=>({currency,...Object.fromEntries(Object.entries(sums).map(([k,v])=>[k,String(v)]))}))};}
module.exports={price,validPrice,history,validate,mutate,totals};
