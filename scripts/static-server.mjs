import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

async function fileExists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function safeJoin(root, pathname) {
  const requested = decodeURIComponent(pathname).replace(/\\/g, '/');
  const relative = requested.replace(/^\/+/, '');
  const resolved = path.resolve(root, relative);
  const normalizedRoot = path.resolve(root) + path.sep;
  if (resolved !== path.resolve(root) && !resolved.startsWith(normalizedRoot)) return null;
  return resolved;
}

async function resolveRequest(root, pathname) {
  let candidate = safeJoin(root, pathname);
  if (!candidate) return null;
  if (pathname.endsWith('/')) candidate = path.join(candidate, 'index.html');
  if (await fileExists(candidate)) return { file: candidate, status: 200 };
  if (!path.extname(candidate)) {
    const nested = path.join(candidate, 'index.html');
    if (await fileExists(nested)) return { file: nested, status: 200 };
  }
  const fallback = path.join(root, '404', 'index.html');
  if (await fileExists(fallback)) return { file: fallback, status: 404 };
  return null;
}

export async function startStaticServer(root, { host = '127.0.0.1', port = 0 } = {}) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${host}`);
      const resolved = await resolveRequest(root, url.pathname);
      if (!resolved) {
        response.writeHead(404, {
          'content-type': 'text/plain; charset=utf-8',
          'x-static-preview': 'production',
        });
        response.end('Not found');
        return;
      }

      const body = await readFile(resolved.file);
      const extension = path.extname(resolved.file).toLowerCase();
      const contentType = MIME[extension] || 'application/octet-stream';
      const acceptsGzip = /\bgzip\b/.test(String(request.headers['accept-encoding'] || ''));
      const compressible = /^(text\/|application\/(javascript|json|xml))/.test(contentType) || contentType.startsWith('image/svg+xml');
      const useGzip = acceptsGzip && compressible && body.length > 1024;
      const responseBody = useGzip ? gzipSync(body) : body;
      const fingerprinted = /\/_next\/static\//.test(url.pathname);

      response.writeHead(resolved.status, {
        'content-type': contentType,
        'cache-control': fingerprinted
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
        'x-static-preview': 'production',
        ...(useGzip ? { 'content-encoding': 'gzip', vary: 'Accept-Encoding' } : {}),
      });
      response.end(responseBody);
    } catch (error) {
      response.writeHead(500, {
        'content-type': 'text/plain; charset=utf-8',
        'x-static-preview': 'production',
      });
      response.end(String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  return {
    server,
    origin: `http://${host}:${address.port}`,
  };
}
