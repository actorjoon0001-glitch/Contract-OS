// Netlify Functions(서버리스) 계약 저장 API — Supabase(PostgreSQL) 영구 저장
// 로컬 개발용 server.js / lib/db.js 와 '동일한 REST 규약'을 구현합니다.
// (프론트엔드는 /api/contracts 를 그대로 호출하므로 수정 불필요)
//
// 필요한 환경변수 (Netlify > Site settings > Environment variables):
//   SUPABASE_URL                 예) https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    Supabase 프로젝트의 service_role 키 (서버 전용, 절대 공개 금지)
import { createClient } from '@supabase/supabase-js';

const TABLE = 'contracts';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// 본문 JSON에서 목록/검색용 요약 컬럼 추출
function summarize(data) {
  return {
    status: data?.status || 'draft',
    client_name: data?.client?.name || '',
    site_address: data?.siteAddress || '',
    showroom: data?.showroom || '',
    salesperson: data?.salesperson || '',
    contract_date: data?.contractDate || '',
    total_amount: num(data?.amounts?.productTotal),
  };
}

// 연도별 계약번호 채번 (예: 2026-0001)
async function nextContractNo(supa, year) {
  const prefix = `${year}-`;
  const { data, error } = await supa
    .from(TABLE)
    .select('contract_no')
    .like('contract_no', `${prefix}%`)
    .order('contract_no', { ascending: false })
    .limit(1);
  if (error) throw error;
  let seq = 1;
  if (data && data[0]?.contract_no) {
    const n = parseInt(data[0].contract_no.slice(prefix.length), 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return prefix + String(seq).padStart(4, '0');
}

// 핵심 처리부 (supa 주입형) — 테스트 가능하도록 default export와 분리
export async function handle(req, idParam, supa) {
  const id = idParam != null && idParam !== '' ? Number(idParam) : null;
  const method = req.method;

  try {
    // ---- 목록 / 생성 (/api/contracts) ----
    if (id === null) {
      if (method === 'GET') {
        const url = new URL(req.url);
        const q = (url.searchParams.get('q') || '').trim();
        let query = supa
          .from(TABLE)
          .select('id, contract_no, status, client_name, site_address, showroom, salesperson, contract_date, total_amount, updated_at')
          .order('updated_at', { ascending: false });
        if (q) {
          const safe = q.replace(/[%,()]/g, ' ');
          query = query.or(
            `client_name.ilike.%${safe}%,site_address.ilike.%${safe}%,contract_no.ilike.%${safe}%,showroom.ilike.%${safe}%,salesperson.ilike.%${safe}%`
          );
        }
        const { data, error } = await query;
        if (error) throw error;
        return json(data || []);
      }

      if (method === 'POST') {
        const data = await req.json().catch(() => null);
        if (!data) return json({ error: '잘못된 요청 형식입니다.' }, 400);
        const year = data.contractDate?.slice(0, 4) || String(new Date().getFullYear());
        const contractNo = data.contractNo || (await nextContractNo(supa, year));
        const row = { contract_no: contractNo, ...summarize(data), data };
        const { data: inserted, error } = await supa.from(TABLE).insert(row).select().single();
        if (error) throw error;
        return json({ id: inserted.id, contract_no: inserted.contract_no, ...inserted, data: inserted.data }, 201);
      }
      return json({ error: '허용되지 않은 메서드입니다.' }, 405);
    }

    // ---- 단건 조회 / 수정 / 삭제 (/api/contracts/:id) ----
    if (method === 'GET') {
      const { data: row, error } = await supa.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!row) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
      return json({ id: row.id, contract_no: row.contract_no, ...row, data: row.data });
    }

    if (method === 'PUT') {
      const data = await req.json().catch(() => null);
      if (!data) return json({ error: '잘못된 요청 형식입니다.' }, 400);
      const patch = { ...summarize(data), data, updated_at: new Date().toISOString() };
      const { data: updated, error } = await supa.from(TABLE).update(patch).eq('id', id).select().maybeSingle();
      if (error) throw error;
      if (!updated) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
      return json({ id: updated.id, contract_no: updated.contract_no, ...updated, data: updated.data });
    }

    if (method === 'DELETE') {
      const { error } = await supa.from(TABLE).delete().eq('id', id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: '허용되지 않은 메서드입니다.' }, 405);
  } catch (err) {
    return json({ error: '서버 오류가 발생했습니다.', detail: String(err?.message || err) }, 500);
  }
}

// Supabase 클라이언트 (service_role 키 사용 — RLS 우회, 서버 전용)
function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('수퍼베이스 환경변수(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았습니다.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// Netlify Functions 진입점
export default async (req, context) => {
  let supa;
  try {
    supa = client();
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500);
  }
  return handle(req, context.params?.id, supa);
};

export const config = {
  path: ['/api/contracts', '/api/contracts/:id'],
};
