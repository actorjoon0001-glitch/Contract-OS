// Netlify Functions(서버리스) 계약 저장 API — Supabase(PostgreSQL) 영구 저장
// 로컬 개발용 server.js / lib/db.js 와 '동일한 REST 규약'을 구현합니다.
// (프론트엔드는 /api/contracts 를 그대로 호출하므로 수정 불필요)
//
// 필요한 환경변수 (Netlify > Site settings > Environment variables):
//   SUPABASE_URL                 예) https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    Supabase 프로젝트의 service_role 키 (서버 전용, 절대 공개 금지)
//   SUPABASE_ANON_KEY            (선택) 설정하면 로그인 필수 모드가 켜짐 — 브라우저 로그인용 공개 키
//   ADMIN_EMAILS                 (선택) 전체 계약 열람 관리자 이메일, 쉼표로 구분 (예: ceo@seum.com,office@seum.com)
import { createClient } from '@supabase/supabase-js';

// 계약 저장 테이블명. 세움os처럼 이미 `contracts` 테이블이 있는 프로젝트와 통합할 때는
// 충돌을 피하려고 SUPABASE_TABLE=econtracts 로 지정한다. (미설정이면 기존처럼 contracts)
const TABLE = process.env.SUPABASE_TABLE || 'contracts';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ---- 인증(로그인) 설정 ----
const anonKey = () => process.env.SUPABASE_ANON_KEY || '';
const authEnabled = () => !!anonKey(); // 익명키가 설정돼 있으면 로그인 필수 모드
const adminEmails = () =>
  (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// 요청의 Bearer 토큰을 검증해 로그인 사용자 컨텍스트를 만든다.
// 인증 미설정(익명키 없음)이면 기존처럼 개방(모두 관리자처럼 전체 접근) — 배포 전 호환/로컬용.
async function authContext(req, supa) {
  if (!authEnabled()) return { enabled: false, user: null, isAdmin: true };
  const hdr = (req.headers.get('authorization') || '');
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  if (!token) return { enabled: true, user: null, isAdmin: false };
  try {
    const { data, error } = await supa.auth.getUser(token);
    if (error || !data?.user) return { enabled: true, user: null, isAdmin: false };
    const email = (data.user.email || '').toLowerCase();
    const meta = data.user.user_metadata || {};
    const name = meta.name || meta.full_name || meta.username || '';
    return { enabled: true, user: { id: data.user.id, email, name }, isAdmin: adminEmails().includes(email) };
  } catch {
    return { enabled: true, user: null, isAdmin: false };
  }
}

// 한 계약(row)을 이 사용자가 볼/수정할 수 있는가?
// 관리자·개방모드는 전체 허용. 그 외에는 본인이 만든 계약(ownerEmail)만.
// 레거시(소유자 미기록) 계약은 영업사원명이 로그인 이름과 같으면 허용(전환기 배려).
function canAccess(rowData, salesperson, auth) {
  if (!auth.enabled || auth.isAdmin) return true;
  if (!auth.user) return false;
  const owner = String(rowData?.ownerEmail || '').toLowerCase();
  if (owner) return owner === auth.user.email;
  const sp = String(rowData?.salesperson ?? salesperson ?? '').trim();
  return !!auth.user.name && sp === auth.user.name;
}

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

// 핵심 처리부 (supa·auth 주입형) — 테스트 가능하도록 default export와 분리
export async function handle(req, idParam, supa, auth = { enabled: false, user: null, isAdmin: true }) {
  const id = idParam != null && idParam !== '' ? Number(idParam) : null;
  const method = req.method;

  // 로그인 필수 모드인데 유효한 사용자가 없으면 차단
  if (auth.enabled && !auth.user) return json({ error: '로그인이 필요합니다.' }, 401);

  try {
    // ---- 목록 / 생성 (/api/contracts) ----
    if (id === null) {
      if (method === 'GET') {
        const url = new URL(req.url);
        const q = (url.searchParams.get('q') || '').trim();
        const deleted = url.searchParams.get('deleted') === '1';
        let query = supa
          .from(TABLE)
          .select('id, contract_no, status, stage:data->>stage, approval_at:data->signatures->approval->>signedAt, deleted_at:data->>deletedAt, id_count:data->>idCount, drawing_count:data->>drawingCount, owner_email:data->>ownerEmail, client_name, site_address, showroom, salesperson, contract_date, total_amount, updated_at')
          .order('updated_at', { ascending: false });
        // 휴지통 분리: deletedAt 값 유무로 정상/삭제됨 구분
        query = deleted ? query.not('data->>deletedAt', 'is', null) : query.is('data->>deletedAt', null);
        if (q) {
          const safe = q.replace(/[%,()]/g, ' ');
          query = query.or(
            `client_name.ilike.%${safe}%,site_address.ilike.%${safe}%,contract_no.ilike.%${safe}%,showroom.ilike.%${safe}%,salesperson.ilike.%${safe}%`
          );
        }
        const { data, error } = await query;
        if (error) throw error;
        let rows = data || [];
        // 권한: 관리자·개방모드가 아니면 본인 계약만 (레거시는 영업사원명 일치로 허용)
        if (auth.enabled && !auth.isAdmin) {
          rows = rows.filter((r) => {
            const owner = String(r.owner_email || '').toLowerCase();
            if (owner) return owner === auth.user.email;
            return !!auth.user.name && String(r.salesperson || '') === auth.user.name;
          });
        }
        rows = rows.map(({ owner_email, ...rest }) => rest); // 이메일은 목록 응답에서 제거
        return json(rows);
      }

      if (method === 'POST') {
        const data = await req.json().catch(() => null);
        if (!data) return json({ error: '잘못된 요청 형식입니다.' }, 400);
        // 만든 사람(소유자) 기록 — 로그인 사용자 기준
        if (auth.enabled && auth.user) {
          data.ownerEmail = auth.user.email;
          if (auth.user.name && !data.ownerName) data.ownerName = auth.user.name;
        }
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
      if (!canAccess(row.data, row.salesperson, auth)) return json({ error: '이 계약을 볼 권한이 없습니다.' }, 403);
      return json({ id: row.id, contract_no: row.contract_no, ...row, data: row.data });
    }

    if (method === 'PUT') {
      const data = await req.json().catch(() => null);
      if (!data) return json({ error: '잘못된 요청 형식입니다.' }, 400);
      // 대상 계약의 현재 소유자 확인 후 권한 검사
      const { data: existing, error: exErr } = await supa.from(TABLE).select('data, salesperson').eq('id', id).maybeSingle();
      if (exErr) throw exErr;
      if (!existing) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
      if (!canAccess(existing.data, existing.salesperson, auth)) return json({ error: '이 계약을 수정할 권한이 없습니다.' }, 403);
      // 소유자 정보는 최초 기록을 유지 (수정자가 소유권을 가로채지 못하도록). 없으면 이번 저장자로 귀속.
      const existingOwner = existing.data?.ownerEmail;
      if (existingOwner) {
        data.ownerEmail = existingOwner;
        if (existing.data?.ownerName) data.ownerName = existing.data.ownerName;
      } else if (auth.enabled && auth.user) {
        data.ownerEmail = auth.user.email;
        if (auth.user.name && !data.ownerName) data.ownerName = auth.user.name;
      }
      const patch = { ...summarize(data), data, updated_at: new Date().toISOString() };
      const { data: updated, error } = await supa.from(TABLE).update(patch).eq('id', id).select().maybeSingle();
      if (error) throw error;
      if (!updated) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
      return json({ id: updated.id, contract_no: updated.contract_no, ...updated, data: updated.data });
    }

    if (method === 'DELETE') {
      const { data: existing, error: exErr } = await supa.from(TABLE).select('data, salesperson').eq('id', id).maybeSingle();
      if (exErr) throw exErr;
      if (existing && !canAccess(existing.data, existing.salesperson, auth)) return json({ error: '이 계약을 삭제할 권한이 없습니다.' }, 403);
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

// 브라우저 로그인에 필요한 공개 설정 (익명키는 공개용이라 노출 안전). 인증 미설정이면 authEnabled:false.
function configResponse() {
  return json({
    authEnabled: authEnabled(),
    supabaseUrl: process.env.SUPABASE_URL || '',
    anonKey: anonKey(),
  });
}

// Netlify Functions 진입점
export default async (req, context) => {
  const path = new URL(req.url).pathname;
  // 공개 설정 — 로그인 화면이 Supabase 주소·익명키를 받아가는 용도 (인증 불필요)
  if (path === '/api/config') return configResponse();

  let supa;
  try {
    supa = client();
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500);
  }

  const auth = await authContext(req, supa);

  // 현재 로그인 사용자 정보 (계정 표시·관리자 여부)
  if (path === '/api/me') {
    if (auth.enabled && !auth.user) return json({ error: '로그인이 필요합니다.' }, 401);
    return json({ email: auth.user?.email || '', name: auth.user?.name || '', isAdmin: !!auth.isAdmin, authEnabled: auth.enabled });
  }

  return handle(req, context.params?.id, supa, auth);
};

export const config = {
  path: ['/api/config', '/api/me', '/api/contracts', '/api/contracts/:id'],
};
