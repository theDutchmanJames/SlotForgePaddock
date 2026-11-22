'use strict';
// Custom car fields: which car section shows them, and their type names.
// A field's `group` names its section. An empty or unknown group (for example one
// written by another app on the shared library) shows in Identity & ownership.
const CustomFields = (() => {
  const SECTIONS = ['Identity & ownership', 'Technical & parts', 'Real Car History', 'Maintenance', 'Performance'];
  const DEFAULT = SECTIONS[0];
  const TYPES = {
    text: 'Text',
    choice: 'Choice',
    number: 'Number',
    date: 'Date',
    yesno: 'Yes / no',
    notes: 'Notes'
  };
  const section = field => (SECTIONS.includes(field?.group) ? field.group : DEFAULT);
  const inSection = (fields, name) => (fields || []).filter(f => section(f) === name);
  return { SECTIONS, DEFAULT, TYPES, section, inSection };
})();
if (typeof module === 'object') module.exports = CustomFields;
