'use strict';
// Overview → Collection value: what the cars are worth now and what was spent on them per year.

function valueMoney(n, currency, whole = false) {
  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: whole ? 0 : undefined,
        maximumFractionDigits: whole || n >= 1000 ? 0 : 2
      }).format(n);
    } catch {
      /* Not a currency code Intl knows. */
    }
  }
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: whole ? 0 : 2 }).format(n);
  return currency ? `${number} ${currency}` : `${number} (no currency)`;
}

/** A round axis maximum and step: 0, 250, 500, 750, 1,000… */
function valueScale(max) {
  if (!(max > 0)) return { top: 1, step: 1 };
  const rough = max / 4,
    magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(s => s >= rough);
  return { top: Math.ceil(max / step) * step, step };
}

function valueChart(entry) {
  const years = entry.years;
  if (!years.length) return '<p class="muted">Add the date each car was bought to see spending per year.</p>';
  const { top: maxY, step } = valueScale(Math.max(...years.map(y => y.spent)));
  const axisLabel = v => valueMoney(v, entry.currency, Number.isInteger(step));
  // Room for the longest axis label (about 7 units per character at this size).
  const W = 1000,
    H = 240,
    left = Math.max(56, axisLabel(maxY).length * 7 + 12),
    right = 8,
    top = 12,
    bottom = 26;
  const plotW = W - left - right,
    plotH = H - top - bottom;
  const slot = plotW / years.length,
    barW = Math.max(2, Math.min(40, slot - 2)); // 2px gap between bars
  const y = v => top + plotH - (v / maxY) * plotH;
  const grid = [];
  for (let v = 0; v <= maxY + step / 2; v += step) {
    grid.push(
      `<line x1="${left}" x2="${W - right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="value-grid"/><text x="${left - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="value-axis">${esc(axisLabel(v))}</text>`
    );
  }
  const labelEvery = Math.ceil(years.length / 12);
  const bars = years
    .map((d, i) => {
      const x = left + i * slot + (slot - barW) / 2,
        h = (d.spent / maxY) * plotH,
        r = Math.min(4, barW / 2, h);
      // Rounded top, square base on the axis.
      const path =
        h > 0
          ? `M${x.toFixed(1)},${(top + plotH).toFixed(1)}V${(top + plotH - h + r).toFixed(1)}Q${x.toFixed(1)},${(top + plotH - h).toFixed(1)} ${(x + r).toFixed(1)},${(top + plotH - h).toFixed(1)}H${(x + barW - r).toFixed(1)}Q${(x + barW).toFixed(1)},${(top + plotH - h).toFixed(1)} ${(x + barW).toFixed(1)},${(top + plotH - h + r).toFixed(1)}V${(top + plotH).toFixed(1)}Z`
          : '';
      const label = `${d.year}: ${valueMoney(d.spent, entry.currency)} on ${d.cars} ${d.cars === 1 ? 'car' : 'cars'}`;
      return (
        `<g class="value-bar" tabindex="0" role="img" aria-label="${esc(label)}" data-value-tip="${esc(label)}">` +
        `<rect x="${(left + i * slot).toFixed(1)}" y="${top}" width="${slot.toFixed(1)}" height="${plotH}" class="value-hit"/>` +
        (path ? `<path d="${path}" class="value-mark"/>` : '') +
        (i % labelEvery === 0 || i === years.length - 1
          ? `<text x="${(left + i * slot + slot / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="value-axis">${d.year}</text>`
          : '') +
        '</g>'
      );
    })
    .join('');
  const table = `<details class="value-table"><summary>Show as a table</summary><table><thead><tr><th scope="col">Year</th><th scope="col">Spent</th><th scope="col">Cars bought</th></tr></thead><tbody>${years.map(d => `<tr><th scope="row">${d.year}</th><td>${esc(valueMoney(d.spent, entry.currency))}</td><td>${d.cars}</td></tr>`).join('')}</tbody></table></details>`;
  return (
    `<figure class="value-figure"><figcaption>Spent on cars per year${entry.currency ? ` (${esc(entry.currency)})` : ''}</figcaption>` +
    `<div class="value-chart-wrap"><svg class="value-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Spent on cars per year">${grid.join('')}${bars}</svg><div class="value-tip" aria-hidden="true" hidden></div></div>${table}</figure>`
  );
}

