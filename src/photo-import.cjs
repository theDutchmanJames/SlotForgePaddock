'use strict';
const MAX_URI=12*1024*1024;
function originalPhoto(bytes){
 const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
 if(!mime)throw Error('Choose a PNG, JPEG or WebP image.');
 const data='data:'+mime+';base64,'+bytes.toString('base64');
 if(data.length>MAX_URI)throw Object.assign(Error('This original photograph exceeds the 12 MB encoded image limit (approximately 9 MB on disk).'),{code:'PHOTO_TOO_LARGE'});
 return data;
}
module.exports={originalPhoto};
