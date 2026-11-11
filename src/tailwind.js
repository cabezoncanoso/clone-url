// Convierte una sección a HTML con clases de Tailwind a partir de los estilos calculados
// en tres anchos: móvil (base), md (768px) y lg (1280px).
const cheerio = require('cheerio');
const { htmlToJsx } = require('./jsx');
const PREFLIGHT = require('fs').readFileSync(require('path').join(__dirname, 'tailwind-preflight.css'), 'utf8');

const PROPS = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'max-width', 'min-height', 'min-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'color', 'text-align', 'text-transform', 'text-decoration-line',
  'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-top-style',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'row-gap', 'column-gap',
  'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'grid-template-columns', 'grid-column-start', 'grid-column-end',
  'vertical-align', 'opacity', 'box-shadow', 'overflow-x', 'overflow-y', 'object-fit', 'list-style-type', 'white-space',
];
const INHERITED = new Set(['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'color', 'text-align', 'text-transform', 'white-space', 'list-style-type']);

// Se ejecuta en el navegador: estilos calculados no por defecto de cada elemento de la sección
function collectStyles({ selector, props, preflight }) {
  const root = document.querySelector(selector);
  if (!root) return null;
  // Estado final: sin animaciones ni transiciones a medias
  document.getAnimations().forEach((a) => { try { a.finish(); } catch { a.cancel(); } });
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const fdoc = frame.contentDocument;
  // Comparamos contra el reset de Tailwind (preflight), no contra los estilos del navegador
  const st = fdoc.createElement('style'); st.textContent = preflight; fdoc.head.appendChild(st);
  const defaults = {};
  const def = (tag) => {
    if (!defaults[tag]) {
      const el = fdoc.createElement(tag); fdoc.body.appendChild(el);
      const cs = getComputedStyle(el); defaults[tag] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
    }
    return defaults[tag];
  };
  const els = [root, ...root.querySelectorAll('*')];
  const out = els.map((el) => {
    const cs = getComputedStyle(el); const d = def(el.tagName.toLowerCase());
    const pcs = el === root ? null : getComputedStyle(el.parentElement);
    const s = {}; const raw = {};
    for (const p of props) raw[p] = cs.getPropertyValue(p);
    const noBorder = ['top', 'right', 'bottom', 'left'].every((side) => raw[`border-${side}-width`] === '0px');
    if (noBorder) { raw['border-top-color'] = ''; raw['border-top-style'] = ''; }
    for (const p of props) {
      if (noBorder && (p === 'border-top-color' || p === 'border-top-style')) continue;
      const v = cs.getPropertyValue(p);
      const inherited = ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'color', 'text-align', 'text-transform', 'white-space', 'list-style-type'].includes(p);
      if (inherited && pcs && pcs.getPropertyValue(p) === v) continue; // ya lo hereda del padre
      if (!inherited && v === d[p]) continue;
      if (inherited && !pcs && v === d[p]) continue;
      s[p] = v;
    }
    for (const o of [s, raw]) if (o['background-image']) o['background-image'] = o['background-image'].replace(/url\("?([^")]+)"?\)/g, (m, u) => `url(${u})`);
    return { s, raw };
  });
  frame.remove();
  return out;
}

const arb = (v) => v.trim().replace(/\s+/g, '_');
function hex(v) {
  const m = v.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
  if (!m) return arb(v);
  const h = (n) => Math.round(+n).toString(16).padStart(2, '0');
  const a = m[4] !== undefined && +m[4] < 1 ? h(+m[4] * 255) : '';
  return `#${h(m[1])}${h(m[2])}${h(m[3])}${a}`;
}
const DISPLAY = { block: 'block', 'inline-block': 'inline-block', inline: 'inline', flex: 'flex', 'inline-flex': 'inline-flex', grid: 'grid', 'inline-grid': 'inline-grid', none: 'hidden', contents: 'contents', 'list-item': 'list-item', table: 'table' };
const JUSTIFY = { 'flex-start': 'start', start: 'start', 'flex-end': 'end', end: 'end', center: 'center', 'space-between': 'between', 'space-around': 'around', 'space-evenly': 'evenly', normal: 'normal' };
const ALIGN = { 'flex-start': 'start', start: 'start', 'flex-end': 'end', end: 'end', center: 'center', baseline: 'baseline', stretch: 'stretch' };

