'use strict';
// Library > Custom fields: your own car fields, grouped by the car section that shows them.
// Add and Edit use the same small window as "Add option"; each field can move up or down
// within its section, and deleting one says first how many cars still hold a value.
let customFieldUsage = null;
async function loadCustomFieldUsage() {
  customFieldUsage = local() ? await api('plan', 'custom.usage') : null;
}
function customFieldCount(id) {
  const n = customFieldUsage?.counts?.[id];
  return n === undefined ? '' : n === 1 ? '1 car' : n + ' cars';
}
function renderCustomFieldLibrary() {
  const fields = db.customFields;
  const sections = CustomFields.SECTIONS.map(name => {
    const own = CustomFields.inSection(fields, name);
    const rows = own
      .map(
        (f, i) =>
          `<div class="list-row custom-field-row" data-key="${esc(f.id)}"><div><strong>${esc(f.label)}</strong><div class="tiny muted">${esc(CustomFields.TYPES[f.type] || f.type)}${customFieldCount(f.id) ? ' · ' + esc(customFieldCount(f.id)) : ''}</div></div><div class="actions">${iconBtn('up', 'Move ' + f.label + ' up', 'custom-up', 'outline', f.id, i === 0)}${iconBtn('down', 'Move ' + f.label + ' down', 'custom-down', 'outline', f.id, i === own.length - 1)}${btn(icon('edit') + ' Edit', 'custom-edit', 'small', f.id)}${binBtn('Delete ' + f.label, 'custom-delete', f.id)}</div></div>`
      )
      .join('');
    return uiPanel(name, rows || '<p class="tiny muted">No fields in this section yet.</p>', 'custom-field-section');
  }).join('');
  return (
    heading(
      'Library',
      'Your own car fields. Each one shows in the car section you choose, and on the Cars page as a column and a sort.',
      btn(icon('plus') + ' Add field', 'custom-add', 'primary')
    ) +
    libraryTabs() +
    `<div class="custom-field-library">${fields.length ? '' : empty('No custom fields yet', 'Add the details that matter to your collection, such as a club class, a chassis plate or a body weight.', btn(icon('plus') + ' Add field', 'custom-add', 'primary'))}${fields.length ? `<div class="custom-field-grid">${sections}</div>` : ''}<div class="note info mt">Custom fields are private: they stay out of car sharing, Dealership packages and car files, and are included in complete backups.</div></div>`
  );
}
function customFieldForm(f = null) {
  const sectionChoices = CustomFields.SECTIONS,
    types = Object.entries(CustomFields.TYPES);
  return `${field('label', 'Field name', f?.label || '')}${
    f
      ? `<label class="field">Field type<input value="${esc(CustomFields.TYPES[f.type] || f.type)}" disabled></label>`
      : `<label class="field">Field type<select name="type">${types.map(([k, label]) => `<option value="${k}">${esc(label)}</option>`).join('')}</select></label>`
  }${field('group', 'Show in', f ? CustomFields.section(f) : CustomFields.DEFAULT, 'select', sectionChoices)}${
    f ? '<p class="tiny muted wide">The type cannot change once cars may have values.</p>' : ''
  }`;
}
function addCustomField() {
  simpleForm(
    'Add a custom car field',
    customFieldForm(),
    async values => {
      await change('custom.add', { label: values.label, type: values.type, group: values.group });
      if (page === 'Library') await loadCustomFieldUsage();
    },
    'Add field'
  );
}
function editCustomField(id) {
  const f = db.customFields.find(x => x.id === id);
  if (!f) return;
  simpleForm('Edit ' + f.label, customFieldForm(f), async values => {
    await change('custom.edit', { id, label: values.label, group: values.group });
  });
}
async function deleteCustomField(id) {
  const f = db.customFields.find(x => x.id === id);
  if (!f) return;
  await loadCustomFieldUsage();
  const n = customFieldUsage?.counts?.[id] || 0,
    revision = customFieldUsage?.revision ?? db.revision;
  modal(
    'Delete ' + f.label,
    `<p>${
      n
        ? `<strong>${n === 1 ? '1 car has' : n + ' cars have'}</strong> a value in this field. Deleting it removes those values; each car's history keeps a note of the old value.`
        : 'No car has a value in this field.'
    }</p><p class="muted">The field also leaves your table columns, saved views and car overview.</p>`,
    async () => {
      await change('custom.delete', { id, revision, confirmed: true });
      await loadCustomFieldUsage();
    },
    'Delete field'
  );
}
async function customFieldAction(action, id) {
  switch (action) {
    case 'custom-library':
      page = 'Library';
      carId = null;
      libraryTab = 'fields';
      await loadCustomFieldUsage();
      render();
      return true;
    case 'custom-add':
      addCustomField();
      return true;
    case 'custom-edit':
      editCustomField(id);
      return true;
    case 'custom-up':
    case 'custom-down':
      await change('custom.move', { id, direction: action === 'custom-up' ? 'up' : 'down' });
      render();
      return true;
    case 'custom-delete':
      await deleteCustomField(id);
      return true;
  }
  return false;
}
