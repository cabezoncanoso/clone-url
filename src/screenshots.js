// Capturas PNG de página completa en escritorio, tablet y móvil.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs/promises');

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  tablet: { ...devices['iPad (gen 7)'] },
  mobile: { ...devices['iPhone 13'] },
};

async function autoScroll(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < Math.min(document.body.scrollHeight, 30000); y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 100));
    }
    window.scrollTo(0, 0);
  });
}

async function screenshots(url, outDir, { scale, log = console.log } = {}) {
  await fs.mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const files = {};
  for (const [name, opts] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ ...opts, ...(scale ? { deviceScaleFactor: scale } : {}) });
    const page = await ctx.newPage();
    log(`Captura ${name}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await autoScroll(page);
    await page.waitForTimeout(800);
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    files[name] = path.basename(file);
    await ctx.close();
  }
  await browser.close();
  return files;
}

module.exports = { screenshots, VIEWPORTS };
