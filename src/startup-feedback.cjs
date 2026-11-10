'use strict';
const path=require('node:path');
function create({BrowserWindow,quit,visible=true}){
 const win=new BrowserWindow({width:500,height:340,useContentSize:true,resizable:false,maximizable:false,minimizable:false,show:false,autoHideMenuBar:true,title:'Opening SlotForge Paddock',icon:path.join(__dirname,'..','assets','icon.png'),backgroundColor:'#171b21',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 let disposed=false,ready=false,elapsed=false;
 const show=()=>{if(visible&&ready&&elapsed&&!disposed&&!win.isDestroyed())win.show();};
 const timer=setTimeout(()=>{elapsed=true;show();},250);
 win.once('ready-to-show',()=>{ready=true;show();});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
 win.on('close',event=>{if(!disposed){event.preventDefault();win.setTitle('Finishing collection preparation…');quit();}});
 win.loadFile(path.join(__dirname,'..','renderer','opening.html')).catch(()=>{});
 return {focus(){if(visible&&ready&&!disposed&&!win.isDestroyed()){win.show();win.focus();}},dispose(){disposed=true;clearTimeout(timer);if(!win.isDestroyed())win.destroy();}};
}
module.exports={create};
