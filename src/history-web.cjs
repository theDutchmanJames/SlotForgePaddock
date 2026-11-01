const http=require('node:http'),https=require('node:https'),dns=require('node:dns').promises,net=require('node:net');
const {Parser,DomHandler}=require('htmlparser2');
const research=require('../renderer/history-research-model.js');
const MAX_BYTES=2*1024*1024;
class BoundedDocument extends DomHandler{
  constructor(){super();this.nodeCount=1;}
  addNode(node){
    if(++this.nodeCount>30000||this.tagStack.length>128)throw Error('This webpage is too complex to read. Use the research template.');
    super.addNode(node);
  }
}
const denied=new net.BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])denied.addSubnet(ip,bits,'ipv4');
const globalV6=new net.BlockList();globalV6.addSubnet('2000::',3,'ipv6');
for(const [ip,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])denied.addSubnet(ip,bits,'ipv6');
function publicAddress(address){const family=net.isIP(address);return family===4?!denied.check(address,'ipv4'):family===6&&globalV6.check(address,'ipv6')&&!denied.check(address,'ipv6');}
function pageURL(value){const u=new URL(research.link(value));if(u.port&&!['80','443'].includes(u.port))throw Error('Use a public webpage on the standard HTTP or HTTPS port.');u.hash='';return u;}
async function download(value,{lookup=dns.lookup,request,timeoutMs=15000}={}){
  const deadline=Date.now()+Math.min(15000,Math.max(1,timeoutMs));let url=pageURL(value);
  for(let redirects=0;redirects<=3;redirects++){
    const host=url.hostname.replace(/^\[|\]$/g,'');let timer;
    const remaining=()=>Math.max(1,deadline-Date.now());
    const addresses=await Promise.race([net.isIP(host)?Promise.resolve([{address:host,family:net.isIP(host)}]):lookup(host,{all:true,verbatim:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Webpage lookup timed out.')),remaining());})]).finally(()=>clearTimeout(timer));
    if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('Only public websites can be read. Local and private network addresses are not supported.');
    if(Date.now()>=deadline)throw Error('Webpage request timed out.');
    const address=addresses[0];
    const response=await new Promise((resolve,reject)=>{
      let req,settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){req?.destroy();reject(error);}else resolve(value);};
      const timer=setTimeout(()=>finish(Error('Webpage request timed out.')),remaining());
      const send=request||(url.protocol==='https:'?https.request:http.request);
      try{req=send(url,{method:'GET',agent:false,headers:{'User-Agent':'SlotForge-Paddock/1.0 (user-requested car research)','Accept':'text/html, application/xhtml+xml','Accept-Encoding':'identity'},lookup:(_hostname,options,cb)=>cb(null,...(options?.all?[[address]]:[address.address,address.family]))},res=>{
        if([301,302,303,307,308].includes(res.statusCode)){res.destroy();return finish(null,{redirect:res.headers.location});}
        if(res.statusCode!==200){res.destroy();return finish(Error(`Website returned HTTP ${res.statusCode}. Try another public source or the research template.`));}
        if(!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(res.headers['content-type']||'')){res.destroy();return finish(Error('This URL did not return an HTML webpage. PDF and other files are not supported.'));}
        if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.destroy();return finish(Error('This website requires compressed content. Use another source or the research template.'));}
        let bytes=0;const chunks=[];
        res.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_BYTES){res.destroy();finish(Error('Webpage exceeds 2 MB.'));}else chunks.push(chunk);});
        res.on('error',e=>finish(e));res.on('aborted',()=>finish(Error('Webpage download was interrupted.')));
        res.on('end',()=>finish(null,{bytes:Buffer.concat(chunks),type:res.headers['content-type']}));
      });
      req.on('error',e=>finish(e));req.end();}catch(error){finish(error);}
    });
    if(Object.hasOwn(response,'redirect')){if(!response.redirect||redirects===3)throw Error('Too many or invalid webpage redirects.');url=pageURL(new URL(response.redirect,url).href);continue;}
    const charset=/charset\s*=\s*["']?([^;\s"']+)/i.exec(response.type)?.[1]||'utf-8';let html;
    try{html=new TextDecoder(charset,{fatal:true}).decode(response.bytes);}catch{throw Error('Unsupported webpage text encoding. Use the research template instead.');}
    return {html,url:url.href};
  }
}
const aliases={team:'team','racing team':'team',entrant:'team',driver:'drivers',drivers:'drivers',event:'event',race:'event',circuit:'event',year:'year','race year':'year','race number':'raceNumber','car number':'raceNumber',qualifying:'qualifying','qualifying result':'qualifying',finish:'finish','finishing result':'finish','race result':'finish',history:'history'};
function parse(html,url){
  research.link(url);if(typeof html!=='string'||Buffer.byteLength(html)>MAX_BYTES)throw Error('Webpage exceeds 2 MB.');
  // Enforce complexity while building the DOM, before a small but tag-dense
  // response can allocate hundreds of thousands of nodes in the host process.
  const handler=new BoundedDocument();new Parser(handler).end(html);
  const nodes=[],stack=[handler.root];
  while(stack.length){const n=stack.pop();nodes.push(n);for(let i=(n.children?.length||0)-1;i>=0;i--)stack.push(n.children[i]);}
  // Iterative text extraction avoids executing scripts and excludes hidden/script content.
  const excluded=n=>['script','style','noscript','template','nav','footer'].includes(n.name)||Object.hasOwn(n.attribs||{},'hidden')||n.attribs?.['aria-hidden']==='true';
  function content(node){let s='',todo=[node];while(todo.length){const n=todo.pop();if(excluded(n))continue;if(n.type==='text')s+=n.data+' ';else for(let i=(n.children?.length||0)-1;i>=0;i--)todo.push(n.children[i]);if(s.length>25000)break;}return s.replace(/\s+/g,' ').trim();}
  function visible(n){for(let p=n;p;p=p.parent)if(excluded(p))return false;return true;}
  const proposals=[];
  function add(field,value,reason){if(!Object.hasOwn(research.labels,field)||typeof value!=='string')return;value=value.replace(/\s+/g,' ').trim();if(!value||value.length>(field==='history'?20000:500)||proposals.some(p=>p.field===field&&p.value===value)||proposals.filter(p=>p.field===field).length>=4)return;proposals.push({field,value,method:'webpage',sourceUrls:[url],uncertainty:reason+' Extracted text; confirm that it refers to this exact full-size car and event.'});}
  const label=s=>aliases[s.toLowerCase().replace(/[:\s]+$/,'').trim()];
  for(const n of nodes){
    if(n.name==='tr'&&visible(n)){const cells=(n.children||[]).filter(c=>['td','th'].includes(c.name));if(cells.length===2)add(label(content(cells[0])),content(cells[1]),'Labelled table field.');}
    if(n.name==='dt'&&visible(n)){let next=n.next;while(next&&['text','comment'].includes(next.type))next=next.next;if(next?.name==='dd')add(label(content(n)),content(next),'Labelled definition field.');}
    if(n.name==='meta'&&['description','og:description'].includes((n.attribs?.name||n.attribs?.property||'').toLowerCase()))add('history',n.attribs.content,'Page description; this may describe a product or the whole page.');
    if(n.name==='script'&&n.attribs?.type?.toLowerCase()==='application/ld+json'){
      let json;try{json=JSON.parse((n.children||[]).map(c=>c.data||'').join(''));}catch{continue;}
      const queue=[[json,0]];let count=0;
      while(queue.length&&count++<300){const [item,depth]=queue.pop();if(!item||typeof item!=='object'||depth>10)continue;if(Array.isArray(item)){for(const v of item.slice(0,50))queue.push([v,depth+1]);continue;}
        if(['Product','Vehicle','Car','Event','SportsEvent'].includes(item['@type']))add('history',item.description,'Structured page description; not verified historical research.');
        if(item['@type']==='PropertyValue')add(label(String(item.name||'')),item.value,'Structured labelled property.');
        for(const v of Object.values(item))if(v&&typeof v==='object')queue.push([v,depth+1]);
      }
    }
  }
  if(!proposals.length)throw Error('No supported labelled fields or descriptions found. This reader cannot interpret photographs, complex results tables or JavaScript-only pages. Try the research template.');
  const title=content(nodes.find(n=>n.name==='title')||{children:[]}).slice(0,200);
  return {proposals,sources:[{title,url}]};
}
async function read(url){const page=await download(url);return parse(page.html,page.url);}
module.exports={read,parse,download,publicAddress,pageURL,MAX_BYTES};
