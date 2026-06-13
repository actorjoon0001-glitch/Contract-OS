// Netlify Functions(서버리스) + Netlify Blobs 기반 계약 저장 API
// 로컬 개발용 server.js / lib/db.js 와 '동일한 REST 규약'을 구현합니다.
// (프론트엔드는 /api/contracts 를 그대로 호출하므로 수정 불필요)
import { getStore } from '@netlify/blobs';

const store = () => getStore('contracts');
const INDEX_KEY = 'index'; // { items: [요약...] } 형태의 목록 인덱스

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function loadIndex(s) {
  return (await s.get(INDEX_KEY, { type: 'json' })) || { items: [] };
}
async function saveIndex(s, idx) {
  await s.setJSON(INDEX_KEY, idx);
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function summarize(id, contractNo, data) {
  return {
    id,
    contract_no: contractNo,
    status: data?.status || 'draft',
    client_name: data?.client?.name || '',
    site_address: data?.siteAddress || '',
    showroom: data?.showroom || '',
    salesperson: data?.salesperson || '',
    contract_date: data?.contractDate || '',
    total_amount: num(data?.amounts?.productTotal),
    updated_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
  };
}

function nextContractNo(items, year) {
  const prefix = `${year}-`;
  let max = 0;
  for (const it of items) {
    if (it.contract_no?.startsWith(prefix)) {
      const n = parseInt(it.contract_no.slice(prefix.length), 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return prefix + String(max + 1).padStart(4, '0');
}

// 핵심 처리부 (store 주입형) — 테스트 가능하도록 default export와 분리
export async function handle(req, idParam, s) {
  const id = idParam != null && idParam !== '' ? Number(idParam) : null;
  const method = req.method;

  try {
    // ---- 목록 / 생성 (/api/contracts) ----
    if (id === null) {
      if (method === 'GET') {
        const url = new URL(req.url);
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const idx = await loadIndex(s);
        let items = [...idx.items].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
        if (q) {
          items = items.filter(
            (it) =>
              (it.client_name || '').toLowerCase().includes(q) ||
              (it.site_address || '').toLowerCase().includes(q) ||
              (it.contract_no || '').toLowerCase().includes(q) ||
              (it.showroom || '').toLowerCase().includes(q) ||
              (it.salesperson || '').toLowerCase().includes(q)
          );
        }
        return json(items);
      }

      if (method === 'POST') {
        const data = await req.json().catch(() => null);
        if (!data) return json({ error: '잘못된 요청 형식입니다.' }, 400);
        const idx = await loadIndex(s);
        const newId = idx.items.reduce((m, it) => Math.max(m, it.id), 0) + 1;
        const year = data.contractDate?.slice(0, 4) || String(new Date().getFullYear());
        const contractNo = data.contractNo || nextContractNo(idx.items, year);
        const created_at = new Date().toISOString().slice(0, 16).replace('T', ' ');
        await s.setJSON(`contract:${newId}`, { data, created_at });
        const summary = summarize(newId, contractNo, data);
        summary.created_at = created_at;
        idx.items.push(summary);
        await saveIndex(s, idx);
        return json({ id: newId, contract_no: contractNo, ...summary, data }, 201);
      }
      return json({ error: '허용되지 않은 메서드입니다.' }, 405);
    }

    // ---- 단건 조회 / 수정 / 삭제 (/api/contracts/:id) ----
    const idx = await loadIndex(s);
    const entry = idx.items.find((it) => it.id === id);

    if (method === 'GET') {
      if (!entry) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
      const rec = await s.get(`contract:${id}`, { type: 'json' });
      return json({ id, contract_no: entry.contract_no, ...entry, data: rec?.data || {}, created_at: rec?.created_at });
    }

    if (method === 'PUT') {
      if (!entry) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
      const data = await req.json().catch(() => null);
      if (!data) return json({ error: '잘못된 요청 형식입니다.' }, 400);
      const rec = (await s.get(`contract:${id}`, { type: 'json' })) || {};
      await s.setJSON(`contract:${id}`, { data, created_at: rec.created_at });
      const summary = summarize(id, entry.contract_no, data);
      summary.created_at = rec.created_at;
      Object.assign(entry, summary);
      await saveIndex(s, idx);
      return json({ id, contract_no: entry.contract_no, ...summary, data });
    }

    if (method === 'DELETE') {
      await s.delete(`contract:${id}`);
      idx.items = idx.items.filter((it) => it.id !== id);
      await saveIndex(s, idx);
      return json({ ok: true });
    }

    return json({ error: '허용되지 않은 메서드입니다.' }, 405);
  } catch (err) {
    return json({ error: '서버 오류가 발생했습니다.', detail: String(err?.message || err) }, 500);
  }
}

// Netlify Functions 진입점
export default async (req, context) => handle(req, context.params?.id, store());

export const config = {
  path: ['/api/contracts', '/api/contracts/:id'],
};
