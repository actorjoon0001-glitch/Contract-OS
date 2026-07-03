// Contract-OS 서버 - 외부 의존성 없이 Node 내장 모듈만 사용
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { Contracts } from './lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    return null;
  }
}

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = normalize(join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA 폴백: 알 수 없는 경로는 index.html 로
    try {
      const data = await readFile(join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(data);
    } catch {
      res.writeHead(404).end('Not Found');
    }
  }
}

async function handleApi(req, res, pathname) {
  const idMatch = pathname.match(/^\/api\/contracts\/(\d+)$/);

  try {
    // 로컬 개발은 인증 없이 개방 — 프론트엔드가 로그인 화면을 건너뛰도록 authEnabled:false
    if (pathname === '/api/config') return sendJson(res, 200, { authEnabled: false, supabaseUrl: '', anonKey: '' });
    if (pathname === '/api/me') return sendJson(res, 200, { email: '', name: '', isAdmin: true, authEnabled: false });

    // 목록 / 생성
    if (pathname === '/api/contracts') {
      if (req.method === 'GET') {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const q = params.get('q') || '';
        const deleted = params.get('deleted') === '1';
        return sendJson(res, 200, Contracts.list({ q, deleted }));
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body) return sendJson(res, 400, { error: '잘못된 요청 형식입니다.' });
        return sendJson(res, 201, Contracts.create(body));
      }
    }

    // 단건 조회 / 수정 / 삭제
    if (idMatch) {
      const id = Number(idMatch[1]);
      if (req.method === 'GET') {
        const c = Contracts.get(id);
        return c ? sendJson(res, 200, c) : sendJson(res, 404, { error: '계약을 찾을 수 없습니다.' });
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        if (!body) return sendJson(res, 400, { error: '잘못된 요청 형식입니다.' });
        if (!Contracts.get(id)) return sendJson(res, 404, { error: '계약을 찾을 수 없습니다.' });
        return sendJson(res, 200, Contracts.update(id, body));
      }
      if (req.method === 'DELETE') {
        return sendJson(res, 200, { ok: Contracts.remove(id) });
      }
    }

    return sendJson(res, 405, { error: '허용되지 않은 메서드입니다.' });
  } catch (err) {
    console.error('[API ERROR]', err);
    return sendJson(res, 500, { error: '서버 오류가 발생했습니다.', detail: String(err.message || err) });
  }
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  ✅ Contract-OS 실행 중`);
  console.log(`  ➜  브라우저에서 열기: http://localhost:${PORT}\n`);
});
