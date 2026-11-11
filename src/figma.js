// Serializa una sección (o la página completa) a un JSON de capas que importa el plugin de figma-plugin/.
// Se generan tres frames: escritorio, tablet y móvil.
const { chromium } = require('playwright');
const fs = require('fs/promises');
const path = require('path');

const FRAMES = [
  { name: 'Escritorio', width: 1440 },
  { name: 'Tablet', width: 768 },
  { name: 'Móvil', width: 390 },
];

// Se ejecuta en el navegador: árbol de capas con posiciones relativas a la raíz
function serialize(selector) {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch { a.cancel(); } });
  const root = selector === 'body' ? document.body : document.querySelector(selector);
  if (!root) return null;
  const R = root.getBoundingClientRect();
  const sx = window.scrollX; const sy = window.scrollY;
  const ox = R.left; const oy = R.top;

  const color = (v) => {
    const m = v && v.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    const a = m[4] === undefined ? 1 : +m[4];
    if (a === 0) return null;
    return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a };
  };
  const px = (v) => parseFloat(v) || 0;
  const abs = (u) => { try { return new URL(u, document.baseURI).href; } catch { return null; } };
  const box = (r) => ({ x: r.left - ox, y: r.top - oy, w: r.width, h: r.height });

  function shadows(v) {
    if (!v || v === 'none') return [];
    // rgb(0, 0, 0) 0px 4px 12px 0px [inset]
    return v.split(/,(?![^(]*\))/).map((s) => {
      const c = color(s.match(/rgba?\([^)]*\)/)?.[0]);
      const nums = s.replace(/rgba?\([^)]*\)/, '').trim().split(/\s+/).filter((n) => /px$/.test(n)).map(px);
      if (!c || nums.length < 2) return null;
      return { color: c, x: nums[0], y: nums[1], blur: nums[2] || 0, spread: nums[3] || 0, inset: /inset/.test(s) };
    }).filter(Boolean);
  }

  function textNode(t, cs) {
    const text = t.data.replace(/\s+/g, ' ');
    if (!text.trim()) return null;
    const range = document.createRange(); range.selectNodeContents(t);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) return null;
    const r = range.getBoundingClientRect();
    const tt = cs.textTransform;
    const content = tt === 'uppercase' ? text.toUpperCase() : tt === 'lowercase' ? text.toLowerCase() : text;
    return {
      type: 'TEXT', name: content.trim().slice(0, 40), ...box(r),
      text: content.trim(), lines: rects.length > 1 ? new Set(rects.map((x) => Math.round(x.top))).size : 1,
      font: {
        family: cs.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, ''),
        weight: +cs.fontWeight || 400, italic: cs.fontStyle === 'italic',
        size: px(cs.fontSize), lineHeight: cs.lineHeight === 'normal' ? null : px(cs.lineHeight),
        letterSpacing: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing),
      },
      color: color(cs.color), align: { center: 'CENTER', right: 'RIGHT', end: 'RIGHT', justify: 'JUSTIFIED' }[cs.textAlign] || 'LEFT',
      underline: cs.textDecorationLine.includes('underline'), strike: cs.textDecorationLine.includes('line-through'),
    };
  }

  function walk(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null;
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const node = {
      type: 'FRAME', name: tag + (el.id ? '#' + el.id : el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''),
      ...box(r), opacity: +cs.opacity, clip: cs.overflow !== 'visible' && el !== document.body,
      fills: [], strokes: null, radius: null, shadows: shadows(cs.boxShadow), children: [],
    };
    if (r.width === 0 && r.height === 0 && !el.children.length) return null;

    const bg = color(cs.backgroundColor);
    if (bg) node.fills.push({ type: 'SOLID', color: bg });
    const bgUrls = [...cs.backgroundImage.matchAll(/url\("?([^")]+)"?\)/g)].map((m) => abs(m[1])).filter(Boolean);
    for (const u of bgUrls) node.fills.push({ type: 'IMAGE', src: u, scale: cs.backgroundSize === 'contain' ? 'FIT' : cs.backgroundSize === 'cover' ? 'FILL' : cs.backgroundRepeat.startsWith('repeat') && cs.backgroundSize === 'auto' ? 'TILE' : 'FILL' });
    const grad = cs.backgroundImage.match(/linear-gradient\(.+\)/);
    if (grad && !bgUrls.length) node.gradient = grad[0];

    const bw = ['Top', 'Right', 'Bottom', 'Left'].map((s) => px(cs[`border${s}Width`]));
    if (bw.some((w) => w > 0)) {
      const c = color(cs.borderTopColor) || color(cs.borderBottomColor) || color(cs.borderLeftColor);
      if (c) node.strokes = { color: c, top: bw[0], right: bw[1], bottom: bw[2], left: bw[3] };
    }
    const rad = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((s) => px(cs[`border${s}Radius`]));
    if (rad.some((v) => v > 0)) node.radius = rad;

    if (tag === 'img') {
      const src = el.currentSrc || el.src;
      node.type = 'IMAGE'; node.src = abs(src);
      node.scale = cs.objectFit === 'contain' ? 'FIT' : cs.objectFit === 'cover' ? 'FILL' : 'FILL';
      node.name = 'img' + (el.alt ? ' · ' + el.alt.slice(0, 30) : '');
      return node;
    }
    if (tag === 'svg') {
      const clone = el.cloneNode(true);
      clone.setAttribute('width', r.width); clone.setAttribute('height', r.height);
      if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      // resuelve currentColor
      clone.innerHTML = clone.innerHTML.replace(/currentColor/g, cs.color);
      if ((clone.getAttribute('fill') || '') === 'currentColor') clone.setAttribute('fill', cs.color);
      node.type = 'SVG'; node.svg = clone.outerHTML;
      return node;
    }
    if (['script', 'style', 'noscript', 'template', 'iframe', 'video', 'canvas', 'br', 'head', 'meta', 'link'].includes(tag)) {
      if (tag === 'video' || tag === 'iframe' || tag === 'canvas') { node.fills.push({ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85, a: 1 } }); node.name = tag; return node; }
      return null;
    }
    if (['input', 'textarea', 'select', 'button'].includes(tag) && (el.value || el.placeholder)) {
      const fake = document.createTextNode(el.value || el.placeholder || '');
      // usamos el rectángulo del control con padding
      const t = { type: 'TEXT', name: 'valor', x: r.left - ox + px(cs.paddingLeft), y: r.top - oy + px(cs.paddingTop), w: r.width - px(cs.paddingLeft) - px(cs.paddingRight), h: r.height - px(cs.paddingTop) - px(cs.paddingBottom), text: fake.data, lines: 1,
        font: { family: cs.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, ''), weight: +cs.fontWeight || 400, italic: false, size: px(cs.fontSize), lineHeight: null, letterSpacing: 0 },
        color: color(cs.color) || { r: 0, g: 0, b: 0, a: 1 }, align: 'LEFT' };
      if (tag !== 'button') node.children.push(t);
    }

    for (const child of el.childNodes) {
      if (child.nodeType === 3) { const t = textNode(child, cs); if (t) node.children.push(t); }
      else if (child.nodeType === 1) { const c = walk(child); if (c) node.children.push(c); }
    }
    // pseudo-elementos con texto (iconos, flechas…)
    for (const pseudo of ['::before', '::after']) {
      const pcs = getComputedStyle(el, pseudo);
      const content = pcs.content;
      if (content && content !== 'none' && content !== 'normal' && /^["']/.test(content)) {
        const txt = content.slice(1, -1).replace(/\\"/g, '"');
        if (txt.trim()) {
          // posición aproximada: al principio o al final del elemento
          node.children.push({ type: 'TEXT', name: pseudo, x: pseudo === '::before' ? r.left - ox : r.right - ox, y: r.top - oy, w: 0, h: r.height, text: txt, lines: 1, autoWidth: true, before: pseudo === '::before',
            font: { family: pcs.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, ''), weight: +pcs.fontWeight || 400, italic: pcs.fontStyle === 'italic', size: px(pcs.fontSize), lineHeight: null, letterSpacing: 0 },
            color: color(pcs.color), align: 'LEFT' });
        }
      }
    }
    // descarta contenedores vacíos e invisibles
    if (!node.children.length && !node.fills.length && !node.strokes && !node.shadows.length) return null;
    return node;
  }

  const tree = walk(root);
  if (tree) { tree.x = 0; tree.y = 0; }
  return { tree, width: R.width, height: R.height, scroll: { sx, sy } };
}

