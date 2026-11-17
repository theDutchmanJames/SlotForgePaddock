'use strict';
// File format v2 carries membership. Keep the existing reviewed-package storage
// format readable by qualified Timing engines; membership is review provenance,
// never a selectable field or a request to purchase an existing car.
function wishlistIds(sub) {
  const value = sub.wishlistImport;
  if (value === undefined) return [];
  const fail = () => {
    throw Error('Invalid Wishlist import membership.');
  };
  if (
    !value ||
    value.version !== 1 ||
    sub.localTransfer ||
    !Array.isArray(value.carIds) ||
    !value.carIds.length ||
    value.carIds.length > 1000 ||
    new Set(value.carIds).size !== value.carIds.length
  )
    fail();
  for (const id of value.carIds) if (typeof id !== 'string' || !sub.package.cars.some(c => c.id === id)) fail();
  return value.carIds;
}
function status(sub, id) {
  return wishlistIds(sub).includes(id) ? 'wishlist' : 'collection';
}
function write(db, ids, options = {}) {
  const { makePackage } = require('./store.cjs');
  const pack = makePackage(db, ids, {
    photos: options.photos === true,
    setups: options.setups === true,
    allowWishlist: true
  });
  const wishes = new Set(db.cars.filter(c => c.collectionStatus === 'wishlist').map(c => c.id));
  if (!ids.some(id => wishes.has(id))) return pack;
  return {
    ...pack,
    version: 2,
    cars: pack.cars.map(c => ({ ...c, collectionStatus: wishes.has(c.id) ? 'wishlist' : 'collection' }))
  };
}
function read(input) {
  const { validatePackage } = require('./store.cjs');
  if (input?.format !== 'slotforge-car-package' || input.version !== 2) return { package: validatePackage(input) };
  if (!Array.isArray(input.cars) || !input.cars.length || input.cars.length > 1000) throw Error('Invalid car count.');
  const carIds = [];
  const cars = input.cars.map(c => {
    if (!c || !['collection', 'wishlist'].includes(c.collectionStatus))
      throw Error('Each car in this file must belong to My Cars or Wishlist.');
    if (c.collectionStatus === 'wishlist') carIds.push(c.id);
    const { collectionStatus, ...fields } = c;
    return fields;
  });
  const result = {
    package: validatePackage({ ...input, version: 1, cars }),
    ...(carIds.length ? { wishlistImport: { version: 1, carIds } } : {})
  };
  wishlistIds(result);
  return result;
}
module.exports = { read, write, wishlistIds, status };
