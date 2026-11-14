'use strict';
self.onmessage=async({data})=>{let bitmap,canvas;try{
 const comma=data.source.indexOf(','),mime=data.source.slice(5,comma).split(';')[0],raw=atob(data.source.slice(comma+1)),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 bitmap=await createImageBitmap(new Blob([bytes],{type:mime}));const scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height));
 canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();bitmap=null;
 const blob=await canvas.convertToBlob({type:'image/png'});if(blob.size>2*1024*1024)throw Error('Preview too large');
 const out=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<out.length;i+=32768)binary+=String.fromCharCode(...out.subarray(i,i+32768));
 self.postMessage({id:data.id,result:'data:image/png;base64,'+btoa(binary)});
 }catch{self.postMessage({id:data.id,result:null});}finally{bitmap?.close();if(canvas)canvas.width=canvas.height=1;}};
