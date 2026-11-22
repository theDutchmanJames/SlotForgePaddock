'use strict';
const CarSort = (() => {
  const fields = {
    name: 'Name',
    maker: 'Manufacturer',
    marque: 'Car brand',
    model: 'Model',
    scale: 'Scale',
    reference: 'Product reference',
    vehicleYear: 'Year of the real car',
    releaseYear: 'Release year',
    acquired: 'Purchase date',
    price: 'Purchase price',
    valuation: 'Current value',
    location: 'Storage location',
    created: 'Recently added',
    updated: 'Recently changed'
  };
  // How a field's values are ordered: as text, numbers, dates or yes/no.
  const kinds = {
    vehicleYear: 'number',
    releaseYear: 'number',
    price: 'number',
    valuation: 'number',
    acquired: 'date',
    created: 'date',
    updated: 'date'
  };
  const CUSTOM = /^custom_[\w-]{1,100}$/;
  const valid = key => typeof key === 'string' && (Object.hasOwn(fields, key) || CUSTOM.test(key)),
    direction = (key, value) =>
      ['asc', 'desc'].includes(value) ? value : ['created', 'updated'].includes(key) ? 'desc' : 'asc';
  const customKind = type => (['number', 'date', 'yesno'].includes(type) ? type : 'text');
  function kind(key, customFields = []) {
    if (CUSTOM.test(key)) return customKind(customFields.find(f => 'custom_' + f.id === key)?.type);
    return kinds[key] || 'text';
  }
  // Every sort the Cars page offers: the built-in fields, then each custom field.
  function options(customFields = []) {
    return [
      ...Object.entries(fields).map(([key, label]) => ({ key, label, kind: kind(key) })),
      ...customFields.map(f => ({ key: 'custom_' + f.id, label: f.label, kind: customKind(f.type), custom: true }))
    ];
  }
  // "€ 45,50", "1,234.5" and "45.5" all read as numbers; anything else has no number.
  function number(value) {
    let s = String(value ?? '').trim();
    if (!s) return null;
    if (s.includes(',') && !s.includes('.') && /,\d{1,2}$/.test(s)) s = s.replace(',', '.');
    s = s.replace(/,/g, '');
    const m = s.match(/-?\d+(?:\.\d+)?/);
    const n = m ? Number(m[0]) : NaN;
    return Number.isFinite(n) ? n : null;
  }
  function yesno(value) {
    const s = String(value ?? '')
      .trim()
      .toLowerCase();
    return s === 'yes' ? 0 : s === 'no' ? 1 : null;
  }
  // A comparable value, or null when the car has none (those always come last).
  function sortValue(value, k) {
    if (k === 'number') return number(value);
    if (k === 'yesno') return yesno(value);
    const s = String(value ?? '').trim();
    return s ? (k === 'date' ? s : s.toLowerCase()) : null;
  }
  const valueOf = (car, key) => (CUSTOM.test(key) ? car.custom?.[key.slice(7)] : car[key]);
  function compare(a, b, key, order, k = kind(key)) {
    const x = sortValue(valueOf(a, key), k),
      y = sortValue(valueOf(b, key), k);
    return (
      (x === null) - (y === null) ||
      (x === null ? 0 : (x < y ? -1 : x > y ? 1 : 0) * (direction(key, order) === 'desc' ? -1 : 1)) ||
      (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)
    );
  }
  function load() {
    try {
      const p = JSON.parse(localStorage.getItem('paddock-car-sort'));
      if (p && valid(p.sort)) return { sort: p.sort, sortDirection: direction(p.sort, p.sortDirection) };
    } catch {}
    return { sort: 'name', sortDirection: 'asc' };
  }
  function save(sort, sortDirection) {
    try {
      localStorage.setItem('paddock-car-sort', JSON.stringify({ sort, sortDirection }));
    } catch {}
  }
  return { fields, valid, direction, kind, options, number, yesno, sortValue, compare, load, save };
})();
if (typeof module === 'object') module.exports = CarSort;
