// 계약 데이터 이전 스크립트 — 기존(별도) Supabase → 세움os Supabase(같은 프로젝트로 통합)
//
// 외부 라이브러리 '없이' Supabase REST API(fetch)만 사용합니다. (Node 20/22+ 내장 fetch)
//  → npm install 불필요. 이 파일 하나만 있으면 실행됩니다.
//
// 안전장치:
//  - 소스(원본)는 '읽기만' 한다. 절대 지우거나 바꾸지 않는다.
//  - 기본은 '미리보기(dry-run)' 모드. 실제 이전은 반드시 --commit 을 붙여야 실행된다.
//  - 대상에는 contract_no(계약번호) 기준 upsert → 여러 번 실행해도 중복 안 생김(재실행 안전).
//  - id(내부 PK)는 대상에서 새로 부여된다. 계약번호·내용·작성/수정일시는 그대로 보존된다.
//
// 사용법 (터미널):
//   # 1) 미리보기 — 아무것도 안 옮기고 건수·목록만 확인
//   SRC_SUPABASE_URL=https://기존.supabase.co \
//   SRC_SERVICE_ROLE_KEY=기존_service_role_키 \
//   DST_SUPABASE_URL=https://세움os.supabase.co \
//   DST_SERVICE_ROLE_KEY=세움os_service_role_키 \
//   node scripts/migrate-contracts.mjs
//
//   # 2) 실제 이전 — 위 명령 끝에 --commit 추가
//   ... node scripts/migrate-contracts.mjs --commit
//
//   (기본 테이블: 소스 contracts → 대상 econtracts. 필요 시 SRC_TABLE / DST_TABLE 로 변경)

function need(key) {
  const v = process.env[key];
  if (!v) { console.error(`✗ 환경변수 ${key} 가 필요합니다.`); process.exit(1); }
  return v;
}

const SRC_URL = need('SRC_SUPABASE_URL').replace(/\/+$/, '');
const SRC_KEY = need('SRC_SERVICE_ROLE_KEY');
const DST_URL = need('DST_SUPABASE_URL').replace(/\/+$/, '');
const DST_KEY = need('DST_SERVICE_ROLE_KEY');
const SRC_TABLE = process.env.SRC_TABLE || 'contracts';
const DST_TABLE = process.env.DST_TABLE || 'econtracts';
const COMMIT = process.argv.includes('--commit');

if (SRC_URL === DST_URL && SRC_TABLE === DST_TABLE) {
  console.error('✗ 소스와 대상이 완전히 같습니다. 서로 다른 프로젝트/테이블이어야 합니다.');
  process.exit(1);
}

// id 는 대상에서 새로 부여 → 이전 대상 컬럼에서 제외. 계약번호·내용·시각은 보존.
const COLS = ['contract_no', 'status', 'client_name', 'site_address', 'showroom', 'salesperson', 'contract_date', 'total_amount', 'data', 'created_at', 'updated_at'];

const authHeaders = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra });

// 소스 전체 읽기 (REST, 100건씩 페이지네이션 — 이미지 포함 대용량 대비)
async function fetchAllSource() {
  const all = [];
  const size = 100;
  for (let offset = 0; ; offset += size) {
    const url = `${SRC_URL}/rest/v1/${SRC_TABLE}?select=*&order=id.asc&offset=${offset}&limit=${size}`;
    const res = await fetch(url, { headers: authHeaders(SRC_KEY) });
    if (!res.ok) throw new Error(`소스 읽기 실패 (${res.status}): ${await res.text()}`);
    const data = await res.json();
    all.push(...data);
    if (data.length < size) break;
  }
  return all;
}

// 대상에 한 건 upsert (contract_no 충돌 시 갱신 → 재실행 안전)
async function upsertRow(row) {
  const payload = {};
  for (const c of COLS) payload[c] = row[c];
  const q = row.contract_no ? '?on_conflict=contract_no' : '';
  const url = `${DST_URL}/rest/v1/${DST_TABLE}${q}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(DST_KEY, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
}

// 대상 현재 건수 (확인용)
async function countDest() {
  const url = `${DST_URL}/rest/v1/${DST_TABLE}?select=id`;
  const res = await fetch(url, { headers: authHeaders(DST_KEY, { Prefer: 'count=exact', Range: '0-0' }) });
  const cr = res.headers.get('content-range') || '';
  return cr.includes('/') ? cr.split('/')[1] : '?';
}

async function main() {
  console.log(`\n소스: ${SRC_URL}  (테이블: ${SRC_TABLE})\n대상: ${DST_URL}  (테이블: ${DST_TABLE})\n모드: ${COMMIT ? '★ 실제 이전(--commit)' : '미리보기(dry-run)'}\n`);

  const rows = await fetchAllSource();
  console.log(`소스에서 계약 ${rows.length}건을 찾았습니다.`);
  const noNumber = rows.filter((r) => !r.contract_no);
  if (noNumber.length) console.log(`  ⚠ 계약번호가 없는 건 ${noNumber.length}건 (중복 방지 키가 없어 매 실행마다 새로 추가될 수 있음)`);
  console.log('\n미리보기 (최대 8건):');
  for (const r of rows.slice(0, 8)) {
    const imgs = Array.isArray(r.data?.idCards) ? r.data.idCards.length : 0;
    console.log(`  · ${r.contract_no || '(번호없음)'} | ${r.client_name || '-'} | 영업 ${r.salesperson || '-'} | 신분증 ${imgs}매`);
  }

  if (!COMMIT) {
    console.log('\n[미리보기 모드] 실제로는 아무것도 옮기지 않았습니다.');
    console.log('내용이 맞으면 위 명령 끝에 --commit 을 붙여 다시 실행하세요.\n');
    return;
  }

  console.log('\n이전을 시작합니다... (contract_no 기준 upsert, 재실행 안전)');
  let ok = 0, fail = 0;
  for (const r of rows) {
    try {
      await upsertRow(r);
      ok++;
      if (ok % 10 === 0) console.log(`  ...${ok}/${rows.length}`);
    } catch (err) {
      fail++;
      console.error(`  ✗ ${r.contract_no || r.client_name}: ${err.message}`);
    }
  }

  console.log(`\n이전 완료 — 성공 ${ok}건, 실패 ${fail}건.`);
  try { console.log(`대상 테이블(${DST_TABLE})의 현재 계약 수: ${await countDest()}건`); } catch { /* 확인용, 실패해도 무시 */ }
  console.log(fail ? '\n⚠ 실패한 건이 있습니다. 위 로그를 확인하세요. (소스는 그대로 있으니 재실행 가능)' : '\n✅ 모든 계약이 안전하게 이전되었습니다. 소스 데이터는 그대로 남아 있습니다.');
}

main().catch((err) => { console.error('\n✗ 오류:', err.message); process.exit(1); });
