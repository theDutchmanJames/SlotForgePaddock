'use strict';
const CarSort=(()=>{
 const fields={name:'Name',maker:'Manufacturer',marque:'Car brand',model:'Model',scale:'Scale',reference:'Product reference',created:'Recently added',updated:'Recently changed'};
 const valid=key=>Object.hasOwn(fields,key),direction=(key,value)=>['asc','desc'].includes(value)?value:['created','updated'].includes(key)?'desc':'asc';
 function compare(a,b,key,order){const x=String(a[key]||'').toLowerCase(),y=String(b[key]||'').toLowerCase();return (!x)-(!y)||((x<y?-1:x>y?1:0)*(direction(key,order)==='desc'?-1:1))||(String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0);}
 function load(){try{const p=JSON.parse(localStorage.getItem('paddock-car-sort'));if(p&&valid(p.sort))return {sort:p.sort,sortDirection:direction(p.sort,p.sortDirection)};}catch{}return {sort:'name',sortDirection:'asc'};}
 function save(sort,sortDirection){try{localStorage.setItem('paddock-car-sort',JSON.stringify({sort,sortDirection}));}catch{}}
 return {fields,valid,direction,compare,load,save};
})();
if(typeof module==='object')module.exports=CarSort;
