const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('slotforge',{
  mediaLease:active=>ipcRenderer.send('sf:media-lease',active),
  thumbnailResult:(id,result)=>ipcRenderer.send('sf:thumbnail-result',id,result),
  onThumbnail:callback=>ipcRenderer.on('sf:thumbnail',(_event,job)=>callback(job)),
  read:known=>ipcRenderer.invoke('sf:read',known),
  query:(operation,payload)=>ipcRenderer.invoke('sf:query',operation,payload),
  mutate:(action,payload,known)=>ipcRenderer.invoke('sf:mutate',action,payload,known),
  club:(action,payload)=>ipcRenderer.invoke('sf:club',action,payload),
  plan:(action,payload)=>ipcRenderer.invoke('sf:plan',action,payload),
  cancelFile:id=>ipcRenderer.invoke('sf:file-cancel',id),
  onFileProgress:callback=>ipcRenderer.on('sf:file-progress',(_event,value)=>callback(value)),
  file:(action,payload,known)=>ipcRenderer.invoke('sf:file',action,payload,known),
  network:(action,payload)=>ipcRenderer.invoke('sf:network',action,payload),
  onOpenCar:callback=>{const handler=(_event,value)=>callback(value);ipcRenderer.on('sf:open-car',handler);return()=>ipcRenderer.removeListener('sf:open-car',handler);},
  onNetwork:callback=>{const handler=(_event,value)=>callback(value);ipcRenderer.on('sf:network-state',handler);return()=>ipcRenderer.removeListener('sf:network-state',handler);},
  onChange:callback=>{const handler=(_event,change)=>callback(change);ipcRenderer.on('sf:changed',handler);return()=>ipcRenderer.removeListener('sf:changed',handler);}
});
