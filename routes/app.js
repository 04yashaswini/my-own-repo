const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const multer = require('multer');

const router = express.Router();

// ---------- Paths ----------
const DATA_DIR = path.join(__dirname, '..', 'data');
const ITEMS_FILE = path.join(DATA_DIR, 'gallery_items.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(ITEMS_FILE)) fs.writeFileSync(ITEMS_FILE, '[]', 'utf8');
if (!fs.existsSync(ACTIVITY_FILE)) fs.writeFileSync(ACTIVITY_FILE, '[]', 'utf8');

// ---------- Tiny JSON "database" layer ----------
// A per-file promise chain serializes reads/writes so concurrent requests
// never interleave and corrupt a JSON file.
const fileLocks = new Map();
function withLock(file, task) {
  const previous = fileLocks.get(file) || Promise.resolve();
  const run = previous.then(task, task);
  fileLocks.set(file, run.catch(() => {}));
  return run;
}

async function readJSON(file, fallback) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    console.error(`Failed to read ${file}:`, e.message);
    return fallback;
  }
}

async function writeJSON(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

async function getAllItems() {
  return readJSON(ITEMS_FILE, []);
}

async function getItemById(id) {
  const items = await getAllItems();
  return items.find((i) => i.id === id) || null;
}

async function createItem({ name, headline, description, image_url }) {
  return withLock(ITEMS_FILE, async () => {
    const items = await readJSON(ITEMS_FILE, []);
    const nextId = items.reduce((max, i) => Math.max(max, i.id), 0) + 1;
    const now = new Date().toISOString();
    const item = { id: nextId, name, headline, description, image_url, created_at: now, updated_at: now };
    items.push(item);
    await writeJSON(ITEMS_FILE, items);
    return item;
  });
}

async function updateItem(id, updates) {
  return withLock(ITEMS_FILE, async () => {
    const items = await readJSON(ITEMS_FILE, []);
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...updates, updated_at: new Date().toISOString() };
    await writeJSON(ITEMS_FILE, items);
    return items[idx];
  });
}

async function deleteItemById(id) {
  return withLock(ITEMS_FILE, async () => {
    const items = await readJSON(ITEMS_FILE, []);
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    const [removed] = items.splice(idx, 1);
    await writeJSON(ITEMS_FILE, items);
    return removed;
  });
}

async function logActivity(message) {
  return withLock(ACTIVITY_FILE, async () => {
    const activity = await readJSON(ACTIVITY_FILE, []);
    activity.unshift({ id: Date.now(), message, created_at: new Date().toISOString() });
    await writeJSON(ACTIVITY_FILE, activity.slice(0, 50)); // keep the file small
  });
}

async function getActivity(limit) {
  const activity = await readJSON(ACTIVITY_FILE, []);
  return activity.slice(0, limit);
}

function searchItems(items, q) {
  const needle = q.toLowerCase();
  return items.filter(
    (i) =>
      i.name.toLowerCase().includes(needle) ||
      (i.headline || '').toLowerCase().includes(needle) ||
      (i.description || '').toLowerCase().includes(needle)
  );
}

function sortItemsByDate(items, direction) {
  const sorted = [...items].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return direction === 'oldest' ? sorted : sorted.reverse();
}

async function getStats() {
  const start = Date.now();
  const items = await getAllItems();
  const latencyMs = Date.now() - start; // real read latency of the JSON store
  return {
    totalItems: items.length,
    mediaAssets: items.filter((i) => i.image_url).length,
    latencyMs
  };
}

// ---------- Upload setup ----------
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '';
    cb(null, crypto.randomBytes(16).toString('hex') + safeExt);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error('Invalid image type. Allowed: JPG, PNG, WEBP, GIF.'));
    }
    cb(null, true);
  }
});

