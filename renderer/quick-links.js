'use strict';
const QuickLinksUI=(()=>{
  const groups=[['brands','Brands'],['shops','Shops & suppliers'],['personal','Personal links']];
  let popover=null,anchor=null,request=0,manager=null;
  const call=async(action,payload)=>{
    const r=await window.slotforge.quickLinks(action,payload);
    if(r?.ok!==true)throw Error(r?.error||'Quick Links could not be opened.');
    return r.value;
  };
  function button(){
    if(!['Parts','Build from Scratch','Workshop','Shopping List'].includes(page)&&!(page==='Library'&&libraryTab==='parts'))return '';
    return '<button type="button" class="btn quick-links-trigger" data-quick-toggle aria-haspopup="dialog" aria-expanded="false">Quick Links <span aria-hidden="true">↗ ▾</span></button>';
  }
  function close(restore=false){
    ++request;const previous=anchor;popover?.remove();popover=null;anchor=null;
    previous?.setAttribute('aria-expanded','false');
    if(restore&&previous?.isConnected)previous.focus();
  }
  function position(){
    if(!popover||!anchor?.isConnected){close();return;}
    const rect=anchor.getBoundingClientRect(),gap=8,w=Math.min(380,innerWidth-24);
    popover.style.width=w+'px';popover.style.left=Math.max(12,Math.min(rect.right-w,innerWidth-w-12))+'px';
    const below=innerHeight-rect.bottom-12,above=rect.top-12,useBelow=below>=260||below>=above;
    popover.style.maxHeight=Math.max(100,(useBelow?below:above)-gap)+'px';
    popover.style.top=useBelow?(rect.bottom+gap)+'px':'auto';popover.style.bottom=useBelow?'auto':(innerHeight-rect.top+gap)+'px';
  }
  async function open(target){
    if(anchor===target){close(true);return;}
    close();anchor=target;const token=request;target.setAttribute('aria-expanded','true');
    try{
      const state=await call('read');if(token!==request||!target.isConnected)return;
      popover=document.createElement('section');popover.className='quick-links-menu';popover.setAttribute('popover','manual');popover.setAttribute('role','dialog');popover.setAttribute('aria-label','Quick Links');
      popover.innerHTML='<label class="field quick-links-search">Find a website<input type="search" data-quick-search placeholder="Brand, shop or website…" autocomplete="off"></label><div class="quick-links-results"></div><div class="quick-links-bottom"><small>Opens in your default browser</small><button type="button" class="btn" data-quick-manage>Manage links…</button></div>';
      document.body.append(popover);popover.showPopover();position();
      const list=popover.querySelector('.quick-links-results'),search=popover.querySelector('[data-quick-search]');
      const draw=()=>{
        const term=search.value.trim().toLocaleLowerCase(),links=state.links.filter(x=>!x.hidden&&`${x.name} ${x.url}`.toLocaleLowerCase().includes(term)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));
        list.innerHTML=links.length?groups.map(([group,title])=>{const items=links.filter(x=>x.group===group);return items.length?`<section><h3>${title}</h3>${items.map(x=>`<button type="button" class="quick-link" data-quick-open="${esc(x.id)}" title="${esc(x.url)}"><span>${esc(x.name)}<small>${esc(new URL(x.url).hostname)}</small></span><span aria-hidden="true">↗</span></button>`).join('')}</section>`:'';}).join(''):'<p class="muted">No matching links. Add your own in Manage links.</p>';
      };
      search.addEventListener('input',draw);draw();search.focus();
    }catch(e){if(token===request){close(true);toast(e.message,true);}}
  }
  const row=x=>`<details class="quick-links-row" data-quick-row="${esc(x.id)}"><summary><span data-quick-name>${esc(x.name||'New link')}</span><small>${x.id.startsWith('default-')?'Included':'Personal'}${x.hidden?' · Hidden':''}</small></summary><div class="form-grid"><label class="field">Name<input data-quick-field="name" maxlength="100" value="${esc(x.name)}"></label><label class="field">Group<select data-quick-field="group">${groups.map(([id,label])=>`<option value="${id}" ${x.group===id?'selected':''}>${label}</option>`).join('')}</select></label><label class="field wide">Website address<input data-quick-field="url" type="url" maxlength="2048" placeholder="https://…" value="${esc(x.url)}"></label><label class="check-row"><input data-quick-field="visible" type="checkbox" ${x.hidden?'':'checked'}>Show in menu</label>${x.id.startsWith('personal-')?'<button type="button" class="btn small" data-quick-remove>Remove personal link</button>':''}</div></details>`;
  function collect(){return [...manager.querySelectorAll('[data-quick-row]')].map(el=>({id:el.dataset.quickRow,name:el.querySelector('[data-quick-field="name"]').value.trim(),url:el.querySelector('[data-quick-field="url"]').value.trim(),group:el.querySelector('[data-quick-field="group"]').value,hidden:!el.querySelector('[data-quick-field="visible"]').checked}));}
  async function manage(){
    const previous=anchor;close();if(manager)return;
    // Claim the manager before the asynchronous read to prevent double opens.
    const dialog=document.createElement('dialog');manager=dialog;dialog.className='quick-links-manager';
    try{
      const state=await call('read');if(manager!==dialog)return;
      dialog.innerHTML='<form novalidate><div class="dialog-head"><h2>Manage Quick Links</h2><button type="button" class="btn ghost" data-quick-cancel aria-label="Close">✕</button></div><div class="dialog-body"><p>Personal shortcuts for this computer. Changes do not affect your collection or need Review.</p><div class="quick-links-manager-tools"><label class="field">Find a link<input type="search" data-quick-filter placeholder="Search names or addresses"></label><button type="button" class="btn" data-quick-add>Add personal link</button><button type="button" class="btn" data-quick-reset>Restore bundled defaults</button></div><p class="muted">Expand a link to edit it or hide it. Restoring defaults keeps your personal links.</p><div data-quick-rows></div><p class="form-error" data-quick-error role="alert" hidden></p></div><div class="dialog-footer"><button type="button" class="btn" data-quick-cancel>Cancel</button><button type="submit" class="btn primary">Save links</button></div></form>';
      const rows=dialog.querySelector('[data-quick-rows]'),filter=dialog.querySelector('[data-quick-filter]'),error=dialog.querySelector('[data-quick-error]');
      const draw=links=>{rows.innerHTML=links.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(row).join('');filter.value='';};draw(state.links);
      document.body.append(dialog);dialog.showModal();filter.focus();let saving=false;
      const finish=()=>{if(saving)return;dialog.close();dialog.remove();manager=null;if(previous?.isConnected)previous.focus();};
      dialog.addEventListener('cancel',e=>{e.preventDefault();finish();});
      filter.addEventListener('input',()=>{const term=filter.value.trim().toLocaleLowerCase();for(const el of rows.children)el.hidden=![...el.querySelectorAll('[data-quick-field="name"],[data-quick-field="url"]')].some(input=>input.value.toLocaleLowerCase().includes(term));});
      dialog.addEventListener('input',e=>{
        const el=e.target.closest('[data-quick-row]');if(!el)return;
        if(e.target.dataset.quickField==='name')el.querySelector('[data-quick-name]').textContent=e.target.value||'New link';
        if(e.target.dataset.quickField==='visible')el.querySelector('summary small').textContent=(el.dataset.quickRow.startsWith('default-')?'Included':'Personal')+(e.target.checked?'':' · Hidden');
      });
      dialog.addEventListener('click',e=>{
        if(saving)return;
        if(e.target.closest('[data-quick-cancel]'))finish();
        if(e.target.closest('[data-quick-remove]'))e.target.closest('[data-quick-row]').remove();
        if(e.target.closest('[data-quick-reset]'))draw([...state.defaults,...collect().filter(x=>x.id.startsWith('personal-'))]);
        if(e.target.closest('[data-quick-add]')){
          if(collect().filter(x=>x.id.startsWith('personal-')).length>=200){error.textContent='You can add up to 200 personal links.';error.hidden=false;return;}
          filter.value='';for(const el of rows.children)el.hidden=false;
          rows.insertAdjacentHTML('afterbegin',row({id:'personal-'+crypto.randomUUID(),name:'',url:'',group:'personal',hidden:false}));rows.firstElementChild.open=true;rows.firstElementChild.querySelector('input').focus();
        }
      });
      dialog.querySelector('form').addEventListener('submit',async e=>{
        e.preventDefault();if(saving)return;
        const links=collect(),invalid=links.find(x=>!x.name||!/^https?:\/\/\S+$/i.test(x.url));
        if(invalid){const el=[...rows.children].find(el=>el.dataset.quickRow===invalid.id);el.hidden=false;el.open=true;el.querySelector(`[data-quick-field="${invalid.name?'url':'name'}"]`).focus();error.textContent='Each link needs a name and a complete http:// or https:// website address.';error.hidden=false;return;}
        saving=true;const controls=[...dialog.querySelectorAll('button,input,select')];controls.forEach(el=>el.disabled=true);
        try{await call('save',{revision:state.revision,links});saving=false;finish();toast('Quick Links saved on this computer.');}
        catch(e){error.textContent=e.message;error.hidden=false;error.scrollIntoView({block:'nearest'});}
        finally{saving=false;controls.forEach(el=>el.disabled=false);}
      });
    }catch(e){dialog.remove();manager=null;toast(e.message,true);}
  }
  document.addEventListener('click',async e=>{
    const toggle=e.target.closest('[data-quick-toggle]');if(toggle){void open(toggle);return;}
    const link=e.target.closest('[data-quick-open]');if(link){const id=link.dataset.quickOpen;close(true);try{await call('open',{id});}catch(e){toast(e.message,true);}return;}
    if(e.target.closest('[data-quick-manage]'))void manage();
  });
  document.addEventListener('pointerdown',e=>{if(anchor&&!popover?.contains(e.target)&&!anchor.contains(e.target))close();});
  document.addEventListener('keydown',e=>{
    if(!popover)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);return;}
    if(!popover.contains(e.target)||!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
    if(e.target.matches('input')&&e.key!=='ArrowDown')return;
    const links=[...popover.querySelectorAll('[data-quick-open]')];if(!links.length)return;
    e.preventDefault();const index=links.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?links.length-1:e.key==='ArrowDown'?(index+1)%links.length:(index-1+links.length)%links.length;links[next].focus();
  });
  document.addEventListener('focusin',e=>{if(popover&&!popover.contains(e.target)&&!anchor?.contains(e.target))close();});
  window.addEventListener('resize',position);
  window.addEventListener('scroll',e=>{if(popover&&!popover.contains(e.target))close();},true);
  return {button,close};
})();
