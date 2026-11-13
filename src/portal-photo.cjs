'use strict';
// Read dimensions before the desktop decoder allocates a full image buffer.
const MAX_PIXELS=60000000;
function dimensions(b){
 if(b.length>=24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.toString('ascii',12,16)==='IHDR')return [b.readUInt32BE(16),b.readUInt32BE(20)];
 if(b.length>=4&&b[0]===255&&b[1]===216){
  for(let i=2;i<b.length;){
   if(b[i++]!==255)break;while(b[i]===255)i++;const marker=b[i++];
   if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;
   if(i+2>b.length)break;const size=b.readUInt16BE(i);if(size<2||i+size>b.length)break;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&size>=8)return [b.readUInt16BE(i+5),b.readUInt16BE(i+3)];i+=size;
  }
 }
 if(b.length>=30&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){
  const type=b.toString('ascii',12,16);
  if(type==='VP8X')return [1+b.readUIntLE(24,3),1+b.readUIntLE(27,3)];
  if(type==='VP8 '&&b[23]===157&&b[24]===1&&b[25]===42)return [b.readUInt16LE(26)&16383,b.readUInt16LE(28)&16383];
  if(type==='VP8L'&&b[20]===47){const bits=b.readUInt32LE(21);return [(bits&16383)+1,((bits>>>14)&16383)+1];}
 }
 throw Object.assign(Error('This photo could not be read. Choose a JPEG, PNG or WebP photograph.'),{code:'INVALID_PHOTO',httpStatus:400});
}
function check(bytes){const [width,height]=dimensions(bytes);if(!width||!height||width>20000||height>20000||width*height>MAX_PIXELS)throw Object.assign(Error('This photograph is too large to open safely. Choose a smaller copy.'),{code:'PHOTO_DIMENSIONS',httpStatus:413});return {width,height};}
module.exports={check,dimensions,MAX_PIXELS};