// ---------- Helpers ----------
function validateItemInput(body) {
  const errors = [];
  const name = (body.name || '').trim();
  const headline = (body.headline || '').trim();
  const description = (body.description || '').trim();

  if (!name) errors.push('Name is required.');
  if (name.length > 160) errors.push('Name must be under 160 characters.');
  if (headline.length > 240) errors.push('Headline must be under 240 characters.');
  if (description.length > 5000) errors.push('Description must be under 5000 characters.');

  return { errors, name, headline, description };
}

// ---------- Local Nano AI (no external API required) ----------
async function localAssistantReply(message) {
  const msg = (message || '').toLowerCase();

  if (/how many items|item count|total items/.test(msg)) {
    const { totalItems } = await getStats();
    return `You currently have ${totalItems} item${totalItems === 1 ? '' : 's'} in the gallery.`;
  }
  if (/media asset/.test(msg)) {
    const { mediaAssets } = await getStats();
    return `You have ${mediaAssets} media asset${mediaAssets === 1 ? '' : 's'} with images attached.`;
  }
  if (/gallery statistic|stats/.test(msg)) {
    const { totalItems, mediaAssets, latencyMs } = await getStats();
    return `Gallery stats — Items: ${totalItems}, Media assets: ${mediaAssets}, Storage read time: ${latencyMs}ms.`;
  }
  if (/recently uploaded|recent upload|latest item/.test(msg)) {
    const items = sortItemsByDate(await getAllItems(), 'newest');
    if (items.length === 0) return 'No items have been uploaded yet.';
    return `The most recently uploaded item is "${items[0].name}".`;
  }
  if (/database status|db status|storage status|connection/.test(msg)) {
    try {
      await getAllItems();
      return 'The local JSON data store is readable and healthy.';
    } catch (e) {
      return 'The local JSON data store appears to be unreadable right now.';
    }
  }
  if (/hello|hi\b|hey/.test(msg)) {
    return "Hey! I'm Nano. Ask me about your gallery stats, recent uploads, or storage status.";
  }

  return "I can help with things like: item counts, gallery statistics, recent uploads, and storage status. Try asking one of those!";
}

async function externalAssistantReply(message) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: message }]
    })
  });
  const data = await response.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return text || "I couldn't generate a response right now.";
}

// ---------- Page routes ----------

router.get('/', async (req, res, next) => {
  try {
    const stats = await getStats();
    const activity = await getActivity(6);
    res.render('app', { page: 'dashboard', stats, activity });
  } catch (err) {
    next(err);
  }
});

router.get('/gallery', async (req, res, next) => {
  try {
    const sort = req.query.sort === 'oldest' ? 'oldest' : 'newest';
    const search = (req.query.q || '').trim();

    let items = await getAllItems();
    if (search) items = searchItems(items, search);
    items = sortItemsByDate(items, sort);

    res.render('app', { page: 'gallery', items, search, sort });
  } catch (err) {
    next(err);
  }
});

router.get('/create', (req, res) => {
  res.render('app', { page: 'create', errors: [], values: {} });
});

router.post('/create', upload.single('image'), async (req, res, next) => {
  try {
    const { errors, name, headline, description } = validateItemInput(req.body);
    if (errors.length) {
      return res.status(400).render('app', { page: 'create', errors, values: req.body });
    }

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : '';
    const item = await createItem({ name, headline, description, image_url: imageUrl });

    await logActivity(`${name} uploaded`);
    res.redirect(`/item/${item.id}?created=1`);
  } catch (err) {
    next(err);
  }
});

router.get('/item/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).render('app', { page: 'error', errorCode: 400, errorMessage: 'Invalid item ID.' });
    }

    const item = await getItemById(id);
    if (!item) {
      return res.status(404).render('app', { page: 'error', errorCode: 404, errorMessage: 'Item not found.' });
    }

    res.render('app', { page: 'item', item, created: req.query.created === '1' });
  } catch (err) {
    next(err);
  }
});

