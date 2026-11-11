// Descarga una URL renderizada con todos sus recursos y reescribe las rutas a relativas.
const { chromium } = require('playwright');
const cheerio = require('cheerio');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const EXT_BY_TYPE = {
  'text/css': '.css', 'application/javascript': '.js', 'text/javascript': '.js',
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/svg+xml': '.svg', 'image/avif': '.avif', 'image/x-icon': '.ico',
  'font/woff2': '.woff2', 'font/woff': '.woff', 'font/ttf': '.ttf', 'font/otf': '.otf',
  'application/font-woff2': '.woff2', 'application/font-woff': '.woff',
  'video/mp4': '.mp4', 'video/webm': '.webm',
};

const FOLDER_BY_EXT = {
  '.css': 'css', '.js': 'js', '.mjs': 'js',
  '.woff2': 'fonts', '.woff': 'fonts', '.ttf': 'fonts', '.otf': 'fonts', '.eot': 'fonts',
  '.mp4': 'media', '.webm': 'media', '.mp3': 'media',
};

function localPathFor(resUrl, contentType) {
  const u = new URL(resUrl);
  let base = decodeURIComponent(path.posix.basename(u.pathname)) || 'index';
  base = base.replace(/[^\w.\-]/g, '_').slice(0, 80);
  let ext = path.extname(base).toLowerCase();
  const typeExt = EXT_BY_TYPE[(contentType || '').split(';')[0].trim()];
  if (!ext && typeExt) { ext = typeExt; base += ext; }
  const folder = FOLDER_BY_EXT[ext] || (ext ? 'img' : 'misc');
  // hash corto para evitar colisiones entre ficheros con el mismo nombre
  const h = crypto.createHash('md5').update(resUrl).digest('hex').slice(0, 6);
  const name = base.replace(/(\.[^.]*)?$/, `-${h}$1`);
  return `assets/${folder}/${name}`;
}

function rel(fromFile, toFile) {
  let r = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return r.startsWith('.') ? r : './' + r;
}

function rewriteCssUrls(css, cssUrl, cssLocal, map) {
  const swap = (raw) => {
    const clean = raw.trim().replace(/^['"]|['"]$/g, '');
    if (!clean || clean.startsWith('data:') || clean.startsWith('#')) return null;
    let abs;
    try { abs = new URL(clean, cssUrl).href.split('#')[0]; } catch { return null; }
    const local = map.get(abs);
    return local ? rel(cssLocal, local) : abs;
  };
  css = css.replace(/url\(\s*([^)]+?)\s*\)/g, (m, raw) => {
    const r = swap(raw);
    return r ? `url("${r}")` : m;
  });
  css = css.replace(/@import\s+(['"])([^'"]+)\1/g, (m, q, raw) => {
    const r = swap(raw);
    return r ? `@import "${r}"` : m;
  });
  return css;
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const step = () => {
        window.scrollBy(0, 600); y += 600;
        if (y < document.body.scrollHeight && y < 30000) setTimeout(step, 120);
        else { window.scrollTo(0, 0); resolve(); }
      };
      step();
    });
  });
}

/**
 * @param {string} url
 * @param {string} outDir
 * @param {{keepScripts?: boolean, log?: (s:string)=>void}} opts
 */