function boxClasses(s, prefix, keys) {
  const [t, r, b, l] = keys.map((k) => s[k]);
  if ([t, r, b, l].every((x) => x === undefined)) return [];
  const v = (x) => `${prefix}-[${arb(x)}]`.replace('-[0px]', '-0');
  if (t && t === r && t === b && t === l) return [v(t).replace(`${prefix}-`, `${prefix}-`)];
  const out = [];
  if (t !== undefined && t === b) out.push(v(t).replace(prefix, prefix + 'y')); else { if (t !== undefined) out.push(v(t).replace(prefix, prefix + 't')); if (b !== undefined) out.push(v(b).replace(prefix, prefix + 'b')); }
  if (l !== undefined && l === r) out.push(v(l).replace(prefix, prefix + 'x')); else { if (l !== undefined) out.push(v(l).replace(prefix, prefix + 'l')); if (r !== undefined) out.push(v(r).replace(prefix, prefix + 'r')); }
  return out;
}

function toClasses(s) {
  const c = [];
  const p = (k, fn) => { if (s[k] !== undefined) { const r = fn(s[k]); if (r) c.push(r); } };
  p('display', (v) => DISPLAY[v] || `[display:${arb(v)}]`);
  p('position', (v) => v !== 'static' && v);
  for (const k of ['top', 'right', 'bottom', 'left']) p(k, (v) => v !== 'auto' && `${k}-[${arb(v)}]`);
  p('z-index', (v) => v !== 'auto' && `z-[${v}]`);
  p('max-width', (v) => (v === 'none' ? 'max-w-none' : `max-w-[${arb(v)}]`));
  p('min-height', (v) => v !== '0px' && v !== 'auto' && `min-h-[${arb(v)}]`);
  p('max-height', (v) => (v === 'none' ? 'max-h-none' : `max-h-[${arb(v)}]`));
  p('min-width', (v) => v !== '0px' && v !== 'auto' && `min-w-[${arb(v)}]`);
  c.push(...boxClasses(s, 'm', ['margin-top', 'margin-right', 'margin-bottom', 'margin-left']));
  c.push(...boxClasses(s, 'p', ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']));
  p('font-family', (v) => `font-['${v.split(',')[0].trim().replace(/["']/g, '').replace(/\s+/g, '_')}']`);
  p('font-size', (v) => `text-[${v}]`);
  p('font-weight', (v) => `font-[${v}]`);
  p('font-style', (v) => (v === 'italic' ? 'italic' : 'not-italic'));
  p('line-height', (v) => `leading-[${v === 'normal' ? 'normal' : v}]`);
  p('letter-spacing', (v) => v !== 'normal' && `tracking-[${v}]`);
  p('color', (v) => `text-[${hex(v)}]`);
  p('text-align', (v) => ({ start: 'text-left', left: 'text-left', center: 'text-center', right: 'text-right', end: 'text-right', justify: 'text-justify' }[v]));
  p('text-transform', (v) => ({ uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize', none: 'normal-case' }[v]));
  p('text-decoration-line', (v) => ({ none: 'no-underline', underline: 'underline', 'line-through': 'line-through' }[v]));
  p('white-space', (v) => `whitespace-${v}`);
  p('list-style-type', (v) => `list-[${arb(v)}]`);
  p('background-color', (v) => `bg-[${hex(v)}]`);
  p('background-image', (v) => v !== 'none' && `bg-[${arb(v)}]`);
  p('background-size', (v) => ({ cover: 'bg-cover', contain: 'bg-contain', auto: 'bg-auto' }[v] || `bg-[length:${arb(v)}]`));
  p('background-position', (v) => `bg-[position:${arb(v)}]`);
  p('background-repeat', (v) => ({ 'no-repeat': 'bg-no-repeat', repeat: 'bg-repeat', 'repeat-x': 'bg-repeat-x', 'repeat-y': 'bg-repeat-y' }[v]));
  const bw = ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'];
  if (bw.some((k) => s[k] !== undefined)) {
    c.push(...boxClasses(s, 'border', bw).map((x) => x.replace(/^border(x|y|t|r|b|l)-/, 'border-$1-')));
  }
  p('border-top-color', (v) => v && `border-[${hex(v)}]`);
  p('border-top-style', (v) => v && v !== 'none' && `border-${v}`);
  const rr = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'];
  if (rr.some((k) => s[k] !== undefined)) {
    const vals = rr.map((k) => s[k] || '0px');
    if (vals.every((x) => x === vals[0])) c.push(`rounded-[${arb(vals[0])}]`);
    else ['tl', 'tr', 'br', 'bl'].forEach((n, i) => vals[i] !== '0px' && c.push(`rounded-${n}-[${arb(vals[i])}]`));
  }
  p('flex-direction', (v) => ({ row: 'flex-row', column: 'flex-col', 'row-reverse': 'flex-row-reverse', 'column-reverse': 'flex-col-reverse' }[v]));
  p('flex-wrap', (v) => ({ wrap: 'flex-wrap', nowrap: 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' }[v]));
  p('justify-content', (v) => JUSTIFY[v] && `justify-${JUSTIFY[v]}`);
  p('align-items', (v) => ALIGN[v] && `items-${ALIGN[v]}`);
  p('align-self', (v) => ALIGN[v] && `self-${ALIGN[v]}`);
  if (s['row-gap'] !== undefined && s['row-gap'] === s['column-gap']) c.push(`gap-[${s['row-gap']}]`);
  else { p('row-gap', (v) => v !== 'normal' && `gap-y-[${v}]`); p('column-gap', (v) => v !== 'normal' && `gap-x-[${v}]`); }
  p('flex-grow', (v) => `grow-[${v}]`);
  p('flex-shrink', (v) => `shrink-[${v}]`);
  p('flex-basis', (v) => v !== 'auto' && `basis-[${arb(v)}]`);
  p('order', (v) => `order-[${v}]`);
  p('grid-template-columns', (v) => v !== 'none' && `grid-cols-[${arb(v)}]`);
  p('grid-column-start', (v) => v !== 'auto' && `col-start-[${arb(v)}]`);
  p('grid-column-end', (v) => v !== 'auto' && `col-end-[${arb(v)}]`);
  p('vertical-align', (v) => ({ baseline: 'align-baseline', top: 'align-top', middle: 'align-middle', bottom: 'align-bottom', 'text-top': 'align-text-top', 'text-bottom': 'align-text-bottom', sub: 'align-sub', super: 'align-super' }[v] || `align-[${arb(v)}]`));
  p('opacity', (v) => `opacity-[${v}]`);
  p('box-shadow', (v) => v !== 'none' && `shadow-[${arb(v)}]`);
  if (s['overflow-x'] && s['overflow-x'] === s['overflow-y']) c.push(`overflow-${s['overflow-x']}`);
  else { p('overflow-x', (v) => `overflow-x-${v}`); p('overflow-y', (v) => `overflow-y-${v}`); }
  p('object-fit', (v) => `object-${v}`);
  return c;
}

/**
 * @param {string} html  HTML de la sección (rutas ya locales)
 * @param {{base: object[], md: object[], lg: object[]}} styles
 */
function buildTailwind(html, styles) {
  const $ = cheerio.load(html, null, false);
  const els = [];
  $.root().children().first().each((_, el) => { els.push(el); $(el).find('*').each((__, d) => els.push(d)); });
  // Diferencias de un breakpoint respecto al anterior (mobile-first)
  const diff = (prev, cur) => {
    const d = {};
    if (!prev || !cur) return d;
    for (const k of Object.keys(cur.raw)) if (cur.raw[k] !== prev.raw[k]) d[k] = cur.raw[k];
    return d;
  };
  els.forEach((el, i) => {
    const b = styles.base[i]; const m = styles.md[i]; const l = styles.lg[i];
    const cls = [
      ...toClasses(b ? b.s : {}),
      ...toClasses(diff(b, m)).map((x) => 'md:' + x),
      ...toClasses(diff(m, l)).map((x) => 'lg:' + x),
    ];
    $(el).removeAttr('style').removeAttr('class');
    if (cls.length) $(el).attr('class', cls.join(' '));
  });
  return $.html();
}

module.exports = { collectStyles, buildTailwind, PROPS, PREFLIGHT, htmlToJsx };