router.get('/edit/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).render('app', { page: 'error', errorCode: 400, errorMessage: 'Invalid item ID.' });
    }

    const item = await getItemById(id);
    if (!item) {
      return res.status(404).render('app', { page: 'error', errorCode: 404, errorMessage: 'Item not found.' });
    }

    res.render('app', { page: 'edit', item, errors: [] });
  } catch (err) {
    next(err);
  }
});

router.post('/edit/:id', upload.single('image'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).render('app', { page: 'error', errorCode: 400, errorMessage: 'Invalid item ID.' });
    }

    const existing = await getItemById(id);
    if (!existing) {
      return res.status(404).render('app', { page: 'error', errorCode: 404, errorMessage: 'Item not found.' });
    }

    const { errors, name, headline, description } = validateItemInput(req.body);
    if (errors.length) {
      return res.status(400).render('app', { page: 'edit', item: { ...existing, ...req.body }, errors });
    }

    let imageUrl = existing.image_url;
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
      if (existing.image_url) {
        fs.unlink(path.join(UPLOAD_DIR, path.basename(existing.image_url)), () => {});
      }
    }

    await updateItem(id, { name, headline, description, image_url: imageUrl });
    await logActivity(`${name} updated`);
    res.redirect(`/item/${id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/delete/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).render('app', { page: 'error', errorCode: 400, errorMessage: 'Invalid item ID.' });
    }

    const removed = await deleteItemById(id);
    if (!removed) {
      return res.status(404).render('app', { page: 'error', errorCode: 404, errorMessage: 'Item not found.' });
    }

    if (removed.image_url) {
      fs.unlink(path.join(UPLOAD_DIR, path.basename(removed.image_url)), () => {});
    }

    await logActivity(`${removed.name} deleted`);
    res.redirect('/gallery');
  } catch (err) {
    next(err);
  }
});

router.get('/database', async (req, res, next) => {
  try {
    const stats = await getStats();
    const items = sortItemsByDate(await getAllItems(), 'newest');
    const recentRecords = items.slice(0, 8);

    res.render('app', { page: 'database', stats, recentRecords, connected: true });
  } catch (err) {
    res.render('app', {
      page: 'database',
      stats: { totalItems: 0, mediaAssets: 0, latencyMs: null },
      recentRecords: [],
      connected: false
    });
  }
});

router.get('/settings', (req, res) => {
  res.render('app', {
    page: 'settings',
    settings: {
      appName: 'NANO SPACE',
      environment: process.env.NODE_ENV || 'development',
      dataDir: '/data',
      uploadDir: '/public/uploads',
      maxUploadSizeMb: 5
    }
  });
});

// ---------- API routes ----------

router.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ items: [] });

    const items = sortItemsByDate(searchItems(await getAllItems(), q), 'newest').slice(0, 20);
    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed.' });
  }
});

router.get('/api/stats', async (req, res) => {
  try {
    res.json(await getStats());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load stats.' });
  }
});

router.get('/api/items', async (req, res) => {
  try {
    const items = sortItemsByDate(await getAllItems(), 'newest');
    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load items.' });
  }
});

router.post('/api/ai', async (req, res) => {
  try {
    const message = (req.body.message || '').toString().slice(0, 1000);
    if (!message.trim()) return res.status(400).json({ error: 'Message is required.' });

    let reply;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        reply = await externalAssistantReply(message);
      } catch (e) {
        console.error('External AI failed, falling back to local assistant:', e.message);
        reply = await localAssistantReply(message);
      }
    } else {
      reply = await localAssistantReply(message);
    }

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Assistant failed to respond.' });
  }
});

// Multer / upload error handling
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || (err.message && err.message.includes('Invalid image type'))) {
    return res.status(400).render('app', {
      page: req.path.includes('edit') ? 'edit' : 'create',
      errors: [err.message],
      values: req.body || {},
      item: req.body || {}
    });
  }
  next(err);
});

module.exports = router;
