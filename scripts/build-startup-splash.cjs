'use strict';
// Render the same branding as the live startup window into NSIS's 24-bit BMP.
// Regenerate after changing opening.html/CSS: npm run build:splash
const fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow}=require('electron');
const root=path.resolve(__dirname,'..');
const profile=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'paddock-splash-build-'));
app.setPath('userData',profile);app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor','1');
async function build(){
 await app.whenReady();
 const win=new BrowserWindow({width:500,height:340,useContentSize:true,frame:false,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await win.loadFile(path.join(root,'renderer','opening.html'));
 await win.webContents.executeJavaScript(`(async()=>{document.querySelector('p').textContent='Preparing the application. Your collection will open shortly.';await Promise.all([...document.images].map(i=>i.decode()));await document.fonts.ready;})()`);
 await win.webContents.insertCSS('.progress:after{animation:none;transform:translateX(75%)}');
 const image=await win.webContents.capturePage(),{width,height}=image.getSize(),pixels=image.toBitmap();
 const stride=(width*3+3)&~3,buffer=Buffer.alloc(54+stride*height);
 buffer.write('BM');buffer.writeUInt32LE(buffer.length,2);buffer.writeUInt32LE(54,10);buffer.writeUInt32LE(40,14);
 buffer.writeInt32LE(width,18);buffer.writeInt32LE(height,22);buffer.writeUInt16LE(1,26);buffer.writeUInt16LE(24,28);buffer.writeUInt32LE(stride*height,34);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const src=(y*width+x)*4,dest=54+(height-1-y)*stride+x*3;pixels.copy(buffer,dest,src,src+3);}
 fs.writeFileSync(path.join(root,'assets','startup-splash.bmp'),buffer);
 fs.mkdirSync(path.join(root,'.qa'),{recursive:true});fs.writeFileSync(path.join(root,'.qa','startup-splash.png'),image.toPNG());
 console.log(`Built ${width}×${height} portable splash.`);win.destroy();
}
build().then(()=>app.exit(0),e=>{console.error(e);app.exit(1);});
