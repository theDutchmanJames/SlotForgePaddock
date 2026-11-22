'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
// Library > Custom fields: add (same small window as Add option) with a car section, edit, move,
// show in that car section and edit-form tab, sort the Cars page by it, and delete with a count.
module.exports = async ({ win, store, js, wait, click, fill, submit, qa }) => {
  const checks = [];
  const capture = async name => {
    win.webContents.invalidate();
    await new Promise(r => setTimeout(r, 400));
    fs.writeFileSync(
      path.join(qa, name),
      (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()
    );
  };
  const cars = [
    ['Custom QA light', '45'],
    ['Custom QA heavy', '9,50'],
    ['Custom QA none', '']
  ].map(([name, price]) => store.mutate('car.save', { data: { name, price } }).result);
  await js(
    "(async()=>{await loadView();page='Library';libraryTab='fields';carId=null;await loadCustomFieldUsage();render()})()"
  );
  await wait('!!document.querySelector(".custom-field-library")');
  assert.match(await js('document.querySelector(".library-strip").innerText'), /Custom fields/);

  // Add two fields through the window.
  await click('[data-action="custom-add"]');
  assert.ok(await js('!!document.querySelector("#dialog [name=group]")'));
  await fill({ label: 'Body weight', type: 'number', group: 'Technical & parts' });
  await submit();
  await click('[data-action="custom-add"]');
  await fill({ label: 'Club class', type: 'choice' });
  await submit();
  await click('[data-action="custom-add"]');
  await fill({ label: 'Glue used', type: 'text', group: 'Technical & parts' });
  await submit();
  const [weight, club, glue] = store.data.customFields.map(f => f.id);
  assert.deepEqual(
    store.data.customFields.map(f => [f.label, f.type, f.group || '']),
    [
      ['Body weight', 'number', 'Technical & parts'],
      ['Club class', 'choice', ''],
      ['Glue used', 'text', 'Technical & parts']
    ]
  );
  await wait('document.querySelectorAll(".custom-field-row").length===3');
  checks.push('Library › Custom fields adds fields with a type and a car section in the Add window');

  // Edit and move.
  await click(`[data-action="custom-edit"][data-id="${weight}"]`);
  assert.equal(await js('document.querySelector("#dialog [name=group]").value'), 'Technical & parts');
  await fill({ label: 'Body weight (g)' });
  await submit();
  assert.equal(store.data.customFields[0].label, 'Body weight (g)');
  await click(`[data-action="custom-up"][data-id="${glue}"]`);
  assert.deepEqual(
    store.data.customFields.map(f => f.id),
    [glue, club, weight]
  );
  assert.equal(await js(`document.querySelector('[data-action="custom-up"][data-id="${glue}"]').disabled`), true);
  await capture('custom-fields-library.png');
  checks.push('custom fields rename and move within their car section');

  // Values show in their car section and on the matching edit-form tab.
  const car = id => store.data.cars.find(c => c.id === id);
  for (const [id, w] of [
    [cars[0], '18'],
    [cars[1], '120']
  ])
    store.mutate('car.save', { id, revision: car(id).revision, data: { custom: { [weight]: w, [club]: 'GT' } } });
  await js(`(async()=>{await loadView();page='Cars';carId='${cars[1]}';section='Technical & parts';render()})()`);
  await wait('!!document.querySelector(".profile-section-stack")');
  const technical = await js('document.querySelector(".profile-section-stack").innerText');
  assert.match(technical, /your fields/i);
  assert.match(technical, /Body weight \(g\)[\s\S]*120/);
  assert.doesNotMatch(technical, /Club class/);
  await js(
    "[...document.querySelectorAll('.panel-heading h2')].find(h=>/your fields/i.test(h.textContent))?.scrollIntoView({block:'center'})"
  );
  await capture('custom-fields-technical.png');
  await click('[data-action="section"][data-id="Identity & ownership"]');
  assert.match(await js('document.querySelector(".profile-section-stack").innerText'), /Club class[\s\S]*GT/);
  await click(`[data-action="edit-car"][data-id="${cars[1]}"]`);
  await wait('!!document.querySelector("#dialog [data-form-panel=Technical]")');
  assert.ok(await js(`!!document.querySelector('[data-form-panel=Technical] [name="custom.${weight}"]')`));
  assert.ok(await js(`!!document.querySelector('[data-form-panel=Custom] [name="custom.${club}"]')`));
  assert.equal(await js(`document.querySelectorAll('#dialog [name="custom.${weight}"]').length`), 1);
  await click('[data-action="close-modal"]');
  checks.push('custom fields show in their car section and on the matching tab of the edit window');

  // Sort the Cars page by the custom number field and by purchase price.
  await js("(async()=>{carId=null;page='Cars';await loadView();render()})()");
  await wait('!!document.querySelector("#cars-sort")');
  assert.ok(await js(`!!document.querySelector('#cars-sort optgroup option[value="custom_${weight}:desc"]')`));
  const order = async value => {
    await js(
      `(()=>{const el=document.querySelector('#cars-sort');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`
    );
    await wait(`document.querySelector('#cars-sort')?.value===${JSON.stringify(value)}&&!viewPendingKey`);
    await new Promise(r => setTimeout(r, 300));
    return js(
      `[...new Set([...document.querySelectorAll('[data-select-car]')].map(el=>el.dataset.selectCar))].filter(id=>${JSON.stringify(cars)}.includes(id))`
    );
  };
  assert.deepEqual(await order(`custom_${weight}:desc`), [cars[1], cars[0], cars[2]]);
  assert.deepEqual(await order(`custom_${weight}:asc`), [cars[0], cars[1], cars[2]]);
  assert.deepEqual(await order('price:asc'), [cars[1], cars[0], cars[2]]);
  await capture('custom-fields-sort.png');
  await order('name:asc');
  checks.push('the Cars page sorts by a custom number field and by purchase price, empty values last');

  // Delete says how many cars hold a value, then removes the field and its values.
  await js("(async()=>{page='Library';libraryTab='fields';await loadCustomFieldUsage();render()})()");
  await click(`[data-action="custom-delete"][data-id="${weight}"]`);
  assert.match(await js('document.querySelector("#dialog").innerText'), /2 cars have/);
  await submit();
  assert.equal(
    store.data.customFields.some(f => f.id === weight),
    false
  );
  assert.equal(car(cars[1]).custom[weight], undefined);
  assert.ok(store.data.events.some(e => e.carId === cars[1] && e.title === 'Custom field removed'));
  for (const id of [club, glue]) {
    await js(`(async()=>{page='Library';libraryTab='fields';render()})()`);
    await click(`[data-action="custom-delete"][data-id="${id}"]`);
    await submit();
  }
  assert.equal(store.data.customFields.length, 0);
  checks.push('deleting a custom field reports how many cars hold a value and keeps the old value in each car history');
  for (const id of cars)
    store.mutate('car.delete', { id, revision: store.data.revision, confirmed: true, confirmName: car(id).name });
  await js("(async()=>{await loadView();page='Overview';carId=null;render()})()");
  return checks;
};
