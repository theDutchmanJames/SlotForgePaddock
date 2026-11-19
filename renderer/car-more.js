'use strict';
// The car's More menu, after docs/ui-reference/more-menu-2026-11 (option A): a drop-down under the More button
// with the actions in groups, each with an icon and a one-line explanation, and Permanently delete set apart.
// The items keep their data-action names, so every action works exactly as before.
const carMoreIcons = {
  rebuild:
    '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8"/><path d="M20 3v5h-5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 16"/><path d="M4 21v-5h5"/>',
  archive:
    '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 3.5v5h5"/>',
  duplicate:
    '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  merge: '<path d="M6 4v5a6 6 0 0 0 6 6h6"/><path d="M15 12l3 3-3 3"/><path d="M6 20v-3"/>',
  export: '<path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  send: '<path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
  framing:
    '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3"/>',
  research: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  delete: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>'
};
function carMoreItem(action, id, iconName, tone, title, text, cls = '') {
  return `<button type="button" class="car-more-item ${cls}" data-action="${action}" data-id="${esc(id)}" data-tone="${tone}" role="menuitem"><i aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${carMoreIcons[iconName]}</svg></i><span><b>${title}</b><small>${text}</small></span></button>`;
}
function carMoreMenu(c) {
  const id = c.id,
    wish = slotforgeDomain.isWishlist(c),
    groups = [
      [
        'Rebuild & life',
        [
          !wish && !c.archived && !c.rebuild?.to
            ? carMoreItem(
                'rebuild-start',
                id,
                'rebuild',
                'amber',
                'Start a rebuild…',
                'Turn this car into a linked new one; its history stays'
              )
            : '',
          !c.rebuild?.to
            ? c.archived
              ? carMoreItem(
                  'archive-car',
                  id,
                  'restore',
                  'blue',
                  'Restore from archive',
                  'Bring it back into your collection'
                )
              : carMoreItem(
                  'archive-car',
                  id,
                  'archive',
                  'blue',
                  'Archive car',
                  'Hide it from your collection; nothing is deleted'
                )
            : ''
        ]
      ],
      [
        'Copies',
        [
          carMoreItem(
            'duplicate-car',
            id,
            'duplicate',
            'violet',
            wish ? 'Duplicate Wishlist entry' : 'Duplicate as another physical car',
            wish ? 'A second Wishlist entry with the same details' : 'A second car with the same details'
          ),
          mergeReviewAvailable
            ? carMoreItem(
                'merge-start',
                id,
                'merge',
                'violet',
                'Merge duplicate car…',
                'Combine two records of the same car'
              )
            : ''
        ]
      ],
      [
        'Share & print',
        [
          carMoreItem('export-car', id, 'export', 'green', 'Export this car', 'A file to open in another Paddock'),
          carMoreItem('reports', id, 'print', 'green', 'Print / PDF…', 'Car card with QR code, specification sheet'),
          !wish && canSubmit()
            ? carMoreItem(
                'send-car',
                id,
                'send',
                'green',
                'Send to ' + esc(net.remote.name),
                'Propose it for the shared collection'
              )
            : ''
        ]
      ],
      [
        'Photos & research',
        [
          carMoreItem('photo-focus', id, 'framing', 'blue', 'Photo framing…', 'Choose the focus point for Fill views'),
          carMoreItem(
            'slotcar-research',
            id,
            'research',
            'blue',
            'Research slotcar…',
            'Product template for your AI, then import'
          )
        ]
      ]
    ];
  return `<div class="car-more-menu" id="car-more-menu" role="menu" aria-label="More actions for ${esc(c.name)}">${groups
    .map(([g, items]) => [g, items.filter(Boolean)])
    .filter(([, items]) => items.length)
    .map(([g, items]) => `<div class="car-more-group">${esc(g)}</div>${items.join('')}`)
    .join(
      ''
    )}<div class="car-more-sep"></div>${carMoreItem('car-delete', id, 'delete', 'red', 'Permanently delete car…', 'Removes the car and its history. You type its name to confirm.', 'danger')}</div>`;
}
let carMoreOpen = null;
const carMoreButton = () =>
  carMoreOpen ? $(`#main [data-action="car-more"][data-id="${CSS.escape(carMoreOpen)}"]`) : null;
function closeCarMore(focusButton = false) {
  const menu = $('#car-more-menu');
  if (!menu) return false;
  const button = carMoreButton();
  menu.remove();
  carMoreOpen = null;
  button?.setAttribute('aria-expanded', 'false');
  button?.classList.remove('on');
  if (focusButton) button?.focus();
  return true;
}
function placeCarMore() {
  const menu = $('#car-more-menu'),
    button = carMoreButton();
  if (!menu || !button) return;
  const r = button.getBoundingClientRect(),
    w = menu.offsetWidth,
    h = menu.offsetHeight,
    below = innerHeight - r.bottom - 12;
  menu.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  menu.style.top = (below >= h || below > r.top ? r.bottom + 8 : Math.max(8, r.top - h - 8)) + 'px';
  menu.style.maxHeight = Math.max(220, below >= h || below > r.top ? below : r.top - 16) + 'px';
}
function toggleCarMore(id) {
  if (closeCarMore()) return;
  const c = db.cars.find(c => c.id === id),
    button = $(`[data-action="car-more"][data-id="${CSS.escape(id)}"]`);
  if (!c || !button) return;
  carMoreOpen = id;
  button.setAttribute('aria-expanded', 'true');
  button.classList.add('on');
  document.body.insertAdjacentHTML('beforeend', carMoreMenu(c));
  placeCarMore();
  $('#car-more-menu .car-more-item')?.focus();
}
// The page can redraw while the menu is open (a view finishing loading): stay with the redrawn More
// button of the same car, or close when that car is no longer on screen.
// (Set up once the page exists: this file loads before app.js defines $.)
addEventListener('DOMContentLoaded', () =>
  new MutationObserver(() => {
    if (!document.getElementById('car-more-menu')) return;
    const button = carMoreButton();
    if (!button) return void closeCarMore();
    button.setAttribute('aria-expanded', 'true');
    button.classList.add('on');
    placeCarMore();
  }).observe(document.getElementById('main'), { childList: true })
);
// Picking an item closes the menu (the action itself runs through the normal click handler);
// so does a click elsewhere, Escape, scrolling the page away or resizing the window.
document.addEventListener(
  'click',
  e => {
    const menu = $('#car-more-menu');
    if (!menu) return;
    if (menu.contains(e.target)) {
      if (e.target.closest('[data-action]')) setTimeout(() => closeCarMore(), 0);
      return;
    }
    if (!e.target.closest('[data-action="car-more"]')) closeCarMore();
  },
  true
);
document.addEventListener('keydown', e => {
  const menu = $('#car-more-menu');
  if (!menu) return;
  const items = [...menu.querySelectorAll('.car-more-item')],
    at = items.indexOf(document.activeElement);
  if (e.key === 'Escape') {
    e.preventDefault();
    closeCarMore(true);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  } else if (e.key === 'Tab') closeCarMore(true);
});
addEventListener('resize', () => placeCarMore());
addEventListener(
  'scroll',
  e => {
    const menu = document.getElementById('car-more-menu');
    if (menu && !menu.contains(e.target)) closeCarMore();
  },
  true
);
