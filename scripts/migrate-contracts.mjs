#!/usr/bin/env node
/**
 * 계약 데이터 이전 스크립트 (Supabase → Supabase)
 *
 * 기존 전자계약서 Supabase 의 소스 테이블(기본: contracts)을 읽어
 * 세움os Supabase 의 대상 테이블(기본: econtracts)로 복사합니다.
 *
 * - 외부 라이브러리 설치 불필요 (Node 18+ 내장 fetch 사용, 저장소는 Node 22.5+)
 * - 기본은 미리보기(dry-run): 실제로 쓰지 않고 건수/목록만 출력합니다.
 * - 실제 이전은 맨 끝에 `--commit` 을 붙여야 실행됩니다.
 * - 소스(SRC)는 절대 수정하지 않습니다. 읽기(GET)만 수행합니다.
 *
 * 사용법:
 *   SRC_SUPABASE_URL=... SRC_SERVICE_ROLE_KEY=... \
 *   DST_SUPABASE_URL=... DST_SERVICE_ROLE_KEY=... \
 *   node scripts/migrate-contracts.mjs            # 미리보기
 *   node scripts/migrate-contracts.mjs --commit   # 실제 이전
 *
 * 선택 환경변수:
 *   SRC_TABLE     소스 테이블명   (기본: contracts)
 *   DST_TABLE     대상 테이블명   (기본: econtracts)
 *   ON_CONFLICT   대상 upsert 충돌 기준 컬럼 (기본: id) — 재실행 시 중복 방지
 *   DROP_COLS     대상에 넣지 않을 컬럼(콤마 구분). 예: id  → 대상이 id 자동생성일 때
 *   BATCH         한 번에 쓰는 행 수 (기본: 500)
 *   PAGE          한 번에 읽는 행 수 (기본: 1000)
 */

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

const SRC_URL = need('SRC_SUPABASE_URL');
const SRC_KEY = need('SRC_SERVICE_ROLE_KEY');
// 대상(DST) 자격증명은 실제 이전(--commit) 시에만 필요. 미리보기는 소스만 읽습니다.
const DST_URL = COMMIT ? need('DST_SUPABASE_URL') : trimTrail(process.env.DST_SUPABASE_URL);
const DST_KEY = COMMIT ? need('DST_SERVICE_ROLE_KEY') : (process.env.DST_SERVICE_ROLE_KEY || '');

const SRC_TABLE = process.env.SRC_TABLE || 'contracts';
const DST_TABLE = process.env.DST_TABLE || 'econtracts';
const ON_CONFLICT = process.env.ON_CONFLICT || 'id';
const DROP_COLS = (process.env.DROP_COLS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const BATCH = clampInt(process.env.BATCH, 500, 1, 5000);
const PAGE = clampInt(process.env.PAGE, 1000, 1, 1000);

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`✖ 환경변수 ${name} 가 필요합니다.`);
    process.exit(1);
  }
  return trimTrail(v); // URL 뒤 슬래시 제거 (키에는 영향 없음)
}

function trimTrail(v) {
  return (v || '').replace(/\/+$/, '');
}

function clampInt(raw, def, min, max) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function restBase(baseUrl) {
  return `${baseUrl}/rest/v1`;
}

function headers(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function fail(prefix, res) {
  let body = '';
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  throw new Error(`${prefix} → HTTP ${res.status} ${res.statusText}\n${body}`);
}

/** 소스에서 모든 행을 페이지 단위로 읽기 (읽기 전용) */
async function readAllSource() {
  const rows = [];
  let offset = 0;
  for (;;) {
    const url =
      `${restBase(SRC_URL)}/${encodeURIComponent(SRC_TABLE)}` +
      `?select=*&order=id.asc&limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url, { headers: headers(SRC_KEY) });
    if (!res.ok) await fail(`소스 읽기 실패 (${SRC_TABLE})`, res);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

function prepRow(row) {
  const out = { ...row };
  for (const c of DROP_COLS) delete out[c];
  return out;
}

function fmtAmount(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('ko-KR');
}

function preview(rows) {
  console.log(`\n소스 테이블: ${SRC_TABLE}  →  대상 테이블: ${DST_TABLE}`);
  console.log(`총 ${rows.length}건\n`);
  if (rows.length === 0) return;

  const head = ['#', '계약번호', '건축주', '현장주소', '계약일', '금액', '상태'];
  const lines = rows.map((r, i) => [
    String(i + 1),
    r.contract_no ?? '',
    r.client_name ?? '',
    (r.site_address ?? '').slice(0, 24),
    r.contract_date ?? '',
    fmtAmount(r.total_amount),
    r.status ?? '',
  ]);
  const widths = head.map((h, c) =>
    Math.max(h.length, ...lines.map((l) => strWidth(l[c])))
  );
  const row = (cols) =>
    cols.map((v, c) => pad(v, widths[c])).join('  ');
  console.log(row(head));
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const l of lines) console.log(row(l));
  console.log('');
}

// 한글(전각) 폭을 2로 계산해 표 정렬
function strWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += /[ᄀ-ￜ＀-｠]/.test(ch) ? 2 : 1;
  return w;
}
function pad(s, width) {
  const str = String(s);
  return str + ' '.repeat(Math.max(0, width - strWidth(str)));
}

/** 대상에 배치 upsert */
async function upsertBatch(batch) {
  const url =
    `${restBase(DST_URL)}/${encodeURIComponent(DST_TABLE)}` +
    (ON_CONFLICT ? `?on_conflict=${encodeURIComponent(ON_CONFLICT)}` : '');
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(DST_KEY, {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify(batch),
  });
  if (!res.ok) await fail(`대상 쓰기 실패 (${DST_TABLE})`, res);
}

async function commit(rows) {
  const prepped = rows.map(prepRow);
  let done = 0;
  for (let i = 0; i < prepped.length; i += BATCH) {
    const batch = prepped.slice(i, i + BATCH);
    await upsertBatch(batch);
    done += batch.length;
    console.log(`  ↳ ${done}/${prepped.length} 건 이전 완료`);
  }
}

async function main() {
  console.log('전자계약서 → 세움os 계약 데이터 이전');
  console.log(`모드: ${COMMIT ? '실제 이전 (--commit)' : '미리보기 (dry-run)'}`);

  const rows = await readAllSource();
  preview(rows);

  if (!COMMIT) {
    console.log('※ 미리보기입니다. 실제로 이전하려면 맨 끝에 --commit 을 붙여 다시 실행하세요.');
    console.log('  (소스 테이블은 읽기만 했고 변경하지 않았습니다.)');
    return;
  }

  if (rows.length === 0) {
    console.log('이전할 데이터가 없습니다.');
    return;
  }

  console.log(`대상(${DST_TABLE})으로 이전을 시작합니다... (충돌 기준: ${ON_CONFLICT || '없음'})`);
  await commit(rows);
  console.log(`\n✔ 완료: 총 ${rows.length}건을 ${DST_TABLE} 로 이전했습니다.`);
  console.log('  (소스 테이블은 변경하지 않았습니다.)');
}

main().catch((err) => {
  console.error('\n✖ 오류로 중단되었습니다.');
  console.error(err.message || err);
  process.exit(1);
});
