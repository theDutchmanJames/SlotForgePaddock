'use strict';
// Reject ambiguous commands before canonical hashing. Used only by the opted-in
// shared-history contract; legacy JSON routes retain their existing behavior.
function parse(bytes){
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);let i=0;
 const ws=()=>{while(/[\x20\t\n\r]/.test(text[i]||'x'))i++;};
 function string(){const start=i++;while(i<text.length){const c=text[i++];if(c==='\\'){i++;continue;}if(c==='"')break;}const s=JSON.parse(text.slice(start,i));for(let p=0;p<s.length;p++){const c=s.charCodeAt(p);if(c>=0xd800&&c<=0xdbff){const next=s.charCodeAt(++p);if(!(next>=0xdc00&&next<=0xdfff))throw Error('Unpaired Unicode surrogate.');}else if(c>=0xdc00&&c<=0xdfff)throw Error('Unpaired Unicode surrogate.');}return s;}
 function walk(depth){if(depth>64)throw Error('JSON nesting exceeds 64 levels.');ws();const c=text[i];
  if(c==='"'){string();return;}
  if(c==='{'||c==='['){i++;ws();const end=c==='{'?'}':']',keys=new Set();if(text[i]===end){i++;return;}for(;;){ws();if(c==='{'){const k=string();if(keys.has(k))throw Error('Duplicate JSON object key.');keys.add(k);ws();i++;}walk(depth+1);ws();if(text[i++]===end)return;}}
  const start=i;while(i<text.length&&!/[\x20\t\n\r,}\]]/.test(text[i]))i++;const token=text.slice(start,i);if(token!=='null'&&token!=='true'&&token!=='false'&&!Number.isFinite(Number(token)))throw Error('Nonfinite JSON number.');
 }
 walk(0);return value;
}
module.exports={parse};