async function snapshot(url, outDir, opts = {}) {
  const log = opts.log || console.log;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const resources = new Map(); // url -> {body, type}

  page.on('response', async (res) => {
    try {
      const req = res.request();
      const rt = req.resourceType();
      if (!['stylesheet', 'image', 'font', 'script', 'media', 'other'].includes(rt)) return;
      if (res.status() >= 300) return;
      const body = await res.body();
      resources.set(res.url().split('#')[0], { body, type: res.headers()['content-type'] || '', rt });
    } catch { /* recursos en streaming o cancelados */ }
  });

  log(`Abriendo ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => log('networkidle no alcanzado, continúo'));
  await autoScroll(page);
  await page.waitForTimeout(1500);

  const finalUrl = page.url();
  // Marca imágenes con src actual (lazy-load) antes de serializar
  await page.evaluate(() => {
    document.querySelectorAll('img').forEach((img) => {
      if (img.currentSrc && !img.getAttribute('src')?.startsWith('data:')) img.setAttribute('src', img.currentSrc);
      img.removeAttribute('loading');
    });
  });
  const html = await page.content();
  const title = await page.title();

  // Segunda pasada: recursos referenciados que el navegador no llegó a pedir
  // (candidatos de srcset de otras densidades, fondos de otros breakpoints, :hover, etc.)
  const wanted = new Set();
  const add = (raw, base) => {
    if (!raw || raw.startsWith('data:') || raw.startsWith('#')) return;
    try { const u = new URL(raw.trim().replace(/^['"]|['"]$/g, ''), base); if (/^https?:$/.test(u.protocol)) wanted.add(u.href.split('#')[0]); } catch {}
  };
  const $pre = cheerio.load(html);
  $pre('img[src], source[src], video[poster], link[rel*="icon"][href], link[rel="stylesheet"][href]').each((_, el) => add($pre(el).attr('src') || $pre(el).attr('poster') || $pre(el).attr('href'), finalUrl));
  $pre('[srcset]').each((_, el) => $pre(el).attr('srcset').split(',').forEach((c) => add(c.trim().split(/\s+/)[0], finalUrl)));
  for (const [u, r] of resources) {
    if (r.rt === 'stylesheet' || r.type.includes('text/css')) {
      for (const m of r.body.toString('utf8').matchAll(/url\(\s*([^)]+?)\s*\)/g)) add(m[1], u);
    }
  }
  const missing = [...wanted].filter((u) => !resources.has(u)).slice(0, 300);
  if (missing.length) log(`Descargando ${missing.length} recursos adicionales`);
  await Promise.all(missing.map(async (u) => {
    try {
      const res = await context.request.get(u, { timeout: 20000 });
      if (res.ok()) {
        const type = res.headers()['content-type'] || '';
        resources.set(u, { body: await res.body(), type, rt: type.includes('css') ? 'stylesheet' : 'other' });
      }
    } catch {}
  }));
  await browser.close();

  // Mapa url absoluta -> ruta local
  const map = new Map();
  for (const [u, r] of resources) {
    if (!opts.keepScripts && r.rt === 'script') continue;
    map.set(u, localPathFor(u, r.type));
  }

  await fs.mkdir(outDir, { recursive: true });
  for (const [u, local] of map) {
    const r = resources.get(u);
    const dest = path.join(outDir, local);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    if (local.endsWith('.css') || r.type.includes('text/css')) {
      await fs.writeFile(dest, rewriteCssUrls(r.body.toString('utf8'), u, local, map));
    } else {
      await fs.writeFile(dest, r.body);
    }
  }

  const $ = cheerio.load(html);
  const toLocal = (val) => {
    if (!val || val.startsWith('data:') || val.startsWith('#') || val.startsWith('mailto:') || val.startsWith('javascript:')) return val;
    try {
      const abs = new URL(val, finalUrl).href.split('#')[0];
      return map.has(abs) ? map.get(abs) : abs; // rutas no descargadas quedan absolutas para no romper enlaces
    } catch { return val; }
  };

  if (!opts.keepScripts) {
    $('script').each((_, el) => {
      const t = ($(el).attr('type') || '').toLowerCase();
      if (!t.includes('json')) $(el).remove();
    });
    $('link[rel="preload"][as="script"], link[rel="modulepreload"]').remove();
  }
  $('base').remove();
  $('[src]').each((_, el) => $(el).attr('src', toLocal($(el).attr('src'))));
  $('link[href]').each((_, el) => $(el).attr('href', toLocal($(el).attr('href'))));
  $('a[href]').each((_, el) => {
    const v = $(el).attr('href');
    try { if (!v.startsWith('#')) $(el).attr('href', new URL(v, finalUrl).href); } catch {}
  });
  $('[srcset]').each((_, el) => {
    const v = $(el).attr('srcset').split(',').map((part) => {
      const [u, d] = part.trim().split(/\s+/);
      return [toLocal(u), d].filter(Boolean).join(' ');
    }).join(', ');
    $(el).attr('srcset', v);
  });
  $('[poster]').each((_, el) => $(el).attr('poster', toLocal($(el).attr('poster'))));
  $('style').each((_, el) => $(el).text(rewriteCssUrls($(el).text(), finalUrl, 'index.html', map)));
  $('[style]').each((_, el) => $(el).attr('style', rewriteCssUrls($(el).attr('style'), finalUrl, 'index.html', map)));
  $('link[integrity], script[integrity]').removeAttr('integrity');

  await fs.writeFile(path.join(outDir, 'index.html'), $.html());
  await fs.writeFile(path.join(outDir, 'meta.json'), JSON.stringify({ url, finalUrl, title, date: new Date().toISOString(), assets: map.size }, null, 2));
  log(`Guardado: ${map.size} recursos`);
  return { title, assets: map.size, finalUrl };
}

module.exports = { snapshot };
