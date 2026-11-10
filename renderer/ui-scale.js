'use strict';
// Whole-window zoom, like Timing; stored only in this desktop user profile.
const UiScale=(()=>{
 const levels=[80,90,100,110,125,150,175,200],normalize=value=>levels.includes(Number(value))?Number(value):100;
 let current=100;
 function load(){try{return normalize(localStorage.getItem('paddock-ui-scale'));}catch{return 100;}}
 function apply(value,persist=true){const next=normalize(value);if(persist)localStorage.setItem('paddock-ui-scale',String(next));window.slotforge.setZoom(next/100);current=next;}
 return {levels,normalize,load,apply,get current(){return current;}};
})();
if(typeof module==='object')module.exports=UiScale;
if(typeof window!=='undefined'&&window.slotforge?.setZoom){
 UiScale.apply(UiScale.load(),false);
 const update=value=>{try{UiScale.apply(value);const select=document.getElementById('ui-scale');if(select)select.value=String(UiScale.current);}catch(e){toast('Could not save interface size: '+e.message,true);}};
 document.addEventListener('change',e=>{if(e.target.id==='ui-scale')update(e.target.value);});
 document.addEventListener('click',e=>{if(e.target.closest('#ui-scale-reset'))update(100);});
}
