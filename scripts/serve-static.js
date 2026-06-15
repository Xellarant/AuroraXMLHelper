#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || process.argv[2] || 4173);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

function send(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType
  });
  res.end(body);
}

function resolveRequestPath(req) {
  const url = new URL(req.url || '/', `http://${host}:${port}`);
  const requestPath = decodeURIComponent(url.pathname);
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  const resolved = resolveRequestPath(req);
  if (!resolved) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.stat(resolved, (statError, stat) => {
    if (statError) {
      send(res, 404, 'Not found');
      return;
    }

    const filePath = stat.isDirectory() ? path.join(resolved, 'index.html') : resolved;
    fs.readFile(filePath, (readError, data) => {
      if (readError) {
        send(res, 404, 'Not found');
        return;
      }

      const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': contentType
      });
      res.end(data);
    });
  });
});

server.listen(port, host, () => {
  console.log(`Aurora XML Helper running at http://${host}:${port}/`);
});
