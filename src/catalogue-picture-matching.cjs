'use strict';
const C = require('./catalogue-pictures-contract.cjs'),
  P = require('./catalogue-picture-requests.cjs');
// Existing local AI responses retain strict context/restore validation. Shared
// responses are rebound once to local targets, then use those same protections.
async function resolve(previews, source, pending) {
  const active = previews.activeIdentity();
  if (source.databaseId === active.databaseId) {
    if (source.recoveryId !== active.recoveryId)
      throw Object.assign(Error('The library was restored. Create a new picture request.'), {
        code: 'RECOVERY_CHANGED'
      });
    try {
      return { response: source, descriptor: previews.journal.get(source.requestId, active), notices: [] };
    } catch (error) {
      if (error.code !== 'REQUEST_NOT_FOUND') throw error;
    }
  }
  // Canonical content makes identical reimports reuse their previews and receipts.
  // Do not include the recovery generation: old saved targets must fail after restore.
  const { instructions, ...content } = source,
    id = 'shared-' + C.digest({ databaseId: active.databaseId, source: content });
  let descriptor = pending.get(id),
    notices = [];
  if (!descriptor)
    try {
      descriptor = previews.journal.get(id, active);
    } catch (error) {
      if (error.code !== 'REQUEST_NOT_FOUND') throw error;
    }
  if (!descriptor) {
    const result = await previews.read(previews.getStore().file, 'matchPictures', {
      expected: active,
      response: source,
      requestId: id
    });
    P.identity(previews.activeIdentity(), result.active);
    descriptor = result.descriptor;
    notices = result.notices;
  }
  if (!descriptor) return { response: null, descriptor: null, notices };
  const byId = new Map(source.items.map(row => [row.itemId, row]));
  const response = {
    ...descriptor.request,
    items: descriptor.request.items.map(row => {
      const original = byId.get(row.itemId);
      if (!original) throw Error('The shared picture file no longer matches its saved mapping.');
      return { ...row, imageUrl: original.imageUrl, imagePageUrl: original.imagePageUrl, notes: original.notes };
    })
  };
  if (!notices.length) {
    const included = new Set(response.items.map(row => row.itemId));
    notices = source.items
      .filter(row => !included.has(row.itemId))
      .map(
        row =>
          `${row.name} (${row.reference || 'no reference'}): skipped — no unique manufacturer/reference match in this saved import.`
      );
  }
  C.validateResponse(response, descriptor, { databaseId: active.databaseId, recoveryId: active.recoveryId });
  return { response, descriptor, notices };
}
module.exports = { resolve };
