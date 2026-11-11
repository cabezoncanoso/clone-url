// Plugin de Figma: importa un figma.json de Total Copy URL como capas editables.
// Sin dependencias ni red. JS conservador (sin optional chaining) para el sandbox de Figma.
figma.showUI(__html__, { width: 300, height: 300 });

var STYLE_BY_WEIGHT = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
var FALLBACK_FAMILY = 'Inter';

function norm(s) { return String(s).toLowerCase().replace(/[\s_-]/g, ''); }

var fontIndex = null; // familia normalizada -> { family, styles: { estiloNormalizado: estiloReal } }
async function buildFontIndex() {
  if (fontIndex) return fontIndex;
  fontIndex = {};
  var list = await figma.listAvailableFontsAsync();
  for (var i = 0; i < list.length; i++) {
    var f = list[i].fontName;
    var k = norm(f.family);
    if (!fontIndex[k]) fontIndex[k] = { family: f.family, styles: {} };
    fontIndex[k].styles[norm(f.style)] = f.style;
  }
  return fontIndex;
}

function wantedStyle(weight, italic) {
  var w = Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
  var base = STYLE_BY_WEIGHT[w];
  if (!italic) return [base];
  return w === 400 ? ['Italic', 'Regular Italic', base] : [base + ' Italic', base];
}

var fontCache = {};
async function resolveFont(font) {
  var key = font.family + '|' + font.weight + '|' + font.italic;
  if (fontCache[key]) return fontCache[key];
  var idx = await buildFontIndex();
  var tries = [font.family, FALLBACK_FAMILY];
  var result = null;
  for (var t = 0; t < tries.length && !result; t++) {
    var fam = idx[norm(tries[t])];
    if (!fam) continue;
    var styles = wantedStyle(font.weight, font.italic).concat(['Regular']);
    for (var s = 0; s < styles.length; s++) {
      var real = fam.styles[norm(styles[s])];
      if (real) { result = { family: fam.family, style: real }; break; }
    }
    if (!result) { var any = Object.keys(fam.styles)[0]; if (any) result = { family: fam.family, style: fam.styles[any] }; }
  }
  if (!result) result = { family: 'Inter', style: 'Regular' };
  try { await figma.loadFontAsync(result); } catch (e) { result = { family: 'Inter', style: 'Regular' }; await figma.loadFontAsync(result); }
  fontCache[key] = result;
  return result;
}

function solid(c) { return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }; }

var imageHashes = {};
function paints(node) {
  var out = [];
  var fills = node.fills || [];
  for (var i = 0; i < fills.length; i++) {
    var f = fills[i];
    if (f.type === 'SOLID') out.push(solid(f.color));
    else if (f.type === 'IMAGE' && imageHashes[f.src]) out.push({ type: 'IMAGE', imageHash: imageHashes[f.src], scaleMode: f.scale || 'FILL' });
  }
  return out;
}

function applyBox(n, node, parentAbs) {
  n.name = node.name || n.name;
  n.x = node.x - parentAbs.x;
  n.y = node.y - parentAbs.y;
  if (n.type !== 'TEXT') n.resize(Math.max(node.w, 0.01), Math.max(node.h, 0.01));
  if (node.opacity !== undefined && node.opacity < 1) n.opacity = node.opacity;
}

function applyDecor(n, node) {
  if (node.strokes) {
    var s = node.strokes;
    n.strokes = [solid(s.color)];
    n.strokeAlign = 'INSIDE';
    if (s.top === s.right && s.top === s.bottom && s.top === s.left) n.strokeWeight = s.top;
    else { n.strokeTopWeight = s.top; n.strokeRightWeight = s.right; n.strokeBottomWeight = s.bottom; n.strokeLeftWeight = s.left; }
  }
  if (node.radius) {
    n.topLeftRadius = node.radius[0]; n.topRightRadius = node.radius[1];
    n.bottomRightRadius = node.radius[2]; n.bottomLeftRadius = node.radius[3];
  }
  if (node.shadows && node.shadows.length) {
    n.effects = node.shadows.map(function (sh) {
      return { type: sh.inset ? 'INNER_SHADOW' : 'DROP_SHADOW', color: { r: sh.color.r, g: sh.color.g, b: sh.color.b, a: sh.color.a },
        offset: { x: sh.x, y: sh.y }, radius: sh.blur, spread: sh.spread, visible: true, blendMode: 'NORMAL' };
    });
  }
}

