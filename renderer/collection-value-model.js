// Collection value: what the cars are worth now and what was spent on them per year.
// Shared by the main process (from the database) and the screen. Amounts stay in their own
// currency; nothing is converted or estimated.
(function (root) {
  'use strict';

  /**
   * Free-text money → number; anything unreadable → null. Paddock's own forms store a plain
   * dot decimal ("49.95"), so a single dot is always a decimal point. Other forms people type:
   * "49,95", "1 250", "1.250,00", "1,250.00", "1.250.000", "1,250" (thousands).
   */
  function amount(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
    if (typeof value !== 'string') return null;
    let s = value.trim().replace(/[\s ']/g, '');
    if (!s || !/^\d[\d.,]*$/.test(s)) return null;
    const dots = (s.match(/\./g) || []).length,
      commas = (s.match(/,/g) || []).length;
    if (dots && commas) {
      // Both: the last one is the decimal mark, the other groups thousands.
      const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
      s = s
        .split(decimal === '.' ? ',' : '.')
        .join('')
        .replace(decimal, '.');
    } else if (dots > 1 || commas > 1) {
      s = s.replace(/[.,]/g, ''); // "1.250.000": only grouping.
    } else if (commas === 1) {
      const [whole, part] = s.split(',');
      // "1,250" groups thousands; "49,95", "0,500" and "1,5" are decimals.
      s = part.length === 3 && whole !== '0' ? whole + part : `${whole}.${part}`;
    }
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  const SYMBOLS = { '€': 'EUR', '£': 'GBP', '$': 'USD', '¥': 'JPY' };
  /** "eur", "€" → "EUR"; empty stays empty (shown as "no currency"). */
  function currencyCode(value) {
    const s = String(value || '').trim();
    return (SYMBOLS[s] || s).toUpperCase().slice(0, 12);
  }

  const FIRST_YEAR = 1900;

  /** The purchase year, or null when missing or implausible (a typo like "0202" or "20245"). */
  function year(date, latest = new Date().getFullYear() + 1) {
    const m = /^(\d{4})-\d{2}(-\d{2})?/.exec(String(date || ''));
    const y = m ? Number(m[1]) : null;
    return y !== null && y >= FIRST_YEAR && y <= latest ? y : null;
  }

  /**
   * @param {Array<{price,currency,costs,valuation,acquired,archived,wishlist}>} cars
   * @returns {{currencies: Array, counts: object}} One entry per currency, most cars first.
   */
  function summarize(cars) {
    const byCurrency = new Map();
    const counts = { active: 0, valued: 0, priceOnly: 0, unknown: 0, unreadable: 0 };
    const entry = currency => {
      if (!byCurrency.has(currency))
        byCurrency.set(currency, { currency, value: 0, valuedCars: 0, spent: 0, boughtCars: 0, years: new Map() });
      return byCurrency.get(currency);
    };
    for (const car of cars) {
      if (car.wishlist) continue;
      const currency = currencyCode(car.currency);
      const price = amount(car.price),
        costs = amount(car.costs),
        valuation = amount(car.valuation);
      if (
        [car.price, car.costs, car.valuation].some(v => v !== undefined && v !== null && v !== '' && amount(v) === null)
      )
        counts.unreadable++;
      // What it is worth now: cars still in the collection, valuation first, else what was paid.
      if (!car.archived) {
        counts.active++;
        const worth = valuation ?? price;
        if (valuation !== null) counts.valued++;
        else if (price !== null) counts.priceOnly++;
        else counts.unknown++;
        if (worth !== null) {
          const e = entry(currency);
          e.value += worth;
          e.valuedCars++;
        }
      }
      // What was spent, in the year it was bought (sold cars included: the money was spent).
      const paid = price === null && costs === null ? null : (price || 0) + (costs || 0);
      if (paid !== null) {
        const e = entry(currency);
        e.spent += paid;
        e.boughtCars++;
        const y = year(car.acquired);
        if (y !== null) {
          const slot = e.years.get(y) || { year: y, spent: 0, cars: 0 };
          slot.spent += paid;
          slot.cars++;
          e.years.set(y, slot);
        }
      }
    }
    const currencies = [...byCurrency.values()]
      .map(e => {
        const known = [...e.years.values()].sort((a, b) => a.year - b.year);
        // Fill the gaps so every year between the first and last purchase has a bar.
        const years = [];
        if (known.length)
          for (let y = known[0].year; y <= known.at(-1).year; y++)
            years.push(e.years.get(y) || { year: y, spent: 0, cars: 0 });
        const round = n => Math.round(n * 100) / 100;
        return {
          currency: e.currency,
          value: round(e.value),
          valuedCars: e.valuedCars,
          spent: round(e.spent),
          boughtCars: e.boughtCars,
          undatedCars: e.boughtCars - known.reduce((n, y) => n + y.cars, 0),
          years: years.map(y => ({ ...y, spent: round(y.spent) }))
        };
      })
      .sort(
        (a, b) => b.valuedCars + b.boughtCars - (a.valuedCars + a.boughtCars) || a.currency.localeCompare(b.currency)
      );
    return { currencies, counts };
  }

  /** The fields summarize() needs from a full car record (merged-away cars are left out). */
  function fromCars(cars) {
    return (cars || [])
      .filter(c => !c.merge)
      .map(c => ({
        price: c.price,
        currency: c.currency,
        costs: c.costs,
        valuation: c.valuation,
        acquired: c.acquired,
        archived: !!c.archived,
        wishlist: c.collectionStatus === 'wishlist'
      }));
  }

  const api = { amount, currencyCode, year, summarize, fromCars };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CollectionValueModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
