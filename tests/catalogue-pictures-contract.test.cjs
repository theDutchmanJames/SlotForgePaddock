'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const Ajv = require('ajv/dist/2020');
const C = require('../src/catalogue-pictures-contract.cjs');
const root = path.join(__dirname, 'fixtures/contracts/catalogue-pictures-v1');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name + '.json'), 'utf8'));
const copy = structuredClone;
const fail = (fn, code) => assert.throws(fn, error => error.code === code);
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/contracts/catalogue-pictures-v1/schema.json')));
const ajv = new Ajv({strict: false, allErrors: true});
ajv.addFormat('date-time', {type: 'string', validate: s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s});
ajv.addSchema(schema);
function independent(value, name) {
  const validate = ajv.compile({$ref: schema.$id + '#/$defs/' + name});
  assert.ok(validate(value), JSON.stringify(validate.errors));
}

test('published schema, limits and English prompt exactly match the inactive contract', () => {
  assert.deepEqual(C.schema, schema);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/contracts/catalogue-pictures-v1/limits.json'))), C.limits);
  assert.equal(fs.readFileSync(path.join(__dirname, '../docs/contracts/catalogue-pictures-v1/AI-INSTRUCTIONS.txt'), 'utf8'), C.instructions + '\n');
  assert.match(C.instructions, /English/); assert.match(C.instructions, /do not add products/i);
  assert.match(C.instructions, /optional/); assert.match(C.instructions, /Do not guess URLs/);
});
for (const [file, definition] of [['request', 'request'], ['response', 'response'], ['partial-response', 'response'], ['journal', 'journal'], ['active', 'identity'], ['intent', 'intent'], ['assembly-intent', 'intent'], ['current', 'current'], ['receipt', 'receipt']]) {
  test('independent JSON Schema validation: ' + file, () => {independent(read(file), definition); C.shape(read(file), definition);});
}
test('blank request and trusted journal are valid; duplicate SKUs have distinct row/record identities', () => {
  C.validateJournal(read('journal')); C.validateRequest(read('request'));
  const j = read('journal'); assert.equal(j.request.items[0].reference, j.request.items[1].reference);
  assert.notEqual(j.targets[0].recordId, j.targets[1].recordId);
});
test('return can omit instructions, reorder items and leave a picture unknown without changing product data', () => {
  const response = read('response'); response.items.reverse();
  assert.equal(C.validateResponse(response, read('journal'), read('active')).missing.length, 0);
  assert.deepEqual(C.parse(Buffer.from(JSON.stringify(response))), response);
  assert.equal(response.items[0].imageUrl, '');
});
test('unreturned rows are reported, including an entirely empty result, never treated as deletion', () => {
  assert.deepEqual(C.validateResponse(read('partial-response'), read('journal'), read('active')).missing, ['item-motor', 'item-motor-lot', 'item-unidentified']);
  const response = read('response'); response.items = [];
  assert.equal(C.validateResponse(response, read('journal'), read('active')).missing.length, 4);
});
test('invented product edits fail even when the JSON itself is structurally valid', () => {
  independent(read('invalid-product-edit'), 'response');
  fail(() => C.validateResponse(read('invalid-product-edit'), read('journal'), read('active')), 'PRODUCT_CHANGED');
});
for (const field of ['name', 'reference', 'category', 'partType', 'productPageUrl']) {
  test('AI cannot rewrite immutable ' + field, () => {
    const value = read('response'); value.items[0][field] = field === 'productPageUrl' ? 'https://example.invalid/changed' : 'changed';
    fail(() => C.validateResponse(value, read('journal'), read('active')), 'PRODUCT_CHANGED');
  });
}
for (const field of ['quantity', 'picture', 'tracking', 'recordId', 'specifications', 'location']) {
  test('AI cannot inject ' + field, () => {
    const value = read('response'); value.items[0][field] = 'not allowed';
    fail(() => C.validateResponse(value, read('journal'), read('active')), 'INVALID_FILE');
  });
}
test('request/database/recovery bindings are mandatory and are not matching-by-name fallbacks', () => {
  for (const key of ['requestId', 'databaseId', 'recoveryId']) {
    const response = read('response'); response[key] = 'different';
    fail(() => C.validateResponse(response, read('journal'), read('active')), 'REQUEST_MISMATCH');
  }
  fail(() => C.validateResponse(read('response'), read('journal'), {...read('active'), databaseId: 'other'}), 'DATABASE_MISMATCH');
  fail(() => C.validateResponse(read('response'), read('journal'), {...read('active'), recoveryId: 'other'}), 'RECOVERY_CHANGED');
});
test('unknown rows and duplicate row identifiers are rejected', () => {
  const value = read('response'); value.items[0].itemId = 'invented';
  fail(() => C.validateResponse(value, read('journal'), read('active')), 'UNKNOWN_ITEM');
  value.items[0].itemId = value.items[1].itemId;
  fail(() => C.validateResponse(value, read('journal'), read('active')), 'DUPLICATE_ITEM');
});
test('trusted journal requires complete unique targets and correct product fingerprints', () => {
  for (const change of [j => j.targets.pop(), j => j.targets[1].recordId = j.targets[0].recordId, j => j.targets[1].itemId = j.targets[0].itemId, j => j.targets[0].expected.productHash = 'f'.repeat(64), j => j.targets[0].kind = 'supply']) {
    const journal = read('journal'); change(journal); fail(() => C.validateJournal(journal), 'INVALID_JOURNAL');
  }
});
test('public file has no local target IDs, stock, baseline photo hashes or private user fields', () => {
  const j = read('journal'), text = JSON.stringify(j.request);
  for (const t of j.targets) assert.ok(!text.includes(t.recordId));
  for (const forbidden of ['pictureHash', 'quantity', 'location', 'tracking', 'price', 'installationHistory']) assert.ok(!Object.hasOwn(j.request.items[0], forbidden));
});
test('100-row and file-byte budgets are separate, Unicode-heavy requests split before export', () => {
  const r = read('request'); r.items = Array.from({length: 101}, (_, i) => ({...r.items[0], itemId: 'row-' + i}));
  fail(() => C.validateRequest(r), 'INVALID_FILE');
  r.items.pop(); C.validateRequest(r);
  r.manufacturer = '😀'.repeat(200); r.instructions = '😀'.repeat(12000);
  for (const [index, row] of r.items.entries()) {
    row.itemId = 'i'.repeat(96) + String(index).padStart(4, '0');
    row.manufacturer = r.manufacturer;
    for (const field of ['name', 'reference', 'category', 'partType']) row[field] = '😀'.repeat(200);
    row.productPageUrl = 'https://example.invalid/' + '😀'.repeat(4070);
  }
  fail(() => C.validateRequest(r), 'FILE_TOO_LARGE');
});
test('strict parsing rejects oversized bytes, duplicate keys, invalid UTF-8 and unsupported versions', () => {
  fail(() => C.parse(Buffer.alloc(C.limits.fileBytes + 1)), 'FILE_TOO_LARGE');
  fail(() => C.parse(Buffer.from('{"version":1,"version":2}')), 'INVALID_FILE');
  fail(() => C.parse(Buffer.from([255])), 'INVALID_FILE');
  const r = read('response'); r.version = 2; fail(() => C.parse(Buffer.from(JSON.stringify(r))), 'INVALID_FILE');
  fail(() => C.parse('{}'), 'INVALID_FILE');
});
for (const url of ['file:///C:/secret.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)', '//example.invalid/a.png', 'https://user:password@example.invalid/a.png', 'https://example.invalid:9000/a.png', 'https://example.invalid/a.png#x', 'https://example.invalid/a b.png', 'https://example.invalid/\nimage.png', 'https:\\example.invalid/a.png']) {
  test('URL syntax rejects ' + JSON.stringify(url), () => fail(() => C.link(url), 'INVALID_URL'));
}
test('URL syntax validation is not network admission: private destinations still require Phase 4 address checks', () => {
  // Prevent future callers from mistaking this pure check for SSRF protection.
  C.link('http://127.0.0.1/a.png'); C.link('https://example.invalid/a.png?token=temporary');
  for (const invalid of [null, undefined, 0, {}, 'https://example.invalid/' + 'x'.repeat(4096)]) fail(() => C.link(invalid), 'INVALID_URL');
});
for (const scenario of read('scenarios')) {
  test('optimistic picture baseline: ' + scenario.name, () => assert.equal(C.compareTarget(read('intent'), scenario.actual), scenario.expected));
}
test('existing-photo replacement requires explicit selection; manual assembly pictures have no AI provenance', () => {
  const intent = read('intent'); intent.expected.pictureHash = 'a'.repeat(64);
  fail(() => C.validateIntent(intent), 'REPLACEMENT_REQUIRED'); intent.replaceExisting = true; C.validateIntent(intent);
  const a = read('assembly-intent'); C.validateIntent(a); a.provenance = intent.provenance;
  fail(() => C.validateIntent(a), 'INVALID_INTENT');
});
test('removal has no asset or provenance and cannot mutate unrelated fields', () => {
  const r = read('assembly-intent'); delete r.assetHash; delete r.replaceExisting; delete r.provenance; r.action = 'remove'; C.validateIntent(r);
  r.quantity = 3; fail(() => C.validateIntent(r), 'INVALID_FILE');
});
test('original-byte and storage-asset digests must be distinguished', () => {
  const bytes = Buffer.from([255,216,255,224]);
  const original = require('../src/photo-import.cjs').originalPhoto(bytes);
  assert.notEqual(crypto.createHash('sha256').update(bytes).digest('hex'), require('../src/lazy-assets.cjs').digest(original));
});
test('source byte budget respects existing encoded-photo limit including the MIME prefix', () => {
  const {originalPhoto} = require('../src/photo-import.cjs');
  const bytes = Buffer.alloc(C.limits.sourcePhotoBytes); bytes.set([255,216,255]);
  assert.ok(originalPhoto(bytes).length <= C.limits.encodedPhotoBytes);
  assert.throws(() => originalPhoto(Buffer.concat([bytes, Buffer.from([0])])), e => e.code === 'PHOTO_TOO_LARGE');
  assert.equal(C.limits.decodeConcurrency, 1); assert.equal(C.limits.downloadConcurrency, 2);
});
test('validation does not change request, response or intent objects', () => {
  const j = read('journal'), r = read('response'), a = read('active'), i = read('intent'), c = read('current');
  const before = copy({j,r,a,i,c}); C.validateResponse(r,j,a); C.compareTarget(i,c);
  assert.deepEqual({j,r,a,i,c}, before);
});
test('response byte budget also applies to validated object callers, not only raw file parsing', () => {
  const journal = read('journal');
  journal.request.items = Array.from({length: 100}, (_, i) => ({...journal.request.items[0], itemId: 'row-' + i}));
  journal.targets = journal.request.items.map((row,i) => ({itemId: row.itemId, kind: row.kind, recordId: 'record-' + i, expected: {revision: 10, productHash: C.productHash(row), pictureHash: null}}));
  const response = copy(journal.request);
  for (const row of response.items) {row.imageUrl = 'https://example.invalid/' + '😀'.repeat(4000); row.imagePageUrl = row.imageUrl;}
  fail(() => C.validateResponse(response, journal, read('active')), 'FILE_TOO_LARGE');
});
test('bad current revision evidence and missing product baselines cannot be treated as ready', () => {
  fail(() => C.compareTarget(read('intent'), {...read('current'), pictureVersion: 13}), 'INVALID_CURRENT');
  fail(() => C.compareTarget(read('intent'), {...read('current'), fieldFloor: 13}), 'INVALID_CURRENT');
  const intent = read('intent'); intent.expected.productHash = null;
  fail(() => C.validateIntent(intent), 'INVALID_INTENT');
});
test('timestamps, whitespace-only manufacturers and a mixed-brand request are rejected', () => {
  const r = read('request'); r.createdAt = '2026-02-30T12:00:00.000Z'; fail(() => C.validateRequest(r), 'INVALID_FILE');
  r.createdAt = '2026-11-13T12:00:00.000Z'; r.manufacturer = '   '; fail(() => C.validateRequest(r), 'INVALID_FILE');
  r.manufacturer = 'Other Brand'; fail(() => C.validateRequest(r), 'INVALID_FILE');
});
test('fixture receipt fingerprint is independently reproducible and binds the exact intended change', () => {
  const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  const intent = read('intent');
  const hash = crypto.createHash('sha256').update(canonical(intent)).digest('hex');
  assert.equal(hash, read('receipt').requestHash);
  const modified = copy(intent); modified.assetHash = 'f'.repeat(64);
  assert.notEqual(C.digest(modified), hash);
});
