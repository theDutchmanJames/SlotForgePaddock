'use strict';
const purchaseHasHistory = s =>
  !!(
    s.purchase?.receipts?.length ||
    s.purchase?.legacyReceived ||
    s.purchase?.orderLog?.length ||
    s.purchase?.receiptCorrections?.length
  );
function purchaseMoney(minor, currency) {
  const n = BigInt(minor);
  return esc(currency) + ' ' + (n / 100n).toLocaleString() + '.' + String(n % 100n).padStart(2, '0');
}
function purchasePriceFields(s) {
  const p = s?.purchase?.price;
  return (
    field('unitPrice', 'Unit price per item (optional)', p ? (p.minor / 100).toFixed(2) : '') +
    field('currency', 'Currency (e.g. EUR)', p?.currency || '')
  );
}
function purchaseHistory(id) {
  const s = db.planning.shopping.find(s => s.id === id);
  if (!s) throw Error('Purchase not found.');
  const p = s.purchase,
    c = p.receiptCorrections || [];
  const entries = [
    ...(p.orderLog || []).map(e => ({
      date: e.date,
      text: (e.type === 'ordered' ? 'Ordered ' : 'Cancelled order: ') + e.quantity,
      details: e.supplier,
      price: e.price
    })),
    ...p.receipts.map(r => ({
      date: r.receivedAt,
      text:
        'Received ' +
        r.quantity +
        ' (' +
        (r.quantity - c.filter(x => x.receiptId === r.id).reduce((n, x) => n + x.quantity, 0)) +
        ' after corrections)',
      details: r.supplier || '',
      price: r.price
    })),
    ...c.map(e => ({
      date: e.date,
      text: 'Reversed ' + e.quantity + ' received · ' + e.restoredOrdered + ' returned to order',
      details: e.reason
    }))
  ].sort((a, b) => a.date.localeCompare(b.date));
  modal(
    'Purchase history · ' + shoppingItem(s).name,
    `${p.legacyReceived ? '<p>' + p.legacyReceived + ' received before individual receipts were recorded. No receipt date was recorded.</p>' : ''}${p.orderBaseline ? '<p class="tiny muted">Opening order balance: ' + p.orderBaseline + ' (before detailed order logging).</p>' : ''}<div class="timeline">${entries.map(e => '<article><strong>' + esc(e.text) + '</strong><p class="tiny muted">' + esc(new Date(e.date).toLocaleString()) + '</p><p>' + esc(e.details) + (e.price ? ' · ' + purchaseMoney(e.price.minor, e.price.currency) + ' per item' : '') + '</p></article>').join('')}</div>${p.receipts.some(r => r.quantity > c.filter(x => x.receiptId === r.id).reduce((n, x) => n + x.quantity, 0)) ? btn('Correct a receipt…', 'shop-correct', '', id) : ''}<p class="plan-help">Corrections retain the original receipt. Only available stock can be reversed; fitted parts and assembly components are protected.</p>`,
    null
  );
  $('#dialog .dialog-footer [data-action=close-modal]').textContent = 'Close';
}
function purchaseCorrection(id) {
  const s = db.planning.shopping.find(s => s.id === id);
  if (!s) throw Error('Purchase not found.');
  const p = s.purchase,
    revision = db.revision;
  const receipts = p.receipts
    .map(r => ({
      ...r,
      remaining:
        r.quantity - (p.receiptCorrections || []).filter(c => c.receiptId === r.id).reduce((n, c) => n + c.quantity, 0)
    }))
    .filter(r => r.remaining > 0);
  modal(
    'Correct receipt · ' + shoppingItem(s).name,
    shoppingSelect(
      'receiptId',
      'Original receipt',
      receipts.map(r => [r.id, new Date(r.receivedAt).toLocaleString() + ' · ' + r.remaining + ' still received']),
      receipts[0]?.id,
      null
    ) +
      field('quantity', 'Quantity to reverse', 1, 'number') +
      field('reason', 'Reason', '', 'textarea') +
      '<label class="check-row"><input type="checkbox" name="restoreOrdered" checked>Return the originally ordered portion to outstanding orders</label><p>Available stock will decrease by the quantity entered. The original receipt stays in history.</p><label class="check-row"><input type="checkbox" name="confirmed" required>I have checked this stock correction.</label>',
    async v => {
      await change('planning.receipt.correct', {
        revision,
        id,
        receiptId: v.receiptId,
        quantity: v.quantity,
        reason: v.reason,
        restoreOrdered: !!v.restoreOrdered,
        confirmed: !!v.confirmed
      });
      await shoppingChanged();
    },
    'Correct receipt'
  );
  const q = $('#dialog [name=quantity]');
  q.min = '1';
  q.step = '1';
  q.required = true;
  $('#dialog [name=reason]').required = true;
}
async function shoppingOrderAction(action, id) {
  if (action === 'shop-history') {
    purchaseHistory(id);
    return true;
  }
  if (action === 'shop-correct') {
    purchaseCorrection(id);
    return true;
  }
  return false;
}
