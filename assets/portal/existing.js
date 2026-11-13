'use strict';
// Additional photos share the Portal's authentication and durable operation IDs.
let chosenCar=null,extraPhotos=[],listOffset=null,listRevision=null,listGeneration=0,listBusy=false;
function element(tag,text,className){const e=document.createElement(tag);if(text)e.textContent=text;if(className)e.className=className;return e;}
function clearExtras(){for(const p of extraPhotos)URL.revokeObjectURL(p.url);extraPhotos=[];chosenCar=null;$('extra-previews').replaceChildren();$('extra-gallery').value='';$('extra-camera').value='';$('extra-progress').hidden=true;$('extra-progress-text').textContent='';}
function portalHome(){if(busy||successTimer!==null)return;if(pending&&!confirm('Check Paddock first: the previous upload may already have saved. Leave this upload?'))return;listGeneration++;pending=null;stored.set('pending',null);clearExtras();clearPhoto();message('');screen('welcome');}
$('add-home').onclick=$('picker-home').onclick=portalHome;
function identifyCar(c){const box=element('div',null,'car-identity');box.append(element('strong',c.name),element('small',[c.maker,c.model,c.reference].filter(Boolean).join(' · ')));return box;}
async function browseCars(reset=true){
 if(listBusy&&!reset)return;const generation=++listGeneration;listBusy=true;
 if(reset){listOffset=0;listRevision=null;$('car-list').replaceChildren();}const query=$('car-query').value.trim();$('car-list-status').textContent='Loading cars…';$('car-more').disabled=true;
 try{const page=await request('/api/car-list',{offset:listOffset||0,query,...(listRevision!==null?{revision:listRevision}:{})});if(generation!==listGeneration)return;
  listRevision=page.revision;listOffset=page.nextOffset;const images=[];
  for(const c of page.cars){const button=element('button',null,'car-option'),image=element('img');image.alt='';image.width=72;image.height=56;image.hidden=true;button.append(image,identifyCar(c));button.onclick=()=>selectExisting(c);$('car-list').append(button);if(c.hasPicture)images.push({c,image});}
  $('car-list-status').textContent=page.total?`${page.total} car${page.total===1?'':'s'} · choose one below`:'No matching cars.';$('car-more').hidden=listOffset===null;
  // One thumbnail at a time; originals and private fields never enter the list.
  for(const {c,image}of images){if(generation!==listGeneration)return;try{const result=await request('/api/thumbnail',{carId:c.id,revision:c.revision});if(generation!==listGeneration)return;if(result.thumbnail){image.src=result.thumbnail;image.hidden=false;}}catch{/* The car remains selectable without a preview. */}}
 }catch(error){if(generation===listGeneration){$('car-list-status').textContent='Could not load cars. Search again to refresh.';requireAccess(error);}}
 finally{if(generation===listGeneration){listBusy=false;$('car-more').disabled=false;}}
}
$('existing-car').onclick=()=>{clearExtras();message('');screen('car-picker');void browseCars();};
$('car-search').onsubmit=e=>{e.preventDefault();void browseCars();};$('car-more').onclick=()=>{void browseCars(false);};
function selectExisting(c){listGeneration++;listBusy=false;clearExtras();chosenCar=c;$('selected-car').replaceChildren(identifyCar(c));message('');screen('photo-editor');extraUpdate();}
function extraUpdate(){
 const locked=busy||successTimer!==null,limit=Math.min(5,chosenCar?.remaining??5),expected=pending?.kind==='photos'?pending.names.length:0;
 $('extra-send').disabled=locked||!chosenCar||!extraPhotos.length||extraPhotos.some(p=>!p.data)||extraPhotos.length>limit||!!expected&&extraPhotos.length!==expected;
 $('extra-send').textContent=pending?'Retry same upload':'Send to Paddock';$('extra-check').hidden=!pending;$('extra-check').disabled=locked;$('photos-back').disabled=locked;
 $('extra-gallery-button').disabled=$('extra-camera-button').disabled=locked||extraPhotos.length>=limit||!!pending&&extraPhotos.length>=expected;
 $('photo-count').textContent=limit?`${extraPhotos.length} / ${limit} photos selected · ${chosenCar?.remaining??40} gallery spaces available`:'This gallery is full (40 photos). Remove photos in Paddock first.';
 for(const b of $('extra-previews').querySelectorAll('button'))b.disabled=locked||!!pending&&!b.dataset.recoverResize;
}
function renderExtras(){
 $('extra-previews').replaceChildren();extraPhotos.forEach((p,index)=>{const card=element('div',null,'photo-preview'),img=element('img');img.src=p.data||p.url;img.alt=`Photo ${index+1}`;card.append(img,element('strong',p.name));
  const remove=element('button','Remove');remove.type='button';remove.onclick=()=>{URL.revokeObjectURL(p.url);extraPhotos.splice(index,1);renderExtras();};card.append(remove);
  if(!p.data){card.append(element('p','This original exceeds the size or image-dimension limit. Choose a smaller copy, or remove it.','muted'));const resize=element('button','Use a smaller copy');resize.type='button';resize.dataset.recoverResize='true';resize.onclick=async()=>{if(busy)return;busy=true;extraUpdate();try{const img=await openImage(p.url),factor=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*factor));canvas.height=Math.max(1,Math.round(img.naturalHeight*factor));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);p.data=canvas.toDataURL('image/jpeg',.88);p.resized=true;}catch(error){message(error.message,true);}finally{busy=false;renderExtras();}};card.append(resize);}else card.append(element('small',p.resized?'Smaller JPEG copy · original unchanged on your phone':'Original photo · unchanged'));
  $('extra-previews').append(card);
 });extraUpdate();
}
async function chooseExtras(files){
 if(busy||!chosenCar)return;const selected=Array.from(files),limit=Math.min(5,chosenCar.remaining??5,pending?.names.length??5);
 if(extraPhotos.length+selected.length>limit){message(`Choose at most ${limit-extraPhotos.length} more photo(s). None of this selection were added.`,true);return;}
 busy=true;extraUpdate();message('');const errors=[];
 for(const file of selected){let url='';try{if(file.size>25*1024*1024)throw Error('Exceeds 25 MiB; export a smaller copy first.');const head=new Uint8Array(await file.slice(0,12).arrayBuffer()),mime=head[0]===255&&head[1]===216&&head[2]===255?'image/jpeg':head[0]===137&&head[1]===80&&head[2]===78&&head[3]===71?'image/png':String.fromCharCode(...head.slice(0,4))==='RIFF'&&String.fromCharCode(...head.slice(8,12))==='WEBP'?'image/webp':null;if(!mime)throw Error('Use JPEG, PNG or WebP. Export HEIC as JPEG.');const blob=file.slice(0,file.size,mime);url=URL.createObjectURL(blob);const image=await openImage(url),large=file.size>MAX_BYTES||image.naturalWidth*image.naturalHeight>MAX_PIXELS||Math.max(image.naturalWidth,image.naturalHeight)>20000;
  const data=large?'':await dataURL(blob),name=pending?.names[extraPhotos.length]||(file.name||'Photograph').replace(/[\x00-\x1f\x7f]/g,'').slice(0,200)||'Photograph';extraPhotos.push({name,url,data,resized:false});
 }catch(error){if(url)URL.revokeObjectURL(url);errors.push(`${file.name}: ${error.message}`);}}
 busy=false;renderExtras();if(errors.length)message(errors.join(' '),true);
}
$('extra-gallery-button').onclick=()=>$('extra-gallery').click();$('extra-camera-button').onclick=()=>$('extra-camera').click();
for(const id of ['extra-gallery','extra-camera'])$(id).onchange=e=>{const files=Array.from(e.target.files);e.target.value='';void chooseExtras(files);};
$('photos-back').onclick=()=>{if(busy)return;if(pending&&!confirm('This upload may already have saved. Check Paddock before selecting another car. Continue?'))return;pending=null;stored.set('pending',null);clearExtras();message('');screen('car-picker');void browseCars();};
function photosSuccess(name,count){pending=null;stored.set('pending',null);busy=false;message(`✓ ${count} photo${count===1?'':'s'} added to ${name}. Returning to the main page…`);$('extra-progress').hidden=true;$('extra-progress-text').textContent='Saved in Paddock';window.scrollTo({top:0,behavior:'smooth'});successTimer=setTimeout(()=>{successTimer=null;clearExtras();message('');screen('welcome');$('existing-car').focus();},2400);extraUpdate();}
async function recoverPhotos(record){
 pending=record;chosenCar=record.car;$('selected-car').replaceChildren(identifyCar(chosenCar));screen('photo-editor');extraUpdate();
 if(record.databaseId!==session.databaseId||record.recoveryId!==session.recoveryId){message('The collection changed since this upload. Check Paddock before choosing another car.',true);return true;}
 const receipt=await request('/api/receipts/'+record.id);if(receipt.found){photosSuccess(record.car.name,receipt.count||record.names.length);return true;}
 message('This upload is not confirmed. Reselect the same photos in the same order if needed, then retry, or check whether it was saved.',true);return true;
}
$('extra-check').onclick=async()=>{if(busy||!pending)return;busy=true;extraUpdate();try{await recoverPhotos(pending);}catch(error){requireAccess(error);}finally{busy=false;extraUpdate();}};
$('extra-send').onclick=async()=>{
 if(busy||$('extra-send').disabled)return;if(pending&&(pending.databaseId!==session.databaseId||pending.recoveryId!==session.recoveryId)){message('The collection changed. Check Paddock before selecting another car.',true);return;}
 pending??={kind:'photos',id:uuid(),databaseId:session.databaseId,recoveryId:session.recoveryId,car:chosenCar,names:extraPhotos.map(p=>p.name)};if(!stored.set('pending',pending)){message('Your browser cannot retain upload recovery details. Enable browser storage before sending.',true);extraUpdate();return;}busy=true;extraUpdate();message('');$('extra-progress').hidden=false;$('extra-progress').value=0;
 try{const result=await upload({operationId:pending.id,carId:pending.car.id,revision:pending.car.revision,photos:extraPhotos.map(p=>({name:p.name,data:p.data}))},'/api/photos','extra-');photosSuccess(pending.car.name,result.count);}catch(error){busy=false;extraUpdate();requireAccess(error);$('extra-progress-text').textContent='Not confirmed — safe to retry the same upload';}
};
