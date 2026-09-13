import express from 'express';
import fs from 'fs/promises';
import path, { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const DOCROOT = path.join(__dirname, 'docroot');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safePath(...segments) {
  const resolved = resolve(DOCROOT, ...segments);
  if (!resolved.startsWith(DOCROOT + path.sep) && resolved !== DOCROOT) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

async function listItems(dir = DOCROOT, base = '') {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const items = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      items.push({ name: rel, type: 'folder' });
      items.push(...await listItems(path.join(dir, e.name), rel));
    } else {
      items.push({ name: rel, type: 'file' });
    }
  }
  return items;
}

async function renderList() {
  const items = await listItems();
  if (!items.length) return '<p id="empty-msg">No files found.</p>';
  let h = '<table id="file-table"><thead><tr><th>Name</th><th>Type</th><th>Actions</th></tr></thead><tbody>';
  for (const it of items) {
    const icon = it.type === 'folder' ? '📁' : '📄';
    const enc = encodeURIComponent(it.name);
    h += `<tr data-name="${esc(it.name)}" data-type="${it.type}">`;
    h += `<td class="file-name">${icon} ${esc(it.name)}</td>`;
    h += `<td>${it.type}</td><td>`;
    if (it.type === 'file') {
      h += `<button class="edit-btn" hx-get="/api/files/edit/${enc}" hx-target="#editor-panel">Edit</button> `;
    }
    h += `<button class="delete-btn" hx-delete="/api/files/${enc}" hx-target="#file-list" hx-swap="innerHTML" hx-confirm="Delete ${esc(it.name)}?">Delete</button> `;
    h += `<button class="move-btn" data-move-name="${esc(it.name)}">Move</button>`;
    h += '</td></tr>';
  }
  return h + '</tbody></table>';
}

async function seed() {
  await fs.rm(DOCROOT, { recursive: true, force: true });
  const j = (...p) => path.join(DOCROOT, ...p);
  await fs.mkdir(j('documents'), { recursive: true });
  await fs.mkdir(j('projects'), { recursive: true });
  await fs.writeFile(j('hello.txt'), 'Hello, world!\nThis is a sample text file.\n');
  await fs.writeFile(j('notes.txt'), 'These are some notes for the project.\nLine two of notes.\n');
  await fs.writeFile(j('documents', 'report.txt'), 'Quarterly Report\n================\nThis is the Q1 report content.\n');
  await fs.writeFile(j('documents', 'memo.txt'), 'Memo: Project deadline is Friday.\nPlease review all pending items.\n');
  await fs.writeFile(j('projects', 'alpha.txt'), 'Project Alpha\n=============\nStatus: In progress\nLead: Alice\n');
}

app.get('/api/files', async (req, res) => {
  res.send(await renderList());
});

app.post('/api/files', async (req, res) => {
  const { name, type, content = '', parent } = req.body;
  const full = parent ? `${parent}/${name}` : name;
  let fp;
  try {
    fp = safePath(full);
  } catch {
    return res.status(400).json({ error: 'Path traversal detected' });
  }
  if (type === 'folder') {
    await fs.mkdir(fp, { recursive: true });
  } else {
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, String(content));
  }
  res.send(await renderList());
});

app.get(/^\/api\/files\/edit\/(.+)/, async (req, res) => {
  const name = req.params[0];
  let fp;
  try {
    fp = safePath(name);
  } catch {
    return res.status(400).send('<p>Path traversal detected</p>');
  }
  try {
    const content = await fs.readFile(fp, 'utf-8');
    const enc = encodeURIComponent(name);
    res.send(
      `<h3>Editing: ${esc(name)}</h3>` +
      `<form id="edit-form" hx-put="/api/files/${enc}" hx-target="#file-list" hx-swap="innerHTML">` +
      `<textarea name="content" id="editor-content" rows="10" cols="60">${esc(content)}</textarea><br>` +
      `<button type="submit" id="save-btn">Save</button> ` +
      `<button type="button" class="cancel-edit-btn">Cancel</button>` +
      `</form>`
    );
  } catch {
    res.status(404).send('<p>File not found</p>');
  }
});

app.put(/^\/api\/files\/(.+)/, async (req, res) => {
  const name = req.params[0];
  let fp;
  try {
    fp = safePath(name);
  } catch {
    return res.status(400).json({ error: 'Path traversal detected' });
  }
  await fs.writeFile(fp, String(req.body.content || ''));
  res.send(await renderList());
});

app.delete(/^\/api\/files\/(.+)/, async (req, res) => {
  let fp;
  try {
    fp = safePath(req.params[0]);
  } catch {
    return res.status(400).json({ error: 'Path traversal detected' });
  }
  try {
    const st = await fs.stat(fp);
    if (st.isDirectory()) {
      await fs.rm(fp, { recursive: true });
    } else {
      await fs.unlink(fp);
    }
  } catch {}
  res.send(await renderList());
});

app.post(/^\/api\/files\/(.+)\/move$/, async (req, res) => {
  const oldName = req.params[0];
  const { newName } = req.body;
  let oldPath, newPath;
  try {
    oldPath = safePath(oldName);
    newPath = safePath(newName);
  } catch {
    return res.status(400).json({ error: 'Path traversal detected' });
  }
  await fs.rename(oldPath, newPath);
  res.send(await renderList());
});

// NOTE: /api/reset is for local demo/testing only. In production, protect this endpoint with authentication.
app.post('/api/reset', async (req, res) => {
  await seed();
  res.json({ ok: true });
});

await seed();
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
