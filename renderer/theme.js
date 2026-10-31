// Colour themes: the list of themes, and the colours of the "Custom" theme that a person picks themselves.
// The colours of the ready-made themes are written down once, in styles.css. Pure functions, so they can be tested without a screen.
(function (root) {
  const THEMES = [['dark', 'Dark'], ['light', 'Light'], ['midnight', 'Midnight blue'], ['forest', 'Forest green'], ['sunset', 'Sunset orange'], ['violet', 'Violet'], ['carbon', 'Carbon and yellow'], ['ocean', 'Ocean (light)'], ['custom', 'Custom (your own colours)']];
  // what a person can colour in the Custom theme: [key (the CSS variable --key), name, where it is used]. The text on the accent colour is chosen automatically.
  const COLORS = [['bg', 'Background', 'the page behind everything'], ['panel', 'Panels', 'the top bar, cards and tables'], ['ink', 'Text', 'normal text'], ['muted', 'Quiet text', 'labels, hints and the tabs you are not on'], ['line', 'Lines', 'borders and dividers'], ['accent', 'Accent', 'the selected tab, main buttons and error messages']];
  const DEFAULT = { bg: '#171b21', panel: '#222831', ink: '#e8e6e1', muted: '#98a0ab', line: '#343b47', accent: '#e5484d' }; // the Dark theme

  // '#ABC' or '#aabbcc' -> '#aabbcc'; anything else -> '' (colours from a settings file are never trusted)
  const hex6 = v => { const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v ?? '').trim()); if (!m) return ''; const h = m[1].toLowerCase(); return '#' + (h.length === 3 ? [...h].map(c => c + c).join('') : h); };
  // the six colours of the Custom theme from the settings; a missing or unreadable one is the Dark colour
  const customOf = s => { const c = (s && s.customColors) || {}; return Object.fromEntries(COLORS.map(([k]) => [k, hex6(c[k]) || DEFAULT[k]])); };

  const light = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  // how well two colours stand out from each other: 1 (identical) to 21 (black on white)
  const ratio = (a, b) => { const x = light(a), y = light(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // a light colour (the panels of a light Custom theme): the depth of the page uses softer shadows on it (styles.css, data-tone)
  const isLight = h => { const x = hex6(h); return !!x && light(x) > 0.35; };
  // the text on the accent colour (main buttons): white when that reads well, otherwise black. 3.7 gives the same choice as each ready-made theme makes for itself.
  const onAccent = accent => (ratio(accent, '#ffffff') >= 3.7 ? '#ffffff' : '#000000');

  // warnings for a colour set that would be hard to read
  function problems(c) {
    const out = [];
    if (Math.min(ratio(c.ink, c.bg), ratio(c.ink, c.panel)) < 3) out.push('Text is very close to the colour of the Background or the Panels, so it is hard to read.');
    if (Math.min(ratio(c.muted, c.bg), ratio(c.muted, c.panel)) < 2) out.push('Quiet text is almost invisible against the Background or the Panels.');
    if (ratio(c.accent, c.bg) < 2) out.push('The Accent is very close to the Background, so selected tabs and error messages are hard to see.');
    return out;
  }

  const api = { THEMES, COLORS, DEFAULT, hex6, customOf, ratio, onAccent, isLight, problems };
  root.Theme = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
