'use strict';
// Answers that stay true until the collection changes.
//
// Moving between pages, opening a part or typing in a search box asks the same questions of
// the catalogue again and again (its groups, its manufacturers, which parts match a filter),
// and each one scans every part. A reader is bound to one revision of one collection file;
// its token (database id, revision, change epoch) changes with every save, including saves
// by SlotForge Timing. So an answer worked out for a token can be reused for that token, and
// is dropped as soon as the token differs.
//
// Remembered values are shared between requests: treat them as read-only, or copy them.
const files = new Map(); // file → { token, values }
const MAX_FILES = 4,
  MAX_VALUES = 200;

/** The remembered answer to `name` for this reader's revision, worked out with `compute` if new. */
function remember(reader, name, compute) {
  if (!reader?.file || !reader.token) return compute();
  const token = JSON.stringify(reader.token);
  let slot = files.get(reader.file);
  if (!slot || slot.token !== token) {
    files.delete(reader.file);
    if (files.size >= MAX_FILES) files.delete(files.keys().next().value);
    slot = { token, values: new Map() };
    files.set(reader.file, slot);
  }
  if (slot.values.has(name)) {
    const value = slot.values.get(name);
    slot.values.delete(name); // Most recently used last.
    slot.values.set(name, value);
    return value;
  }
  const value = compute();
  if (slot.values.size >= MAX_VALUES) slot.values.delete(slot.values.keys().next().value);
  slot.values.set(name, value);
  return value;
}

function clear() {
  files.clear();
}

module.exports = { remember, clear };
