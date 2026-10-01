-- Contract-OS 계약서 저장 테이블 (Supabase / PostgreSQL)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.contracts (
  id            bigint generated always as identity primary key,
  contract_no   text unique,                       -- 연도별 채번 (예: 2026-0001)
  status        text not null default 'draft',      -- draft | confirmed
  client_name   text,                               -- 건축주명 (목록/검색용)
  site_address  text,                               -- 현장주소 (목록/검색용)
  showroom      text,                               -- 전시장 (목록 분류용)
  salesperson   text,                               -- 영업사원 (목록 분류용)
  contract_date text,                               -- 계약일자 (YYYY-MM-DD)
  total_amount  numeric,                            -- 제품합계(만원, 목록 표시용)
  data          jsonb not null,                     -- 계약 본문 전체 (JSON)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 목록 정렬/검색 인덱스
create index if not exists contracts_updated_at_idx on public.contracts (updated_at desc);
create index if not exists contracts_contract_no_idx on public.contracts (contract_no);

-- RLS: service_role 키(서버 함수 전용)는 RLS를 우회하므로 별도 정책 없이도 동작합니다.
-- 브라우저에서 anon 키로 직접 접근하지 않도록, RLS는 켜 두고 공개 정책은 만들지 않습니다.
alter table public.contracts enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 활동/로그인 기록 테이블 (관리자 페이지의 '로그인 기록'·'활동 기록'용)
-- 환경변수 SUPABASE_LOG_TABLE 로 이름을 바꿀 수 있으며, 미설정 시 아래 이름을 사용합니다.
create table if not exists public.econtract_activity_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  kind         text not null,          -- 'login' | 'activity'
  type         text not null,          -- login | create | update | delete | restore | confirm
  actor_email  text,                   -- 행위자 이메일
  actor_name   text,                   -- 행위자 이름
  showroom     text,                   -- 전시장
  contract_id  bigint,                 -- 대상 계약 id (활동 기록)
  contract_no  text,                   -- 대상 계약번호
  client_name  text,                   -- 건축주명
  detail       text                    -- 상세(휴지통 이동/영구삭제/확정 등)
);

create index if not exists econtract_activity_log_at_idx on public.econtract_activity_log (kind, at desc);

alter table public.econtract_activity_log enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 설계 진행 상태 공유 테이블 (전자계약서 목록 ↔ 설계OS 연동, 계약번호 기준)
-- 환경변수 SUPABASE_DESIGN_TABLE 로 이름을 바꿀 수 있으며, 미설정 시 아래 이름을 사용합니다.
-- 설계OS도 이 테이블의 같은 행(contract_no)을 읽고/쓰면 양쪽 상태가 함께 바뀝니다.
create table if not exists public.design_progress (
  contract_no text primary key,     -- 계약번호 (연동 키)
  status      text,                 -- 미착수 | 영업팀협의 | 도면작업 | 건축사전달 | 본부장검토 | 완료 | 보류
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table public.design_progress enable row level security;
