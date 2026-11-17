(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.FactorySpecs = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const present = value => typeof value === 'string' && value.trim() !== '';
  function preview(car, labels, installations = [], parts = []) {
    return Object.entries(labels).flatMap(([field, label]) => {
      const value = car.factory?.[field],
        current = car.technical?.[field] || '';
      if (!present(value) || value === current) return [];
      const returns = installations
        .filter(i => i.carId === car.id && !i.removed && i.field === field)
        .flatMap(i => {
          const name = parts.find(p => p.id === i.partId)?.name;
          return value === name
            ? []
            : [{ name: name || i.name || 'Installed part', quantity: i.quantity, assembly: !!i.assemblyId }];
        });
      return [{ field, label, value, current, returns, selected: !present(current) && !returns.length }];
    });
  }
  function patch(rows, fields) {
    if (!Array.isArray(fields) || !fields.length) throw Error('Select at least one Factory specification to apply.');
    const technical = {},
      stockOverrides = [];
    for (const field of new Set(fields)) {
      const row = rows.find(r => r.field === field);
      if (!row) throw Error('Invalid Factory specification selection.');
      technical[field] = row.value;
      if (row.returns.length) stockOverrides.push(field);
    }
    return { data: { technical }, ...(stockOverrides.length ? { stockOverrides } : {}) };
  }
  return { preview, patch };
});