function renderCollectionValue(summary) {
  // A Dealership copy shows the dealership's collection; its value belongs there, not here.
  if (clubState?.active || db?.club?.replica) return '';
  // Paged views must get the figures from the main process: a page holds only some cars.
  // Only older collections without paged views are summarized here, from all their cars.
  const v =
    summary ||
    (db && (!db._view || db._view.compatibility)
      ? CollectionValueModel.summarize(CollectionValueModel.fromCars(db.cars))
      : null);
  if (!v) return '';
  const heading = uiSectionHeading('Collection value', '');
  if (!v.currencies.length) {
    return (
      heading +
      `<div class="panel value-empty"><p class="muted">Add purchase prices or valuations to your cars (Identity & ownership) to see what your collection is worth and what you spent per year. Values stay private on this computer.</p></div>`
    );
  }
  const main = v.currencies[0],
    others = v.currencies.slice(1),
    c = v.counts;
  const basis = [
    c.valued ? `${c.valued} valued` : '',
    c.priceOnly ? `${c.priceOnly} at purchase price` : '',
    c.unknown ? `${c.unknown} without a value` : ''
  ]
    .filter(Boolean)
    .join(' · ');
  const tiles =
    `<div class="overview-stats value-stats">` +
    `<div class="panel overview-stat"><span class="stat-label">${icon('database')}Collection value</span><strong class="stat">${esc(valueMoney(main.value, main.currency))}</strong><span class="tiny muted">${esc(basis || 'No values yet')}</span></div>` +
    `<div class="panel overview-stat"><span class="stat-label">${icon('box')}Spent on cars</span><strong class="stat">${esc(valueMoney(main.spent, main.currency))}</strong><span class="tiny muted">${main.boughtCars} ${main.boughtCars === 1 ? 'car' : 'cars'} with a price, including sold ones${main.undatedCars ? ` · ${main.undatedCars} without a purchase date` : ''}</span></div>` +
    `</div>`;
  const rest = others.length
    ? `<p class="tiny muted">Other currencies (not converted): ${others.map(o => esc(`${valueMoney(o.value, o.currency)} value · ${valueMoney(o.spent, o.currency)} spent`)).join('; ')}.</p>`
    : '';
  const warn = c.unreadable
    ? `<p class="tiny muted">${c.unreadable} ${c.unreadable === 1 ? 'car has' : 'cars have'} a price or value that could not be read as a number; that amount is ignored.</p>`
    : '';
  return (
    heading +
    tiles +
    `<div class="panel value-panel">${valueChart(main)}${rest}${warn}<p class="tiny muted">Collection value uses each car's valuation, or what you paid when there is none. Wishlist cars are not included.</p></div>`
  );
}

// Hover and keyboard focus show the bar's value in a small tooltip above the chart.
function valueTip(event) {
  const bar = event.target.closest?.('.value-bar');
  const wrap = event.target.closest?.('.value-chart-wrap');
  const tip = wrap?.querySelector('.value-tip');
  if (!tip) return;
  if (!bar) {
    tip.hidden = true;
    return;
  }
  tip.textContent = bar.dataset.valueTip;
  tip.hidden = false;
  const box = wrap.getBoundingClientRect(),
    mark = bar.getBoundingClientRect();
  tip.style.left = `${Math.max(0, Math.min(box.width - 180, mark.left - box.left + mark.width / 2 - 90))}px`;
}
document.addEventListener('mouseover', valueTip);
document.addEventListener('focusin', valueTip);
document.addEventListener('focusout', event => {
  const wrap = event.target.closest?.('.value-chart-wrap');
  if (wrap && !event.relatedTarget?.closest?.('.value-chart-wrap')) {
    const tip = wrap.querySelector('.value-tip');
    if (tip) tip.hidden = true;
  }
});
document.addEventListener('mouseout', event => {
  if (event.target.closest?.('.value-chart-wrap') && !event.relatedTarget?.closest?.('.value-chart-wrap')) {
    const tip = event.target.closest('.value-chart-wrap').querySelector('.value-tip');
    if (tip) tip.hidden = true;
  }
});
