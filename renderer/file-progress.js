(() => {
  const box=document.querySelector('#file-progress'),label=document.querySelector('#file-progress-label'),bar=document.querySelector('#file-progress-bar'),cancel=document.querySelector('#file-progress-cancel');let job;
  window.slotforge.onFileProgress(value=>{job=value;box.hidden=!value;if(!value)return;label.textContent=value.phase;bar.max=Math.max(1,value.total||1);bar.value=value.done||0;cancel.hidden=!value.cancelable;cancel.disabled=false;cancel.textContent='Cancel';});
  cancel.addEventListener('click',async event=>{event.stopPropagation();if(!job?.cancelable)return;cancel.disabled=true;cancel.textContent='Cancelling…';await window.slotforge.cancelFile(job.id);});
})();
