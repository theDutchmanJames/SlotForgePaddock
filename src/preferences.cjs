const Theme=require('../renderer/theme.js');
const OverviewLayout=require('../renderer/overview-layout.js');
const check=(ok,message)=>{if(!ok)throw Error(message);};
function validate(settings,columns=[]){
  if(settings.overviewLayout!==undefined)OverviewLayout.validate(settings.overviewLayout,columns);
  if(settings.showroomFeaturedId!==undefined)check(typeof settings.showroomFeaturedId==='string'&&(!settings.showroomFeaturedId||/^[a-zA-Z0-9_-]{1,100}$/.test(settings.showroomFeaturedId)),'Invalid spotlight car.');
  check(Theme.THEMES.some(([key])=>key===settings.theme),'Invalid theme.');
  if(settings.customColors!==undefined){
    const colors=settings.customColors;
    check(colors&&typeof colors==='object'&&!Array.isArray(colors),'Invalid custom colours.');
    for(const [key] of Theme.COLORS)check(typeof colors[key]==='string'&&!!Theme.hex6(colors[key]),'Choose a valid colour for '+key+'.');
  }
  if(settings.banner!==undefined){
    const banner=settings.banner;
    check(banner&&typeof banner==='object'&&!Array.isArray(banner),'Invalid welcome banner.');
    for(const [key,max] of [['line1',120],['line2',200],['line3',500]])check(typeof banner[key]==='string'&&banner[key].trim()&&banner[key].length<=max&&!/[\r\n]/.test(banner[key]),'Enter banner '+key+' as one line (maximum '+max+' characters).');
  }
}
function save(settings,p,columns=[]){
  if(p.overviewLayout!==undefined){OverviewLayout.validate(p.overviewLayout,columns);settings.overviewLayout=structuredClone(p.overviewLayout);}
  if(p.showroomFeaturedId!==undefined)settings.showroomFeaturedId=p.showroomFeaturedId;
  if(p.theme!==undefined)settings.theme=p.theme;
  if(p.customColors!==undefined){
    validate({...settings,customColors:p.customColors},columns);
    settings.customColors=Theme.customOf({customColors:p.customColors});
  }
  if(p.banner===null)delete settings.banner;
  else if(p.banner!==undefined){validate({...settings,banner:p.banner},columns);settings.banner=Object.fromEntries(['line1','line2','line3'].map(k=>[k,p.banner[k].trim()]));}
  validate(settings,columns);
}
module.exports={validate,save};
