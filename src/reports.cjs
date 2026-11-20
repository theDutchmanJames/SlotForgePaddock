const QRCode = require('./vendor/QRCode'),
  level = require('./vendor/QRCode/QRErrorCorrectLevel');
const { gearRatioText, today } = require('../renderer/domain.js');
const esc = v =>
  String(v ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const link = (db, car) => `slotforge-paddock://car/${db.id}/${car.id}`;
function parseLink(value) {
  try {
    const u = new URL(value);
    if (
      u.protocol !== 'slotforge-paddock:' ||
      u.hostname !== 'car' ||
      u.username ||
      u.password ||
      u.port ||
      u.search ||
      u.hash
    )
      return null;
    const [databaseId, carId, ...rest] = u.pathname.slice(1).split('/');
    if (rest.length || ![databaseId, carId].every(x => /^[a-zA-Z0-9_-]{1,100}$/.test(x || ''))) return null;
    return { databaseId, carId };
  } catch {
    return null;
  }
}
function qr(value) {
  const q = new QRCode(-1, level.M);
  q.addData(value);
  q.make();
  const n = q.getModuleCount();
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
  return `<svg class="report-qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 8} ${n + 8}" aria-label="Open car in Paddock" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${d}" fill="black"/></svg>`;
}
// Printed reports in SlotForge Timing's print style (docs/ui-reference/print-2026-11, A · Timing style). The
// styles live in renderer/report-print.css so the PDF and the in-app preview look the same.
const fs = require('node:fs'),
  path = require('node:path');
const TechGroups = require('../renderer/tech-groups.js');
const file = (...p) => path.join(__dirname, '..', ...p);
const dataUrl = (f, type) => `data:${type};base64,${fs.readFileSync(file(f)).toString('base64')}`;
let printCss = null;
// The PDF has no access to the app's files, so its fonts and the logo travel inside the document.
function pdfCss() {
  printCss ??=
    `@font-face{font-family:'SF Barlow Condensed';src:url(${dataUrl('renderer/fonts/barlowcondensed/BarlowCondensed-BoldItalic.ttf', 'font/ttf')}) format('truetype');font-weight:700;font-style:italic}` +
    `@font-face{font-family:'SF Roboto Mono';src:url(${dataUrl('renderer/fonts/robotomono/RobotoMono[wght].ttf', 'font/ttf')}) format('truetype');font-weight:100 700}` +
    'body{margin:0;background:white}@page{size:A4;margin:12mm 12mm 16mm}' +
    fs.readFileSync(file('renderer', 'report-print.css'), 'utf8');
  return printCss;
}
let logo = null;
const logoUrl = () => (logo ??= dataUrl('assets/slotforge-wordmark-light.svg', 'image/svg+xml'));
const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const longMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${longMonths[Number(m[2]) - 1]} ${m[1]}` : String(iso || '');
};
const labels = Object.fromEntries(Object.values(TechGroups).flat());
const label = k => labels[k] || (k.charAt(0).toUpperCase() + k.slice(1).replace(/([A-Z])/g, ' $1').toLowerCase());
const grams = v => (/^\d+(?:[.,]\d+)?$/.test(String(v ?? '').trim()) ? String(v).trim() + ' g' : v);
const lanes = ['#e5484d', '#3b82f6', '#f2c230', '#34c77b', '#a855f7', '#f97316'];
// opts.photo(car, size) gives the image address for a car photo (size: 'card' or 'thumb'), or '' for none.
// The app passes small versions; without it the stored photo is used as it is.
function render(db, p = {}, opts = {}) {
  const photoOf = (c, size) => (opts.photo ? opts.photo(c, size) : c.picture || '');
  if (p.revision !== undefined && p.revision !== db.revision)
    throw Error('The database changed. Reopen the report preview.');
  if (!['cards', 'inventory', 'setup', 'scrutineering'].includes(p.kind)) throw Error('Choose a report type.');
  if (!Array.isArray(p.ids) || p.ids.length < 1 || p.ids.length > 500 || new Set(p.ids).size !== p.ids.length)
    throw Error('Choose 1–500 different cars.');
  const cars = p.ids.map(id => {
    const c = db.cars.find(c => c.id === id);
    if (!c) throw Error('Car no longer exists.');
    return c;
  });
  const setup = p.setupId
    ? db.setups.find(s => s.id === p.setupId && cars.length === 1 && s.carId === cars[0].id)
    : null;
  if (p.setupId && !setup) throw Error('Choose a setup belonging to this car.');
  const title = {
    cards: 'Car cards',
    inventory: 'Collection inventory',
    setup: 'Setup sheets',
    scrutineering: 'Club scrutineering sheets'
  }[p.kind];
  const day = today(),
    [, mm, dd] = day.split('-'),
    collection = db.settings.name || 'My collection',
    count = n => `${n} ${n === 1 ? 'car' : 'cars'}`;
  const head = (kick, heading, sub) =>
    `<div class="rp-rule"></div><div class="rp-head"><div><div class="rp-kick">${esc(kick)}</div><h1 class="rp-title">${esc(heading)}</h1><p class="rp-sub">${esc(sub)}</p></div><img class="rp-logo" src="${logoUrl()}" alt="SlotForge"><div class="rp-date"><b>${Number(dd)}</b><span>${months[Number(mm) - 1]} ${day.slice(0, 4)}</span></div></div><div class="rp-check"></div>`;
  const tile = (k, v, small = '') =>
    `<div class="rp-tile"><span class="rp-lab">${esc(k)}</span><b>${esc(v || '—')}</b>${small ? `<small>${esc(small)}</small>` : ''}</div>`;
  const photoBox = (c, number = true, src = photoOf(c, 'card')) =>
    `<div class="rp-photo ${src ? '' : 'empty'}">${src ? `<img src="${esc(src)}" alt="${esc(c.name)}">` : 'No photo'}${number && c.number ? `<span class="rp-num">${esc(c.number)}</span>` : ''}</div>`;
  const qrBlock = c =>
    `<div class="rp-qr"><a href="${esc(link(db, c))}">${qr(link(db, c))}</a><span>Open in Paddock on a computer<br>with this collection installed.</span></div>`;
  let body = '<div class="report">';
  if (p.kind === 'cards') {
    body += `<section class="rp-doc">${head('Collection · car cards', 'Car cards', `${collection} · ${count(cars.length)} · scan a card to open the car in Paddock`)}`;
    for (const c of cars) {
      const t = c.technical || {};
      body += `<article class="rp-card">${photoBox(c)}<div><div class="rp-lab">${esc([c.maker, c.scale, c.raceClass].filter(Boolean).join(' · ') || 'Slot car')}</div><h2>${esc(c.name)}</h2><p class="rp-meta">${esc([c.number ? '#' + c.number : '', c.location].filter(Boolean).join(' · ') || collection)}</p><div class="rp-tiles">${tile('Motor', t.motor)}${tile('Gearing', [t.pinion, t.gear].filter(Boolean).join(' / '))}${tile('Ratio', gearRatioText(t.pinion, t.gear))}${tile('Rear tyres', t.rearTyres)}${tile('Weight', grams(t.weight))}${tile('Class', c.raceClass)}</div>${qrBlock(c)}</div></article>`;
    }
    body += '</section>';
  }
  if (p.kind === 'inventory') {
    const purchase = p.purchase === true,
      makers = [...new Set(cars.map(c => c.maker).filter(Boolean))],
      places = [...new Set(cars.map(c => c.location).filter(Boolean))],
      paid = {};
    if (purchase)
      for (const c of cars) {
        const n = Number(String(c.price ?? '').replace(',', '.'));
        if (String(c.price ?? '').trim() && Number.isFinite(n)) paid[c.currency || '—'] = (paid[c.currency || '—'] || 0) + n;
      }
    const paidText = Object.entries(paid)
        .map(([cur, n]) => `${cur} ${n.toFixed(2)}`)
        .join(' · '),
      thumbs = cars.length <= 100;
    body += `<section class="rp-doc">${head('Collection · inventory', title, `${collection} · ${count(cars.length)}${purchase ? ' · prices in their own currency' : ''}`)}<div class="rp-tiles four">${tile('Cars', String(cars.length))}${tile('Makers', String(makers.length), makers.slice(0, 3).join(' · '))}${purchase ? tile('Paid', paidText || '—', 'per currency, as recorded') : tile('Scales', String(new Set(cars.map(c => c.scale).filter(Boolean)).size))}${tile('Locations', String(places.length), places.slice(0, 3).join(' · '))}</div><div class="rp-lab rp-sec">Cars</div><table><thead><tr>${thumbs ? '<th></th>' : ''}${['Number', 'Car', 'Maker', 'Scale', 'Location', ...(purchase ? ['Acquired', 'Seller', 'Price', 'Currency'] : [])].map(x => `<th class="${x === 'Price' ? 'rp-r' : ''}">${x}</th>`).join('')}</tr></thead><tbody>${cars
      .map(
        (c, i) =>
          `<tr class="rp-lane rp-lane-${i % lanes.length}">${thumbs ? ((src = photoOf(c, 'thumb')) => `<td class="rp-thumb">${src ? `<img src="${esc(src)}" alt="">` : ''}</td>`)() : ''}<td class="rp-m">${esc(c.number || '—')}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.maker || '—')}</td><td>${esc(c.scale || '—')}</td><td>${esc(c.location || '—')}</td>${purchase ? [longDate(c.acquired), c.seller].map(x => `<td>${esc(x || "—")}</td>`).join("") + `<td class="rp-m rp-r">${esc(c.price || '—')}</td><td>${esc(c.currency || '—')}</td>` : ''}</tr>`
      )
      .join('')}</tbody></table><p class="rp-note">${count(cars.length)}. Monetary values retain their individual currencies; no conversion or valuation is inferred.</p></section>`;
  }
  if (p.kind === 'setup' || p.kind === 'scrutineering')
    for (const c of cars) {
      const t = setup?.technical || c.technical || {},
        meta = [c.maker, c.scale, c.number ? '#' + c.number : ''].filter(Boolean).join(' · ');
      body += '<section class="rp-doc report-sheet">';
      if (p.kind === 'setup') {
        const hero = photoOf(c, 'card'),
          config = setup ? setup.name : 'Current car',
          configText = setup
            ? `Configuration: ${setup.name} · the specification saved on ${longDate(setup.date)}${setup.track ? ' · ' + setup.track : ''}, not the car as it is today.`
            : 'Configuration: Current car · the car as it is now.';
        const used = new Set(),
          groups = Object.entries(TechGroups)
            .map(([g, rows]) => [g, rows.filter(([k]) => t[k]).map(([k]) => (used.add(k), [label(k), t[k]]))])
            .filter(([, rows]) => rows.length);
        const other = Object.entries(t).filter(([k, v]) => v && !used.has(k));
        if (other.length) groups.push(['Other', other.map(([k, v]) => [label(k), v])]);
        const installs = setup && (setup.sourceId || !setup.installations)
          ? null
          : (setup ? setup.installations : db.installations.filter(i => i.carId === c.id && !i.removed)).map(i => [
              i.position || i.field,
              ((setup ? i.name : db.parts.find(p => p.id === i.partId)?.name) || i.name || 'Part') + ' × ' + i.quantity
            ]);
        body +=
          head('Setup sheet · ' + config, c.name, [meta, setup ? 'saved ' + longDate(setup.date) : 'current configuration', setup?.track].filter(Boolean).join(' · ')) +
          `<div class="rp-hero ${hero ? '' : 'nophoto'}">${hero ? photoBox(c, false, hero) : ''}<div class="rp-tiles big">${tile('Ratio', gearRatioText(t.pinion, t.gear), [t.pinion, t.gear].filter(Boolean).join(' / '))}${tile('Weight', grams(t.weight))}${tile('Motor', t.motor)}${tile('Rear tyres', t.rearTyres)}${tile('Guide', t.guide)}${tile('Class', c.raceClass)}</div></div>` +
          `<div class="rp-grid2 rp-gap">${groups.map(([g, rows]) => `<div class="rp-panel"><span class="rp-lab">${esc(g)}</span><div class="rp-kv">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div></div>`).join('') || '<div class="rp-panel"><span class="rp-lab">Specifications</span><p class="rp-note">No specifications recorded.</p></div>'}<div class="rp-panel"><span class="rp-lab">Tracked parts</span>${installs ? (installs.length ? `<div class="rp-kv">${installs.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>` : '<p class="rp-note">No tracked parts installed.</p>') : '<p class="rp-note">This historical setup has no tracked-inventory snapshot.</p>'}</div></div><div class="rp-callout">${esc(configText)}</div>`;
      }
      if (p.kind === 'scrutineering') {
        const rows = [
          ['Class', c.raceClass],
          ['Motor', t.motor],
          ['Gear ratio', gearRatioText(t.pinion, t.gear)],
          ['Weight (g)', t.weight],
          ['Ground clearance', t.clearance],
          ['Front width', t.frontWidth],
          ['Rear width', t.rearWidth],
          ['Rear tyre diameter', t.rearDiameter],
          ['Magnets', t.magnets]
        ];
        body +=
          head('Scrutineering · club check', (c.number ? '#' + c.number + ' ' : '') + c.name, [meta, c.raceClass ? 'class ' + c.raceClass : '', 'bring this sheet to the technical table'].filter(Boolean).join(' · ')) +
          `<div class="rp-tiles four">${tile('Class', c.raceClass, 'recorded')}${tile('Weight', grams(t.weight), 'recorded')}${tile('Ratio', gearRatioText(t.pinion, t.gear), 'recorded')}${tile('Motor', t.motor, 'recorded')}</div><div class="rp-lab rp-sec">Technical check</div><table><thead><tr><th>Item</th><th>Recorded</th><th>Measured</th><th class="rp-c">OK</th></tr></thead><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="rp-m">${esc(v || '—')}</td><td><span class="rp-write"></span></td><td class="rp-c"><span class="rp-box"></span></td></tr>`).join('')}</tbody></table><div class="rp-callout">Recorded specifications only. Verify against your club’s rules and actual measurements.</div><div class="rp-sign">${['Inspector', 'Date', 'Result'].map(k => `<div class="rp-panel"><span class="rp-lab">${k}</span></div>`).join('')}</div><div class="rp-panel rp-notes"><span class="rp-lab">Notes</span></div>`;
      }
      body += '</section>';
    }
  const printBody = body + '</div>',
    footer = `Made with SlotForge Paddock · ${collection} · ${title} · ${day}`;
  body += `<footer>${esc(footer)}</footer></div>`;
  const footerTemplate = `<div style="font:8.5px Arial,sans-serif;width:100%;padding:0 12mm;color:#6b7684;display:flex;justify-content:space-between"><span>${esc(footer)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
  return {
    title,
    body,
    css: pdfCss(),
    footerTemplate,
    html: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(title)}</title><style>${pdfCss()}</style></head><body>${printBody}</body></html>`
  };
}
module.exports = { render, parseLink, link, qr };
