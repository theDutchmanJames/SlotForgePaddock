'use strict';
const { pathToFileURL } = require('node:url');
// Node and Chromium serialize the same file location differently: drive casing
// on Windows, and percent-encoded unreserved characters (notably ~ in 8.3 paths).
// Normalize those equivalent representations only. Do not resolve paths, fold
// path casing, decode separators, remove queries/fragments or accept prefixes.
function canonicalURL(url, platform = process.platform) {
  if (typeof url !== 'string' || !url.startsWith('file:')) return url;
  const normalized = url.replace(/%([0-9a-f]{2})/gi, (encoded, hex) => {
    const char = String.fromCharCode(parseInt(hex, 16));
    return /^[a-z0-9._~-]$/i.test(char) ? char : encoded.toUpperCase();
  });
  return platform === 'win32'
    ? normalized.replace(/^file:\/\/\/([a-z]):/, (_, drive) => 'file:///' + drive.toUpperCase() + ':')
    : normalized;
}
function fileURL(file) {
  return canonicalURL(pathToFileURL(file).href);
}
function owns(window, event, url) {
  return !!(
    window &&
    !window.isDestroyed() &&
    event?.sender &&
    !event.sender.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    canonicalURL(event.senderFrame?.url) === url
  );
}
module.exports = { canonicalURL, fileURL, owns };
