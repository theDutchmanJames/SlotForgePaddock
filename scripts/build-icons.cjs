// Repo-native vector additions: same 256px canvas, 8px rounded strokes and single colour as the supplied pack.
const fs=require('node:fs'),path=require('node:path');
const dir=path.join(__dirname,'../renderer/icons');
const p=d=>`<path d="${d}"/>`,c=(x,y,r,fill=false)=>`<circle cx="${x}" cy="${y}" r="${r}"${fill?' fill="currentColor" stroke="none"':''}/>`,rect=(x,y,w,h,r=0,fill=false)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"${fill?' fill="currentColor" stroke="none"':''}/>`;
const coil=(x,y)=>p(`M${x+18} ${y-12}V${y}M${x} ${y}H${x+36}L${x} ${y+18}L${x+36} ${y+36}L${x} ${y+54}H${x+36}M${x+18} ${y+54}V${y+66}`);
const bottle=(cap=34)=>rect(74,83,108,131,14)+rect(101,83-cap,54,cap,4)+p('M93 128H163M93 147H147');
const additions={
 'chassis-section':p('M54 48H202V206H54Z M77 75H179V111H77Z M77 143H179V179H77Z')+c(66,60,4,true)+c(190,194,4,true),
 'motor-bracket':p('M44 204V57H184V169H212V204Z M44 169H184')+c(114,111,34)+c(65,184,6,true)+c(192,184,6,true),
 'anglewinder-gear':'<g transform="rotate(-24 128 128)"><ellipse cx="128" cy="128" rx="85" ry="59"/><ellipse cx="128" cy="128" rx="62" ry="39"/>'+p('M43 128V154C65 213 191 213 213 154V128 M128 71V89 M90 77L99 94 M58 98L80 107 M49 130H72 M73 167L88 151 M128 186V167 M181 167L169 151 M207 130H184 M198 98L177 108 M166 77L157 94')+c(128,128,17)+'</g>',
 'pulley':c(128,128,88)+c(128,128,69)+c(128,128,24)+p('M128 59V104 M128 152V197 M59 128H104 M152 128H197'),
 'drive-belt':'<ellipse cx="128" cy="122" rx="94" ry="57"/><ellipse cx="128" cy="122" rx="78" ry="41"/>'+p('M34 122V148C34 224 222 224 222 148V122 M53 172V187 M80 187V201 M110 193V207 M141 193V207 M173 186V201 M201 172V188'),
 'independent-axle':p('M27 128H112 M144 128H229 M112 112V144 M144 112V144')+rect(48,71,31,114,7)+rect(177,71,31,114,7)+p('M63 89V167 M192 89V167'),
 'wheel-hub':'<ellipse cx="128" cy="150" rx="76" ry="52"/>'+rect(93,67,70,84,8)+'<ellipse cx="128" cy="67" rx="35" ry="23"/>'+c(128,67,10)+c(75,150,7,true)+c(181,150,7,true)+p('M110 176H146'),
 'wheel-tyre-set':c(128,128,93)+c(128,128,66)+c(128,128,18)+p('M128 62V110 M128 146V194 M62 128H110 M146 128H194 M81 81L115 115 M141 141L175 175 M175 81L141 115 M115 141L81 175'),
 'suppression-capacitor':rect(73,56,110,116,18)+p('M100 172V218 M156 172V218 M98 87H158 M128 72V102 M98 134H158'),
 'suspension-kit':rect(73,48,110,151,12)+rect(93,84,70,77,6)+coil(22,100)+coil(198,100)+p('M107 199V218 M149 199V218'),
 'custom-part':p('M44 57H105C93 16 163 16 151 57H212V110C171 99 171 164 212 153V210H151C162 170 95 170 105 210H44V153C85 165 85 98 44 110Z'),
 'other-part':p('M39 69L128 30L217 69V187L128 226L39 187Z M39 69L128 109L217 69 M128 109V226')+p('M112 151C112 126 150 126 150 147C150 162 128 159 128 177')+c(128,194,4,true),
 'assembly':rect(59,43,138,66,11)+p('M31 76H59 M197 76H220 M128 109V150 M29 179H227')+c(128,179,29)+c(128,179,10)+rect(39,135,28,88,6)+rect(189,135,28,88,6),
 'hex-nut':p('M82 45H174L221 128L174 211H82L35 128Z')+c(128,128,40),
 'terminal-eyelet':c(128,84,48)+c(128,84,23)+p('M102 124V207H154V124 M102 176H154'),
 'screwdriver':p('M43 35L70 62L61 78L35 51Z M65 73L118 126')+'<g transform="rotate(-45 162 166)">'+rect(132,111,60,109,19)+p('M149 135V196 M174 135V196')+'</g>',
 'hex-driver':p('M91 209V57H192V81H115V209Z M91 183H115')+p('M171 57V81'),
 'pliers':p('M92 43L113 88L143 88L164 43 M92 43L62 95L110 135 M164 43L194 95L146 135 M110 135L62 218 M146 135L194 218 M98 157L78 145 M158 157L178 145')+c(128,119,22)+c(128,119,5,true),
 'cutter':p('M76 36L128 103L180 36 M76 36L65 87L110 133 M180 36L191 87L146 133 M110 133L65 219 M146 133L191 219 M82 171L101 182 M155 182L174 171')+c(128,120,18),
 'tweezers':p('M72 39C128 15 184 39 184 85L149 219L134 224L157 81 M72 39L107 219L122 224L99 71'),
 'hand-file':p('M53 40L91 34L135 158L99 171Z M101 169L137 157L157 213L122 225Z M64 63L95 53 M73 86L103 76 M81 110L111 99 M90 134L120 123'),
 'calipers':p('M47 32V222H221V198H71V32 M47 69H114V35 M47 146H114V198 M91 198V213 M116 198V207 M141 198V213 M166 198V207 M191 198V213'),
 'scales':rect(46,100,164,117,17)+'<ellipse cx="128" cy="81" rx="83" ry="35"/>'+rect(78,151,100,36,5)+p('M101 169H116 M136 169H151'),
 'setup-plate':p('M56 72H202L227 185H29Z M29 185V204H227V185 M75 83L59 174 M128 83V174 M181 83L199 174 M52 117H210 M44 147H216')+c(74,98,4,true)+c(182,98,4,true),
 'ride-height-gauge':p('M35 209V165H67V136H99V107H131V78H163V49H211V209Z M53 186H63 M85 158H95 M117 130H127 M149 101H159 M181 73H191'),
 'gear-mesh-tool':c(92,106,52)+c(92,106,14)+c(173,150,38)+c(173,150,11)+p('M92 37V54 M40 106H23 M92 158V175 M173 99V112 M211 150H229 M173 188V205 M58 70L46 58 M131 68L143 56 M58 143L46 155'),
 'tyre-truer':rect(34,170,188,42,8)+c(93,116,44)+c(93,116,18)+rect(162,71,47,87,7)+p('M137 116H222 M93 160V170 M174 158V170 M186 71V42 M170 42H202 M49 191H74'),
 'sanding-equipment':rect(47,80,163,119,9)+p('M47 80L71 51H183L210 80 M72 104L93 125 M104 104L125 125 M136 104L157 125 M168 104L189 125 M72 145L93 166 M104 145L125 166 M136 145L157 166 M168 145L189 166'),
 'wheel-puller':p('M46 58H210V153H183V84H73V153H46Z M128 26V173 M99 30H157 M114 104H142 M114 123H142 M114 142H142')+c(128,192,34)+c(128,192,12),
 'wheel-balancer':p('M40 215H216 M69 215V124L94 94 M187 215V124L162 94 M32 111H224')+c(128,111,62)+c(128,111,17)+p('M128 49V94 M66 111H111 M145 111H190'),
 'motor-tester':rect(36,102,184,113,12)+rect(57,127,84,42,5)+c(184,154,16)+p('M63 192H91 M119 192H147 M84 102V79 M172 102V79')+rect(68,40,119,39,8)+p('M48 60H68 M187 60H209'),
 'rpm-meter':rect(68,70,120,151,15)+rect(86,95,84,49,6)+c(128,182,16)+p('M112 70V45H144V70 M100 30L88 17 M128 26V11 M156 30L168 17 M102 120H112 M123 120H133 M144 120H154'),
 'multimeter':rect(62,30,132,190,16)+rect(80,51,96,48,5)+c(128,146,29)+p('M128 146L141 125 M88 191V231 M169 191V231')+c(88,191,6)+c(169,191,6),
 'soldering-iron':p('M31 221L83 169 M83 169L105 147 M93 136L120 163 M177 48C213 25 236 60 215 81')+'<g transform="rotate(45 146 105)">'+rect(124,39,44,127,13)+p('M137 62V135 M155 62V135')+'</g>',
 'bench-power-supply':rect(32,62,192,143,13)+rect(49,84,93,45,5)+c(185,106,19)+c(77,170,12)+c(125,170,12)+p('M169 160H204 M169 179H204 M65 106H81 M99 106H123 M60 205V221 M196 205V221'),
 'cleaner':bottle()+p('M101 49V27H180V49H154 M180 27L203 44 M179 57L191 80'),
 'cleaning-brush':p('M109 32H147V126H109Z M91 126H165L187 219H69Z M91 145H165 M94 160L86 211 M116 160L112 211 M140 160L144 211 M162 160L170 211'),
 'cloth':p('M56 45L205 68L188 218L35 191Z M56 45L104 88L35 191 M104 88L205 68 M104 88L153 153L188 218 M60 173L104 119 M77 184L116 137'),
 'bearing-oil':bottle()+p('M116 49V22H140V49 M128 159C105 183 113 199 128 199C143 199 151 183 128 159Z'),
 'gear-grease':rect(50,91,156,124,17)+rect(46,64,164,27,5)+c(128,153,33)+c(128,153,13)+p('M128 108V120 M128 186V198 M83 153H95 M161 153H173'),
 'glue':p('M97 83H159L190 215H66Z M112 83V49H144V83 M119 49V18H137V49 M91 158H165')+c(128,127,12),
 'tape':c(112,118,78)+c(112,118,38)+p('M112 196H215V157H180 M161 177H203'),
 'solder':c(111,123,70)+c(111,123,29)+p('M181 123H207V198H232 M74 71L149 175 M53 109L128 192 M96 54L171 158'),
 'flux':rect(67,85,122,131,14)+rect(77,58,102,27,4)+p('M128 27V58 M96 159C114 134 142 134 160 159 M102 180H154'),
 'heat-shrink':p('M49 65L93 51L147 198L103 214Z M101 45L145 31L199 178L155 194Z M53 80L98 65 M104 60L150 45 M97 198L142 184 M149 178L194 162'),
 'abrasive':p('M54 38H202V183L164 220H54Z M164 220V183H202 M78 68L90 81 M115 68L127 81 M152 68L164 81 M78 108L90 121 M115 108L127 121 M152 108L164 121 M78 148L90 161 M115 148L127 161'),
 'paint':rect(56,98,125,116,12)+rect(49,76,139,22,4)+p('M185 52L221 28 M162 78L185 52 M175 63L199 87 M173 89L154 107 M79 144H157 M79 164H135'),
 'toolbox':rect(30,88,196,128,12)+p('M89 88V48H167V88 M30 137H226 M109 126H147V157H109Z'),
 'race-case':rect(43,64,170,153,12)+p('M95 64V36H161V64 M43 107H213 M74 64V217 M182 64V217')+rect(111,95,34,28,4)+c(69,230,8,true)+c(188,230,8,true),
 'parts-organiser':rect(29,51,198,160,11)+p('M29 97H227 M29 153H227 M91 51V211 M160 51V211')+c(60,74,9)+c(126,126,14)+p('M181 173L207 197 M181 197L207 173'),
 'storage-tray':p('M54 57H202L225 188H31Z M31 188V214H225V188 M54 57V151H202V57 M54 151L31 188 M202 151L225 188 M70 76H185'),
};
for(const [id,geometry]of Object.entries(additions))fs.writeFileSync(path.join(dir,id+'.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><title>${id.replaceAll('-',' ')}</title><g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">${geometry}</g></svg>\n`);
const art={};
for(const filename of fs.readdirSync(dir).filter(f=>f.endsWith('.svg')).sort()){
 const svg=fs.readFileSync(path.join(dir,filename),'utf8');
 if(/<script|<foreignObject|\bon\w+\s*=|\bhref\s*=|url\(/i.test(svg))throw Error('Unexpected SVG content: '+filename);
 const inner=svg.replace(/^[\s\S]*?<svg\b[^>]*>/,'').replace(/<\/svg>\s*$/,'').replace(/<title>[\s\S]*?<\/title>/g,'');
 art[filename.slice(0,-4)]=inner;
}
fs.writeFileSync(path.join(__dirname,'../renderer/icon-art.js'),'// Generated by scripts/build-icons.cjs from the bundled SVG files.\nconst slotforgeIconArt='+JSON.stringify(art)+';\n');
console.log(`${Object.keys(art).length} icons bundled (${Object.keys(additions).length} additions).`);
