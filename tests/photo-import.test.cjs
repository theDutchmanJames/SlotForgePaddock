const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{originalPhoto}=require('../src/photo-import.cjs');
test('photo import preserves original PNG bytes without conversion, scaling or metadata changes',()=>{
 const bytes=fs.readFileSync(path.join(__dirname,'../assets/icon.png')),uri=originalPhoto(bytes);assert.equal(uri,'data:image/png;base64,'+bytes.toString('base64'));assert.deepEqual(Buffer.from(uri.split(',')[1],'base64'),bytes);
});
test('photo type detection supports JPEG and WebP and refuses other formats',()=>{
 assert.match(originalPhoto(Buffer.from([255,216,255,224])),/^data:image\/jpeg;/);assert.match(originalPhoto(Buffer.from('RIFF1234WEBPdata')),/^data:image\/webp;/);
 for(const bytes of [Buffer.alloc(0),Buffer.from('<svg/>'),Buffer.from('GIF89a')])assert.throws(()=>originalPhoto(bytes),/PNG, JPEG or WebP/);
});
test('oversized originals require an explicit UI decision, never silent conversion',()=>{
 const bytes=Buffer.alloc(9*1024*1024);bytes.set([255,216,255]);assert.throws(()=>originalPhoto(bytes),e=>e.code==='PHOTO_TOO_LARGE');
});
