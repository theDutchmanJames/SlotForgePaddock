'use strict';
(()=>{
 const worker=new Worker('media-thumbnail-worker.js');
 window.slotforge.onThumbnail(job=>worker.postMessage(job));
 worker.onmessage=({data})=>window.slotforge.thumbnailResult(data.id,data.result);
 // One lease covers the application dialogs, including nested viewer/editor
 // transitions. Release only when the final dialog closes.
 let active=false;const sync=()=>{const next=!!document.querySelector('dialog[open]');if(next!==active){active=next;window.slotforge.mediaLease(next);}};
 new MutationObserver(sync).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
})();
