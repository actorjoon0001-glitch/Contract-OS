-- Contract-OS 계약서 저장 테이블 — '세움os와 같은 Supabase 프로젝트에 통합'하는 경우용.
-- 세움os에는 이미 다른 구조의 `contracts` 테이블이 있으므로, 이름 충돌을 피해
-- 전자계약서 전용 테이블 `econtracts` 로 분리한다. (세움os의 기존 contracts 는 건드리지 않음)
--
-- 실행: 세움os Supabase 대시보드 > SQL Editor 에 붙여넣고 Run.
-- 배포: Netlify 환경변수에 SUPABASE_TABLE=econtracts 를 추가하면 앱이 이 테이블을 사용한다.

create table if not exists public.econtracts (
  id            bigint generated always as identity primary key,
  contract_no   text unique,                       -- 연도별 채번 (예: 2026-0001)
  status        text not null default 'draft',      -- draft | confirmed
  client_name   text,                               -- 건축주명 (목록/검색용)
  site_address  text,                               -- 현장주소 (목록/검색용)
  showroom      text,                               -- 전시장 (목록 분류용)
  salesperson   text,                               -- 영업사원 (목록 분류용)
  contract_date text,                               -- 계약일자 (YYYY-MM-DD)
  total_amount  numeric,                            -- 제품합계(만원, 목록 표시용)
  data          jsonb not null,                     -- 계약 본문 전체 (JSON) — 신분증·소유자 등 모두 여기 포함
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 목록 정렬/검색 인덱스
create index if not exists econtracts_updated_at_idx on public.econtracts (updated_at desc);
create index if not exists econtracts_contract_no_idx on public.econtracts (contract_no);

-- RLS: service_role 키(서버 함수 전용)는 RLS를 우회하므로 별도 정책 없이도 동작합니다.
-- 브라우저에서 anon 키로 직접 접근하지 않도록, RLS는 켜 두고 공개 정책은 만들지 않습니다.
alter table public.econtracts enable row level security;
