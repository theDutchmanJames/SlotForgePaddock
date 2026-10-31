// Keep the inline, theme-aware diagram in sync with its editable SVG source.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','renderer');
const svg=fs.readFileSync(path.join(root,'build-diagram.svg'),'utf8');
const inner=svg.replace(/^[\s\S]*?<svg\b[^>]*>/,'').replace(/<\/svg>\s*$/,'');
if(inner===svg)throw Error('Expected an SVG document.');
fs.writeFileSync(path.join(root,'build-art.js'),'// Bundled from build-diagram.svg; inline so labels follow the app theme.\nconst BuildDiagramArt='+JSON.stringify(inner)+';\n');
