'use strict';
// Deterministic documentation/fixture export. Never opens a user library.
const fs = require('node:fs'), path = require('node:path');
const C = require('../src/catalogue-pictures-contract.cjs');
const root = path.resolve(__dirname, '..');
function json(relative, value) {
  const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
const folder = 'tests/fixtures/contracts/catalogue-pictures-v1/';
json('docs/contracts/catalogue-pictures-v1/schema.json', C.schema);
json('docs/contracts/catalogue-pictures-v1/limits.json', C.limits);
fs.writeFileSync(path.join(root, 'docs/contracts/catalogue-pictures-v1/AI-INSTRUCTIONS.txt'), C.instructions + '\n');
const product = (itemId, kind, name, reference, category, partType) => ({itemId, kind, name, manufacturer: 'Example Racing', reference, category, partType, productPageUrl: '', imageUrl: '', imagePageUrl: '', notes: ''});
const request = {
  format: 'slotforge-catalogue-images', version: 1, requestId: 'picture-request-example-1', databaseId: 'example-library', recoveryId: 'example-recovery-1', manufacturer: 'Example Racing', createdAt: '2026-11-13T12:00:00.000Z', instructions: C.instructions,
  items: [
    product('item-motor', 'part', 'Example motor', 'M-01', 'Motors & motor parts', 'Motor'),
    product('item-motor-lot', 'part', 'Example motor', 'M-01', 'Motors & motor parts', 'Motor'),
    product('item-oil', 'supply', 'Example bearing oil', 'OIL-01', 'Cleaning & lubrication', 'Bearing oil'),
    product('item-unidentified', 'part', 'Example axle', '', 'Axles & bearings', 'Axle')
  ]
};
const journal = {version: 1, request, targets: request.items.map((row, i) => ({itemId: row.itemId, kind: row.kind, recordId: 'record-' + i, expected: {revision: 10, productHash: C.productHash(row), pictureHash: i === 1 ? 'a'.repeat(64) : null}}))};
const response = structuredClone(request); delete response.instructions;
for (let i = 0; i < 3; i++) {
  response.items[i].imageUrl = 'https://images.example.invalid/' + (i < 2 ? 'M-01.png' : 'OIL-01.webp');
  response.items[i].imagePageUrl = 'https://example.invalid/products/' + response.items[i].reference;
}
response.items[3].notes = 'No reliable exact match without a product reference; picture intentionally left empty.';
const active = {databaseId: request.databaseId, recoveryId: request.recoveryId};
const intent = {...active, version: 1, operationId: 'picture-operation-1', kind: 'part', recordId: 'record-0', expected: journal.targets[0].expected, action: 'set', assetHash: 'b'.repeat(64), replaceExisting: false, provenance: {requestId: request.requestId, itemId: 'item-motor', imageUrl: response.items[0].imageUrl, imagePageUrl: response.items[0].imagePageUrl, downloadedAt: '2026-11-13T12:05:00.000Z', sourceBytesHash: 'c'.repeat(64)}};
const current = {...active, kind: 'part', recordId: 'record-0', revision: 12, fieldFloor: 0, pictureVersion: 0, productHash: intent.expected.productHash, pictureHash: null};
const partial = structuredClone(response); partial.items = [partial.items[2]];
const changed = structuredClone(response); changed.items[0].reference = 'M-02';
const assembly = {...intent, operationId: 'assembly-picture-operation-1', kind: 'assembly', recordId: 'assembly-1', expected: {revision: 10, productHash: null, pictureHash: null}, provenance: null};
const receipt = {...active, version: 1, operationId: intent.operationId, requestHash: C.digest(intent), kind: intent.kind, recordId: intent.recordId, status: 'applied', pictureHash: intent.assetHash, revision: 13, duplicate: false};
const scenarios = [
  {name: 'unrelated stock revision', actual: current, expected: 'READY'},
  {name: 'another photo now exists', actual: {...current, pictureHash: 'd'.repeat(64), pictureVersion: 11}, expected: 'PICTURE_CHANGED'},
  {name: 'photo added then removed (ABA)', actual: {...current, pictureVersion: 12}, expected: 'PICTURE_CHANGED'},
  {name: 'product reference changed', actual: {...current, productHash: 'e'.repeat(64)}, expected: 'PRODUCT_CHANGED'},
  {name: 'history floor advanced', actual: {...current, fieldFloor: 11}, expected: 'BASELINE_EXPIRED'},
  {name: 'same identity but older state', actual: {...current, revision: 9}, expected: 'BASELINE_EXPIRED'},
  {name: 'database restored', actual: {...current, recoveryId: 'example-recovery-2'}, expected: 'RECOVERY_CHANGED'},
  {name: 'different library', actual: {...current, databaseId: 'another-library'}, expected: 'DATABASE_MISMATCH'},
  {name: 'duplicate lot is not the target', actual: {...current, recordId: 'record-1'}, expected: 'TARGET_MISMATCH'},
  {name: 'target removed', actual: null, expected: 'TARGET_MISSING'}
];
for (const [name, value] of Object.entries({request, response, journal, active, intent, current, 'partial-response': partial, 'invalid-product-edit': changed, 'assembly-intent': assembly, receipt, scenarios})) json(folder + name + '.json', value);
console.log('Exported catalogue-pictures v1 contract and synthetic fixtures.');
