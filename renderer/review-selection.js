'use strict';
// Explicitly marked review choices only: never consent boxes or stock decisions.
const ReviewSelection=(()=>{
 const toolbar=()=>'<div class="actions review-selection-bar"><button type="button" class="btn small" data-review-bulk="all">Select all changes</button><button type="button" class="btn small" data-review-bulk="none">Clear selection</button><span class="tiny muted" data-review-count role="status" aria-live="polite"></span></div>';
 const choices=scope=>[...scope.querySelectorAll('input[type="checkbox"][data-review-choice]')].filter(e=>!e.matches(':disabled')&&!e.required&&e.closest('[data-review-selection]')===scope);
 function update(scope){if(!scope)return;const list=choices(scope),count=scope.querySelector('[data-review-count]');if(count)count.textContent=`${list.filter(e=>e.checked).length} of ${list.length} selected`;}
 function select(scope,on){
  const list=choices(scope),groups=new Map();
  for(const el of list){const key=el.dataset.reviewAlternative;if(key)groups.set(key,(groups.get(key)||0)+1);}
  for(const el of list){
   // Multiple proposals for one field need a human choice; preserve that choice.
   if(on&&(el.hasAttribute('data-review-manual')||groups.get(el.dataset.reviewAlternative)>1))continue;
   el.checked=on;
  }
  update(scope);
 }
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-review-bulk]');if(!button||button.disabled)return;
  const scope=button.closest('[data-review-selection]');if(scope){event.preventDefault();select(scope,button.dataset.reviewBulk==='all');}
 });
 document.addEventListener('change',event=>{
  const el=event.target,scope=el.closest('[data-review-selection]');if(!scope)return;
  if(el.checked&&el.dataset.reviewAlternative)for(const other of choices(scope))if(other!==el&&other.dataset.reviewAlternative===el.dataset.reviewAlternative)other.checked=false;
  update(scope);
 });
 // Reviews render dynamically in both the page and dialogs. Observe additions,
 // not checkbox attributes or the whole collection, to initialise their counts.
 new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){if(node.nodeType!==1)continue;if(node.matches('[data-review-selection]'))update(node);for(const scope of node.querySelectorAll('[data-review-selection]'))update(scope);}}).observe(document.body,{childList:true,subtree:true});
 return {toolbar,update,select};
})();
