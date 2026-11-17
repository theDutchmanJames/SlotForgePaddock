'use strict';
const { TEXT_FIELDS, TECH_FIELDS } = require('./store.cjs');
const history = require('./real-history.cjs');
const identity = new Set([
  'name',
  'number',
  'maker',
  'reference',
  'marque',
  'model',
  'scale',
  'vehicleYear',
  'releaseYear',
  'livery',
  'colours',
  'raceNumber',
  'team',
  'drivers',
  'event',
  'edition',
  'serial',
  'origin',
  'category',
  'raceClass',
  'description'
]);
const dates = new Set(['acquired', 'valuationDate', 'loanDate', 'returnDate', 'disposalDate']);
const amounts = new Set(['price', 'costs', 'valuation', 'salePrice']);
const labels = {
  name: 'Display name',
  number: 'Collection number',
  maker: 'Manufacturer',
  reference: 'Product reference',
  marque: 'Brand / marque',
  model: 'Model',
  acquired: 'Purchase / acquisition date',
  price: 'Purchase price',
  costs: 'Additional costs',
  raceClass: 'Racing class',
  ratedRpm: 'Rated no-load RPM',
  ratedVoltage: 'Rated voltage (V)',
  motorTorque: 'Motor torque (gf·cm)',
  torqueVoltage: 'Torque rated at (V)',
  pod: 'Motor pod',
  podSettings: 'Motor pod settings',
  pinion: 'Pinion teeth',
  gear: 'Driven gear teeth',
  pinionPart: 'Pinion component',
  gearPart: 'Driven gear component',
  frontDiameter: 'Front tyre diameter (mm)',
  rearDiameter: 'Rear tyre diameter (mm)',
  frontWidth: 'Front track width (mm)',
  rearWidth: 'Rear track width (mm)',
  weight: 'Total weight (g)',
  clearance: 'Ground clearance (mm)',
  wheelbase: 'Wheelbase (mm)',
  lights: 'Lighting',
  chip: 'Decoder',
  history: 'Historical description',
  year: 'Race year',
  finish: 'Finishing position'
};
const label = k => labels[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
function fields(customFields = []) {
  const list = TEXT_FIELDS.map(key => ({
    id: key,
    label: label(key),
    group: identity.has(key) ? 'Identity' : 'Collection & ownership',
    type: dates.has(key) ? 'date' : amounts.has(key) ? 'number' : 'text',
    max: key === 'name' ? 200 : 20000
  }));
  for (const prefix of ['technical', 'factory'])
    for (const key of TECH_FIELDS)
      list.push({
        id: prefix + '.' + key,
        label: label(key),
        group: prefix === 'factory' ? 'Factory specifications' : 'Current specifications',
        type: key === 'measuredDate' ? 'date' : 'text',
        max: 20000
      });
  for (const key of history.fields)
    list.push({
      id: 'realHistory.' + key,
      label: label(key),
      group: 'Real Car History',
      type: 'text',
      max: key === 'history' ? 20000 : 500
    });
  list.push({
    id: 'realHistory.classification',
    label: 'Livery classification',
    group: 'Real Car History',
    type: 'choice',
    choices: history.classifications,
    max: 100
  });
  for (const id of ['usage', 'tags'])
    list.push({ id, label: id === 'usage' ? 'Usage labels' : 'Tags', group: 'Labels', type: 'labels', max: 20000 });
  for (const f of customFields)
    list.push({
      id: 'custom.' + f.id,
      label: f.label,
      group: 'Custom fields',
      type: f.type === 'yesno' ? 'yesno' : f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text',
      max: 20000
    });
  return list;
}
const normal = s =>
  String(s)
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ');
const aliases = {
  manufacturer: 'maker',
  'slotcar manufacturer': 'maker',
  'slot car manufacturer': 'maker',
  brand: 'marque',
  make: 'marque',
  'car brand': 'marque',
  sku: 'reference',
  ref: 'reference',
  'product code': 'reference',
  'catalogue number': 'reference',
  'catalog number': 'reference',
  car: 'name',
  'car name': 'name',
  title: 'name',
  paid: 'price',
  'purchase date': 'acquired',
  'bought': 'acquired',
  notes: 'description',
  'storage': 'location',
  'storage location': 'location',
  'collection no': 'number',
  'purchase cost': 'price',
  'racing class': 'raceClass',
  'usage labels': 'usage'
};
function suggest(headers, available) {
  const matches = new Map();
  const add = (s, id) => {
    const n = normal(s),
      a = matches.get(n) || new Set();
    a.add(id);
    matches.set(n, a);
  };
  for (const f of available) {
    add(f.id, f.id);
    add(f.label, f.id);
    add(f.group + ' ' + f.label, f.id);
    if (f.id.startsWith('factory.')) add('factory ' + f.label, f.id);
    if (f.id.startsWith('technical.')) add('current ' + f.label, f.id);
  }
  const allowed = new Set(available.map(f => f.id)),
    used = new Set();
  return headers.map(header => {
    const n = normal(header),
      candidates = matches.get(n),
      id = aliases[n] || (candidates?.size === 1 ? [...candidates][0] : '');
    if (!id || !allowed.has(id) || used.has(id)) return '';
    used.add(id);
    return id;
  });
}
function date(value, order) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw Error('Invalid calendar date');
    return value;
  }
  const m = /^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})$/.exec(value);
  if (!m) throw Error('Use a calendar date (for example 2026-11-15)');
  let y, month, day;
  if (m[1].length === 4) [y, month, day] = m.slice(1);
  else {
    if (!['dmy', 'mdy'].includes(order)) throw Error('Choose day/month/year or month/day/year for text dates');
    [day, month] = order === 'dmy' ? [m[1], m[2]] : [m[2], m[1]];
    y = m[3];
  }
  if (y.length !== 4) throw Error('Use a four-digit year');
  return date(y + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0'));
}
function convert(cell, field, options) {
  if (cell.issue) throw Error(cell.issue);
  const text = String(cell.text ?? '').trim();
  if (!text) return undefined;
  if (text.length > field.max) throw Error('Value exceeds ' + field.max + ' characters');
  if (field.type === 'date') return date(cell.date || text, options.dateOrder);
  if (field.type === 'number') {
    if (typeof cell.number === 'number') return String(cell.number);
    const comma = options.decimal === ',',
      pattern = comma
        ? /^[+-]?(?:\d+|\d{1,3}(?:[. ]\d{3})+)(?:,\d+)?$/
        : /^[+-]?(?:\d+|\d{1,3}(?:[, ]\d{3})+)(?:\.\d+)?$/;
    if (!pattern.test(text)) throw Error('Check the number and decimal separator; map currency separately');
    const number = Number(comma ? text.replace(/[. ]/g, '').replace(',', '.') : text.replace(/[, ]/g, ''));
    if (!Number.isFinite(number)) throw Error('Invalid number');
    return String(number);
  }
  if (field.type === 'yesno') {
    if (/^(yes|true|1)$/i.test(text)) return 'Yes';
    if (/^(no|false|0)$/i.test(text)) return 'No';
    throw Error('Use Yes or No');
  }
  if (field.type === 'choice') {
    const choice = field.choices.find(c => c.toLowerCase() === text.toLowerCase());
    if (!choice) throw Error('Choose ' + field.choices.join(', '));
    return choice;
  }
  if (field.type === 'labels') {
    const parts = [
      ...new Set(
        text
          .split(options.labelSeparator || ',')
          .map(s => s.trim())
          .filter(Boolean)
      )
    ];
    if (parts.length > 100 || parts.some(s => s.length > 160))
      throw Error('Too many labels or a label exceeds 160 characters');
    return parts;
  }
  return text;
}
function mapRows(sheet, config, available) {
  if (!Number.isInteger(config.header) || config.header < 1 || config.header > sheet.rows.length)
    throw Error('Choose the header row');
  const width = Math.max(...sheet.rows.map(r => r.length), 0),
    mapping = config.mapping;
  if (!Array.isArray(mapping) || mapping.length !== width) throw Error('Map each spreadsheet column');
  const byId = new Map(available.map(f => [f.id, f])),
    used = new Set();
  for (const id of mapping) {
    if (!id) continue;
    if (!byId.has(id)) throw Error('A mapped field no longer exists');
    if (used.has(id)) throw Error('Two columns target ' + byId.get(id).label);
    used.add(id);
  }
  if (!used.has('name')) throw Error('Map one column to Identity → Display name');
  if (
    !['', 'dmy', 'mdy', 'ymd'].includes(config.dateOrder || '') ||
    !['.', ','].includes(config.decimal || '.') ||
    !['', ',', ';', '|'].includes(config.labelSeparator || ',')
  )
    throw Error('Invalid import formats');
  const rows = [];
  for (let index = config.header; index < sheet.rows.length; index++) {
    const source = sheet.rows[index];
    if (!source.some(c => String(c.text ?? '').trim() || c.issue)) continue;
    const data = {},
      errors = [];
    mapping.forEach((id, col) => {
      if (!id) return;
      const field = byId.get(id);
      try {
        const value = convert(source[col] || { text: '' }, field, config);
        if (value === undefined) return;
        const [group, key] = id.split('.');
        if (key) (data[group] ??= {})[key] = value;
        else data[id] = value;
      } catch (e) {
        errors.push(field.group + ' → ' + field.label + ': ' + e.message);
      }
    });
    if (!data.name) errors.push('Display name is required');
    rows.push({ row: index + 1, data, errors });
  }
  if (!rows.length) throw Error('There are no car rows below this header');
  return rows;
}
module.exports = { fields, suggest, mapRows, normal, date };
