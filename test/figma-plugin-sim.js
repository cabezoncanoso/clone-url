// Simulador mínimo de la API de plugins de Figma: ejecuta figma-plugin/code.js con un figma.json
// y genera un HTML con el resultado para revisarlo sin abrir Figma.
// Uso: node test/figma-plugin-sim.js figma-plugin/code.js ruta/figma.json salida.html
const fs = require('fs'); const vm = require('vm');
const [,, codePath, jsonPath, outHtml] = process.argv;
let id = 0; const imgs = {};
class Node {
  constructor(type) { this.type = type; this.id = ++id; this.children = []; this.x = 0; this.y = 0; this.width = 100; this.height = 100; this.fills = type === 'FRAME' ? [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }] : []; this.strokes = []; this.effects = []; this.opacity = 1; this.parent = null; }
  resize(w, h) { if (!(w >= 0.01 && h >= 0.01)) throw new Error('resize inválido ' + w + 'x' + h); this.width = w; this.height = h; }
  appendChild(c) { if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1); c.parent = this; this.children.push(c); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }
}
class Text extends Node {
  constructor() { super('TEXT'); this._fontName = null; this.fontSize = 12; this.textAutoResize = 'NONE'; }
  set fontName(f) { if (!loaded.has(f.family + '|' + f.style)) throw new Error('fuente no cargada ' + JSON.stringify(f)); this._fontName = f; }
  get fontName() { return this._fontName; }
  set characters(c) { if (!this._fontName) throw new Error('characters sin fuente'); this._c = c; this._fit(); }
  get characters() { return this._c; }
  _fit() { if (this.textAutoResize === 'WIDTH_AND_HEIGHT') { this.width = this._c.length * this.fontSize * 0.55; this.height = this.fontSize * 1.2; } }
  set textAutoResize(v) { this._ar = v; if (this._c) this._fit(); } get textAutoResize() { return this._ar; }
}
const loaded = new Set();
const FONTS = ['Regular', 'Medium', 'Semi Bold', 'Bold', 'Italic', 'Bold Italic'].map((s) => ({ fontName: { family: 'Inter', style: s } }));
const page = new Node('PAGE'); const msgs = [];
const figma = {
  showUI() {}, ui: { postMessage: (m) => msgs.push(m), onmessage: null },
  createFrame: () => new Node('FRAME'), createRectangle: () => new Node('RECTANGLE'), createText: () => new Text(),
  createNodeFromSvg: (svg) => { const n = new Node('FRAME'); n.svg = svg; n.fills = []; return n; },
  createImage: (bytes) => { if (!(bytes instanceof Uint8Array)) throw new Error('bytes no Uint8Array'); const h = 'h' + Object.keys(imgs).length; imgs[h] = Buffer.from(bytes).toString('base64'); return { hash: h }; },
  listAvailableFontsAsync: async () => FONTS,
  loadFontAsync: async (f) => { if (!FONTS.some((x) => x.fontName.family === f.family && x.fontName.style === f.style)) throw new Error('no existe'); loaded.add(f.family + '|' + f.style); },
  viewport: { center: { x: 0, y: 0 }, scrollAndZoomIntoView() {} }, currentPage: page,
};
page.loadAsync = async () => {}; Object.defineProperty(page, 'selection', { set() {} });
vm.runInNewContext(fs.readFileSync(codePath, 'utf8'), { figma, __html__: '', console });
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const images = {}; for (const [u, im] of Object.entries(data.images)) images[u] = new Uint8Array(Buffer.from(im.data, 'base64'));
(async () => {
  await figma.ui.onmessage({ type: 'import', frames: data.frames, images, selector: data.selector });
  console.log(msgs.map((m) => m.text).join('\n'));
  const col = (c, o = 1) => `rgba(${c.r * 255},${c.g * 255},${c.b * 255},${o})`;
  const render = (n) => {
    const st = [`position:absolute;left:${n.x}px;top:${n.y}px;width:${n.width}px;height:${n.height}px;opacity:${n.opacity}`];
    if (n.clipsContent) st.push('overflow:hidden');
    for (const f of n.fills || []) {
      if (n.type === 'TEXT') continue;
      if (f.type === 'SOLID') st.push(`background-color:${col(f.color, f.opacity ?? 1)}`);
      if (f.type === 'IMAGE') st.push(`background-image:url(data:image/png;base64,${imgs[f.imageHash]});background-size:${f.scaleMode === 'FIT' ? 'contain' : f.scaleMode === 'TILE' ? 'auto' : 'cover'}`);
    }
    if (n.strokes && n.strokes.length) { const c = col(n.strokes[0].color); st.push(n.strokeWeight !== undefined ? `box-shadow:inset 0 0 0 ${n.strokeWeight}px ${c}` : `border-style:solid;box-sizing:border-box;border-color:${c};border-width:${n.strokeTopWeight}px ${n.strokeRightWeight}px ${n.strokeBottomWeight}px ${n.strokeLeftWeight}px`); }
    if (n.topLeftRadius !== undefined) st.push(`border-radius:${n.topLeftRadius}px ${n.topRightRadius}px ${n.bottomRightRadius}px ${n.bottomLeftRadius}px`);
    const sh = (n.effects || []).filter((e) => e.type === 'DROP_SHADOW'); if (sh.length) st.push('filter:' + sh.map((e) => `drop-shadow(${e.offset.x}px ${e.offset.y}px ${e.radius / 2}px ${col(e.color, e.color.a)})`).join(' '));
    if (n.type === 'TEXT') {
      const f = n.fills[0];
      st.push(`font-family:${n._fontName.family},sans-serif;font-weight:${/Bold/.test(n._fontName.style) ? 700 : 400};font-size:${n.fontSize}px;color:${f ? col(f.color, f.opacity) : '#000'};white-space:${n.textAutoResize === 'WIDTH_AND_HEIGHT' ? 'nowrap' : 'normal'};text-align:${(n.textAlignHorizontal || 'LEFT').toLowerCase()};${n.lineHeight ? 'line-height:' + n.lineHeight.value + 'px;' : ''}${n.textDecoration === 'UNDERLINE' ? 'text-decoration:underline;' : ''}`);
      if (n.textAutoResize === 'WIDTH_AND_HEIGHT') st.push('width:auto;height:auto');
      return `<div style="${st.join(';')}">${n._c.replace(/</g, '&lt;')}</div>`;
    }
    if (n.svg) return `<div style="${st.join(';')}">${n.svg}</div>`;
    return `<div title="${n.name}" style="${st.join(';')}">${n.children.map(render).join('')}</div>`;
  };
  const tops = page.children; const minX = Math.min(...tops.map((t) => t.x));
  tops.forEach((t) => { t.x -= minX; });
  fs.writeFileSync(outHtml, `<!doctype html><body style="margin:0;background:#888;position:relative">${tops.map(render).join('')}</body>`);
  console.log('frames:', tops.map((t) => `${t.name} ${t.width}x${Math.round(t.height)} hijos=${t.children.length}`).join(' | '));
})().catch((e) => { console.error('FALLO', e); process.exit(1); });
