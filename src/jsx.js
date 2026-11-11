// Conversión sencilla de HTML a JSX (className, htmlFor, style como objeto, etiquetas vacías cerradas, camelCase en SVG).
const cheerio = require('cheerio');

const ATTR = {
  class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength',
  colspan: 'colSpan', rowspan: 'rowSpan', autocomplete: 'autoComplete', autofocus: 'autoFocus',
  crossorigin: 'crossOrigin', srcset: 'srcSet', frameborder: 'frameBorder', allowfullscreen: 'allowFullScreen',
  contenteditable: 'contentEditable', enctype: 'encType', referrerpolicy: 'referrerPolicy', playsinline: 'playsInline',
  viewbox: 'viewBox', 'xlink:href': 'xlinkHref', 'xml:space': 'xmlSpace', 'xmlns:xlink': 'xmlnsXlink',
};
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const BOOL = new Set(['checked', 'disabled', 'selected', 'multiple', 'muted', 'autoplay', 'loop', 'controls', 'hidden', 'required', 'open', 'defer', 'async', 'novalidate']);

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const esc = (s) => s.replace(/[{}<>]/g, (c) => `{'${c}'}`);

function styleObj(style) {
  const parts = style.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':');
    const k = d.slice(0, i).trim(); const v = d.slice(i + 1).trim();
    const key = k.startsWith('--') ? `'${k}'` : camel(k.replace(/^-ms-/, 'ms-'));
    return `${key}: ${JSON.stringify(v)}`;
  });
  return `{{ ${parts.join(', ')} }}`;
}

function attrName(n) {
  if (ATTR[n]) return ATTR[n];
  if (n.startsWith('data-') || n.startsWith('aria-')) return n;
  if (n.startsWith('on')) return null; // eliminamos handlers inline
  return camel(n);
}

function render(node, assetPrefix, depth = 0) {
  const pad = '  '.repeat(depth);
  if (node.type === 'text') {
    const t = node.data.replace(/\s+/g, ' ');
    return t.trim() ? pad + esc(t.trim()) : '';
  }
  if (node.type === 'comment') return '';
  if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') return '';
  const tag = node.name;
  if (tag === 'script') return '';
  const attrs = Object.entries(node.attribs || {}).map(([k, v]) => {
    const n = attrName(k);
    if (!n) return '';
    if (n === 'style') return `style=${styleObj(v)}`;
    if (BOOL.has(k) && (v === '' || v === k)) return n;
    let val = v;
    if (['src', 'srcSet', 'poster', 'href'].includes(n)) val = val.replace(/(^|,\s*)assets\//g, `$1${assetPrefix}assets/`);
    return `${n}=${JSON.stringify(val)}`;
  }).filter(Boolean).join(' ');
  const open = `${pad}<${tag}${attrs ? ' ' + attrs : ''}`;
  if (VOID.has(tag)) return `${open} />`;
  if (tag === 'style') return `${pad}<style>{${JSON.stringify(cheerioText(node))}}</style>`;
  const kids = (node.children || []).map((c) => render(c, assetPrefix, depth + 1)).filter(Boolean);
  if (!kids.length) return `${open} />`;
  return `${open}>\n${kids.join('\n')}\n${pad}</${tag}>`;
}
function cheerioText(node) { return (node.children || []).map((c) => c.data || '').join(''); }

function htmlToJsx(html, assetPrefix = '/') {
  const $ = cheerio.load(html, { xmlMode: false }, false);
  return $.root().contents().toArray().map((n) => render(n, assetPrefix)).filter(Boolean).join('\n');
}

module.exports = { htmlToJsx };
