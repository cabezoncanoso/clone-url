// Extrae una sección (selector CSS) de un snapshot local: HTML, solo el CSS que le aplica
// (manteniendo @media / @supports / @container), fuentes, keyframes y assets usados.
const { chromium } = require('playwright');
const fs = require('fs/promises');
const path = require('path');
const { VIEWPORTS } = require('./screenshots');
const { htmlToJsx } = require('./jsx');
const { exportFigma } = require('./figma');
const { collectStyles, buildTailwind, PROPS, PREFLIGHT } = require('./tailwind');

// Se ejecuta dentro del navegador
function collectInPage(selector) {
  const root = document.querySelector(selector);
  if (!root) return { error: 'Selector no encontrado: ' + selector };

  const ancestors = [];
  for (let p = root.parentElement; p; p = p.parentElement) ancestors.unshift(p);
  const subtree = [root, ...root.querySelectorAll('*')];
  const all = new Set([...ancestors, ...subtree]);
  const allArr = [...all];

  const DYN = /::?(before|after|placeholder|selection|marker|first-line|first-letter|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)|:(hover|focus|focus-within|focus-visible|active|visited|link|target|checked|disabled|enabled|invalid|valid|required|optional|placeholder-shown|autofill|-webkit-autofill)\b/g;

  function splitSelectors(text) {
    const out = []; let depth = 0; let cur = '';
    for (const ch of text) {
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim()).filter(Boolean);
  }
  function matchesAny(sel) {
    let s = sel.replace(DYN, '').trim();
    if (!s || /[>+~]$/.test(s)) s = s.replace(/[>+~]\s*$/, '') || '*';
    try { return allArr.some((el) => el.matches(s)); } catch { return false; }
  }

  // fuentes y animaciones usadas
  const fonts = new Set(); const anims = new Set();
  for (const el of subtree) {
    for (const pseudo of [null, '::before', '::after']) {
      const cs = getComputedStyle(el, pseudo);
      cs.fontFamily.split(',').forEach((f) => fonts.add(f.trim().replace(/^['"]|['"]$/g, '').toLowerCase()));
      cs.animationName.split(',').forEach((a) => a.trim() !== 'none' && anims.add(a.trim()));
    }
  }

  const media = new Set();
  function walk(rules, baseHref) {
    let out = '';
    for (const rule of rules) {
      const fix = (t) => t.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/g, (m, u) => {
        if (u.startsWith('data:')) return m;
        try { return `url("${new URL(u, baseHref).href}")`; } catch { return m; }
      });
      if (rule instanceof CSSStyleRule) {
        const parts = splitSelectors(rule.selectorText);
        const kept = parts.filter(matchesAny);
        if (kept.length) {
          const body = rule.cssText.slice(rule.cssText.indexOf('{'));
          out += fix(`${kept.join(', ')} ${body}`) + '\n';
        }
      } else if (rule instanceof CSSMediaRule) {
        const inner = walk(rule.cssRules, baseHref);
        if (inner) { media.add(rule.conditionText || rule.media.mediaText); out += `@media ${rule.conditionText || rule.media.mediaText} {\n${inner}}\n`; }
      } else if (window.CSSContainerRule && rule instanceof CSSContainerRule) {
        const inner = walk(rule.cssRules, baseHref);
        if (inner) out += `@container ${rule.conditionText} {\n${inner}}\n`;
      } else if (rule instanceof CSSSupportsRule) {
        const inner = walk(rule.cssRules, baseHref);
        if (inner) out += `@supports ${rule.conditionText} {\n${inner}}\n`;
      } else if (window.CSSLayerBlockRule && rule instanceof CSSLayerBlockRule) {
        const inner = walk(rule.cssRules, baseHref);
        if (inner) out += `@layer ${rule.name} {\n${inner}}\n`;
      } else if (rule instanceof CSSFontFaceRule) {
        const fam = rule.style.getPropertyValue('font-family').trim().replace(/^['"]|['"]$/g, '').toLowerCase();
        if (fonts.has(fam)) out += fix(rule.cssText) + '\n';
      } else if (rule instanceof CSSKeyframesRule) {
        if (anims.has(rule.name)) out += rule.cssText + '\n';
      } else if (rule instanceof CSSImportRule) {
        try { out += walk(rule.styleSheet.cssRules, rule.styleSheet.href || baseHref); } catch {}
      } else if (window.CSSPropertyRule && rule instanceof CSSPropertyRule) {
        out += rule.cssText + '\n';
      }
    }
    return out;
  }

  let css = '';
  for (const sheet of document.styleSheets) {
    try { css += walk(sheet.cssRules, sheet.href || document.baseURI); } catch { /* hoja inaccesible */ }
  }

  // Esqueleto de ancestros (mismas etiquetas/clases/ids) para que los selectores descendientes sigan funcionando
  const shell = (el) => {
    const c = el.cloneNode(false);
    return c.outerHTML.replace(/<\/[^>]+>$/, '');
  };
  const anc = ancestors.filter((a) => a !== document.documentElement && a !== document.body);
  const open = anc.map(shell).join('\n');
  const close = anc.map((a) => `</${a.tagName.toLowerCase()}>`).reverse().join('\n');

  const absUrl = (u) => { try { return new URL(u, document.baseURI).href; } catch { return u; } };
  const clone = root.cloneNode(true);
  [clone, ...clone.querySelectorAll('*')].forEach((el) => {
    for (const a of ['src', 'poster']) if (el.getAttribute(a) && !el.getAttribute(a).startsWith('data:')) el.setAttribute(a, absUrl(el.getAttribute(a)));
    if (el.getAttribute('srcset')) el.setAttribute('srcset', el.getAttribute('srcset').split(',').map((p) => { const [u, d] = p.trim().split(/\s+/); return [absUrl(u), d].filter(Boolean).join(' '); }).join(', '));
    if (el.getAttribute('style')) el.setAttribute('style', el.getAttribute('style').replace(/url\(\s*["']?([^"')]+)["']?\s*\)/g, (m, u) => u.startsWith('data:') ? m : `url("${absUrl(u)}")`));
  });

  return {
    html: clone.outerHTML,
    open, close,
    htmlAttrs: [...document.documentElement.attributes].map((a) => `${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join(' '),
    bodyAttrs: [...document.body.attributes].map((a) => `${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join(' '),
    css,
    media: [...media],
    rect: root.getBoundingClientRect().toJSON(),
  };
}

async function exportSection({ snapshotUrl, snapshotDir, selector, outDir, log = console.log }) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(snapshotUrl, { waitUntil: 'networkidle' });
  const data = await page.evaluate(collectInPage, selector);
  if (data.error) { await browser.close(); throw new Error(data.error); }

  await fs.mkdir(outDir, { recursive: true });
  const base = new URL('./', snapshotUrl).href; // http://host/snapshots/<id>/
  const used = new Set();
  const localize = (text, fromRoot = '') => text.replace(/https?:\/\/[^\s"')]+/g, (u) => {
    if (!u.startsWith(base)) return u;
    const relPath = decodeURIComponent(u.slice(base.length).split(/[?#]/)[0]);
    used.add(relPath);
    return fromRoot + relPath;
  });

  const css = localize(data.css);
  const html = localize(data.html);
  const copyAssets = async () => { for (const p of used) {
    const src = path.join(snapshotDir, p);
    const dest = path.join(outDir, p);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest).catch(() => log(`No encontrado: ${p}`));
  } };
  await copyAssets();

  const body = `${data.open}\n${html}\n${data.close}`;
  await fs.writeFile(path.join(outDir, 'section.css'), `/* CSS extraído para ${selector}\n * Breakpoints: ${data.media.join(' | ') || 'ninguno'} */\n${css}`);
  await fs.writeFile(path.join(outDir, 'index.html'), `<!doctype html>\n<html ${data.htmlAttrs}>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Sección</title>\n<link rel="stylesheet" href="section.css">\n</head>\n<body ${data.bodyAttrs}>\n${body}\n</body>\n</html>\n`);

  // React y Astro
  await fs.mkdir(path.join(outDir, 'react'), { recursive: true });
  const jsx = htmlToJsx(body, '/');
  await fs.writeFile(path.join(outDir, 'react', 'Section.jsx'), `// Copia la carpeta assets/ a public/assets/ de tu proyecto (las imágenes se sirven desde /assets/)\nimport '../section.css';\n\nexport default function Section() {\n  return (\n    <>\n${jsx.split('\n').map((l) => '      ' + l).join('\n')}\n    </>\n  );\n}\n`);
  await fs.mkdir(path.join(outDir, 'astro'), { recursive: true });
  const astroHtml = body.replace(/(src|href|poster)="assets\//g, '$1="/assets/').replace(/(srcset="[^"]*)/g, (m) => m.replace(/(^|,\s*|")assets\//g, '$1/assets/'));
  await fs.writeFile(path.join(outDir, 'astro', 'Section.astro'), `---\n// Copia la carpeta assets/ a public/assets/ de tu proyecto Astro\nimport '../section.css';\n---\n${astroHtml}\n`);

  // Tailwind: estilos calculados en móvil (base), md (768px) y lg (1280px)
  const styles = {};
  for (const [bp, width] of [['base', 390], ['md', 768], ['lg', 1280]]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(snapshotUrl, { waitUntil: 'networkidle' });
    styles[bp] = await p.evaluate(collectStyles, { selector, props: PROPS, preflight: PREFLIGHT });
    await ctx.close();
  }
  if (styles.base) {
    const twHtml = localize(buildTailwind(data.html, styles));
    await copyAssets();
    const extras = (css.match(/@font-face\s*{[^}]*}/g) || []).join('\n');
    await fs.mkdir(path.join(outDir, 'tailwind'), { recursive: true });
    await fs.writeFile(path.join(outDir, 'tailwind', 'index.html'), `<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Sección (Tailwind)</title>\n<script src="https://cdn.tailwindcss.com/3.4.17"></script>\n<style>\n${extras.replace(/url\("assets\//g, 'url("../assets/')}\n</style>\n</head>\n<body>\n${twHtml.replace(/(src|poster)="assets\//g, '$1="../assets/').replace(/srcset="[^"]*"/g, (m) => m.replace(/(^|,\s*|")assets\//g, '$1../assets/')).replace(/url\(assets\//g, 'url(../assets/')}\n</body>\n</html>\n`);
    const twJsx = htmlToJsx(twHtml, '/').replace(/url\(assets\//g, 'url(/assets/');
    await fs.writeFile(path.join(outDir, 'tailwind', 'Section.jsx'), `// Componente React con clases de Tailwind (copia assets/ a public/assets/).\n// Las fuentes personalizadas necesitan su @font-face en tu CSS global.\nexport default function Section() {\n  return (\n    <>\n${twJsx.split('\n').map((l) => '      ' + l).join('\n')}\n    </>\n  );\n}\n`);
  }

  // Capturas de la sección por breakpoint
  const shots = {};
  for (const [name, opts] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext(opts);
    const p = await ctx.newPage();
    await p.goto(snapshotUrl, { waitUntil: 'networkidle' });
    const el = await p.$(selector);
    if (el && await el.isVisible()) {
      await el.screenshot({ path: path.join(outDir, `section-${name}.png`) }).catch(() => {});
      shots[name] = `section-${name}.png`;
    }
    await ctx.close();
  }
  await browser.close();
  // Figma: capas para el plugin de figma-plugin/
  let figmaInfo = null;
  try { figmaInfo = await exportFigma({ snapshotUrl, snapshotDir, selector, outFile: path.join(outDir, 'figma', 'figma.json'), log }); }
  catch (e) { log('Figma: ' + e.message); }
  await fs.writeFile(path.join(outDir, 'meta.json'), JSON.stringify({ selector, breakpoints: data.media, assets: [...used], shots }, null, 2));
  return { breakpoints: data.media, assets: used.size, cssBytes: css.length, shots, figma: figmaInfo };
}

module.exports = { exportSection };
