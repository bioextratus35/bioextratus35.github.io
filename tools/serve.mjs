// Servidor local de teste (só para desenvolvimento).
// - Serve a pasta ../site com suporte a Range (necessário para vídeo no iOS)
// - Serve ../tools em /__tools/ (compilador do alvo)
// - POST /__save?name=quadro.mind grava o arquivo em ../site/targets/
// Uso: node tools/serve.mjs [porta]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '../site');
const TOOLS = here;
const PORT = Number(process.argv[2] || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mind': 'application/octet-stream',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'POST' && url.pathname === '/__save') {
    const name = path.basename(url.searchParams.get('name') || 'quadro.mind');
    const dest = name.endsWith('.mind') ? path.join(SITE, 'targets', name) : path.join(TOOLS, 'saida', name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const out = fs.createWriteStream(dest);
    req.pipe(out);
    out.on('finish', () => { res.end('ok ' + dest); console.log('gravado', dest); });
    return;
  }

  let base = SITE, rel = decodeURIComponent(url.pathname);
  if (rel.startsWith('/__tools/')) { base = TOOLS; rel = rel.slice('/__tools'.length); }
  let file = path.join(base, rel);
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('404'); }

  const stat = fs.statSync(file);
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace('bytes=', '').split('-');
    const start = Number(s), end = e ? Number(e) : stat.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': stat.size });
    fs.createReadStream(file).pipe(res);
  }
}).listen(PORT, () => console.log(`Fio a Fio local: http://localhost:${PORT}/`));
