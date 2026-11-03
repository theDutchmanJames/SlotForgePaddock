'use strict';
const {isDeepStrictEqual}=require('node:util');
const {cloneJSON}=require('./json-data.cjs');
// Internal manifest deltas. A history insertion stores one splice, not the IDs
// of every existing event. Public protocols must negotiate their own schema.
function delta(before,after,path=[],out=[]){
 if(isDeepStrictEqual(before,after))return out;
 if(Array.isArray(before)&&Array.isArray(after)){
  if(before.length===after.length){for(let i=0;i<after.length;i++)delta(before[i],after[i],[...path,i],out);return out;}
  let start=0,end=0;while(start<before.length&&start<after.length&&isDeepStrictEqual(before[start],after[start]))start++;
  while(end<before.length-start&&end<after.length-start&&isDeepStrictEqual(before[before.length-1-end],after[after.length-1-end]))end++;
  out.push({path,splice:{start,remove:before.length-start-end,items:cloneJSON(after.slice(start,after.length-end))}});return out;
 }
 if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after)&&isDeepStrictEqual(Object.keys(before),Object.keys(after))){for(const key of Object.keys(after))delta(before[key],after[key],[...path,key],out);return out;}
 out.push({path,value:cloneJSON(after)});return out;
}
module.exports={delta};
