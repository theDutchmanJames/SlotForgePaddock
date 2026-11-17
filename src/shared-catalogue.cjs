'use strict';
// One snapshot and one IPC reply for a bounded overview. No photo bodies or galleries.
const Q = require('./sqlite-query.cjs'),
  C = require('./shared-car-library.cjs'),
  T = require('./timing-integration.cjs');
function read(store, options, input = {}) {
  if (
    Object.keys(input).some(k => !['search', 'limit', 'offset', 'token'].includes(k)) ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 48 ||
    (input.offset && !input.token)
  )
    throw Error('Invalid overview page.');
  return Q.read(store, input.token, r => {
    const page = r.list('cars', {
      collectionStatus: 'collection',
      offset: input.offset || 0,
      limit: input.limit,
      query: input.search || '',
      sort: 'name',
      archived: false
    });
    const definitions = store.data.customFields;
    const cars = page.rows.map(car => {
      const binding = require('./car-merge-settings-store.cjs').load(r, {
        carId: car.id,
        sourceId: options.installationId
      }).value;
      const extra = r.record(
        JSON.stringify([
          'libraryExtras',
          'id:extra-' + T.digest(['timing.carExtras', options.installationId, binding.localCarId])
        ])
      );
      const original = extra ? require('./shared-library-evidence.cjs').summary(extra) : {};
      const service = require('./shared-library-service.cjs').project(r, car);
      return {
        ...C.project(car),
        binding,
        original,
        custom: car.custom || {},
        service,
        hasPicture: !!(require('./lazy-assets.cjs').property(car, 'picture') || car.picture),
        galleryCount: car.photos?.length || 0
      };
    });
    return { cars, definitions, total: page.total, nextOffset: page.nextOffset, token: r.token };
  }).value;
}
module.exports = { read };
