const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('slotforge',{
  read:()=>ipcRenderer.invoke('sf:read'),
  mutate:(action,payload)=>ipcRenderer.invoke('sf:mutate',action,payload),
  plan:(action,payload)=>ipcRenderer.invoke('sf:plan',action,payload),
  file:(action,payload)=>ipcRenderer.invoke('sf:file',action,payload),
  network:(action,payload)=>ipcRenderer.invoke('sf:network',action,payload),
  onNetwork:callback=>{const handler=(_event,value)=>callback(value);ipcRenderer.on('sf:network-state',handler);return()=>ipcRenderer.removeListener('sf:network-state',handler);},
  onChange:callback=>{const handler=()=>callback();ipcRenderer.on('sf:changed',handler);return()=>ipcRenderer.removeListener('sf:changed',handler);}
});
