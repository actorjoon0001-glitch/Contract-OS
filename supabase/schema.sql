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
