// Render the approved Collection SVG consistently for desktop packaging.
// Run with: npm run build:app-icon
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const root = path.join(__dirname, '..');
const assets = path.join(root, 'assets');
const svg = fs.readFileSync(path.join(assets, 'icon.svg'), 'utf8');
app.disableHardwareAcceleration();

async function build() {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  const images = await win.webContents.executeJavaScript(`(async () => {
    const image = new Image();
    image.src = ${JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))};
    await image.decode();
    return ${JSON.stringify(sizes)}.map(size => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    });
  })()`);
  const pngs = images.map(value => Buffer.from(value, 'base64'));
  fs.writeFileSync(path.join(assets, 'icon.png'), pngs.at(-1));
  const icoPngs = pngs.slice(0, 7);
  const header = Buffer.alloc(6 + icoPngs.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(icoPngs.length, 4);
  let offset = header.length;
  icoPngs.forEach((png, i) => {
    const entry = 6 + i * 16;
    header[entry] = header[entry + 1] = sizes[i] === 256 ? 0 : sizes[i];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([header, ...icoPngs]));
  fs.writeFileSync(path.join(assets, 'icon-mac.svg'), svg);
  fs.writeFileSync(path.join(assets, 'brand-mark.svg'), svg.replace(/\s*<rect id="tile"[^>]*\/>/, ''));
  console.log('Built icon.png (1024px), icon.ico (16–256px), icon-mac.svg and brand-mark.svg.');
  win.destroy();
}
build().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
