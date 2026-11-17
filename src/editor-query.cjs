'use strict';
// Editor identities are typed; a part ID is never searched through car history.
const groups = {
  cars: [
    'factory-specs',
    'edit-car',
    'main-photo',
    'add-photo',
    'photo-focus',
    'viewer-photo-focus',
    'add-test',
    'attach-document'
  ],
  parts: ['edit-part', 'part-appearance', 'delete-part', 'receive-stock', 'install-stock'],
  supplies: ['edit-supply', 'archive-supply', 'delete-supply'],
  jobs: ['edit-job', 'open-job', 'job-plan', 'job-note', 'job-photo'],
  setups: ['compare-setup', 'apply-setup'],
  tests: ['test-snapshot'],
  documents: ['guide-edit', 'guide-remove', 'remove-document'],
  assemblies: ['assembly-photo', 'install-assembly', 'remove-assembly', 'replace-assembly', 'dismantle-assembly']
};
const bucket = action => Object.keys(groups).find(k => groups[k].includes(action));
const focused = action =>
  [
    'factory-specs',
    'add-part',
    'edit-part',
    'part-appearance',
    'add-supply',
    'edit-supply',
    'archive-supply',
    'delete-supply',
    'edit-job',
    'job-plan',
    'job-note',
    'shop-new-list',
    'shop-rename-list',
    'add-car',
    'edit-car',
    'main-photo',
    'add-photo',
    'delete-photo',
    'photo-focus',
    'viewer-photo-focus',
    'add-test',
    'attach-document',
    'remove-document',
    'guide-add',
    'guide-edit',
    'guide-remove'
  ].includes(action);
function suggestions(r, section) {
  const fields =
    section === 'parts'
      ? ['name', 'maker', 'location', 'material', 'partType', 'category']
      : ['maker', 'location', 'partType'];
  const rows = r.db
    .prepare(
      `SELECT f.path,f.json FROM record_fields f JOIN records r ON r.key=f.record WHERE r.bucket=? AND f.path IN (SELECT value FROM json_each(?)) GROUP BY f.path,f.json ORDER BY f.path,f.json`
    )
    .all(JSON.stringify([section]), JSON.stringify(fields.map(k => JSON.stringify([k]))));
  const result = Object.fromEntries(fields.map(k => [k, []]));
  for (const row of rows) {
    const value = JSON.parse(row.json);
    if (typeof value === 'string' && value) result[JSON.parse(row.path)[0]].push(value);
  }
  // Preserve category-specific custom part types without reading whole parts.
  if (section === 'parts')
    result.typesByCategory = r.db
      .prepare(
        `SELECT DISTINCT json_extract(c.json,'$') category,json_extract(t.json,'$') partType FROM records r JOIN record_fields c ON c.record=r.key AND c.path='["category"]' JOIN record_fields t ON t.record=r.key AND t.path='["partType"]' WHERE r.bucket='["parts"]' AND t.json<>'""' ORDER BY category,partType`
      )
      .all();
  return result;
}
function relatedPlanning(r, section, field, ids) {
  if (!ids.length) return [];
  return r.db
    .prepare(
      `SELECT r.key FROM records r JOIN record_fields f ON f.record=r.key WHERE r.bucket=? AND f.path=? AND json_extract(f.json,'$') IN (SELECT value FROM json_each(?)) ORDER BY CAST(substr(r.identity,7) AS INTEGER)`
    )
    .all(JSON.stringify(['planning', section]), JSON.stringify([field]), JSON.stringify(ids))
    .map(row => r.record(row.key, { assetHandle: true }));
}
function customChoices(r, definitions) {
  const ids = definitions.filter(f => f.type === 'choice').map(f => f.id);
  if (!ids.length) return {};
  const rows = r.db
    .prepare(
      `SELECT f.path,f.json FROM records r JOIN record_fields f ON f.record=r.key WHERE r.bucket='["cars"]' AND f.path IN (SELECT value FROM json_each(?)) GROUP BY f.path,f.json ORDER BY f.path,f.json`
    )
    .all(JSON.stringify(ids.map(id => JSON.stringify(['custom', id]))));
  const result = {};
  for (const row of rows) {
    const id = JSON.parse(row.path)[1],
      value = JSON.parse(row.json);
    if (typeof value === 'string' && value) (result[id] ??= []).push(value);
  }
  return result;
}
module.exports = { bucket, focused, suggestions, relatedPlanning, customChoices };