async function exportFigma({ snapshotUrl, snapshotDir, selector = 'body', outFile, log = console.log }) {
  const browser = await chromium.launch();
  const base = new URL('./', snapshotUrl).href;
  const frames = [];
  const srcs = new Set();
  for (const f of FRAMES) {
    const page = await browser.newPage({ viewport: { width: f.width, height: 900 } });
    await page.goto(snapshotUrl, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.scrollTo(0, 0));
    const data = await page.evaluate(serialize, selector);
    await page.close();
    if (!data || !data.tree) continue;
    const visit = (n) => {
      if (n.src) srcs.add(n.src);
      (n.fills || []).forEach((fl) => fl.src && srcs.add(fl.src));
      (n.children || []).forEach(visit);
    };
    visit(data.tree);
    frames.push({ name: f.name, viewport: f.width, width: data.width, height: data.height, tree: data.tree });
  }
  if (!frames.length) { await browser.close(); throw new Error('Selector no encontrado: ' + selector); }

  // Imágenes embebidas en base64 (solo las del snapshot local)
  const images = {};
  for (const u of srcs) {
    if (!u.startsWith(base)) continue;
    const rel = decodeURIComponent(u.slice(base.length).split(/[?#]/)[0]);
    try {
      const buf = await fs.readFile(path.join(snapshotDir, rel));
      images[u] = { name: path.basename(rel), ext: path.extname(rel).slice(1).toLowerCase(), data: buf.toString('base64') };
    } catch { log(`Imagen no encontrada: ${rel}`); }
  }
  // Figma solo admite PNG, JPG y GIF: convertimos webp/avif/svg/ico a PNG con un canvas
  const conv = Object.entries(images).filter(([, im]) => !['png', 'jpg', 'jpeg', 'gif'].includes(im.ext));
  if (conv.length) {
    const page = await browser.newPage();
    const MIME = { webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp' };
    for (const [u, im] of conv) {
      const png = await page.evaluate(async ({ src }) => {
        const img = new Image(); img.src = src;
        try { await img.decode(); } catch { return null; }
        const k = /svg/.test(src.slice(0, 30)) ? 2 : 1;
        const c = document.createElement('canvas');
        c.width = (img.naturalWidth || 300) * k; c.height = (img.naturalHeight || 150) * k;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/png').split(',')[1];
      }, { src: `data:${MIME[im.ext] || 'image/png'};base64,${im.data}` });
      if (png) images[u] = { name: im.name.replace(/\.[^.]+$/, '.png'), ext: 'png', data: png };
      else delete images[u];
    }
  }
  await browser.close();

  const out = { format: 'total-copy-url/figma', version: 1, selector, frames, images };
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(out));
  return { frames: frames.length, images: Object.keys(images).length, bytes: (await fs.stat(outFile)).size };
}

module.exports = { exportFigma, serialize };
