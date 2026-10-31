const dgram=require('node:dgram');
const crypto=require('node:crypto');
const os=require('node:os');
const GROUP='239.255.47.77',PORT=47778;
const interfaces=()=>[...new Set(Object.values(os.networkInterfaces()).flat().filter(i=>i.family==='IPv4').map(i=>i.address))];
function privateIP(ip){const a=ip.split('.').map(Number);return a.length===4&&a.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&(a[0]===10||a[0]===127||a[0]===192&&a[1]===168||a[0]===172&&a[1]>=16&&a[1]<=31);}
function decode(bytes){if(bytes.length>2048)return null;try{return JSON.parse(bytes.toString());}catch{return null;}}
function advertisement(bytes,peer,nonce){
  const p=decode(bytes);
  if(!p||p.type!=='slotforge-host'||p.version!==1||p.nonce!==nonce||!privateIP(peer.address)||typeof p.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>200||!Number.isInteger(p.port)||p.port<1||p.port>65535)return null;
  return {id:p.id,name:p.name,address:peer.address+':'+p.port};
}
async function advertise(info){
  const socket=dgram.createSocket({type:'udp4',reuseAddr:true});
  try{await new Promise((resolve,reject)=>{socket.once('error',reject);socket.bind(PORT,'0.0.0.0',resolve);});
    let joined=0;for(const ip of interfaces())try{socket.addMembership(GROUP,ip);joined++;}catch{/* Some adapters do not support multicast. */}
    if(!joined)socket.addMembership(GROUP);
    socket.setMulticastTTL(1);socket.on('error',()=>{});
    const limits=new Map();
    socket.on('message',(bytes,peer)=>{
      const p=decode(bytes);if(!p||p.type!=='slotforge-discover'||p.version!==1||typeof p.nonce!=='string'||!/^[a-f0-9]{32}$/.test(p.nonce)||!privateIP(peer.address))return;
      const last=limits.get(peer.address)||0;if(Date.now()-last<200)return;if(limits.size>256)limits.clear();limits.set(peer.address,Date.now());
      const data=info();if(!data)return;
      socket.send(Buffer.from(JSON.stringify({type:'slotforge-host',version:1,nonce:p.nonce,id:data.id,name:data.name,port:data.port})),peer.port,peer.address,()=>{});
    });return socket;
  }catch(e){try{socket.close();}catch{}throw e;}
}
async function scan({duration=1800,signal}={}){
  const socket=dgram.createSocket('udp4'),nonce=crypto.randomBytes(16).toString('hex'),found=new Map();let timer,abort;
  try{return await new Promise((resolve,reject)=>{
    const finish=()=>resolve([...found.values()].sort((a,b)=>a.name.localeCompare(b.name)));
    abort=finish;if(signal?.aborted)return finish();signal?.addEventListener('abort',abort,{once:true});
    socket.on('error',reject);socket.on('message',(bytes,peer)=>{const item=advertisement(bytes,peer,nonce);if(item&&found.size<100)found.set(item.id+'@'+item.address,item);});
    socket.bind(0,'0.0.0.0',async()=>{
      try{socket.setMulticastTTL(1);const bytes=Buffer.from(JSON.stringify({type:'slotforge-discover',version:1,nonce}));
        for(const ip of interfaces()){if(signal?.aborted)break;try{socket.setMulticastInterface(ip);await new Promise(resolve=>socket.send(bytes,PORT,GROUP,()=>resolve()));}catch{}}
        timer=setTimeout(finish,duration);
      }catch(e){reject(e);}
    });
  });}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);try{socket.close();}catch{}}
}
module.exports={advertise,scan,advertisement,privateIP};
