// 계약 데이터 이전 스크립트 — 기존(별도) Supabase → 세움os Supabase(같은 프로젝트로 통합)
//
// 안전장치:
//  - 소스(원본)는 '읽기만' 한다. 절대 지우거나 바꾸지 않는다.
//  - 기본은 '미리보기(dry-run)' 모드. 실제 이전은 반드시 --commit 을 붙여야 실행된다.
//  - 대상에는 contract_no(계약번호) 기준 upsert → 여러 번 실행해도 중복 안 생김(재실행 안전).
//  - id(내부 PK)는 대상에서 새로 부여된다. 계약번호·내용·작성/수정일시는 그대로 보존된다.
//
// 사용법:
//   1) 먼저 대상(세움os) 프로젝트에서 supabase/schema.sql 을 실행해 contracts 테이블을 만든다.
//   2) 아래 4개 환경변수를 넣고 실행한다.
//
//   SRC_SUPABASE_URL=...        기존 전자계약서용 프로젝트 URL
//   SRC_SERVICE_ROLE_KEY=...    기존 프로젝트 service_role 키
//   DST_SUPABASE_URL=...        세움os 프로젝트 URL
//   DST_SERVICE_ROLE_KEY=...    세움os 프로젝트 service_role 키
//
//   # 미리보기(아무것도 안 옮김, 건수·목록만 확인)
//   node scripts/migrate-contracts.mjs
//   # 실제 이전
//   node scripts/migrate-contracts.mjs --commit

import { createClient } from '@supabase/supabase-js';

function need(key) {
  const v = process.env[key];
  if (!v) { console.error(`✗ 환경변수 ${key} 가 필요합니다.`); process.exit(1); }
  return v;
}

const SRC_URL = need('SRC_SUPABASE_URL');
const SRC_KEY = need('SRC_SERVICE_ROLE_KEY');
const DST_URL = need('DST_SUPABASE_URL');
const DST_KEY = need('DST_SERVICE_ROLE_KEY');
const COMMIT = process.argv.includes('--commit');

if (SRC_URL === DST_URL) {
  console.error('✗ 소스와 대상 URL이 같습니다. 서로 다른 프로젝트여야 합니다.');
  process.exit(1);
}

const src = createClient(SRC_URL, SRC_KEY, { auth: { persistSession: false } });
const dst = createClient(DST_URL, DST_KEY, { auth: { persistSession: false } });

// id 는 대상에서 새로 부여 → 이전 대상 컬럼에서 제외. 계약번호·내용·시각은 보존.
const COLS = ['contract_no', 'status', 'client_name', 'site_address', 'showroom', 'salesperson', 'contract_date', 'total_amount', 'data', 'created_at', 'updated_at'];

// 소스 전체 읽기 (페이지네이션 — 이미지 포함 대용량 대비 100건씩)
async function fetchAllSource() {
  const all = [];
  const size = 100;
  for (let from = 0; ; from += size) {
    const { data, error } = await src.from('contracts').select('*').order('id', { ascending: true }).range(from, from + size - 1);
    if (error) throw new Error(`소스 읽기 실패: ${error.message}`);
    all.push(...data);
    if (data.length < size) break;
  }
  return all;
}

async function main() {
  console.log(`\n소스: ${SRC_URL}\n대상: ${DST_URL}\n모드: ${COMMIT ? '★ 실제 이전(--commit)' : '미리보기(dry-run)'}\n`);

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
    console.log('내용이 맞으면 다음으로 실제 이전하세요:  node scripts/migrate-contracts.mjs --commit\n');
    return;
  }

  console.log('\n이전을 시작합니다... (contract_no 기준 upsert, 재실행 안전)');
  let ok = 0, fail = 0;
  for (const r of rows) {
    const payload = {};
    for (const c of COLS) payload[c] = r[c];
    const opts = r.contract_no ? { onConflict: 'contract_no' } : undefined;
    const { error } = await dst.from('contracts').upsert(payload, opts);
    if (error) { fail++; console.error(`  ✗ ${r.contract_no || r.client_name}: ${error.message}`); }
    else { ok++; if (ok % 10 === 0) console.log(`  ...${ok}/${rows.length}`); }
  }

  const { count, error: cErr } = await dst.from('contracts').select('*', { count: 'exact', head: true });
  console.log(`\n이전 완료 — 성공 ${ok}건, 실패 ${fail}건.`);
  if (!cErr) console.log(`대상 프로젝트의 현재 계약 수: ${count}건`);
  console.log(fail ? '\n⚠ 실패한 건이 있습니다. 위 로그를 확인하세요. (소스는 그대로 있으니 재실행 가능)' : '\n✅ 모든 계약이 안전하게 이전되었습니다. 소스 데이터는 그대로 남아 있습니다.');
}

main().catch((err) => { console.error('\n✗ 오류:', err.message); process.exit(1); });
