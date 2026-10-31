(function(root){
  function compare(a,b){
    const technical=[...new Set([...Object.keys(a.technical||{}),...Object.keys(b.technical||{})])].filter(k=>a.technical?.[k]||b.technical?.[k]).map(key=>({key,before:a.technical?.[key]||'',after:b.technical?.[key]||'',changed:(a.technical?.[key]||'')!==(b.technical?.[key]||'')}));
    const inventory=s=>{const m=new Map();for(const i of s.installations||[]){const key=JSON.stringify([i.partId,i.field||'',i.position||'',i.assemblyId||'']);const r=m.get(key)||{key,name:i.name||i.partId,position:i.position||i.field||'',quantity:0};r.quantity+=i.quantity;m.set(key,r);}return m;};const left=inventory(a),right=inventory(b);
    // Public car packages omit inventory; imported setups retain sourceId and an empty local array.
    const inventoryKnown=!a.sourceId&&!b.sourceId&&Array.isArray(a.installations)&&Array.isArray(b.installations);
    const parts=inventoryKnown?[...new Set([...left.keys(),...right.keys()])].map(key=>({key,name:(right.get(key)||left.get(key)).name,beforeName:left.get(key)?.name||'',afterName:right.get(key)?.name||'',position:(right.get(key)||left.get(key)).position,before:left.get(key)?.quantity||0,after:right.get(key)?.quantity||0,changed:(left.get(key)?.quantity||0)!==(right.get(key)?.quantity||0)})):[];
    return {technical,parts,inventoryKnown,changes:technical.filter(r=>r.changed).length+parts.filter(r=>r.changed).length};
  }
  const api={compare};if(typeof module==='object'&&module.exports)module.exports=api;else root.SetupComparison=api;
})(globalThis);
