const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('slotforge',{
  read:known=>ipcRenderer.invoke('sf:read',known),
  mutate:(action,payload,known)=>ipcRenderer.invoke('sf:mutate',action,payload,known),
  club:(action,payload)=>ipcRenderer.invoke('sf:club',action,payload),
  plan:(action,payload)=>ipcRenderer.invoke('sf:plan',action,payload),
  file:(action,payload)=>ipcRenderer.invoke('sf:file',action,payload),
  network:(action,payload)=>ipcRenderer.invoke('sf:network',action,payload),
  onOpenCar:callback=>{const handler=(_event,value)=>callback(value);ipcRenderer.on('sf:open-car',handler);return()=>ipcRenderer.removeListener('sf:open-car',handler);},
  onNetwork:callback=>{const handler=(_event,value)=>callback(value);ipcRenderer.on('sf:network-state',handler);return()=>ipcRenderer.removeListener('sf:network-state',handler);},
  onChange:callback=>{const handler=(_event,change)=>callback(change);ipcRenderer.on('sf:changed',handler);return()=>ipcRenderer.removeListener('sf:changed',handler);}
});
