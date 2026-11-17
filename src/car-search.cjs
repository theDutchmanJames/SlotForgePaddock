'use strict';

function googleUrl(car) {
  if (!car || typeof car !== 'object' || Array.isArray(car)) throw Error('Open a car to search Google.');
  const text = key => {
    const value = car[key];
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string' || value.length > 2000) throw Error('Invalid car search field.');
    return value.trim().replace(/\s+/g, ' ');
  };
  const query = ['maker', 'marque', 'model', 'reference'].map(text).filter(Boolean).join(' ') || text('name');
  if (!query) throw Error('Add a car name or product details before searching Google.');
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', query);
  return url.href;
}

module.exports = { googleUrl };
