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

// ---- 전시장 코드/명 정규화 (employees.showroom 영어코드 ↔ 계약서 한글값 매칭용) ----
const SHOWROOM_CODE_TO_KR = {
  headquarters: '본사 전시장', showroom1: '1전시장', showroom3: '3전시장',
  ganghwa: '강화전시장', andong: '안동전시장', gwangju: '광주전시장',
};
// 여러 표기(영어코드·한글·레거시)를 하나의 키로 통일
const SHOWROOM_KEY = {
  headquarters: 'hq', '본사 전시장': 'hq', '본점': 'hq', '본사': 'hq',
  showroom1: 'sr1', '1전시장': 'sr1', '제1전시장': 'sr1',
  showroom3: 'sr3', '3전시장': 'sr3', '제3전시장': 'sr3',
  ganghwa: 'ganghwa', '강화전시장': 'ganghwa', '강화': 'ganghwa',
  andong: 'andong', '안동전시장': 'andong', '안동': 'andong',
  gwangju: 'gwangju', '광주전시장': 'gwangju', '광주': 'gwangju',
};
function normShowroom(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return SHOWROOM_KEY[s] || SHOWROOM_KEY[s.toLowerCase()] || s.toLowerCase();
}
// 개인전용 전시장(본인 것만 보임) — 그 외 전시장은 같은 전시장끼리 공유.
// PRIVATE_SHOWROOMS 미설정 시 기본값: headquarters(본사). 전부 공유로 하려면 빈 값('')으로 설정.
function privateShowroomKeys() {
  const raw = process.env.PRIVATE_SHOWROOMS;
  const val = raw === undefined ? 'headquarters' : raw;
  return new Set(val.split(',').map((s) => normShowroom(s)).filter(Boolean));
}
// 이 전시장이 '공유' 전시장인가 (같은 전시장 계약을 서로 볼 수 있는지)
function isSharedShowroom(key) { return !!key && !privateShowroomKeys().has(key); }

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
    const meta = { ...(data.user.app_metadata || {}), ...(data.user.user_metadata || {}) };
    let name = meta.name || meta.full_name || meta.username || meta.displayName || '';
    let showroom = '';
    // 세움os employees 테이블에서 직원의 전시장 조회 (auth_user_id 우선, 없으면 email)
    try {
      let emp = (await supa.from('employees').select('showroom, name').eq('auth_user_id', data.user.id).maybeSingle()).data;
      if (!emp && email) emp = (await supa.from('employees').select('showroom, name').eq('email', email).maybeSingle()).data;
      if (emp) {
        const code = String(emp.showroom || '').trim();
        showroom = SHOWROOM_CODE_TO_KR[code] || code; // 한글 전시장명으로(자동입력·표시용)
        if (!name && emp.name) name = emp.name;
      }
    } catch { /* employees 조회 실패 시 전시장 없이 진행(폴백: 본인 것만) */ }
    return { enabled: true, user: { id: data.user.id, email, name, showroom }, isAdmin: adminEmails().includes(email) };
  } catch {
    return { enabled: true, user: null, isAdmin: false };
  }
}

// 한 계약(row)을 이 사용자가 볼/수정할 수 있는가?
// 관리자·개방모드는 전체 허용. 공유 전시장 직원은 '같은 전시장' 계약 + 본인 것.
// 개인전용 전시장(예: 본사) 직원은 '본인 것만'. (전시장 정보 없으면 본인 것만)
function canAccess(rowData, salesperson, auth) {
  if (!auth.enabled || auth.isAdmin) return true;
  if (!auth.user) return false;
  const vkey = normShowroom(auth.user.showroom);
  if (isSharedShowroom(vkey) && normShowroom(rowData?.showroom) === vkey) return true; // 공유 전시장: 같은 전시장
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
          .select('id, contract_no, status, stage:data->>stage, approval_at:data->signatures->approval->>signedAt, deleted_at:data->>deletedAt, id_count:data->>idCount, drawing_count:data->>drawingCount, memo:data->>memo, deposit_date:data->deposit->>date, deposit_amount:data->deposit->>amount, owner_email:data->>ownerEmail, client_name, site_address, showroom, salesperson, contract_date, total_amount, updated_at')
          .order('created_at', { ascending: false })  // 작성(생성) 순 — 최근 계약이 위로 고정(수정해도 안 바뀜)
          .order('contract_no', { ascending: false }); // 동일 시각 대비 결정적 정렬
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
        // 권한: 공유 전시장은 같은 전시장 전체, 개인전용 전시장(본사)은 본인 것만 (+ 본인 소유는 항상)
        if (auth.enabled && !auth.isAdmin) {
          const vkey = normShowroom(auth.user.showroom);
          const shared = isSharedShowroom(vkey);
          rows = rows.filter((r) => {
            if (shared && normShowroom(r.showroom) === vkey) return true;  // 공유 전시장: 같은 전시장
            const owner = String(r.owner_email || '').toLowerCase();
            if (owner) return owner === auth.user.email;                   // 본인 소유
            return !!auth.user.name && String(r.salesperson || '') === auth.user.name;
          });
        }
        if (!(auth.enabled && !auth.isAdmin)) { /* 관리자·개방모드는 owner_email 유지(담당자 표시용) */ }
        else rows = rows.map(({ owner_email, ...rest }) => rest); // 일반 직원 응답에선 이메일 제거
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
    return json({ email: auth.user?.email || '', name: auth.user?.name || '', showroom: auth.user?.showroom || '', isAdmin: !!auth.isAdmin, authEnabled: auth.enabled });
  }

  // 직원 목록 (관리자 전용) — 목록에서 계약을 특정 직원 담당으로 넘길 때 사용
  if (path === '/api/employees') {
    if (auth.enabled && !auth.user) return json({ error: '로그인이 필요합니다.' }, 401);
    if (auth.enabled && !auth.isAdmin) return json({ error: '권한이 없습니다.' }, 403);
    try {
      const { data, error } = await supa.from('employees').select('name, email, showroom, status').order('showroom').order('name');
      if (error) throw error;
      const list = (data || []).filter((e) => e.email).map((e) => ({
        name: e.name || '',
        email: String(e.email).toLowerCase(),
        showroom: SHOWROOM_CODE_TO_KR[String(e.showroom || '').trim()] || e.showroom || '',
      }));
      return json(list);
    } catch (err) {
      return json({ error: '직원 목록 조회 실패', detail: String(err?.message || err) }, 500);
    }
  }

  return handle(req, context.params?.id, supa, auth);
};

export const config = {
  path: ['/api/config', '/api/me', '/api/employees', '/api/contracts', '/api/contracts/:id'],
};
