'use strict';
// Custom car field definitions: add, rename or move to another car section,
// reorder, and delete (which also removes the field's values from every car).
const { randomUUID } = require('node:crypto');
const CustomFields = require('../renderer/custom-fields.js');
const TYPES = Object.keys(CustomFields.TYPES);
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
function label(db, value, except) {
  check(typeof value === 'string' && value.trim(), 'Enter a field name.');
  const name = value.trim();
  check(name.length <= 160, 'A field name is at most 160 characters.');
  check(
    !db.customFields.some(f => f.id !== except && f.label.toLowerCase() === name.toLowerCase()),
    'That field already exists.'
  );
  return name;
}
function group(value) {
  if (value === undefined || value === '' || value === CustomFields.DEFAULT) return '';
  check(CustomFields.SECTIONS.includes(value), 'Choose a car section for this field.');
  return value;
}
function find(db, id) {
  const field = db.customFields.find(f => f.id === id);
  check(field, 'That custom field no longer exists.');
  return field;
}
function add(db, p) {
  check(TYPES.includes(p.type), 'Invalid field type.');
  check(db.customFields.length < 100, 'A collection can have up to 100 custom fields.');
  const field = { id: randomUUID(), label: label(db, p.label), type: p.type },
    section = group(p.group);
  if (section) field.group = section;
  db.customFields.push(field);
  return { id: field.id };
}
function edit(db, p) {
  const field = find(db, p.id);
  check(p.type === undefined || p.type === field.type, 'A field type cannot change once cars may have values.');
  field.label = label(db, p.label, field.id);
  if (p.group !== undefined) {
    const section = group(p.group);
    if (section) field.group = section;
    else if (Object.hasOwn(field, 'group')) field.group = '';
  }
  // The shared library uses the revision to notice edits made by another app.
  field.revision = (field.revision || 1) + 1;
  return { id: field.id };
}
// Up and down move a field past the next field shown in the same car section.
function move(db, p) {
  const field = find(db, p.id);
  check(['up', 'down'].includes(p.direction), 'Choose up or down.');
  const list = db.customFields,
    from = list.indexOf(field),
    section = CustomFields.section(field),
    step = p.direction === 'up' ? -1 : 1;
  let to = from + step;
  while (to >= 0 && to < list.length && CustomFields.section(list[to]) !== section) to += step;
  if (to < 0 || to >= list.length) return { id: field.id, moved: false };
  [list[from], list[to]] = [list[to], list[from]];
  return { id: field.id, moved: true };
}
// How many cars hold a value for each field (shown before deleting).
function usage(cars, id) {
  return cars.filter(c => String(c.custom?.[id] ?? '').trim()).length;
}
function remove(db, p) {
  check(db.revision === p.revision, 'The collection changed. Reopen this action and review the field again.');
  check(p.confirmed === true, 'Confirm deleting the field.');
  const field = find(db, p.id),
    key = 'custom_' + field.id,
    { journal } = require('./collection.cjs');
  let cleared = 0;
  for (const car of db.cars) {
    if (!car.custom || !Object.hasOwn(car.custom, field.id)) continue;
    const before = car.custom[field.id];
    delete car.custom[field.id];
    if (String(before ?? '').trim()) {
      cleared++;
      // Keep the old value in the car's history, so deleting a field loses nothing for good.
      journal(db, car, 'Custom field removed', field.label + ': ' + before, [{ key, before, after: '' }]);
    } else {
      car.revision++;
      car.updated = new Date().toISOString();
    }
  }
  db.customFields = db.customFields.filter(f => f !== field);
  const keep = columns => columns.filter(c => c !== key);
  db.settings.columns = keep(db.settings.columns);
  if (db.settings.overviewLayout?.details)
    db.settings.overviewLayout = { ...db.settings.overviewLayout, details: keep(db.settings.overviewLayout.details) };
  for (const view of db.views) {
    if (Array.isArray(view.columns)) view.columns = keep(view.columns);
    if (view.sort === key) {
      view.sort = 'name';
      view.sortDirection = 'asc';
    }
  }
  return { id: field.id, cleared };
}
function mutate(db, action, p) {
  if (action === 'custom.add') return add(db, p);
  if (action === 'custom.edit') return edit(db, p);
  if (action === 'custom.move') return move(db, p);
  if (action === 'custom.delete') return remove(db, p);
  throw Error('Unknown custom field operation.');
}
module.exports = { mutate, usage };
