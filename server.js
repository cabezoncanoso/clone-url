// Total Copy URL — servidor local
const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const archiver = require('archiver');
const { snapshot } = require('./src/snapshot');
const { screenshots } = require('./src/screenshots');
const { exportSection } = require('./src/section');

const PORT = process.env.PORT || 4321;
const DATA = path.join(__dirname, 'data');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/snapshots', express.static(DATA));

const slug = (url) => {
  const u = new URL(url);
  const d = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `${u.hostname.replace(/^www\./, '')}-${d}`.replace(/[^\w.-]/g, '_');
};
const safeId = (id) => { if (!/^[\w.-]+$/.test(id)) throw new Error('id inválido'); return id; };

app.post('/api/capture', async (req, res) => {
  try {
    const { url, keepScripts = false, shots = true } = req.body;
    new URL(url);
    const id = slug(url);
    const dir = path.join(DATA, id);
    const info = await snapshot(url, path.join(dir, 'site'), { keepScripts });
    const images = shots ? await screenshots(url, path.join(dir, 'screens')) : {};
    res.json({ id, ...info, images });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/captures', async (_req, res) => {
  await fs.mkdir(DATA, { recursive: true });
  const ids = (await fs.readdir(DATA)).sort().reverse();
  const list = [];
  for (const id of ids) {
    try { list.push({ id, ...JSON.parse(await fs.readFile(path.join(DATA, id, 'site', 'meta.json'), 'utf8')) }); } catch {}
  }
  res.json(list);
});

app.post('/api/section', async (req, res) => {
  try {
    const id = safeId(req.body.id);
    const { selector } = req.body;
    const n = Date.now().toString(36);
    const outDir = path.join(DATA, id, 'sections', n);
    const info = await exportSection({
      snapshotUrl: `http://localhost:${PORT}/snapshots/${id}/site/index.html`,
      snapshotDir: path.join(DATA, id, 'site'),
      selector, outDir,
    });
    res.json({ section: n, ...info });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function sendZip(res, dir, name) {
  res.attachment(name);
  const zip = archiver('zip', { zlib: { level: 9 } });
  zip.on('error', (e) => res.status(500).end(e.message));
  zip.pipe(res);
  zip.directory(dir, false);
  zip.finalize();
}
app.get('/api/zip/:id', (req, res) => sendZip(res, path.join(DATA, safeId(req.params.id), 'site'), `${req.params.id}.zip`));
app.get('/api/zip/:id/screens', (req, res) => sendZip(res, path.join(DATA, safeId(req.params.id), 'screens'), `${req.params.id}-capturas.zip`));
app.get('/api/zip/:id/section/:n', (req, res) => sendZip(res, path.join(DATA, safeId(req.params.id), 'sections', safeId(req.params.n)), `${req.params.id}-seccion-${req.params.n}.zip`));

app.listen(PORT, () => console.log(`Total Copy URL en http://localhost:${PORT}`));