var count = 0;
async function build(node, parent, parentAbs) {
  count++;
  if (count % 200 === 0) figma.ui.postMessage({ type: 'progress', text: 'Creando capas… ' + count });

  if (node.type === 'TEXT') {
    var t = figma.createText();
    var font = await resolveFont(node.font);
    t.fontName = font;
    t.characters = node.text;
    t.fontSize = Math.max(1, node.font.size);
    if (node.font.lineHeight) t.lineHeight = { value: node.font.lineHeight, unit: 'PIXELS' };
    if (node.font.letterSpacing) t.letterSpacing = { value: node.font.letterSpacing, unit: 'PIXELS' };
    if (node.color) t.fills = [solid(node.color)];
    t.textAlignHorizontal = node.align || 'LEFT';
    if (node.underline) t.textDecoration = 'UNDERLINE'; else if (node.strike) t.textDecoration = 'STRIKETHROUGH';
    parent.appendChild(t);
    t.name = node.name || node.text.slice(0, 40);
    if (node.lines > 1) { t.textAutoResize = 'HEIGHT'; t.resize(Math.max(node.w, 1), Math.max(node.h, 1)); t.textAutoResize = 'HEIGHT'; }
    else t.textAutoResize = 'WIDTH_AND_HEIGHT';
    t.x = node.x - parentAbs.x;
    t.y = node.y - parentAbs.y;
    if (node.autoWidth && !node.before) t.x = t.x - t.width;
    if (node.autoWidth) t.y = t.y + (node.h - t.height) / 2;
    return t;
  }

  if (node.type === 'SVG') {
    var v;
    try { v = figma.createNodeFromSvg(node.svg); }
    catch (e) { v = figma.createRectangle(); v.fills = [solid({ r: 0.8, g: 0.8, b: 0.8, a: 1 })]; }
    parent.appendChild(v);
    applyBox(v, node, parentAbs);
    v.name = node.name;
    return v;
  }

  if (node.type === 'IMAGE') {
    var r = figma.createRectangle();
    parent.appendChild(r);
    applyBox(r, node, parentAbs);
    r.fills = imageHashes[node.src]
      ? [{ type: 'IMAGE', imageHash: imageHashes[node.src], scaleMode: node.scale || 'FILL' }]
      : [solid({ r: 0.85, g: 0.85, b: 0.85, a: 1 })];
    applyDecor(r, node);
    return r;
  }

  var f = figma.createFrame();
  parent.appendChild(f);
  applyBox(f, node, parentAbs);
  f.fills = paints(node);
  f.clipsContent = !!node.clip;
  applyDecor(f, node);
  var abs = { x: node.x, y: node.y };
  for (var i = 0; i < node.children.length; i++) await build(node.children[i], f, abs);
  return f;
}

figma.ui.onmessage = async function (msg) {
  if (msg.type !== 'import') return;
  try {
    await figma.currentPage.loadAsync();
    count = 0;
    var keys = Object.keys(msg.images);
    for (var i = 0; i < keys.length; i++) {
      try { imageHashes[keys[i]] = figma.createImage(msg.images[keys[i]]).hash; } catch (e) { /* formato no admitido */ }
    }
    var startX = 0;
    var vp = figma.viewport.center;
    var created = [];
    for (var k = 0; k < msg.frames.length; k++) {
      var fr = msg.frames[k];
      var top = figma.createFrame();
      top.name = fr.name + ' · ' + fr.viewport + 'px';
      top.resize(Math.max(fr.width, 1), Math.max(fr.height, 1));
      top.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      top.clipsContent = true;
      figma.currentPage.appendChild(top);
      top.x = Math.round(vp.x) + startX;
      top.y = Math.round(vp.y);
      var inner = await build(fr.tree, top, { x: 0, y: 0 });
      // la raíz de la sección ocupa todo el frame; si no tiene relleno propio se aplana dentro del frame
      if (inner && inner.type === 'FRAME' && inner.fills.length === 0 && !inner.strokes.length && !inner.effects.length) {
        var kids = inner.children.slice();
        for (var c = 0; c < kids.length; c++) { var kx = kids[c].x, ky = kids[c].y; top.appendChild(kids[c]); kids[c].x = kx + inner.x; kids[c].y = ky + inner.y; }
        inner.remove();
      }
      startX += fr.width + 120;
      created.push(top);
    }
    figma.currentPage.selection = created;
    figma.viewport.scrollAndZoomIntoView(created);
    figma.ui.postMessage({ type: 'done', text: 'Listo: ' + count + ' capas en ' + created.length + ' frames.' });
  } catch (e) {
    figma.ui.postMessage({ type: 'error', text: 'Error: ' + (e && e.message ? e.message : e) });
  }
};
