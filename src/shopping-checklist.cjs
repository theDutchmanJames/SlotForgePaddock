'use strict';
// Checklist state is additive. Original order/receipt quantities remain an audit
// trail; changing a checklist never reverses stock or erases a delivery.
const P = require('./purchasing.cjs');
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const quantity = line => line.purchase?.checklist?.quantity ?? line.quantity;
const done = line => line.purchase?.checklist?.done ?? line.received >= line.quantity;
const deleted = line => line.purchase?.checklist?.deleted === true;
const outstanding = line => (deleted(line) || done(line) ? 0 : Math.max(0, quantity(line) - line.received));
function init(line) {
  return (line.purchase.checklist ??= { version: 1, quantity: line.quantity, done: done(line), deleted: false });
}
function validate(line) {
  const c = line.purchase?.checklist;
  if (c === undefined) return;
  check(
    c &&
      c.version === 1 &&
      Number.isSafeInteger(c.quantity) &&
      c.quantity >= 0 &&
      c.quantity <= 1000000 &&
      typeof c.done === 'boolean' &&
      typeof c.deleted === 'boolean' &&
      (c.manualQuantity === undefined || typeof c.manualQuantity === 'boolean'),
    'Invalid shopping checklist.'
  );
}
function mutate(db, action, p, stamp) {
  P.upgrade(db);
  const line = db.planning.shopping.find(s => s.id === p.id);
  check(line, 'Shopping item not found.');
  const c = init(line);
  if (action === 'planning.checklist.delete') {
    c.deleted = true;
  } else if (action === 'planning.checklist.restore') {
    c.deleted = false;
  } else if (action === 'planning.checklist.edit') {
    check(!c.deleted, 'Restore this item before editing it.');
    if (p.quantity !== undefined) {
      const n = Number(p.quantity);
      check(
        (typeof p.quantity === 'number' || (typeof p.quantity === 'string' && p.quantity.trim())) &&
          Number.isSafeInteger(n) &&
          n > 0 &&
          n <= 1000000,
        'Enter a positive whole quantity.'
      );
      const part = db.parts.find(x => x.id === line.partId);
      check(part?.tracking !== 'individual' || n === 1, 'An individually tracked part can only contain one item.');
      if (c.quantity !== n) c.manualQuantity = true;
      c.quantity = n;
    }
    if (p.listId !== undefined) {
      check(
        db.planning.shoppingLists.some(l => l.id === p.listId),
        'Choose a shopping list.'
      );
      line.purchase.listId = p.listId;
    }
  } else if (action === 'planning.checklist.done') {
    check(!c.deleted && typeof p.done === 'boolean', 'Choose an active shopping item.');
    check(p.addStock === undefined || typeof p.addStock === 'boolean', 'Choose whether to add stock.');
    check(!p.addStock || p.done === true, 'Stock can only be added when marking an item done.');
    if (p.addStock) {
      check(p.confirmed === true, 'Confirm the quantity to add to stock.');
      check(!c.done, 'This item is already done. Stock was not added again.');
      const amount = Number(p.quantity),
        remaining = Math.max(0, c.quantity - line.received);
      check(
        (typeof p.quantity === 'number' || (typeof p.quantity === 'string' && p.quantity.trim())) &&
          Number.isSafeInteger(amount) &&
          amount > 0 &&
          amount <= remaining,
        'Quantity exceeds the amount not yet added to stock.'
      );
      check(line.purchase.item.kind !== 'free', 'Choose a stock record for this free-text item first.');
      // The existing receiver provides stock invariants and immutable receipts.
      line.quantity = Math.max(line.quantity, line.received + amount + line.purchase.ordered);
      require('./planning.cjs').mutate(db, 'planning.receive', {
        revision: db.revision,
        shoppingId: line.id,
        ...(line.partId ? { partId: line.partId } : {}),
        quantity: amount,
        confirmed: true
      });
    }
    c.done = p.done;
  } else throw Error('Unknown checklist operation.');
  line.updated = stamp;
  return line.id;
}
module.exports = { quantity, done, deleted, outstanding, init, validate, mutate };
