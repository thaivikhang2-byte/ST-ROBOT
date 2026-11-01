'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.join(__dirname, 'frontend');
const port = 5500;
const home = '/frontend/public/index.html';
if (!fs.existsSync(path.join(root, 'public', 'index.html'))) {
  console.error('Dat start-web.cjs va MO-WEB.bat trong thu muc ST-Robot, ngang hang thu muc frontend.');
  process.exit(1);
}
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.ico':'image/x-icon', '.pdf':'application/pdf', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf', '.webp':'image/webp' };
const entryPages = new Set(['index.html', 'gioithieu.html', 'kit.html', 'hoclieu.html', 'course.learning.html', 'quiz.html', 'dangky.html']);
function createFrontendServer() {
return http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, {'Allow':'GET, HEAD'}); return res.end(); }
  let pathname, url;
  try { url = new URL(req.url, 'http://127.0.0.1'); pathname = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400); return res.end('Invalid URL'); }
  if (pathname === '/' || entryPages.has(pathname.slice(1))) {
    const destination = pathname === '/' ? home : '/frontend/public/' + pathname.slice(1);
    res.writeHead(302, {Location:destination + url.search}); return res.end();
  }
  if (!pathname.startsWith('/frontend/')) { res.writeHead(404); return res.end('Not found'); }
  const relative = pathname.slice('/frontend/'.length);
  const parts = relative.split(/[\\/]/);
  if (parts.some(p => p.startsWith('.')) || !['public','src'].includes(parts[0])) { res.writeHead(404); return res.end('Not found'); }
  let file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) { res.writeHead(404); return res.end('Not found'); }
  if (pathname.endsWith('/')) file = path.join(file, 'index.html');
  const type = types[path.extname(file).toLowerCase()];
  if (!type) { res.writeHead(404); return res.end('Not found'); }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type':type, 'Content-Length':stat.size, 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff'});
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
});
}
module.exports = { createFrontendServer };
if (require.main === module) {
const server = createFrontendServer();
server.on('error', err => {
  console.error(err.code === 'EADDRINUSE' ? 'Cong 5500 dang duoc su dung. Tat Live Server / cua so MO-WEB cu roi chay lai.' : err.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}${home}`;
  console.log(`Web dang chay: ${url}\nCo the tat VS Code. Giu cua so nay mo. Nhan Ctrl+C de dung.\nChi phuc vu frontend; backend / AI can chay rieng.`);
  if (process.platform === 'win32') {
    const browser = spawn('cmd.exe', ['/c', 'start', '', url], {stdio:'ignore'});
    browser.on('error', () => console.log('Hay mo dia chi tren trong trinh duyet.'));
  }
});
}
