'use strict';
const currencies = ['EUR', 'USD', 'GBP'];
function currency(value) {
  if (!currencies.includes(value)) throw Error('Choose EUR, USD or GBP for catalogue prices.');
  return value;
}
function validate(input, errors) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push('Price must be an object.');
    return null;
  }
  const p = { amount: input.amount, currency: input.currency, status: input.status, basis: input.basis };
  if (typeof p.amount !== 'number' || !Number.isFinite(p.amount) || p.amount < 0 || p.amount > 1000000)
    errors.push('Price amount must be a number between 0 and 1,000,000.');
  if (!currencies.includes(p.currency)) errors.push('Price currency must be EUR, USD or GBP.');
  if (!['published', 'estimate'].includes(p.status)) errors.push('Price status must be published or estimate.');
  if (!['pack', 'piece', 'item'].includes(p.basis)) errors.push('Price basis must be pack, piece or item.');
  for (const [key, max] of [
    ['explanation', 2000],
    ['sourceUrl', 2048],
    ['checkedDate', 10]
  ]) {
    const v = input[key] ?? '';
    if (typeof v !== 'string' || v.length > max) {
      errors.push('Price ' + key + ' must be text of at most ' + max + ' characters.');
      p[key] = '';
    } else p[key] = v.trim();
  }
  if (p.status === 'estimate' && !p.explanation) errors.push('Estimated prices need an explanation of the estimate.');
  if (p.status === 'published' && (!p.sourceUrl || !p.checkedDate))
    errors.push('Published prices need a source URL and the date actually checked.');
  if (p.sourceUrl) {
    try {
      const u = new URL(p.sourceUrl);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw Error();
    } catch {
      errors.push('Price source must be an HTTP or HTTPS URL without credentials.');
    }
  }
  if (
    p.checkedDate &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(p.checkedDate) ||
      !Number.isFinite(Date.parse(p.checkedDate)) ||
      new Date(p.checkedDate).toISOString().slice(0, 10) !== p.checkedDate)
  )
    errors.push('Price checked date must be a valid YYYY-MM-DD date.');
  if (Object.keys(input).some(k => !Object.hasOwn(p, k))) errors.push('Price contains unsupported fields.');
  return p;
}
const instructions = `INDICATIVE PRICES: Use the currency in reference.pricing.currency. If it is null or no template is supplied, ask the user to choose EUR, USD or GBP before researching. Include a price object for every researched product: {amount,currency,status,basis,explanation,sourceUrl,checkedDate}. amount is a JSON number, never formatted text; currency is EUR, USD or GBP; status is published or estimate; basis is pack, piece or item. A pack price is for the entire sold pack, not each piece. Record the actual price basis and explain pack contents, tax and shipping treatment where known. These are indicative catalogue prices, not purchase costs or stock valuations.
Prefer a published price in the chosen currency, with its sourceUrl and actual checkedDate (YYYY-MM-DD). When unavailable, provide a reasonable, clearly labelled estimate, explaining the comparable product or other basis. Currency conversions are estimates too: retain the original price/currency, conversion rate and its provenance in explanation; never present a conversion as a published price in the chosen currency. Estimates may leave sourceUrl and checkedDate empty when no source was actually checked. Never fabricate a URL, date or precise-looking evidence. Do not use zero as a placeholder for an unknown price. Estimation is allowed ONLY for price: never guess specifications, references, variants or compatibility. Keep all descriptive price text in English.`;
module.exports = { currency, validate, instructions, currencies };
