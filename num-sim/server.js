// num-sim 本地服务：Node 零依赖，仅监听 127.0.0.1
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8787;
const HOST = '127.0.0.1';
const ROOT = __dirname;
const DATA_EXT = new Set(['.json', '.xlsx', '.xls', '.csv']);
const MAX_FILE = 50 * 1024 * 1024;
const IS_WIN = process.platform === 'win32';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xlsx': 'application/octet-stream',
  '.xls': 'application/octet-stream',
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj));

function listDrives() {
  const out = [];
  for (let c = 65; c <= 90; c++) {
    const d = String.fromCharCode(c) + ':\\';
    try { fs.accessSync(d); out.push({ name: d, type: 'dir', path: d }); } catch (_) { /* 不存在 */ }
  }
  return out;
}

function handleList(u, res) {
  const dir = (u.searchParams.get('dir') || '').trim();
  if (!dir && IS_WIN) return sendJson(res, 200, { dir: '', parent: null, entries: listDrives() });
  const abs = path.resolve(ROOT, dir || '/');
  const entries = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name.startsWith('$')) continue;
    const p = path.join(abs, e.name);
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = fs.statSync(p).isDirectory(); } catch (_) { continue; } }
    if (isDir) entries.push({ name: e.name, type: 'dir', path: p });
    else if (DATA_EXT.has(path.extname(e.name).toLowerCase())) {
      let size = 0;
      try { size = fs.statSync(p).size; } catch (_) { /* ignore */ }
      entries.push({ name: e.name, type: 'file', path: p, size });
    }
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  const par = path.dirname(abs);
  const parent = par === abs ? (IS_WIN ? '' : null) : par;
  sendJson(res, 200, { dir: abs, parent, entries });
}

function handleFile(u, res) {
  const p = path.resolve(ROOT, u.searchParams.get('path') || '');
  const ext = path.extname(p).toLowerCase();
  if (!DATA_EXT.has(ext)) return sendJson(res, 400, { error: '仅允许 .json/.xlsx/.xls/.csv' });
  const st = fs.statSync(p);
  if (!st.isFile()) return sendJson(res, 400, { error: '不是文件' });
  if (st.size > MAX_FILE) return sendJson(res, 413, { error: '文件过大（>50MB）' });
  send(res, 200, fs.readFileSync(p), MIME[ext]);
}

function handleStatic(u, res) {
  let rel = decodeURIComponent(u.pathname);
  if (rel === '/') rel = '/index.html';
  const fp = path.join(ROOT, path.normalize(rel));
  if (!fp.startsWith(ROOT + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
  fs.readFile(fp, (err, buf) => {
    if (err) return sendJson(res, 404, { error: 'not found' });
    send(res, 200, buf, MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  if (host !== '127.0.0.1' && host !== 'localhost') return sendJson(res, 403, { error: 'forbidden host' });
  const u = new URL(req.url, 'http://127.0.0.1');
  try {
    if (u.pathname === '/api/list') return handleList(u, res);
    if (u.pathname === '/api/file') return handleFile(u, res);
    if (u.pathname === '/favicon.ico') return send(res, 204, '');
    return handleStatic(u, res);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`端口 ${PORT} 已被占用：可能已经启动过，直接打开 http://localhost:${PORT}`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`num-sim 已启动: http://localhost:${PORT}  (Ctrl+C 退出)`);
});
