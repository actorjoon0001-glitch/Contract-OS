import { api } from './api.js';
import {
  SUPPLIER, emptyContract, recalc, paymentRemaining,
  fmtMan, manToKorean, normalizeContract, computeIntegrityHash,
  MOVE_OPTIONS, computeMoveFee, moveTruckQty,
  SAMPLE_ID, sampleContract, sampleListRow,
  STAGES, stageLabel,
  MODELS, modelContract,
  SHOWROOMS, defaultTerms,
} from './model.js';
import { openSignaturePad } from './sign.js';
import { loadAuthConfig, authEnabled, currentUser, login, logout, setOnAuthLost, trySSO } from './auth.js';

let editorLocked = false; // 확정 상태이면 true (입력·서명 잠금)
let dupView = false;      // 중복 고객 타 전시장 계약 읽기전용 열람
let me = null;            // 로그인 사용자 정보 { email, name, isAdmin }

// 진행상태(stage) — 값이 없으면 확정 여부로 추정
function stageOf(row) {
  if (STAGES.some((s) => s.key === row.stage)) return row.stage;
  return row.status === 'confirmed' ? 'completed' : 'negotiating';
}

const app = document.getElementById('app');
let current = null;     // 편집 중인 계약 객체
let currentId = null;   // 저장된 계약 id (신규는 null)
let dirty = false;      // 미저장 변경 여부

// ---------- 유틸: 경로 기반 객체 접근 ----------
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 3D 홈플래너 연동 — 홈플래너에서 만든 도면을 협의도면으로 직접 받는다(postMessage)
const PLANNER_ORIGIN = 'https://seum-home-planner.netlify.app';
const PLANNER_URL = PLANNER_ORIGIN + '/';

// ---------- 라우팅 ----------
window.addEventListener('hashchange', guardedRoute);
window.addEventListener('DOMContentLoaded', boot);

// 앱 시작: 로그인 필요 여부 확인 → 필요하면 로그인 화면, 아니면 정상 라우팅
async function boot() {
  window.addEventListener('message', onPlannerMessage); // 3D 홈플래너 도면 수신
  await loadAuthConfig();
  setOnAuthLost(() => { me = null; renderLogin(); });
  // 자동 로그인(SSO): 세움os에 임베드된 경우, 부모창이 넘겨주는 세션으로 로그인 시도
  if (authEnabled() && !currentUser()) {
    app.innerHTML = '<div class="boot-loading no-print">로그인 확인 중…</div>';
    await trySSO();
  }
  if (authEnabled() && currentUser() && !me) { try { me = await api.me(); } catch { /* 401이면 authLost가 처리 */ } }
  // 등록된 직원 계정이 아니면 차단(로그아웃 + 안내)
  if (authEnabled() && me && !me.isAdmin && !me.isEmployee) {
    logout(); me = null;
    return renderLogin('등록된 직원 계정이 아닙니다. 관리자에게 문의하세요.');
  }
  guardedRoute();
}

// 로그인 필수 모드인데 세션이 없으면 로그인 화면으로 가로챈다.
function guardedRoute() {
  if (authEnabled() && !currentUser()) return renderLogin();
  route();
}

async function route() {
  const hash = location.hash || '#/';
  if (hash === '#/' || hash === '') return renderList();
  if (hash === '#/admin') return renderAdmin();
  if (hash === '#/trash') return renderTrash();
  if (hash === '#/new') return renderModelPicker();
  const mNew = hash.match(/^#\/new\/([\w-]+)$/);
  if (mNew) return openEditor(null, mNew[1] === 'blank' ? null : mNew[1]);
  if (hash === `#/edit/${SAMPLE_ID}`) return openEditor(SAMPLE_ID);
  const m = hash.match(/^#\/edit\/(\d+)$/);
  if (m) return openEditor(Number(m[1]));
  const mDup = hash.match(/^#\/dup\/(\d+)$/);
  if (mDup) return openEditor(Number(mDup[1]), null, { dup: true });
  renderList();
}

function go(hash) {
  if (dirty && !confirm('저장하지 않은 변경사항이 있습니다. 이동하시겠습니까?')) return;
  dirty = false;
  location.hash = hash;
}

// ---------- 로그인 화면 ----------
function renderLogin(msg = '') {
  current = null; currentId = null; dirty = false;
  app.innerHTML = `
    <div class="login-wrap no-print">
      <form class="login-card" id="login-form">
        <div class="login-brand"><span class="logo">SEUM</span> 전자 계약서</div>
        <p class="login-sub muted">세움 직원 계정(세움os)으로 로그인하세요.</p>
        <label class="login-field">이메일
          <input type="email" id="login-email" autocomplete="username" placeholder="name@seum.com" required />
        </label>
        <label class="login-field">비밀번호
          <input type="password" id="login-pw" autocomplete="current-password" placeholder="비밀번호" required />
        </label>
        <div class="login-msg danger" id="login-msg">${esc(msg)}</div>
        <button class="btn primary login-btn" type="submit">로그인</button>
      </form>
    </div>`;
  const form = document.getElementById('login-form');
  const msgEl = document.getElementById('login-msg');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('.login-btn');
    const email = document.getElementById('login-email').value;
    const pw = document.getElementById('login-pw').value;
    btn.disabled = true; btn.textContent = '로그인 중...'; msgEl.textContent = '';
    try {
      await login(email, pw);
      try { me = await api.me(); } catch { me = null; }
      // 등록된 직원 계정이 아니면 차단
      if (me && !me.isAdmin && !me.isEmployee) {
        logout(); me = null;
        msgEl.textContent = '등록된 직원 계정이 아닙니다. 관리자에게 문의하세요.';
        btn.disabled = false; btn.textContent = '로그인';
        return;
      }
      // 딥링크(#/edit/{id})로 들어와 로그인한 경우 원래 목적지로 이동, 그 외엔 현재 해시(기본 목록)
      route();
    } catch (err) {
      msgEl.textContent = err.message || '로그인에 실패했습니다.';
      btn.disabled = false; btn.textContent = '로그인';
    }
  };
  document.getElementById('login-email').focus();
}

// 상단 계정 표시(이메일 + 관리자 배지 + 로그아웃) — 로그인 모드에서만 노출
function accountChip() {
  if (!authEnabled()) return '';
  const u = me || currentUser() || {};
  const label = u.name || u.email || '';
  return `<span class="account-chip" title="${esc(u.email || '')}">
      <span class="acc-name">${esc(label)}</span>
      ${me?.isAdmin ? '<span class="acc-admin">관리자</span>' : ''}
      <button class="btn tiny acc-logout" id="logout-btn" type="button">로그아웃</button>
    </span>`;
}
function bindAccount(scope) {
  const btn = (scope || document).querySelector('#logout-btn');
  if (btn) btn.onclick = () => {
    if (!confirm('로그아웃할까요?')) return;
    logout(); me = null; renderLogin();
  };
}

// ---------- 목록 화면 ----------
let listRows = []; // 전체 목록 캐시 (전시장/영업사원/검색 필터는 클라이언트에서 처리)
let listFiltered = []; // 현재 필터 적용된 목록 (인쇄용)
let employeeList = [];  // 직원 목록(관리자 담당자 지정용) — 로드 시 1회 채움
const listCols = () => (canManageList() ? 17 : 16); // 관리자면 '담당자' 열 추가

async function renderList() {
  current = null; currentId = null; dirty = false;
  app.innerHTML = `
    <div class="topbar no-print">
      <div class="brand"><span class="logo">SEUM</span> 전자 계약서 <small>Contract-OS</small>
        ${canManageList() ? '<button class="btn tiny admin-btn" id="admin-btn" title="관리자 통계 페이지 (관리자 전용)">📊 관리자 페이지</button>' : ''}
      </div>
      <div class="actions">
        <input id="search" class="search" type="search" placeholder="건축주 · 연락처(뒷번호) · 현장주소 · 계약번호 · 전시장 · 영업사원 검색" />
        <select id="filter-stage" class="filter-sel">
          <option value="">진행상태 전체</option>
          ${STAGES.map((s) => `<option value="${s.key}">${s.label}</option>`).join('')}
        </select>
        <select id="filter-month" class="filter-sel"><option value="">전체 기간</option></select>
        <select id="filter-showroom" class="filter-sel"><option value="">전시장 전체</option></select>
        <select id="filter-sales" class="filter-sel"><option value="">영업사원 전체</option></select>
        <button class="btn" id="list-print-btn" title="현재 목록 인쇄 / PDF">🖨 인쇄</button>
        <button class="btn" id="trash-btn" title="삭제된 계약 보기/복원">🗑 휴지통</button>
        <button class="btn primary" id="new-btn">+ 새 계약서</button>
        ${accountChip()}
      </div>
    </div>
    <div class="list-wrap no-print">
      <table class="list-table">
        <thead>
          <tr>
            <th>계약번호</th><th>전시장</th><th>영업사원</th><th>건축주</th><th>현장주소</th>
            <th class="right">제품합계(만원)</th><th>계약일자</th><th class="right">계약금(만원)</th><th class="center">인허가</th><th>신분증</th><th>도면</th><th>진행상태</th><th>대표이사 승인</th>${canManageList() ? '<th>담당자</th>' : ''}<th>메모</th><th>수정일</th><th></th>
          </tr>
        </thead>
        <tbody id="list-body"><tr><td colspan="${listCols()}" class="muted center">불러오는 중...</td></tr></tbody>
      </table>
    </div>
    <div id="list-print" class="list-print"></div>`;

  document.getElementById('new-btn').onclick = () => go('#/new');
  document.getElementById('trash-btn').onclick = () => go('#/trash');
  document.getElementById('list-print-btn').onclick = printList;
  const adminBtn = document.getElementById('admin-btn');
  if (adminBtn) adminBtn.onclick = () => go('#/admin');
  bindAccount(app);
  document.getElementById('search').oninput = applyListFilters;
  document.getElementById('filter-stage').onchange = applyListFilters;
  document.getElementById('filter-month').onchange = applyListFilters;
  document.getElementById('filter-showroom').onchange = applyListFilters;
  document.getElementById('filter-sales').onchange = applyListFilters;
  loadList();
}

async function loadList() {
  const body = document.getElementById('list-body');
  try {
    // 관리자면 직원 목록 1회 로드(담당자 지정 드롭다운용)
    if (canManageList() && !employeeList.length) {
      try { employeeList = await api.employees(); } catch { /* 직원 목록 실패 시 담당자 지정만 비활성 */ }
    }
    const rows = await api.list('');
    // 필터 드롭다운은 실제 계약서 기준으로 채우고(샘플 값 제외), 샘플 행은 목록 맨 아래에 고정
    populateMonthFilter(rows);
    populateFilter('filter-showroom', '전시장 전체', rows.map((r) => r.showroom));
    populateFilter('filter-sales', '영업사원 전체', rows.map((r) => r.salesperson));
    listRows = [...rows, sampleListRow()];
    applyListFilters();
  } catch (err) {
    body.innerHTML = `<tr><td colspan="${listCols()}" class="center danger">목록을 불러오지 못했습니다: ${esc(err.message)}</td></tr>`;
  }
}

// 목록 날짜(월별 필터·계약일자 칸 기준): 계약된 건은 입금일, 그 외는 견적/계약일
function rowDateStr(r) { return r.deposit_date || r.contract_date || ''; }

// 월별 필터 채우기 — 데이터에 존재하는 월(YYYY-MM)만, 최근 월이 위로
function populateMonthFilter(rows) {
  const sel = document.getElementById('filter-month');
  if (!sel) return;
  const prev = sel.value;
  const months = [...new Set(rows.map((r) => rowDateStr(r).slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))]
    .sort((a, b) => b.localeCompare(a));
  sel.innerHTML = `<option value="">전체 기간</option>` + months.map((m) => {
    const [y, mo] = m.split('-');
    return `<option value="${m}">${y}년 ${Number(mo)}월</option>`;
  }).join('');
  sel.value = prev; // 선택 유지
}

function populateFilter(id, allLabel, values) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const prev = sel.value;
  const distinct = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  sel.innerHTML = `<option value="">${allLabel}</option>` + distinct.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  sel.value = prev; // 선택 유지
}

function applyListFilters() {
  const q = (document.getElementById('search').value || '').toLowerCase().trim();
  const st = document.getElementById('filter-stage').value;
  const mo = document.getElementById('filter-month')?.value || '';
  const sr = document.getElementById('filter-showroom').value;
  const sp = document.getElementById('filter-sales').value;
  let rows = listRows;
  if (st) rows = rows.filter((r) => stageOf(r) === st);
  if (mo) rows = rows.filter((r) => rowDateStr(r).slice(0, 7) === mo);
  if (sr) rows = rows.filter((r) => (r.showroom || '') === sr);
  if (sp) rows = rows.filter((r) => (r.salesperson || '') === sp);
  if (q) {
    const qDigits = q.replace(/\D/g, ''); // 연락처 뒷번호 검색용 (숫자만)
    rows = rows.filter((r) => {
      const textHit = [r.client_name, r.site_address, r.contract_no, r.showroom, r.salesperson]
        .some((v) => (v || '').toLowerCase().includes(q));
      const phoneHit = qDigits && String(r.client_phone || '').replace(/\D/g, '').includes(qDigits);
      return textHit || phoneHit;
    });
  }
  listFiltered = rows;
  renderListRows(rows);
}

// 현재 필터된 목록을 깔끔한 표로 인쇄
function printList() {
  const rows = (listFiltered || []).filter((r) => !r.is_sample);
  const box = document.getElementById('list-print');
  if (!box) return;
  if (!rows.length) { alert('인쇄할 계약이 없습니다.'); return; }
  // 적용된 필터 요약
  const selText = (id) => { const s = document.getElementById(id); return s && s.value ? s.options[s.selectedIndex].text : ''; };
  const q = (document.getElementById('search')?.value || '').trim();
  const parts = [];
  if (selText('filter-month')) parts.push(selText('filter-month'));
  if (selText('filter-stage')) parts.push(selText('filter-stage'));
  if (selText('filter-showroom')) parts.push(selText('filter-showroom'));
  if (selText('filter-sales')) parts.push(selText('filter-sales'));
  if (q) parts.push(`검색 "${q}"`);
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const permText = (r) => (r.permit_type === 'permit' ? '인허가' : r.permit_type === 'temporary' ? '가설축조' : '-');
  const dateText = (r) => {
    const contracted = CONTRACTED_STAGES.has(stageOf(r)) || !!r.deposit_date;
    const d = contracted ? (r.deposit_date || r.contract_date || '') : (r.contract_date || '');
    return d ? esc(d) + (contracted ? '' : ' (견적)') : '-';
  };
  const depText = (r) => {
    const contracted = CONTRACTED_STAGES.has(stageOf(r)) || !!r.deposit_date;
    const amt = contracted ? (r.deposit_amount || r.down_payment) : '';
    return fmtMan(amt) || '-';
  };
  const body = rows.map((r, i) => `<tr>
    <td class="c">${i + 1}</td>
    <td>${esc(r.contract_no || '-')}</td>
    <td>${esc(r.showroom || '-')}</td>
    <td>${esc(r.salesperson || '-')}</td>
    <td>${esc(r.client_name || '-')}</td>
    <td>${esc(r.site_address || '-')}</td>
    <td class="r">${fmtMan(r.total_amount) || '-'}</td>
    <td>${dateText(r)}</td>
    <td class="r">${depText(r)}</td>
    <td class="c">${permText(r)}</td>
    <td class="c">${esc(stageLabel(stageOf(r)))}</td>
  </tr>`).join('');
  box.innerHTML = `
    <div class="list-print-head">
      <div class="lp-title">㈜세움디자인하우징 · 계약 목록</div>
      <div class="lp-meta">${parts.length ? esc(parts.join(' · ')) + ' · ' : ''}총 ${rows.length}건 · 출력일 ${stamp}</div>
    </div>
    <table class="list-print-table">
      <thead><tr>
        <th>#</th><th>계약번호</th><th>전시장</th><th>영업사원</th><th>건축주</th><th>현장주소</th>
        <th class="r">제품합계(만원)</th><th>계약일자</th><th class="r">계약금(만원)</th><th>인허가</th><th>진행상태</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  window.print();
}

// 관리자만: 목록에서 전시장을 바로 바꿔 다른 전시장으로 넘기기
function canManageList() { return !authEnabled() || !!me?.isAdmin; }
function listShowroomSelect(r) {
  const v = r.showroom || '';
  const opts = [`<option value="" ${v ? '' : 'selected'}>- 미지정</option>`]
    .concat(SHOWROOMS.map((s) => `<option value="${esc(s)}" ${v === s ? 'selected' : ''}>${esc(s)}</option>`));
  if (v && !SHOWROOMS.includes(v)) opts.push(`<option value="${esc(v)}" selected>${esc(v)}</option>`); // 레거시 값 보존
  return `<select class="row-showroom" data-showroom-id="${r.id}" title="전시장 변경 → 그 전시장 직원에게 넘김">${opts.join('')}</select>`;
}
// 관리자: 계약 담당자(소유자)를 특정 직원으로 지정 → 그 직원에게 넘김
function rowOwnerSelect(r) {
  const cur = String(r.owner_email || '').toLowerCase();
  const opts = [`<option value="" ${cur ? '' : 'selected'}>- 담당 지정</option>`]
    .concat(employeeList.map((e) => `<option value="${esc(e.email)}" ${cur === e.email ? 'selected' : ''}>${esc(e.name || e.email)}${e.showroom ? ` (${esc(e.showroom)})` : ''}</option>`));
  if (cur && !employeeList.some((e) => e.email === cur)) opts.push(`<option value="${esc(cur)}" selected>${esc(cur)}</option>`); // 목록에 없는 기존 담당자 보존
  return `<select class="row-owner" data-owner-id="${r.id}" title="담당자 지정 → 그 직원에게 넘김(그 직원이 보게 됨)">${opts.join('')}</select>`;
}

// 중복 고객 배지 — 같은 연락처가 다른 전시장 계약에도 있으면 표시(클릭하면 상세 팝업)
function dupBadge(r) {
  const d = r.dupes;
  if (!Array.isArray(d) || !d.length) return '';
  return ` <span class="dup-badge no-print" data-dup="${esc(JSON.stringify(d))}" data-name="${esc(r.client_name || '')}" title="클릭하면 다른 전시장 견적 이력 보기">🔁 타 전시장 (${d.length})</span>`;
}

// 중복 고객 상세 팝업 — 닫기 전까지 유지
function openDupDialog(name, dupes) {
  if (!Array.isArray(dupes) || !dupes.length) return;
  const overlay = document.createElement('div');
  overlay.className = 'sign-modal-overlay no-print';
  overlay.innerHTML = `
    <div class="sign-modal dup-modal" role="dialog" aria-modal="true" aria-label="다른 전시장 견적 이력">
      <div class="sign-modal-head"><h3>🔁 다른 전시장 견적 이력</h3><button class="sign-x" type="button" aria-label="닫기">✕</button></div>
      <div class="dup-body">
        <p class="dup-sub muted small"><b>${esc(name || '이 고객')}</b> — 같은 연락처로 다른 전시장에서 받은 견적입니다.</p>
        <ul class="dup-list">${dupes.map((x) => `<li>
          <span class="dup-sr">${esc(x.showroom || '-')}</span>
          <span class="dup-mid">${esc(x.salesperson || '-')}</span>
          <span class="dup-dt">${esc(x.date || '-')}</span>
          ${x.id ? `<button type="button" class="btn tiny dup-go" data-id="${x.id}">📄 계약서 보기</button>` : ''}
        </li>`).join('')}</ul>
      </div>
      <div class="sign-modal-actions"><span class="grow"></span><button class="btn primary" data-act="close" type="button">확인</button></div>
    </div>`;
  document.body.appendChild(overlay);
  const done = () => { overlay.remove(); window.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') done(); };
  window.addEventListener('keydown', onKey);
  overlay.querySelector('.sign-x').onclick = done;
  overlay.querySelector('[data-act="close"]').onclick = done;
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) done(); });
  overlay.querySelectorAll('.dup-go').forEach((b) => {
    b.onclick = () => { const id = b.dataset.id; done(); go(`#/dup/${id}`); };
  });
}

// 오늘 날짜 YYYY-MM-DD
function todayYmd() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// 계약금 입금(금액·날짜) 입력 모달 — '계약완료' 처리 시 사용
function openDepositDialog({ initial = {}, onSave, onCancel } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'sign-modal-overlay no-print';
  overlay.innerHTML = `
    <div class="sign-modal dep-modal" role="dialog" aria-modal="true" aria-label="계약금 입금 정보">
      <div class="sign-modal-head"><h3>계약완료 — 계약금 입금 정보</h3><button class="sign-x" type="button" aria-label="닫기">✕</button></div>
      <p class="dep-note">계약완료는 <b>계약금(10%)을 전액 받은 경우에만</b> 변경해 주세요.<br>아직 계약금을 받지 않았다면 <b>취소</b>를 누르고 진행상태를 <b>‘계약금 대기’</b>로 변경해 주세요.</p>
      <div class="dep-body">
        <label class="dep-field">받은 계약금 <span class="muted small">(만원)</span>
          <input id="dep-amount" class="dep-input" type="text" inputmode="numeric" value="${esc(initial.amount ?? '')}" placeholder="예: 500" />
        </label>
        <label class="dep-field">입금 날짜
          <input id="dep-date" class="dep-input" type="date" value="${esc(initial.date || todayYmd())}" />
        </label>
      </div>
      <div class="sign-modal-actions"><span class="grow"></span>
        <button class="btn" data-act="cancel" type="button">취소</button>
        <button class="btn primary" data-act="save" type="button">저장</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const amountEl = overlay.querySelector('#dep-amount');
  const dateEl = overlay.querySelector('#dep-date');
  amountEl.addEventListener('input', () => { amountEl.value = amountEl.value.replace(/[^\d.,]/g, ''); });
  let settled = false;
  const done = (result) => {
    if (settled) return; settled = true;
    window.removeEventListener('keydown', onKey);
    overlay.remove();
    if (result) onSave?.(result); else onCancel?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') done(null); };
  window.addEventListener('keydown', onKey);
  overlay.querySelector('.sign-x').onclick = () => done(null);
  overlay.querySelector('[data-act="cancel"]').onclick = () => done(null);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) done(null); });
  overlay.querySelector('[data-act="save"]').onclick = () => done({ amount: amountEl.value.trim(), date: dateEl.value });
  setTimeout(() => amountEl.focus(), 0);
}

// 계약 단계로 넘어간(입금된) 건인지 — 이 경우 날짜는 '계약금 입금일'
const CONTRACTED_STAGES = new Set(['completed', 'design_3d', 'production', 'installing', 'delivered']);
// 목록 날짜 칸: 계약된 건은 입금일(=계약일)+받은 계약금, 견적 단계 건은 견적일(견적 표시)
function listDateCell(r) {
  const contracted = CONTRACTED_STAGES.has(stageOf(r)) || !!r.deposit_date;
  if (!contracted) {
    const q = r.contract_date || '';
    return q ? `${esc(q)} <span class="quote-tag" title="견적 단계 (계약금 입금 전)">견적</span>` : '-';
  }
  const d = r.deposit_date || r.contract_date || '';
  return d ? esc(d) : '-';
}

// 계약금 열 — 받은 계약금 금액(만원)
// 계약완료 처리 시 입력한 금액(deposit_amount)이 있으면 우선, 없으면 본문 계약금(downPayment)으로 대체
function listDepositCell(r) {
  const contracted = CONTRACTED_STAGES.has(stageOf(r)) || !!r.deposit_date;
  if (!contracted) return '<span class="muted small">—</span>';
  const explicit = String(r.deposit_amount || '').trim();
  const amt = explicit || String(r.down_payment || '').trim();
  if (!amt || amt === '0') return '<span class="muted small">—</span>';
  const shown = fmtMan(amt) || esc(amt);
  return `<span class="dep-mini" title="받은 계약금">💰${shown}</span>`;
}

// 인허가 열 — 계약서에서 선택한 인허가 구분 (permit=준공용/인허가, temporary=가설축조신고, 미선택=—)
function listPermitCell(r) {
  const v = r.permit_type;
  if (v === 'permit') return '<span class="permit-badge yes" title="주택 — 준공용 인허가">인허가</span>';
  if (v === 'temporary') return '<span class="permit-badge no" title="컨테이너·체류형쉼터 — 가설건축물축조신고">가설축조</span>';
  return '<span class="muted small">—</span>';
}

function renderListRows(rows) {
  const body = document.getElementById('list-body');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${listCols()}" class="muted center">조건에 맞는 계약서가 없습니다.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((r) => `
    <tr data-id="${r.id}" class="row">
      <td>${esc(r.contract_no || '-')}</td>
      <td>${(r.is_sample || !canManageList()) ? esc(r.showroom || '-') : listShowroomSelect(r)}</td>
      <td>${esc(r.salesperson || '-')}</td>
      <td>${esc(r.client_name || '-')}${dupBadge(r)}</td>
      <td class="ellipsis">${esc(r.site_address || '-')}</td>
      <td class="right">${fmtMan(r.total_amount) || '-'}</td>
      <td>${listDateCell(r)}</td>
      <td class="right">${listDepositCell(r)}</td>
      <td class="center">${r.is_sample ? '' : listPermitCell(r)}</td>
      <td class="center">${r.is_sample ? '' : (Number(r.id_count) > 0
        ? `<span class="id-badge" title="신분증 ${Number(r.id_count)}매 첨부됨">📎 ${Number(r.id_count)}</span>`
        : '<span class="muted small">—</span>')}</td>
      <td class="center">${r.is_sample ? '' : (Number(r.drawing_count) > 0
        ? `<span class="dw-badge" title="협의도면 ${Number(r.drawing_count)}건 첨부됨">📐 ${Number(r.drawing_count)}</span>`
        : '<span class="muted small">—</span>')}</td>
      <td>${r.is_sample
        ? '<span class="badge">샘플</span>'
        : `<select class="row-stage stage-${stageOf(r)}" data-stage-id="${r.id}" title="진행상태 변경">
            ${STAGES.map((s) => `<option value="${s.key}" ${stageOf(r) === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select>${r.status === 'confirmed' ? ' <span class="lock" title="확정·봉인됨">🔒</span>' : ''}`}</td>
      <td>${r.is_sample ? '' : (r.approval_at
        ? `<button class="row-approve approved" data-approve-id="${r.id}" title="${esc(fmtSignDate(r.approval_at))} 승인됨 · 다시 서명">✅ 승인됨</button>`
        : `<button class="row-approve" data-approve-id="${r.id}" title="대표이사 승인 전자서명">✎ 승인</button>`)}</td>
      ${canManageList() ? `<td>${r.is_sample ? '' : rowOwnerSelect(r)}</td>` : ''}
      <td class="memo-cell">${r.is_sample ? '' : `<input class="row-memo" data-memo-id="${r.id}" value="${esc(r.memo || '')}" placeholder="메모..." title="직원 메모 · 입력 후 다른 곳을 클릭하면 저장됩니다" />`}</td>
      <td class="muted small">${esc((r.updated_at || '').slice(0, 16))}</td>
      <td>${r.is_sample ? '' : `<button class="btn tiny danger" data-del="${r.id}">삭제</button>`}</td>
    </tr>`).join('');

  body.querySelectorAll('.row').forEach((tr) => {
    tr.onclick = (e) => {
      if (e.target.dataset.del || e.target.closest('.row-stage') || e.target.closest('.row-approve') || e.target.closest('.row-memo') || e.target.closest('.row-showroom') || e.target.closest('.row-owner') || e.target.closest('.dup-badge')) return; // 인라인 조작은 행 이동 제외
      go(`#/edit/${tr.dataset.id}`);
    };
  });
  // 중복 고객 배지: 클릭하면 상세 팝업
  body.querySelectorAll('.dup-badge').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      let dupes = [];
      try { dupes = JSON.parse(b.dataset.dup || '[]'); } catch { dupes = []; }
      openDupDialog(b.dataset.name || '', dupes);
    };
  });
  // 직원 메모: 목록에서 바로 입력 (엔터 또는 포커스 아웃 시 저장, Esc는 취소)
  body.querySelectorAll('.row-memo').forEach((inp) => {
    inp.onclick = (e) => e.stopPropagation();
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }          // 엔터 → 저장(blur가 onchange 유발)
      else if (e.key === 'Escape') {                                       // Esc → 원래 값으로 되돌리고 취소
        const cached = listRows.find((r) => String(r.id) === String(inp.dataset.memoId));
        inp.value = cached ? (cached.memo || '') : '';
        inp.blur();
      }
    };
    inp.onchange = async () => {
      const id = inp.dataset.memoId;
      const val = inp.value;
      inp.disabled = true;
      inp.classList.remove('saved');
      try {
        const rec = await api.get(id);
        const data = rec.data || {};
        data.memo = val;
        await api.update(id, data);
        const cached = listRows.find((r) => String(r.id) === String(id));
        if (cached) cached.memo = val;
        inp.classList.add('saved'); // 저장 표시(잠깐 초록 테두리)
        setTimeout(() => inp.classList.remove('saved'), 1200);
      } catch (err) {
        alert('메모 저장 실패: ' + err.message);
      } finally {
        inp.disabled = false;
      }
    };
  });
  // 대표이사 승인: 목록에서 바로 전자서명 결재 (이미 승인된 건은 기존 서명을 미리보기로 띄워 수정 가능)
  body.querySelectorAll('.row-approve').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.approveId;
      btn.disabled = true;
      let rec;
      try {
        rec = await api.get(id); // 기존 승인 서명 이미지를 가져와 미리보기
      } catch (err) {
        alert('불러오기 실패: ' + err.message);
        btn.disabled = false;
        return;
      }
      btn.disabled = false;
      const data = rec.data || {};
      const existing = data.signatures?.approval?.image || '';
      openSignaturePad({
        title: existing ? '대표이사 승인 — 서명 수정' : '대표이사 승인 전자서명',
        initial: existing,
        onSave: async (dataUrl) => {
          btn.disabled = true;
          try {
            data.signatures = data.signatures || {};
            data.signatures.approval = dataUrl
              ? { image: dataUrl, signedAt: new Date().toISOString(), agent: navigator.userAgent }
              : { image: '', signedAt: '', agent: '' }; // 빈 서명이면 승인 취소
            await api.update(id, data);
            loadList();
          } catch (err) {
            alert('승인 저장 실패: ' + err.message);
            btn.disabled = false;
          }
        },
      });
    };
  });
  // 진행상태: 목록에서 바로 변경 (계약서를 열지 않아도 됨)
  body.querySelectorAll('.row-stage').forEach((sel) => {
    sel.onclick = (e) => e.stopPropagation();
    sel.onchange = async (e) => {
      e.stopPropagation();
      const id = sel.dataset.stageId;
      const stage = sel.value;
      const cached = listRows.find((r) => String(r.id) === String(id));
      const prevStage = cached ? stageOf(cached) : '';
      const applyStage = async (deposit) => {
        sel.disabled = true;
        try {
          const rec = await api.get(id);
          const data = rec.data || {};
          data.stage = stage;
          if (deposit) data.deposit = deposit;
          await api.update(id, data);
          sel.className = `row-stage stage-${stage}`; // 색상 갱신
          if (cached) cached.stage = stage; // 캐시 동기화 (필터 정확도)
        } catch (err) {
          alert('진행상태 변경 실패: ' + err.message);
          loadList();
        } finally {
          sel.disabled = false;
        }
      };
      // '계약완료'로 바꿀 때 계약금 입금(금액·날짜) 입력받기 (취소 시 원복)
      if (stage === 'completed') {
        openDepositDialog({
          onSave: (dep) => applyStage({ ...dep, at: new Date().toISOString() }),
          onCancel: () => { sel.value = prevStage; sel.className = `row-stage stage-${prevStage}`; },
        });
        return;
      }
      applyStage();
    };
  });
  // 전시장 인라인 변경 (관리자): 다른 전시장으로 넘기기
  body.querySelectorAll('.row-showroom').forEach((sel) => {
    sel.onclick = (e) => e.stopPropagation();
    sel.onchange = async () => {
      const id = sel.dataset.showroomId;
      const val = sel.value;
      sel.disabled = true;
      try {
        const rec = await api.get(id);
        const data = rec.data || {};
        data.showroom = val;
        await api.update(id, data);
        const cached = listRows.find((r) => String(r.id) === String(id));
        if (cached) cached.showroom = val; // 캐시 동기화
      } catch (err) {
        alert('전시장 변경 실패: ' + err.message);
        loadList();
      } finally {
        sel.disabled = false;
      }
    };
  });
  // 담당자 지정 (관리자): 계약 소유자를 특정 직원으로 → 그 직원에게 넘김
  body.querySelectorAll('.row-owner').forEach((sel) => {
    sel.onclick = (e) => e.stopPropagation();
    sel.onchange = async () => {
      const id = sel.dataset.ownerId;
      const email = sel.value;
      const emp = employeeList.find((e) => e.email === email);
      sel.disabled = true;
      try {
        const rec = await api.get(id);
        const data = rec.data || {};
        data.ownerEmail = email;
        data.ownerName = emp?.name || '';
        await api.update(id, data);
        const cached = listRows.find((r) => String(r.id) === String(id));
        if (cached) cached.owner_email = email; // 캐시 동기화
      } catch (err) {
        alert('담당자 지정 실패: ' + err.message);
        loadList();
      } finally {
        sel.disabled = false;
      }
    };
  });
  body.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('이 계약서를 휴지통으로 보낼까요?\n휴지통에서 다시 복원할 수 있습니다.')) return;
      b.disabled = true;
      try {
        const rec = await api.get(b.dataset.del); // 소프트 삭제: 본문에 삭제표시만 남기고 보관
        const data = rec.data || {};
        data.deletedAt = new Date().toISOString();
        await api.update(b.dataset.del, data);
        loadList();
      } catch (err) {
        alert('삭제 실패: ' + err.message);
        b.disabled = false;
      }
    };
  });
}

// ---------- 관리자 통계 페이지 (관리자 전용) ----------
let adminRows = [];
let adminEmps = [];
let adminTargets = {}; // { 영업사원: { count, amount(만) } } — 월 목표(이 기기 저장)
function loadTargets() { try { return JSON.parse(localStorage.getItem('seum_admin_targets') || '{}'); } catch { return {}; } }
function saveTargets() { try { localStorage.setItem('seum_admin_targets', JSON.stringify(adminTargets)); } catch { /* 저장 실패 무시 */ } }
function achHtml(actual, target) {
  if (!target) return '<span class="muted">·</span>';
  const p = Math.round(actual / target * 100);
  const cls = p >= 100 ? 'ok' : (p >= 70 ? 'warn' : 'danger');
  return `<b class="ach-${cls}">${p}%</b>`;
}
async function renderAdmin() {
  if (!canManageList()) return go('#/'); // 관리자 외 접근 차단
  current = null; currentId = null; dirty = false;
  app.innerHTML = `
    <div class="topbar no-print">
      <div class="brand"><span class="logo">SEUM</span> 관리자 페이지 <small>계약 통계 · KPI</small></div>
      <div class="actions">
        <select id="adm-month" class="filter-sel" title="조회할 월 선택"></select>
        <button class="btn" id="adm-print-btn" title="이 통계를 인쇄 / PDF">🖨 인쇄</button>
        <button class="btn" id="back-btn">← 목록으로</button>
        ${accountChip()}
      </div>
    </div>
    <div class="admin-wrap" id="admin-wrap">
      <p class="muted center" style="padding:48px">불러오는 중…</p>
    </div>`;
  document.getElementById('back-btn').onclick = () => go('#/');
  document.getElementById('adm-print-btn').onclick = () => window.print();
  bindAccount(app);
  try {
    adminRows = (await api.list('')).filter((r) => !r.is_sample);
    try { adminEmps = await api.employees(); } catch { adminEmps = []; } // 세움os 직원 명부(전시장 소속)
    adminTargets = loadTargets();
  } catch (err) {
    document.getElementById('admin-wrap').innerHTML = `<p class="center danger" style="padding:40px">통계를 불러오지 못했습니다: ${esc(err.message)}</p>`;
    return;
  }
  // 레이아웃: 좌측 뷰어 권한 설정 패널 + 우측 통계 본문
  document.getElementById('admin-wrap').innerHTML = `
    <div class="admin-layout">
      ${permissionPanelHtml()}
      <div class="admin-main"><div id="admin-body"></div></div>
    </div>`;
  bindPermissionPanel();
  // 월 선택지 채우기
  const months = [...new Set(adminRows.map((r) => admDateStr(r).slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort((a, b) => b.localeCompare(a));
  const sel = document.getElementById('adm-month');
  sel.innerHTML = months.map((m) => `<option value="${m}">${admMonthLabel(m)}</option>`).join('') + `<option value="">전체 기간</option>`;
  sel.value = months[0] || '';
  sel.onchange = () => renderAdminBody(sel.value);
  renderAdminBody(sel.value);
}

// 뷰어 권한 설정 패널 (관리자 전용) — 전시장별로 묶어 직원별 열람 범위 드롭다운
function permissionPanelHtml() {
  const opt = (v, cur, label) => `<option value="${v}" ${(cur || 'own') === v ? 'selected' : ''}>${label}</option>`;
  // 전시장별 그룹핑 (세움os처럼)
  const byShow = {};
  for (const e of adminEmps) { const sh = admShowroom(e.showroom); (byShow[sh] = byShow[sh] || []).push(e); }
  const showNames = Object.keys(byShow).sort((a, b) => {
    const ia = SHOWROOM_ORDER.indexOf(a), ib = SHOWROOM_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'ko');
  });
  const empRow = (e) => `
    <tr>
      <td class="perm-name">${esc(e.name || '-')}</td>
      <td class="perm-cell">
        <select class="perm-sel" data-email="${esc(e.email)}">
          ${opt('own', e.scope, '본인만')}${opt('showroom', e.scope, '같은 전시장')}${opt('all', e.scope, '전체')}
        </select>
        <span class="perm-status" data-email="${esc(e.email)}"></span>
      </td>
    </tr>`;
  const body = showNames.length ? showNames.map((sh) => {
    const emps = byShow[sh].slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
    return `<tr class="perm-group"><td colspan="2">${esc(sh)} <span class="muted small">${emps.length}명</span></td></tr>${emps.map(empRow).join('')}`;
  }).join('') : `<tr><td colspan="2" class="muted center" style="padding:16px">직원 명부를 불러올 수 없습니다.</td></tr>`;
  return `<aside class="perm-panel no-print">
    <h3 class="perm-title">👁 뷰어 권한 설정</h3>
    <p class="perm-hint muted small">직원별 계약서 열람 범위입니다. <b>본인만</b>(영업사원) · <b>같은 전시장</b>(지점장) · <b>전체</b>(본사 정산팀).</p>
    <div class="perm-scroll"><table class="perm-table">
      <thead><tr><th>이름</th><th>열람 범위</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </aside>`;
}

function bindPermissionPanel() {
  document.querySelectorAll('.perm-sel').forEach((sel) => {
    sel.onchange = async () => {
      const email = sel.dataset.email, scope = sel.value;
      const status = document.querySelector(`.perm-status[data-email="${CSS.escape(email)}"]`);
      sel.disabled = true;
      if (status) { status.textContent = '저장 중…'; status.className = 'perm-status'; }
      try {
        await api.setEmployeeScope(email, scope);
        const emp = adminEmps.find((e) => e.email === email);
        if (emp) emp.scope = scope;
        if (status) { status.textContent = '✔ 저장됨'; status.className = 'perm-status ok'; }
      } catch (err) {
        if (status) { status.textContent = '실패: ' + err.message; status.className = 'perm-status danger'; }
      } finally {
        sel.disabled = false;
        if (status) setTimeout(() => { status.textContent = ''; }, 2500);
      }
    };
  });
}

function admDateStr(r) { return r.deposit_date || r.contract_date || ''; }
function admContracted(r) { return CONTRACTED_STAGES.has(stageOf(r)) || !!r.deposit_date; }
function admNum(v) { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; }
function admMonthLabel(m) { const [y, mo] = m.split('-'); return `${y}년 ${Number(mo)}월`; }
// 전시장 표기 정규화 (광주/광주전시장, 본사/본사 전시장 등 통합)
const SHOWROOM_ALIAS = { '본사': '본사 전시장', '본점': '본사 전시장', '1전시장': '1전시장', '제1전시장': '1전시장', '3전시장': '3전시장', '제3전시장': '3전시장', '강화': '강화전시장', '안동': '안동전시장', '광주': '광주전시장' };
function admShowroom(v) { const s = String(v ?? '').trim(); if (!s) return '미지정'; return SHOWROOM_ALIAS[s] || s; }
const SHOWROOM_ORDER = ['본사 전시장', '1전시장', '3전시장', '강화전시장', '안동전시장', '광주전시장'];

function renderAdminBody(period) {
  const wrap = document.getElementById('admin-body') || document.getElementById('admin-wrap');
  const rows = adminRows.filter((r) => !period || admDateStr(r).slice(0, 7) === period);
  const periodLabel = period ? admMonthLabel(period) : '전체 기간';
  // ── KPI 집계 ──
  const contracted = rows.filter(admContracted);
  const canceled = rows.filter((r) => stageOf(r) === 'canceled');
  const quotes = rows.filter((r) => !admContracted(r) && stageOf(r) !== 'canceled');
  const conv = (contracted.length + quotes.length) ? Math.round(contracted.length / (contracted.length + quotes.length) * 100) : 0;
  const sumAmt = contracted.reduce((a, r) => a + admNum(r.total_amount), 0);
  const sumDep = contracted.reduce((a, r) => a + admNum(r.deposit_amount || r.down_payment), 0);
  const kpi = [
    { label: `계약완료 (${periodLabel})`, val: `${contracted.length}건`, cls: 'ok' },
    { label: '견적·진행중', val: `${quotes.length}건` },
    { label: '계약 전환율', val: `${conv}%`, cls: 'brand' },
    { label: '총 계약금액', val: `${fmtMan(sumAmt)}만`, cls: 'brand' },
    { label: '받은 계약금 합계', val: `${fmtMan(sumDep)}만`, cls: 'ok' },
    { label: '취소', val: `${canceled.length}건`, cls: 'danger' },
  ];
  // ── 전시장 → 영업사원 → 월별 계약(완료) 건수 ──
  const months = [...new Set(contracted.map((r) => admDateStr(r).slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort();
  // 그룹: 전시장 → 영업사원 (개인). 2명 이상 함께 적힌 건은 별도 '공동 계약'으로 분리
  // 전시장 소속은 세움os 직원 명부(employees) 기준 — 계약서에 적힌 전시장이 달라도 소속대로 묶임
  const empShow = {}; // 이름 -> 공식 전시장(한글)
  for (const e of adminEmps) if (e.name) empShow[e.name.trim()] = admShowroom(e.showroom);
  const groups = {}; // showroom -> salesperson -> { done, quotes, amt, dep }
  const coop = {};   // "names" -> { sh, sp, done, quotes, amt, dep }
  const isCoop = (sp) => sp.split(/[,\/]/).map((s) => s.trim()).filter(Boolean).length >= 2;
  const ensure = (sh, sp) => { groups[sh] = groups[sh] || {}; return groups[sh][sp] = groups[sh][sp] || { done: 0, quotes: 0, amt: 0, dep: 0 }; };
  for (const r of rows) {
    const sp = (r.salesperson || '미지정').trim();
    // 소속 전시장: 직원 명부 우선, 없으면 계약서에 적힌 전시장
    const sh = empShow[sp] || admShowroom(r.showroom);
    let g;
    if (isCoop(sp)) { g = coop[sh + '|' + sp] = coop[sh + '|' + sp] || { sh, sp, done: 0, quotes: 0, amt: 0, dep: 0 }; }
    else { g = ensure(sh, sp); }
    if (admContracted(r)) { g.done += 1; g.amt += admNum(r.total_amount); g.dep += admNum(r.deposit_amount || r.down_payment); }
    else if (stageOf(r) !== 'canceled') { g.quotes += 1; }
  }
  const showNames = Object.keys(groups).sort((a, b) => {
    const ia = SHOWROOM_ORDER.indexOf(a), ib = SHOWROOM_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'ko');
  });

  // ── 전시장 → 영업사원(개인) 실적 표 (선택 기간) ──
  let table;
  if (!rows.length) {
    table = `<p class="muted center" style="padding:28px">${periodLabel}에 해당하는 계약이 없습니다.</p>`;
  } else if (!showNames.length) {
    table = `<p class="muted center" style="padding:28px">개인 영업사원 실적이 없습니다. (아래 공동 계약 참고)</p>`;
  } else {
    let gDone = 0, gQuote = 0, gAmt = 0, gDep = 0, body = '';
    for (const sh of showNames) {
      const sps = Object.keys(groups[sh]).sort((a, b) => groups[sh][b].done - groups[sh][a].done || a.localeCompare(b, 'ko'));
      let sDone = 0, sQuote = 0, sAmt = 0, sDep = 0, spRows = '';
      for (const sp of sps) {
        const g = groups[sh][sp];
        const denom = g.done + g.quotes;
        const conv = denom ? Math.round(g.done / denom * 100) : 0;
        sDone += g.done; sQuote += g.quotes; sAmt += g.amt; sDep += g.dep;
        spRows += `<tr>
          <td class="adm-sp">${esc(sp)}</td>
          <td class="right adm-tot">${g.done || '·'}</td>
          <td class="right muted">${g.quotes || '·'}</td>
          <td class="right">${denom ? conv + '%' : '·'}</td>
          <td class="right">${fmtMan(g.amt) || '·'}</td>
          <td class="right">${fmtMan(g.dep) || '·'}</td></tr>`;
      }
      gDone += sDone; gQuote += sQuote; gAmt += sAmt; gDep += sDep;
      body += `<tr class="adm-show"><td>${esc(sh)} <span class="muted small">${sps.length}명</span></td>
        <td class="right adm-tot">${sDone || '·'}</td><td class="right">${sQuote || '·'}</td>
        <td class="right">·</td><td class="right">${fmtMan(sAmt) || '·'}</td><td class="right">${fmtMan(sDep) || '·'}</td></tr>${spRows}`;
    }
    table = `<div class="adm-scroll"><table class="adm-table">
      <thead><tr><th>전시장 / 영업사원</th><th class="right">계약완료</th><th class="right">견적·진행</th><th class="right">전환율</th><th class="right">계약금액(만)</th><th class="right">받은계약금(만)</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td>개인 합계</td><td class="right adm-tot">${gDone}</td><td class="right">${gQuote}</td><td class="right">·</td><td class="right">${fmtMan(gAmt) || '·'}</td><td class="right">${fmtMan(gDep) || '·'}</td></tr></tfoot>
    </table></div>`;
  }

  // ── 공동 계약(2인 이상) 별도 표 ──
  const coopList = Object.values(coop).sort((a, b) => b.done - a.done || b.amt - a.amt || a.sp.localeCompare(b.sp, 'ko'));
  let coopTable = '';
  if (coopList.length) {
    let cD = 0, cQ = 0, cA = 0, cP = 0;
    const rowsHtml = coopList.map((g) => {
      const denom = g.done + g.quotes; const conv = denom ? Math.round(g.done / denom * 100) : 0;
      cD += g.done; cQ += g.quotes; cA += g.amt; cP += g.dep;
      return `<tr>
        <td class="adm-sp">${esc(g.sp)}</td><td class="muted">${esc(g.sh)}</td>
        <td class="right adm-tot">${g.done || '·'}</td><td class="right muted">${g.quotes || '·'}</td>
        <td class="right">${denom ? conv + '%' : '·'}</td>
        <td class="right">${fmtMan(g.amt) || '·'}</td><td class="right">${fmtMan(g.dep) || '·'}</td></tr>`;
    }).join('');
    coopTable = `
      <h3 class="adm-h">공동 계약 <span class="muted small">— 2인 이상 함께 진행한 건 (개인 실적과 분리)</span></h3>
      <div class="adm-scroll"><table class="adm-table">
        <thead><tr><th>공동 영업사원</th><th>전시장</th><th class="right">계약완료</th><th class="right">견적·진행</th><th class="right">전환율</th><th class="right">계약금액(만)</th><th class="right">받은계약금(만)</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr><td colspan="2">공동 합계</td><td class="right adm-tot">${cD}</td><td class="right">${cQ}</td><td class="right">·</td><td class="right">${fmtMan(cA) || '·'}</td><td class="right">${fmtMan(cP) || '·'}</td></tr></tfoot>
      </table></div>`;
  }

  // ── 목표 대비 달성률 표 (개인 영업사원, 월 목표 기준) ──
  const individuals = [];
  for (const sh of showNames) for (const sp of Object.keys(groups[sh])) individuals.push({ sh, sp, ...groups[sh][sp] });
  individuals.sort((a, b) => b.done - a.done || b.amt - a.amt || a.sp.localeCompare(b.sp, 'ko'));
  const targetTable = individuals.length ? `<div class="adm-scroll"><table class="adm-table adm-target-table">
    <thead><tr><th>영업사원</th><th>전시장</th><th class="right">계약완료</th><th class="right">목표(건)</th><th class="right">달성률</th><th class="right">계약금액(만)</th><th class="right">목표(만)</th><th class="right">달성률</th></tr></thead>
    <tbody>${individuals.map((s) => {
      const t = adminTargets[s.sp] || {};
      return `<tr data-sp="${esc(s.sp)}" data-done="${s.done}" data-amt="${s.amt}">
        <td class="adm-sp">${esc(s.sp)}</td><td class="muted">${esc(s.sh)}</td>
        <td class="right adm-tot">${s.done}</td>
        <td class="right"><input class="adm-target" data-kind="count" value="${t.count || ''}" inputmode="numeric" placeholder="—" /></td>
        <td class="right adm-ach" data-kind="count">${achHtml(s.done, t.count)}</td>
        <td class="right">${fmtMan(s.amt) || '·'}</td>
        <td class="right"><input class="adm-target adm-target-amt" data-kind="amount" value="${t.amount || ''}" inputmode="numeric" placeholder="—" /></td>
        <td class="right adm-ach" data-kind="amount">${achHtml(s.amt, t.amount)}</td></tr>`;
    }).join('')}</tbody>
  </table></div>` : '';

  wrap.innerHTML = `
    <div class="adm-report-head">㈜세움디자인하우징 · 계약 통계 · KPI <b>${periodLabel}</b></div>
    <div class="kpi-row">${kpi.map((k) => `<div class="kpi-card"><div class="kpi-val ${k.cls || ''}">${k.val}</div><div class="kpi-label">${k.label}</div></div>`).join('')}</div>
    <h3 class="adm-h">전시장 · 영업사원별 실적 <span class="muted small">— ${periodLabel} · 개인 (계약완료 기준)</span></h3>
    ${table}
    ${coopTable}
    ${individuals.length ? `<h3 class="adm-h">🎯 목표 대비 달성률 <span class="muted small">— ${periodLabel} 월 목표 (목표값은 이 기기에 저장)</span></h3>${targetTable}` : ''}`;

  // 목표 입력 → 저장 + 달성률 즉시 갱신
  wrap.querySelectorAll('.adm-target').forEach((inp) => {
    inp.oninput = () => {
      inp.value = inp.value.replace(/[^\d]/g, '');
      const tr = inp.closest('tr');
      const sp = tr.dataset.sp, kind = inp.dataset.kind;
      const t = adminTargets[sp] = adminTargets[sp] || {};
      t[kind] = inp.value ? Number(inp.value) : 0;
      saveTargets();
      const actual = kind === 'count' ? Number(tr.dataset.done) : Number(tr.dataset.amt);
      const cell = tr.querySelector(`.adm-ach[data-kind="${kind}"]`);
      if (cell) cell.innerHTML = achHtml(actual, t[kind]);
    };
  });
}

// ---------- 휴지통 화면 ----------
async function renderTrash() {
  current = null; currentId = null; dirty = false;
  app.innerHTML = `
    <div class="topbar no-print">
      <div class="brand"><span class="logo">SEUM</span> 휴지통 <small>삭제된 계약</small></div>
      <div class="actions">
        <button class="btn" id="back-btn">← 목록으로</button>
      </div>
    </div>
    <div class="list-wrap no-print">
      <p class="muted trash-note"><b>복원</b>하면 계약 목록으로 되돌아갑니다.${canManageList() ? ' <b>영구삭제</b>하면 다시 살릴 수 없습니다.' : ' (영구삭제는 관리자만 가능합니다.)'}</p>
      <table class="list-table">
        <thead>
          <tr>
            <th>계약번호</th><th>전시장</th><th>영업사원</th><th>건축주</th><th>현장주소</th>
            <th class="right">제품합계(만원)</th><th>계약일자</th><th>삭제일시</th><th></th>
          </tr>
        </thead>
        <tbody id="trash-body"><tr><td colspan="9" class="muted center">불러오는 중...</td></tr></tbody>
      </table>
    </div>`;
  document.getElementById('back-btn').onclick = () => go('#/');
  loadTrash();
}

async function loadTrash() {
  const body = document.getElementById('trash-body');
  try {
    const rows = await api.list('', { deleted: true });
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="9" class="muted center">휴지통이 비어 있습니다.</td></tr>`;
      return;
    }
    body.innerHTML = rows.map((r) => `
      <tr data-id="${r.id}">
        <td>${esc(r.contract_no || '-')}</td>
        <td>${esc(r.showroom || '-')}</td>
        <td>${esc(r.salesperson || '-')}</td>
        <td>${esc(r.client_name || '-')}</td>
        <td class="ellipsis">${esc(r.site_address || '-')}</td>
        <td class="right">${fmtMan(r.total_amount) || '-'}</td>
        <td>${esc(r.contract_date || '-')}</td>
        <td class="muted small">${esc(r.deleted_at ? fmtSignDate(r.deleted_at) : '-')}</td>
        <td class="trash-actions">
          <button class="btn tiny primary" data-restore="${r.id}">복원</button>
          ${canManageList() ? `<button class="btn tiny danger" data-purge="${r.id}">영구삭제</button>` : ''}
        </td>
      </tr>`).join('');
    bindTrashActions();
  } catch (err) {
    body.innerHTML = `<tr><td colspan="9" class="center danger">휴지통을 불러오지 못했습니다: ${esc(err.message)}</td></tr>`;
  }
}

function bindTrashActions() {
  const body = document.getElementById('trash-body');
  body.querySelectorAll('[data-restore]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        const rec = await api.get(b.dataset.restore); // 복원: 삭제표시만 제거
        const data = rec.data || {};
        delete data.deletedAt;
        await api.update(b.dataset.restore, data);
        loadTrash();
      } catch (err) {
        alert('복원 실패: ' + err.message);
        b.disabled = false;
      }
    };
  });
  body.querySelectorAll('[data-purge]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('영구 삭제하면 되돌릴 수 없습니다.\n정말 삭제할까요?')) return;
      b.disabled = true;
      try {
        await api.remove(b.dataset.purge); // 영구삭제: DB에서 완전 제거
        loadTrash();
      } catch (err) {
        alert('영구삭제 실패: ' + err.message);
        b.disabled = false;
      }
    };
  });
}

// ---------- 새 계약: 모델 선택 화면 ----------
function renderModelPicker() {
  current = null; currentId = null; dirty = false;
  // 전시장별로 그 전시장 소속 모델만 표시 (모델을 고르면 전시장이 함께 자동 설정됨)
  const modelCard = (m) => `
    <button class="mp-card mp-model" data-model="${m.id}">
      <img class="mp-photo" src="/img/models/${m.photoId || m.id}.jpg" alt="${esc(m.name)} 대표사진" loading="lazy" onerror="this.remove()" />
      <span class="mp-body">
        <span class="mp-name">${esc(m.name)}</span>
        <span class="mp-meta">${esc(m.category)} · ${m.area}평</span>
        <span class="mp-price">시작가 ${fmtMan(m.startPrice)}만</span>
      </span>
    </button>`;
  // 일산 박람회 모델(전시장 없이 영업사원 본인 전시장으로 열림)
  const expoModels = MODELS.filter((m) => m.expo);
  const expoSection = expoModels.length ? `
      <h3 class="mp-section-title">🎪 일산 박람회 모델</h3>
      <p class="muted small">박람회 출품 모델 견적서 — 누르면 본인 전시장으로 자동 세팅된 견적서가 열립니다. (신모델 2개는 임시값, 상세 수정 예정)</p>
      <div class="mp-grid">${expoModels.map(modelCard).join('')}</div>` : '';
  const showroomSections = SHOWROOMS.map((sr) => {
    const models = MODELS.filter((m) => m.showroom === sr);
    if (!models.length) return '';
    return `<h3 class="mp-cat mp-showroom">🏢 ${esc(sr)} <span class="muted small">${models.length}개 모델</span></h3>
      <div class="mp-grid">${models.map(modelCard).join('')}</div>`;
  }).join('');
  app.innerHTML = `
    <div class="topbar no-print">
      <div class="brand"><a href="#/" class="back">← 목록</a></div>
      <div class="doc-meta"><span class="muted">새 계약서</span></div>
      <div class="actions"></div>
    </div>
    <div class="model-picker no-print">
      <h2 class="mp-title">어떤 계약서로 만들까요?</h2>
      <div class="mp-grid mp-basic-grid">
        <button class="mp-card mp-basic" data-model="blank">
          <span class="mp-name">📄 기본 계약서</span>
          <span class="mp-meta">통합(전체 옵션) 빈 양식 · 모델 없이 모든 옵션 표시</span>
        </button>
      </div>
      ${expoSection}
      <h3 class="mp-section-title">전시장별 모델 계약서</h3>
      <p class="muted small">모델을 고르면 해당 전시장·시작가·기본 평수가 자동으로 세팅된 계약서가 열립니다.</p>
      ${showroomSections}
    </div>`;
  app.querySelectorAll('.mp-card').forEach((b) => {
    b.onclick = () => go(`#/new/${b.dataset.model}`); // 모델이 전시장을 알고 있어 자동 설정됨
  });
}

// ---------- 편집 화면 ----------
async function openEditor(id, modelId = null, { dup = false } = {}) {
  currentId = id;
  dupView = false;
  if (id === SAMPLE_ID) {
    // 샘플은 DB에 없는 참고용 양식 → 새 계약서처럼 다룬다(저장 시 새로 생성)
    current = sampleContract();
    current.contractNo = '';
    currentId = null;
  } else if (id) {
    try {
      const rec = await api.get(id, { dup });
      current = rec.data;
      current.contractNo = rec.contract_no;
      dupView = !!dup; // 중복 열람은 읽기전용
    } catch (err) {
      alert('계약서를 불러오지 못했습니다: ' + err.message);
      return go('#/');
    }
  } else {
    current = modelId ? modelContract(modelId) : emptyContract();
    // 새 계약: 전시장은 모델에 따라 이미 설정됨(모델). 없으면(기본 계약서) 로그인 전시장. 영업사원은 로그인 이름.
    if (me?.showroom && !current.showroom) current.showroom = me.showroom;
    if (me?.name && !current.salesperson) current.salesperson = me.name;
  }
  normalizeContract(current);
  recalc(current);
  renderEditor();
}

function renderEditor() {
  const c = current;
  editorLocked = c.status === 'confirmed' || dupView; // 중복 열람은 읽기전용
  const [y, mo, d] = (c.contractDate || '').split('-');

  app.innerHTML = `
    <div class="topbar no-print">
      <div class="brand"><a href="#/" class="back">← 목록</a></div>
      <div class="doc-meta">
        ${c.contractNo ? `계약번호 <b>${esc(c.contractNo)}</b>` : '<span class="muted">새 계약서 (저장 시 번호 부여)</span>'}
        ${c.modelName ? `<span class="model-badge">${esc(c.modelName)}</span>` : ''}
        ${dupView ? '<span class="viewonly-badge">👁 다른 전시장 계약 · 읽기전용</span>' : ''}
        <span id="dirty-flag" class="muted"></span>
      </div>
      <div class="actions">
        ${dupView ? '' : `<label class="status-toggle"><input type="checkbox" id="status-confirmed" ${c.status === 'confirmed' ? 'checked' : ''}/> 확정</label>`}
        <button class="btn" id="print-btn">🖨 인쇄 / PDF</button>
        ${dupView ? '' : '<button class="btn primary" id="save-btn">💾 저장</button>'}
        ${accountChip()}
      </div>
    </div>

    <div class="manage-bar no-print">
      <span class="mb-title">관리</span>
      <label>진행상태
        <select id="stage-select" class="mb-stage stage-${stageOf(c)}">
          ${STAGES.map((s) => `<option value="${s.key}" ${stageOf(c) === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </label>
      <span id="deposit-info" class="dep-info no-print"></span>
      <label>모델
        <select id="model-select" class="mb-stage">
          <option value="" ${c.modelId ? '' : 'selected'}>통합(전체 옵션)</option>
          ${MODELS.map((m) => `<option value="${m.id}" ${c.modelId === m.id ? 'selected' : ''}>${esc(m.showroom || (m.expo ? '일산박람회' : ''))} · ${esc(m.name)} (${fmtMan(m.startPrice)}만)</option>`).join('')}
        </select>
      </label>
      <label>전시장 <span class="req">*</span> ${showroomSelect(c.showroom)}</label>
      <label>영업사원 <span class="req">*</span> ${field('salesperson', c.salesperson, 'manage')}</label>
      <label>인허가 구분 <span class="req">*</span>
        <select id="permit-select" class="mb-stage permit-${esc(c.permitType || 'none')}">
          <option value="" ${!c.permitType ? 'selected' : ''}>- 선택</option>
          <option value="temporary" ${c.permitType === 'temporary' ? 'selected' : ''}>컨테이너·체류형쉼터 (가설건축물축조신고)</option>
          <option value="permit" ${c.permitType === 'permit' ? 'selected' : ''}>주택 (준공용 인허가)</option>
        </select>
      </label>
      <span class="mb-hint muted small">※ 목록 분류·검색용 (계약서 인쇄에는 표시 안 됨) · <b>전시장·영업사원·현장주소·인허가 구분은 필수</b></span>
    </div>

    <div class="idcard-bar no-print">
      <div class="ic-head">
        <span class="mb-title">신분증 · 사업자등록증 첨부</span>
        <span class="ic-hint muted small">개인 고객은 신분증, 사업자 고객은 사업자등록증 첨부 (이미지·PDF · 내부 자료 · 계약서 인쇄에는 표시 안 됨)</span>
        <span class="grow"></span>
        <label class="btn tiny primary ic-add-btn">＋ 첨부 추가
          <input type="file" id="idcard-input" accept="image/*,application/pdf,.pdf" multiple hidden />
        </label>
      </div>
      <div id="idcard-grid" class="ic-grid"></div>
    </div>

    <div class="idcard-bar no-print">
      <div class="ic-head">
        <span class="mb-title">협의도면 첨부</span>
        <span class="ic-hint muted small">협의 도면(평면도 등) 이미지·PDF 보관용 (내부 자료 · 계약서 인쇄에는 표시 안 됨)</span>
        <span class="grow"></span>
        <button type="button" id="dw-3d-btn" class="btn tiny dw-3d-btn" title="3D 홈플래너에서 도면을 만들고 '계약서로 보내기'를 누르면 이 협의도면에 바로 첨부됩니다 (새 창)">🏠 3D도면 만들기</button>
        <button type="button" id="dw-mat-btn" class="btn tiny dw-mat-btn" title="자재 선택 페이지에서 항목별 자재를 고르고 '계약서로 보내기'를 누르면 선택표가 협의도면에 첨부됩니다 (새 창)">🎨 자재 선택</button>
        <label class="btn tiny primary dw-add-btn">＋ 도면 추가
          <input type="file" id="drawing-input" accept="image/*,application/pdf,.pdf" multiple hidden />
        </label>
      </div>
      <div id="drawing-grid" class="ic-grid"></div>
    </div>

    <div id="contract" class="contract">
      <header class="c-head">
        <div class="c-logo"><img class="c-logo-img" src="${SUPPLIER.logoImage}" alt="세움 로고" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-block';" /><span class="logo" style="display:none">SEUM</span><div>㈜세움디자인하우징</div></div>
        <h1>계 약 서</h1>
        <div class="c-bank">[ (주)세움디자인하우징 : ${esc(SUPPLIER.bankAccount)} ]</div>
      </header>

      <table class="grid main-grid">
        <colgroup><col style="width:6%"><col style="width:13%"><col style="width:18%"><col style="width:30%"><col style="width:8%"><col style="width:25%"></colgroup>
        <tr class="section-row">
          <th colspan="3" class="sec">계 약 금 액</th>
          <th colspan="3" class="sec">주 문 내 용</th>
        </tr>
        ${renderRows()}
      </table>

      <table class="grid extra-cost-grid ${hasExtraCosts(c) ? '' : 'ec-empty'}">
        <colgroup><col style="width:52%"><col style="width:33%"><col style="width:15%"></colgroup>
        <tr><th class="sec ec-head" colspan="3">
          [ 기타 비용 ]
          <span class="muted small no-print">어닝 등 추가 옵션을 입력하세요</span>
          ${editorLocked ? '' : '<button type="button" class="btn tiny no-print" id="ec-add">+ 항목 추가</button>'}
        </th></tr>
        ${renderExtraCosts()}
      </table>

      <table class="grid extra-grid">
        <tr><th class="sec extra-head">[ 서비스 · 기타 내용 ]</th></tr>
        <tr>
          <td class="extra-cell">
            <textarea class="f extra ${editorLocked ? 'locked' : ''}" data-path="extraNotes" rows="2" placeholder="추가 계약 내용을 입력하세요. (특약·서비스 등)" ${editorLocked ? 'readonly' : ''}>${esc(c.extraNotes || '')}</textarea>
          </td>
        </tr>
      </table>

      <table class="grid terms-grid">
        <tr><th class="sec terms-head" colspan="2">[ 약 관 ]</th></tr>
        <tr>
          <td class="terms-cell">
            <ul class="terms-list" id="terms-list">${renderTerms()}</ul>
          </td>
        </tr>
      </table>

      <table class="grid sign-grid">
        <colgroup><col style="width:10%"><col style="width:40%"><col style="width:12%"><col style="width:38%"></colgroup>
        <tr>
          <td rowspan="3" class="sign-label">공급자</td>
          <td class="sign-co">${esc(SUPPLIER.company)}</td>
          <td rowspan="3" class="sign-label">계약자<br><span class="muted small">(건축주)</span></td>
          <td class="sign-field"><span class="fl">건축주 <span class="req no-print">*</span></span> <span class="sign-name">${field('client.name', c.client.name, 'name')}</span> ${signSlot('client')}</td>
        </tr>
        <tr>
          <td class="sign-co">사업자번호 : ${esc(SUPPLIER.bizNo)}</td>
          <td class="sign-field"><span class="fl">생년월일 <span class="req no-print">*</span></span> ${field('client.birth', c.client.birth)}</td>
        </tr>
        <tr>
          <td class="sign-co sign-co-rep">대표 ${esc(SUPPLIER.ceo)} ${signSlot('supplier')}</td>
          <td class="sign-field"><span class="fl">연락처 <span class="req no-print">*</span></span> ${field('client.phone', c.client.phone)}</td>
        </tr>
        <tr>
          <td class="sign-label">　</td>
          <td class="sign-co muted small">상기 계약내용에 대하여 공급자와 계약자는 상호 합의하여 계약을 체결함.</td>
          <td class="sign-label">주소</td>
          <td class="sign-field">${field('client.address', c.client.address, 'addr')}</td>
        </tr>
      </table>
    </div>`;

  bindEditor();
  updateTotals();
}

// 좌측 계약금액 / 우측 주문내용을 한 행씩 짝지어 렌더
function renderRows() {
  const c = current;
  // 좌측(계약금액) 행 정의
  const left = [
    { label: '제품공급가', type: 'supply', key: 'productSupply' },
    { label: '부가세(Vat)', type: 'calc', key: 'vat' },
    { label: '제품 합계', type: 'calc', key: 'productTotal', strong: true },
    { label: '계약금', type: 'pay', key: 'downPayment', cond: '계약 시 입금 (10%)' },
    { label: '중도금 1', type: 'pay', key: 'interim1', cond: '기초공사 완료 후 입금 (30%)' },
    { label: '중도금 2', type: 'pay', key: 'interim2', cond: '철골·외장·지붕 완료 후 입금 (40%)' },
    { label: '중도금 3', type: 'pay', key: 'interim3', cond: '내장목공 완료 시 입금 (15%)' },
    { label: '잔금', type: 'pay', key: 'balance', cond: '준공서류 전달 / 이동설치시 출고 전 입금 (5%)' },
    { label: '계약일자', type: 'date' },
    { label: '현장주소', type: 'site' },
  ];

  const rows = [];
  const maxLen = Math.max(left.length, c.items.length);
  for (let i = 0; i < maxLen; i++) {
    rows.push(`<tr>${leftCell(left[i])}${rightCell(c.items[i], i)}</tr>`);
  }
  return rows.join('');
}

function leftCell(row) {
  if (!row) return `<td class="lbl empty"></td><td colspan="2" class="empty"></td>`;
  const c = current;
  if (row.type === 'calc') {
    return `<td class="lbl">${row.label}</td>
      <td colspan="2" class="amt ${row.strong ? 'strong' : ''}">
        <span class="auto" data-total="${row.key}">${fmtMan(c.amounts[row.key])}</span> <span class="unit">만원</span>
      </td>`;
  }
  if (row.type === 'supply') {
    // 주문내용 금액 합계가 자동으로 채워짐. 직접 입력하면 그 값이 우선됨.
    const ro = editorLocked ? 'readonly' : '';
    const lc = editorLocked ? 'locked' : '';
    const manualEmpty = c.amounts.supplyManual === '' || c.amounts.supplyManual == null;
    const shown = manualEmpty ? fmtMan(c.amounts.itemsSupply) : c.amounts.supplyManual;
    return `<td class="lbl">${row.label}</td>
      <td colspan="2" class="amt">
        <input class="f amt right ${lc}" data-path="amounts.supplyManual" value="${esc(shown)}" title="주문내용 금액의 합계가 자동 입력됩니다. 직접 입력하면 그 값이 우선됩니다(지우면 다시 합계)." ${ro} />
        <span class="unit">만원</span>
        <span class="pay-diff no-print" id="pay-diff"></span>
      </td>`;
  }
  if (row.type === 'pay') {
    // 비율대로 자동 배분되며, 직접 입력하면 그 값이 우선됨(수동 조정)
    const ro = editorLocked ? 'readonly' : '';
    const lc = editorLocked ? 'locked' : '';
    return `<td class="lbl">${row.label}</td>
      <td class="amt">
        <input class="f amt right ${lc}" data-path="amounts.${row.key}" data-pay="${row.key}" value="${esc(fmtMan(c.amounts[row.key]))}" title="비율대로 자동 입력됩니다. 직접 입력하면 그 값이 우선됩니다(수동 조정)." ${ro} />
        <span class="unit">만원</span>
      </td>
      <td class="cond muted small">${row.cond || ''}</td>`;
  }
  if (row.type === 'date') {
    const [y, mo, d] = (c.contractDate || '').split('-');
    return `<td class="lbl">${row.label}</td>
      <td colspan="2" class="datecell">
        ${dateField('y', y, '년', 4)} ${dateField('m', mo, '월', 2)} ${dateField('d', d, '일', 2)}
      </td>`;
  }
  if (row.type === 'site') {
    return `<td class="lbl">${row.label} <span class="req no-print">*</span></td>
      <td colspan="2" class="sitecell">${field('siteAddress', c.siteAddress, 'site')}</td>`;
  }
  return `<td class="lbl empty"></td><td colspan="2" class="empty"></td>`;
}

function rightCell(item, i) {
  if (!item) return `<td colspan="3" class="empty"></td>`;
  // 단가: priceEditable 항목은 직접 입력칸(체류형 쉼터 등 단가가 다른 경우), 그 외엔 고정 라벨
  let priceHtml = '';
  if (item.priceEditable) {
    priceHtml = `<span class="item-price price-edit">평당 ${field(`items.${i}.unitPrice`, item.unitPrice, 'price', 'right')}<span class="unit2">만원</span></span>`;
  } else {
    const priceLabel = item.priceLabel ? item.priceLabel : (item.unitPrice !== '' ? `${item.unitPrice}만원` : '');
    priceHtml = priceLabel ? `<span class="item-price">${esc(priceLabel)}</span>` : '';
  }
  return `
    <td class="item-name">
      <span class="item-no">${item.no}.</span> ${esc(item.name)}
      ${priceHtml}
      ${item.unit === '평당'
        ? `<span class="area-input">${field(`items.${i}.area`, item.area, 'area', 'right')}<span class="unit2">평</span></span>`
        : ''}
      ${item.unit === '거리' ? moveControls(i, item) : ''}
    </td>
    <td class="amt">${field(`items.${i}.amount`, item.amount, 'amt', 'right')} <span class="unit">만원</span></td>
    <td class="note">${noteField(`items.${i}.note`, item.note)}</td>`;
}

function renderTerms() {
  const ro = editorLocked ? 'readonly' : '';
  const rows = current.terms.map((t, i) => `
    <li class="term-row">
      <textarea class="f term-input" data-term="${i}" rows="1" ${ro}>${esc(t)}</textarea>
      ${editorLocked ? '' : `<button type="button" class="term-del no-print" data-term-del="${i}" title="이 약관 삭제">✕</button>`}
    </li>`).join('');
  const controls = editorLocked ? '' : `<li class="term-ctrl no-print">
      <button type="button" class="btn tiny" id="term-add">＋ 약관 추가</button>
      <button type="button" class="btn tiny" id="term-reset">기본 약관 복원</button>
    </li>`;
  return rows + controls;
}

function rerenderTerms() {
  const list = document.getElementById('terms-list');
  if (!list) return;
  list.innerHTML = renderTerms();
  bindTerms();
}

function bindTerms() {
  const list = document.getElementById('terms-list');
  if (!list) return;
  list.querySelectorAll('.term-input').forEach((ta) => {
    autoGrow(ta);
    if (editorLocked) return;
    ta.oninput = () => { current.terms[Number(ta.dataset.term)] = ta.value; autoGrow(ta); markDirty(); };
  });
  if (editorLocked) return;
  list.querySelectorAll('[data-term-del]').forEach((b) => {
    b.onclick = () => { current.terms.splice(Number(b.dataset.termDel), 1); rerenderTerms(); markDirty(); };
  });
  const add = document.getElementById('term-add');
  if (add) add.onclick = () => {
    current.terms.push(''); rerenderTerms(); markDirty();
    const inputs = list.querySelectorAll('.term-input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  };
  const reset = document.getElementById('term-reset');
  if (reset) reset.onclick = () => {
    if (confirm('약관을 기본 약관으로 되돌릴까요?\n지금 수정한 약관 내용은 사라집니다.')) { current.terms = defaultTerms(); rerenderTerms(); markDirty(); }
  };
}

// 기타 비용 행에 내용이 하나라도 있는지 (인쇄 시 빈 섹션 숨김용)
function hasExtraCosts(c) {
  return (c.extraCosts || []).some((ec) => String(ec.name || '').trim() !== '' || String(ec.amount || '').trim() !== '');
}

// 기타 비용 행 렌더 (항목명 | 금액 | 삭제)
function renderExtraCosts() {
  return (current.extraCosts || []).map((ec, i) => `
    <tr class="ec-row">
      <td class="ec-name">${field(`extraCosts.${i}.name`, ec.name, 'ec-name-in')}</td>
      <td class="amt">${field(`extraCosts.${i}.amount`, ec.amount, 'amt', 'right')} <span class="unit">만원</span></td>
      <td class="ec-del no-print">${editorLocked ? '' : `<button type="button" class="btn tiny danger" data-ec-del="${i}">삭제</button>`}</td>
    </tr>`).join('');
}

// 입력 필드 생성 (인쇄 시 밑줄/테두리 없는 텍스트처럼 보임)
function field(path, value, cls = '', align = '') {
  const lock = editorLocked ? 'readonly' : '';
  const lc = editorLocked ? 'locked' : '';
  return `<input class="f ${cls} ${align} ${lc}" data-path="${path}" value="${esc(value)}" ${lock} />`;
}
// 전시장 선택 드롭다운 (고정 목록). 목록에 없는 기존 값은 보존해서 그대로 표시.
function showroomSelect(value) {
  const v = value || '';
  const dis = editorLocked ? 'disabled' : '';
  const opts = [`<option value="" ${v ? '' : 'selected'}>전시장 선택</option>`]
    .concat(SHOWROOMS.map((s) => `<option value="${esc(s)}" ${v === s ? 'selected' : ''}>${esc(s)}</option>`));
  if (v && !SHOWROOMS.includes(v)) opts.push(`<option value="${esc(v)}" selected>${esc(v)} (기존)</option>`); // 레거시 값 보존
  return `<select id="showroom-select" class="mb-stage ${editorLocked ? 'locked' : ''}" data-path="showroom" ${dis}>${opts.join('')}</select>`;
}
// 비고/설명: 여러 줄로 줄바꿈되는 textarea (높이는 내용에 맞춰 자동 조절)
function noteField(path, value) {
  const lock = editorLocked ? 'readonly' : '';
  const lc = editorLocked ? 'locked' : '';
  // 현장답사·협의 후 진행 등 '별도 협의 필요' 주의 문구는 다른 색으로 강조
  const hl = /협의\s*후\s*진행|현장\s*답사|현장답사|정화조/.test(value || '') ? ' note-hl' : '';
  return `<textarea class="f note ${lc}${hl}" data-path="${path}" rows="1" ${lock}>${esc(value)}</textarea>`;
}
// 내용 길이에 맞춰 textarea 높이 자동 조절
function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = (el.scrollHeight + 2) + 'px';
}
// 이동 설치비: 거리 구간 선택(드롭다운). 선택 시 금액 자동 입력. 인쇄용 라벨 별도 표시.
function moveControls(i, item) {
  const dis = editorLocked ? 'disabled' : '';
  const lc = editorLocked ? 'locked' : '';
  const cat = MOVE_OPTIONS.categories.find((c) => c.key === item.moveCategory);
  const catOpts = MOVE_OPTIONS.categories.map((c) =>
    `<option value="${c.key}" ${item.moveCategory === c.key ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
  // 거리 구간 라벨은 종류와 무관하게 동일(100km미만/200km미만/200km이상)
  const tierLabels = (cat ? cat.tiers : MOVE_OPTIONS.categories[0].tiers).map((t) => t.label);
  const tierOpts = tierLabels.map((l) =>
    `<option value="${esc(l)}" ${item.tier === l ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const showTruck = !!(cat && cat.truck);
  return `<span class="move-input">
      <select class="f dist no-print ${lc}" data-move-cat="${i}" ${dis}>
        <option value="">종류 선택</option>${catOpts}
      </select>
      <select class="f dist no-print ${lc}" data-move-tier="${i}" ${dis}>
        <option value="">거리 선택</option>${tierOpts}
      </select>
      <label class="move-truck no-print" data-move-truck-wrap="${i}" style="${showTruck ? '' : 'display:none'}">
        일반트럭 추가
        <select class="f dist no-print ${lc}" data-move-truck="${i}" ${dis}>
          ${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${moveTruckQty(item) === n ? 'selected' : ''}>${n === 0 ? '없음' : n + '대'}</option>`).join('')}
        </select>
      </label>
      <span class="move-print print-only" data-move-print="${i}">${esc(movePrintLabel(item))}</span>
    </span>`;
}

// 인쇄/확정 시 표시할 이동 설치비 선택 요약 라벨
function movePrintLabel(item) {
  const cat = MOVE_OPTIONS.categories.find((c) => c.key === item.moveCategory);
  if (!cat || !item.tier) return '';
  let s = `${cat.label} · ${item.tier}`;
  const qty = moveTruckQty(item);
  if (cat.truck && qty > 0) s += ` · 일반트럭 ${qty}대 추가`;
  return s;
}

// 이동 설치비 선택 변경 시 금액·표시 갱신
function updateMoveFee(i) {
  const item = current.items[i];
  const cat = MOVE_OPTIONS.categories.find((c) => c.key === item.moveCategory);
  // 트럭옵션 없는 종류(농막)면 체크박스 숨김 + 트럭 선택 해제
  const wrap = app.querySelector(`[data-move-truck-wrap="${i}"]`);
  if (wrap) wrap.style.display = (cat && cat.truck) ? '' : 'none';
  if (!(cat && cat.truck)) item.truckQty = 0;
  // 금액 계산 → 금액칸 반영
  const fee = computeMoveFee(item);
  item.amount = fee === '' ? '' : fee;
  const amtInp = app.querySelector(`input[data-path="items.${i}.amount"]`);
  if (amtInp) amtInp.value = fee === '' ? '' : fmtMan(fee);
  // 인쇄 라벨 갱신
  const printEl = app.querySelector(`[data-move-print="${i}"]`);
  if (printEl) printEl.textContent = movePrintLabel(item);
  updateTotals();
  markDirty();
}
function dateField(part, value, suffix, size) {
  const lock = editorLocked ? 'readonly' : '';
  const lc = editorLocked ? 'locked' : '';
  return `<input class="f date ${part} ${lc}" data-date="${part}" value="${esc(value || '')}" size="${size}" placeholder="${suffix === '년' ? '____' : '__'}" ${lock} /><span class="unit3">${suffix}</span>`;
}

// ---------- 전자 서명 ----------
// 서명 슬롯: 서명 전에는 "✎ 서명" 버튼(화면) + 인쇄용 "(인)", 서명 후에는 서명 이미지
function signSlot(party) {
  return `<span class="sign-host" id="sign-host-${party}" data-sign-host="${party}">${signSlotInner(party)}</span>`;
}

function signSlotInner(party) {
  // 공급자(대표)는 별도 서명 없이 법인 인감 도장 이미지를 자동 표시 (이미지 없으면 '(인)')
  if (party === 'supplier') {
    return `<span class="sig-wrap seal-wrap">
        <img class="seal-img" src="${esc(SUPPLIER.sealImage)}" alt="법인 인감"
             onerror="this.style.display='none';this.nextElementSibling.style.display='inline';" />
        <span class="seal seal-fallback" style="display:none">(인)</span>
      </span>`;
  }
  const sig = current.signatures?.[party] || {};
  if (sig.image) {
    const clickable = editorLocked ? '' : `data-sign="${party}"`;
    const title = editorLocked ? '확정·봉인됨' : '클릭하여 다시 서명';
    return `<span class="sig-wrap signed ${editorLocked ? 'locked' : ''}" ${clickable} title="${title}">
        <img class="sig-img" src="${esc(sig.image)}" alt="서명" />
        ${sig.signedAt ? `<span class="sig-date no-print">${esc(fmtSignDate(sig.signedAt))} 전자서명</span>` : ''}
      </span>`;
  }
  if (editorLocked) return `<span class="seal">(인)</span>`;
  return `<button type="button" class="sig-btn no-print" data-sign="${party}">✎ 서명</button><span class="seal print-only">(인)</span>`;
}

function fmtSignDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 서명 슬롯에 클릭 이벤트 연결 (서명 패드 열기)
function bindSign(scope) {
  scope.querySelectorAll('[data-sign]').forEach((el) => {
    el.onclick = () => {
      const party = el.dataset.sign;
      openSignaturePad({
        title: party === 'supplier' ? '공급자(대표) 전자 서명' : '계약자(건축주) 전자 서명',
        initial: current.signatures?.[party]?.image || '',
        onSave: (dataUrl) => {
          current.signatures[party] = dataUrl
            ? { image: dataUrl, signedAt: new Date().toISOString(), agent: navigator.userAgent }
            : { image: '', signedAt: '', agent: '' };
          markDirty();
          const host = document.getElementById('sign-host-' + party);
          if (host) { host.innerHTML = signSlotInner(party); bindSign(host); }
        },
      });
    };
  });
}

// ---------- 신분증 첨부 ----------
// 신분증은 계약금 입금 후 받는 내부 보관 자료 → 확정(잠금) 여부와 무관하게 언제든 추가/삭제 가능,
// 무결성 봉인 해시에서도 제외됨(model.js computeIntegrityHash). 인쇄에는 나오지 않음(no-print).
const ID_MAX_DIM = 1600;   // 저장 시 이미지 최대 가로/세로 픽셀 (신분증 판독에 충분)
const ID_QUALITY = 0.82;   // JPEG 압축 품질

function renderIdCards() {
  const grid = document.getElementById('idcard-grid');
  if (!grid) return;
  const cards = current.idCards || [];
  if (!cards.length) {
    grid.innerHTML = `<p class="ic-empty muted small">첨부된 신분증·사업자등록증이 없습니다. <b>＋ 첨부 추가</b>로 이미지·PDF를 올려 보관하세요.</p>`;
    return;
  }
  grid.innerHTML = cards.map((card, i) => {
    const src = card.data || card.image || '';               // 신버전(data)·구버전(image) 호환
    const isImg = card.kind ? card.kind === 'image' : !!card.image;
    const pdf = !isImg && isPdfAttachment(card);
    return `
    <div class="ic-card" data-ic="${i}">
      ${isImg
        ? `<img class="ic-thumb" src="${esc(src)}" alt="첨부 ${i + 1}" data-ic-view="${i}" title="클릭하면 크게 보기" />`
        : `<div class="ic-thumb ic-file" data-ic-view="${i}" title="클릭하면 ${pdf ? '미리보기' : '내려받기'}"><span class="ic-file-ic">${pdf ? '📕' : '📄'}</span><span class="ic-file-ext">${esc(((card.name || '').split('.').pop() || 'FILE').toUpperCase())}</span></div>`}
      <input class="ic-label" data-ic-label="${i}" value="${esc(card.label || '')}" placeholder="라벨(예: 신분증 앞면 / 사업자등록증)" />
      <div class="ic-meta muted small">${esc(card.name || '')}${card.uploadedAt ? `${card.name ? ' · ' : ''}${esc(fmtSignDate(card.uploadedAt))}` : ''}</div>
      <button type="button" class="btn tiny danger ic-del" data-ic-del="${i}">삭제</button>
    </div>`;
  }).join('');
}

function bindIdCards() {
  const input = document.getElementById('idcard-input');
  const grid = document.getElementById('idcard-grid');
  if (!input || !grid) return;

  input.onchange = async () => {
    const files = [...(input.files || [])]; // 이미지 + PDF(사업자등록증) 모두 허용
    input.value = ''; // 같은 파일 다시 선택 가능하도록 초기화
    if (!files.length) return;
    const addBtn = document.querySelector('.ic-add-btn');
    if (addBtn) addBtn.classList.add('busy');
    try {
      for (const file of files) {
        try {
          const item = await fileToAttachment(file, ID_MAX_DIM, ID_QUALITY);
          (current.idCards ||= []).push({ ...item, label: '', uploadedAt: new Date().toISOString() });
        } catch (err) {
          alert(`"${file.name}" 처리 실패: ${err.message}`);
        }
      }
      current.idCount = current.idCards.length;
      renderIdCards();
      bindIdCards();
      markDirty();
    } finally {
      if (addBtn) addBtn.classList.remove('busy');
    }
  };

  grid.querySelectorAll('[data-ic-view]').forEach((el) => {
    el.onclick = () => {
      const i = Number(el.dataset.icView);
      const card = current.idCards?.[i];
      if (!card) return;
      const src = card.data || card.image || '';
      const isImg = card.kind ? card.kind === 'image' : !!card.image;
      const title = card.label || card.name || `첨부 ${i + 1}`;
      if (isImg) openImageViewer(src, title);
      else if (isPdfAttachment(card)) openPdfViewer(src, title);
      else downloadData(src, card.name || `첨부_${i + 1}`);
    };
  });
  grid.querySelectorAll('[data-ic-label]').forEach((inp) => {
    inp.oninput = () => {
      const i = Number(inp.dataset.icLabel);
      if (current.idCards?.[i]) { current.idCards[i].label = inp.value; markDirty(); }
    };
  });
  grid.querySelectorAll('[data-ic-del]').forEach((b) => {
    b.onclick = () => {
      const i = Number(b.dataset.icDel);
      if (!confirm('이 첨부를 삭제할까요?')) return;
      current.idCards.splice(i, 1);
      current.idCount = current.idCards.length;
      renderIdCards();
      bindIdCards();
      markDirty();
    };
  });
}

// 첨부 최대 파일 크기 (비이미지 원본 저장 시) 및 첨부 판별 유틸
const ATTACH_FILE_MAX = 5 * 1024 * 1024; // 5MB
function isPdfAttachment(x) {
  return String(x?.data || '').startsWith('data:application/pdf') || /\.pdf$/i.test(x?.name || '');
}

// 업로드 파일 → 저장용 항목 {data,name,kind}. 이미지는 축소 JPEG, 그 외(PDF 등)는 원본(용량 제한).
// 신분증·사업자등록증·협의도면 첨부에서 공통으로 사용.
function fileToAttachment(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const isImage = (file.type || '').startsWith('image/');
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
    if (!isImage) {
      if (file.size > ATTACH_FILE_MAX) {
        return reject(new Error(`파일이 너무 큽니다(${(file.size / 1048576).toFixed(1)}MB). 5MB 이하로 줄여 주세요.`));
      }
      reader.onload = () => resolve({ data: reader.result, name: file.name, kind: 'file' });
      reader.readAsDataURL(file);
      return;
    }
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('이미지를 열 수 없습니다.'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // 투명 배경(PNG) 대비 흰 바탕
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ data: canvas.toDataURL('image/jpeg', quality), name: file.name, kind: 'image' });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// 첨부 이미지 크게 보기 (오버레이)
function openImageViewer(src, title = '신분증') {
  const overlay = document.createElement('div');
  overlay.className = 'img-viewer-overlay no-print';
  overlay.innerHTML = `
    <div class="img-viewer">
      <div class="iv-head">
        <span class="iv-title">${esc(title)}</span>
        <a class="btn tiny" href="${esc(src)}" download="${esc(title)}.jpg">내려받기</a>
        <button class="btn tiny iv-x" type="button" aria-label="닫기">✕</button>
      </div>
      <img class="iv-img" src="${esc(src)}" alt="${esc(title)}" />
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { window.removeEventListener('keydown', onKey); overlay.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', onKey);
  overlay.querySelector('.iv-x').onclick = close;
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
}

// ---------- 협의도면 첨부 ----------
// 신분증과 동일하게 내부 보관 자료(확정 여부 무관·봉인 제외·인쇄 제외). 이미지는 축소 저장, PDF 등은 원본 저장.
const DRAW_MAX_DIM = 2200;               // 도면 이미지 최대 픽셀 (신분증보다 크게 — 세부 판독)
const DRAW_QUALITY = 0.85;               // JPEG 압축 품질

function renderDrawings() {
  const grid = document.getElementById('drawing-grid');
  if (!grid) return;
  const items = current.drawings || [];
  if (!items.length) {
    grid.innerHTML = `<p class="ic-empty muted small">첨부된 협의도면이 없습니다. <b>＋ 도면 추가</b>로 이미지·PDF를 올려 보관하세요.</p>`;
    return;
  }
  grid.innerHTML = items.map((d, i) => `
    <div class="ic-card" data-dw="${i}">
      ${d.kind === 'image'
        ? `<img class="ic-thumb" src="${esc(d.data)}" alt="도면 ${i + 1}" data-dw-view="${i}" title="클릭하면 크게 보기" />`
        : `<div class="ic-thumb ic-file" data-dw-view="${i}" title="클릭하면 ${isPdfAttachment(d) ? '미리보기' : '내려받기'}"><span class="ic-file-ic">${isPdfAttachment(d) ? '📕' : '📄'}</span><span class="ic-file-ext">${esc(((d.name || '').split('.').pop() || 'FILE').toUpperCase())}</span></div>`}
      <input class="ic-label" data-dw-label="${i}" value="${esc(d.label || '')}" placeholder="라벨(예: 1층 평면도)" />
      <div class="ic-meta muted small">${esc(d.name || '')}${d.uploadedAt ? ` · ${esc(fmtSignDate(d.uploadedAt))}` : ''}</div>
      <button type="button" class="btn tiny danger ic-del" data-dw-del="${i}">삭제</button>
    </div>`).join('');
}

function bindDrawings() {
  const input = document.getElementById('drawing-input');
  const grid = document.getElementById('drawing-grid');
  const btn3d = document.getElementById('dw-3d-btn');
  if (btn3d) btn3d.onclick = openPlanner;
  const btnMat = document.getElementById('dw-mat-btn');
  if (btnMat) btnMat.onclick = openMaterials;
  if (!input || !grid) return;

  input.onchange = async () => {
    const files = [...(input.files || [])];
    input.value = '';
    if (!files.length) return;
    const addBtn = document.querySelector('.dw-add-btn');
    if (addBtn) addBtn.classList.add('busy');
    try {
      for (const file of files) {
        try {
          const item = await fileToDrawing(file);
          (current.drawings ||= []).push({ ...item, label: '', uploadedAt: new Date().toISOString() });
        } catch (err) {
          alert(`"${file.name}" 처리 실패: ${err.message}`);
        }
      }
      current.drawingCount = current.drawings.length;
      renderDrawings();
      bindDrawings();
      markDirty();
    } finally {
      if (addBtn) addBtn.classList.remove('busy');
    }
  };

  grid.querySelectorAll('[data-dw-view]').forEach((el) => {
    el.onclick = () => {
      const i = Number(el.dataset.dwView);
      const d = current.drawings?.[i];
      if (!d) return;
      const title = d.label || d.name || `도면 ${i + 1}`;
      if (d.kind === 'image') openImageViewer(d.data, title);
      else if (isPdfAttachment(d)) openPdfViewer(d.data, title);   // PDF는 앱 내 미리보기
      else downloadData(d.data, d.name || `도면_${i + 1}`);        // 그 외 파일은 내려받기
    };
  });
  grid.querySelectorAll('[data-dw-label]').forEach((inp) => {
    inp.oninput = () => {
      const i = Number(inp.dataset.dwLabel);
      if (current.drawings?.[i]) { current.drawings[i].label = inp.value; markDirty(); }
    };
  });
  grid.querySelectorAll('[data-dw-del]').forEach((b) => {
    b.onclick = () => {
      const i = Number(b.dataset.dwDel);
      if (!confirm('이 협의도면 첨부를 삭제할까요?')) return;
      current.drawings.splice(i, 1);
      current.drawingCount = current.drawings.length;
      renderDrawings();
      bindDrawings();
      markDirty();
    };
  });
}

// 협의도면 업로드 → 공통 fileToAttachment 사용(도면은 세부 판독 위해 더 큰 해상도)
function fileToDrawing(file) {
  return fileToAttachment(file, DRAW_MAX_DIM, DRAW_QUALITY);
}

// 3D 홈플래너 열기 — 계약서 창을 opener로 유지하고, 되돌려 보낼 대상(origin)·계약식별자(cid)를 전달
function openPlanner() {
  const params = new URLSearchParams({ origin: location.origin, cid: String(currentId || 'new') });
  window.open(`${PLANNER_URL}?${params.toString()}`, 'seum3dPlanner');
}

// 자재 선택 페이지 열기 (계약서와 같은 사이트 내 페이지) — origin·cid 전달
function openMaterials() {
  const params = new URLSearchParams({ origin: location.origin, cid: String(currentId || 'new') });
  window.open(`/materials.html?${params.toString()}`, 'seumMaterials');
}

// 이미지(dataURL) 여러 장을 협의도면에 첨부 (축소·압축 파이프라인 통과)
async function attachDrawingImages(shots, source) {
  for (const s of shots) {
    const blob = await (await fetch(s.img)).blob();
    const item = await fileToDrawing(new File([blob], `${s.label}.jpg`, { type: blob.type || 'image/jpeg' }));
    (current.drawings ||= []).push({ ...item, label: s.label, uploadedAt: new Date().toISOString(), source });
  }
  current.drawingCount = current.drawings.length;
  renderDrawings();
  bindDrawings();
  markDirty();
  try { window.focus(); } catch { /* noop */ }
}

// 외부 창(홈플래너·자재선택)에서 postMessage로 보낸 이미지를 협의도면에 자동 첨부
//  - 홈플래너: { type:'SEUM_DESIGN', planImage, view3d, name }  (출처: PLANNER_ORIGIN)
//  - 자재선택: { type:'SEUM_MATERIALS', image, name }           (출처: 같은 사이트)
async function onPlannerMessage(e) {
  const msg = e.data;
  if (!msg) return;
  let shots, source, label;
  if (msg.type === 'SEUM_DESIGN' && e.origin === PLANNER_ORIGIN) {
    const base = msg.name || '홈플래너 도면';
    shots = [
      { img: msg.planImage, label: `${base} · 평면도` },
      { img: msg.view3d, label: `${base} · 3D 투시` },
    ].filter((s) => s.img && String(s.img).startsWith('data:image'));
    source = '3d-planner'; label = '3D 홈플래너 도면';
  } else if (msg.type === 'SEUM_MATERIALS' && e.origin === location.origin) {
    shots = [{ img: msg.image, label: msg.name || '자재 선택표' }]
      .filter((s) => s.img && String(s.img).startsWith('data:image'));
    source = 'materials'; label = '자재 선택표';
  } else {
    return; // 알 수 없는 메시지·출처 무시
  }
  if (!current) { alert('먼저 계약서를 연 상태에서 보내 주세요.'); return; }
  if (!shots.length) { alert('받은 이미지가 없습니다. 다시 시도해 주세요.'); return; }
  try {
    await attachDrawingImages(shots, source);
    alert(`${label} ${shots.length}장이 협의도면에 첨부되었습니다. (저장을 눌러야 최종 보관됩니다)`);
  } catch (err) {
    alert('첨부 실패: ' + (err.message || err));
  }
}

// PDF 앱 내 미리보기 (data URL → Blob URL 로 iframe 렌더 — 브라우저 호환성↑)
function openPdfViewer(dataUrl, title = '도면') {
  let blobUrl = '';
  try {
    const b64 = dataUrl.split(',')[1] || '';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    blobUrl = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
  } catch { blobUrl = dataUrl; }
  const overlay = document.createElement('div');
  overlay.className = 'img-viewer-overlay no-print';
  overlay.innerHTML = `
    <div class="img-viewer pdf-viewer">
      <div class="iv-head">
        <span class="iv-title">${esc(title)}</span>
        <a class="btn tiny" href="${esc(dataUrl)}" download="${esc(title.endsWith('.pdf') ? title : title + '.pdf')}">내려받기</a>
        <button class="btn tiny iv-x" type="button" aria-label="닫기">✕</button>
      </div>
      <iframe class="iv-pdf" title="${esc(title)}"></iframe>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.iv-pdf').src = blobUrl; // 안전하게 프로퍼티로 지정
  const close = () => {
    window.removeEventListener('keydown', onKey);
    if (blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl);
    overlay.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', onKey);
  overlay.querySelector('.iv-x').onclick = close;
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
}

// data URL 파일 내려받기
function downloadData(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 편집기 관리바에 계약금 입금 정보 표시(있으면) — 클릭하면 수정
function renderDepositInfo() {
  const el = document.getElementById('deposit-info');
  if (!el) return;
  const d = current.deposit;
  if (d && (String(d.amount || '').trim() || d.date)) {
    el.innerHTML = `<button type="button" class="dep-chip" id="deposit-edit" title="계약금 입금 정보 수정">💰 계약금 ${d.amount ? esc(d.amount) + '만' : '-'}${d.date ? ` · ${esc(d.date)}` : ''}</button>`;
    const btn = document.getElementById('deposit-edit');
    if (btn) btn.onclick = () => openDepositDialog({
      initial: current.deposit,
      onSave: (dep) => { current.deposit = { ...dep, at: new Date().toISOString() }; renderDepositInfo(); markDirty(); },
    });
  } else {
    el.innerHTML = '';
  }
}

// ---------- 편집 이벤트 ----------
function bindEditor() {
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) saveBtn.onclick = saveContract;
  document.getElementById('print-btn').onclick = () => window.print();
  bindAccount(app);
  // 진행상태: '확정' 잠금과 무관하게 언제든 변경 가능 (관리용 라벨)
  const stageSel = document.getElementById('stage-select');
  if (stageSel) stageSel.onchange = (e) => {
    const val = e.target.value;
    if (val === 'completed') { // 계약완료 → 계약금 입금 정보 입력 (취소 시 원복)
      const prev = current.stage;
      openDepositDialog({
        initial: current.deposit || {},
        onSave: (dep) => {
          current.deposit = { ...dep, at: new Date().toISOString() };
          current.stage = 'completed';
          e.target.className = 'mb-stage stage-completed';
          renderDepositInfo();
          markDirty();
        },
        onCancel: () => { e.target.value = prev; },
      });
      return;
    }
    current.stage = val;
    e.target.className = `mb-stage stage-${current.stage}`; // 색상 갱신
    markDirty();
  };
  renderDepositInfo();
  // 인허가 구분: 가설축조신고 / 준공용(인허가) — 저장 시 필수
  const permitSel = document.getElementById('permit-select');
  if (permitSel) permitSel.onchange = (e) => {
    current.permitType = e.target.value; // '' | 'temporary' | 'permit'
    e.target.className = `mb-stage permit-${current.permitType || 'none'}`;
    markDirty();
  };
  // 전시장: 드롭다운 선택 → current.showroom 반영
  const showroomSel = document.getElementById('showroom-select');
  if (showroomSel) showroomSel.onchange = (e) => { current.showroom = e.target.value; markDirty(); };
  // 모델 전환: 주문내용 옵션·금액을 새 모델 기준으로 재설정 (고객/현장/일자 등 입력값은 유지)
  const modelSel = document.getElementById('model-select');
  if (modelSel) modelSel.onchange = (e) => {
    const id = e.target.value;
    if (editorLocked) { e.target.value = current.modelId || ''; return; }
    if (!confirm('모델을 바꾸면 주문내용 옵션과 금액이 새 모델 기준으로 초기화됩니다.\n계속할까요?')) {
      e.target.value = current.modelId || '';
      return;
    }
    const preset = id ? modelContract(id) : emptyContract();
    // 이미 입력한 고객/관리 정보는 유지
    preset.client = current.client;
    preset.siteAddress = current.siteAddress;
    preset.contractDate = current.contractDate;
    preset.salesperson = current.salesperson;
    preset.stage = current.stage;
    preset.status = current.status;
    preset.contractNo = current.contractNo;
    preset.extraNotes = current.extraNotes;
    preset.idCards = current.idCards; // 첨부한 신분증은 모델 전환과 무관하게 유지
    preset.drawings = current.drawings; // 첨부한 협의도면도 유지
    if (!id) preset.showroom = current.showroom; // 통합 선택 시 기존 전시장 유지
    current = preset;
    normalizeContract(current);
    recalc(current);
    markDirty();
    renderEditor();
  };
  const confirmToggle = document.getElementById('status-confirmed');
  if (confirmToggle) confirmToggle.onchange = async (e) => {
    if (e.target.checked) {
      // 확정: 무결성 봉인 후 잠금
      current.status = 'confirmed';
      await sealContract();
    } else {
      // 확정 해제: 봉인 깨짐 경고
      if (!confirm('확정을 해제하면 전자 서명 무결성 봉인이 깨집니다. 내용을 다시 수정하시겠습니까?')) {
        e.target.checked = true;
        return;
      }
      current.status = 'draft';
      current.integrity = { hash: '', sealedAt: '', agent: '' };
    }
    markDirty();
    renderEditor();
  };

  bindSign(app);
  renderIdCards();
  bindIdCards();
  renderDrawings();
  bindDrawings();
  updateSealBanner();

  app.querySelectorAll('input.f[data-path], textarea.f[data-path]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const path = inp.dataset.path;
      let v = inp.value;
      // 금액/면적/단가 입력은 숫자(콤마 허용)
      if (inp.classList.contains('amt') || inp.classList.contains('area') || inp.classList.contains('price')) {
        v = v.replace(/[^\d.,]/g, '');
      }
      setPath(current, path, v);
      // 결제 항목을 직접 수정하면 수동 조정 모드로 전환 (자동 배분 중지)
      if (inp.dataset.pay) current.amounts.payManual = true;
      // 주문 항목: 금액을 직접 수정하면 수동 금액 고정, 평수·단가를 고치면 자동 계산 복귀
      const im = path.match(/^items\.(\d+)\.(amount|area|unitPrice)$/);
      if (im) {
        const it = current.items[Number(im[1])];
        if (it) it.amountManual = im[2] === 'amount' ? String(v).trim() !== '' : false;
      }
      if (inp.tagName === 'TEXTAREA') autoGrow(inp);
      // 비고: '협의 후 진행/현장답사' 등 주의 문구면 강조색 토글
      if (inp.classList.contains('note')) {
        inp.classList.toggle('note-hl', /협의\s*후\s*진행|현장\s*답사|현장답사|정화조/.test(v));
      }
      if (path.startsWith('items.') || path.startsWith('amounts.') || path.startsWith('extraCosts.')) updateTotals();
      markDirty();
    });
  });
  // 이동 설치비: 거리 구간 선택 → 금액 자동 입력
  app.querySelectorAll('select[data-move-cat]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const i = Number(sel.dataset.moveCat);
      current.items[i].moveCategory = sel.value;
      updateMoveFee(i);
    });
  });
  app.querySelectorAll('select[data-move-tier]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const i = Number(sel.dataset.moveTier);
      current.items[i].tier = sel.value;
      updateMoveFee(i);
    });
  });
  app.querySelectorAll('select[data-move-truck]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const i = Number(sel.dataset.moveTruck);
      current.items[i].truckQty = Number(sel.value) || 0;
      updateMoveFee(i);
    });
  });

  // 기타 비용: 항목 추가 / 삭제
  const ecAdd = document.getElementById('ec-add');
  if (ecAdd) ecAdd.onclick = () => {
    (current.extraCosts ||= []).push({ name: '', amount: '' });
    markDirty();
    renderEditor();
  };
  app.querySelectorAll('[data-ec-del]').forEach((b) => {
    b.onclick = () => {
      current.extraCosts.splice(Number(b.dataset.ecDel), 1);
      markDirty();
      renderEditor();
    };
  });

  // 약관 편집 바인딩
  bindTerms();

  // 비고 textarea 초기 높이 맞춤 (저장된 내용이 모두 보이도록)
  app.querySelectorAll('textarea.f').forEach(autoGrow);

  // 제품공급가: 직접 입력을 비우고 빠져나가면 주문내용 합계로 복귀
  const supplyInput = app.querySelector('input[data-path="amounts.supplyManual"]');
  if (supplyInput) supplyInput.addEventListener('blur', () => {
    const manualEmpty = current.amounts.supplyManual === '' || current.amounts.supplyManual == null;
    if (manualEmpty) supplyInput.value = fmtMan(current.amounts.itemsSupply);
  });

  // 계약일자 (년/월/일 → contractDate 합성)
  app.querySelectorAll('input.f.date[data-date]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const y = app.querySelector('input.date.y').value.padStart(4, '0').slice(-4);
      const mo = (app.querySelector('input.date.m').value || '').padStart(2, '0');
      const d = (app.querySelector('input.date.d').value || '').padStart(2, '0');
      current.contractDate = `${y}-${mo}-${d}`;
      markDirty();
    });
  });
}

function markDirty() {
  dirty = true;
  const f = document.getElementById('dirty-flag');
  if (f) f.textContent = '● 미저장';
}

// 확정 시점의 계약 내용+서명을 해시로 봉인
async function sealContract() {
  current.integrity = { hash: '', sealedAt: new Date().toISOString(), agent: navigator.userAgent };
  current.integrity.hash = await computeIntegrityHash(current);
}

// 무결성 봉인 상태 배너 (확정 후 변경 여부 검증)
async function updateSealBanner() {
  const contractEl = document.getElementById('contract');
  if (!contractEl) return;
  let banner = document.getElementById('seal-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'seal-banner';
    banner.className = 'seal-banner no-print';
    contractEl.prepend(banner);
  }
  if (current.status === 'confirmed' && current.integrity?.hash) {
    const ok = (await computeIntegrityHash(current)) === current.integrity.hash;
    const when = fmtSignDate(current.integrity.sealedAt);
    banner.className = `seal-banner no-print ${ok ? 'ok' : 'bad'}`;
    banner.innerHTML = ok
      ? `🔒 <b>확정·봉인됨</b> — 확정(${esc(when)}) 이후 내용 변경 없음. 수정하려면 상단 ‘확정’을 해제하세요.`
      : `⚠ <b>무결성 경고</b> — 확정(${esc(when)}) 이후 계약 내용 또는 서명이 변경되었습니다.`;
  } else {
    banner.className = 'seal-banner no-print';
    banner.innerHTML = '';
  }
}

// 자동계산 결과를 화면에 반영
function updateTotals() {
  recalc(current);
  app.querySelectorAll('[data-total]').forEach((el) => {
    el.textContent = fmtMan(current.amounts[el.dataset.total]);
  });
  // 제품공급가: 직접 입력값이 없으면 주문내용 금액 합계를 실시간 반영
  const supplyInput = app.querySelector('input[data-path="amounts.supplyManual"]');
  if (supplyInput && document.activeElement !== supplyInput) {
    const manualEmpty = current.amounts.supplyManual === '' || current.amounts.supplyManual == null;
    if (manualEmpty) supplyInput.value = fmtMan(current.amounts.itemsSupply);
  }
  // 자동계산 항목(평당·요금규칙·거리)은 금액칸도 자동 갱신
  current.items.forEach((it, i) => {
    if (it.unit === '평당' || it.priceRule || it.unit === '거리') {
      const inp = app.querySelector(`input[data-path="items.${i}.amount"]`);
      if (inp && document.activeElement !== inp) inp.value = fmtMan(it.amount);
    }
  });
  // 자동 배분 모드면 결제 입력칸도 비율대로 갱신 (포커스 중인 칸은 건드리지 않음)
  if (!current.amounts.payManual) {
    ['downPayment', 'interim1', 'interim2', 'interim3', 'balance'].forEach((k) => {
      const inp = app.querySelector(`input[data-pay="${k}"]`);
      if (inp && document.activeElement !== inp) inp.value = fmtMan(current.amounts[k]);
    });
  }
  // 결제 스케줄 안내 + 수동 조정 시 되돌리기 버튼
  let hint = document.getElementById('pay-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'pay-hint';
    hint.className = 'pay-hint no-print';
    document.getElementById('contract')?.prepend(hint);
  }
  if (current.amounts.productTotal > 0) {
    const won = manToKorean(current.amounts.productTotal);
    const remain = paymentRemaining(current);
    if (current.amounts.payManual) {
      const balanceNote = Math.abs(remain) < 0.5
        ? `<span class="ok">합계 일치</span>`
        : remain > 0 ? `<span class="warn">미배정 ${fmtMan(remain)}만원</span>`
          : `<span class="warn">${fmtMan(-remain)}만원 초과</span>`;
      hint.innerHTML = `<span class="warn">✎ 결제 금액 수동 조정됨</span> · ${balanceNote} · 제품합계 ${won} <button type="button" class="btn tiny" id="pay-reset"${editorLocked ? ' disabled' : ''}>자동 배분으로 되돌리기</button>`;
      const resetBtn = document.getElementById('pay-reset');
      if (resetBtn) resetBtn.onclick = () => {
        current.amounts.payManual = false;
        markDirty();
        updateTotals();
      };
    } else {
      hint.innerHTML = `<span class="ok">✔ 결제 스케줄 자동 배분</span> 계약금 10% · 중도금1 30% · 중도금2 40% · 중도금3 15% (백만원 단위 내림) · 잔금 나머지 · 제품합계 ${won}`;
    }
  } else {
    hint.innerHTML = '';
  }
  // 제품공급가 옆 빨간 표시 — 결제(계약금+중도금+잔금) 합계가 제품합계와 다르면 차이 금액 안내
  const diffEl = document.getElementById('pay-diff');
  if (diffEl) {
    const remain = current.amounts.productTotal > 0 ? paymentRemaining(current) : 0;
    if (Math.abs(remain) >= 0.5) {
      diffEl.textContent = remain > 0 ? `⚠ 결제 ${fmtMan(remain)}만원 부족` : `⚠ 결제 ${fmtMan(-remain)}만원 초과`;
      diffEl.classList.add('show');
    } else {
      diffEl.textContent = '';
      diffEl.classList.remove('show');
    }
  }
}

// ---------- 저장 ----------
async function saveContract() {
  // 필수 입력 확인: 건축주 이름·생년월일·연락처, 전시장·영업사원·현장주소가 비어있으면 저장 막기
  const required = [
    { key: 'client.name', label: '건축주 이름' },
    { key: 'client.birth', label: '생년월일' },
    { key: 'client.phone', label: '연락처' },
    { key: 'showroom', label: '전시장' },
    { key: 'salesperson', label: '영업사원' },
    { key: 'siteAddress', label: '현장주소' },
  ];
  const getVal = (k) => k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), current);
  const missing = required.filter((r) => !String(getVal(r.key) ?? '').trim());
  if (missing.length) {
    alert(`다음 항목을 작성해 주세요:\n\n· ${missing.map((m) => m.label).join('\n· ')}\n\n건축주 이름·생년월일·연락처, 전시장·영업사원·현장주소는 필수 입력입니다.`);
    const first = app.querySelector(`[data-path="${missing[0].key}"]`);
    if (first) { first.focus(); first.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    return;
  }
  // 인허가 구분(가설축조신고/준공용) 필수 — 선택 안 했으면 저장 막고 안내
  if (current.permitType !== 'temporary' && current.permitType !== 'permit') {
    alert('인허가 구분을 선택해 주세요.\n\n· 컨테이너·체류형쉼터 (가설건축물축조신고)\n· 주택 (준공용 인허가)\n\n둘 중 하나를 반드시 선택해야 저장됩니다.');
    const sel = document.getElementById('permit-select');
    if (sel) { sel.focus(); sel.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    return;
  }
  try {
    recalc(current);
    let saved;
    if (currentId) {
      saved = await api.update(currentId, current);
    } else {
      saved = await api.create(current);
      currentId = saved.id;
      current.contractNo = saved.contract_no;
      history.replaceState(null, '', `#/edit/${saved.id}`);
    }
    dirty = false;
    const f = document.getElementById('dirty-flag');
    if (f) f.textContent = '✔ 저장됨';
    // 계약번호 표시 갱신
    const meta = document.querySelector('.doc-meta');
    if (meta && current.contractNo) meta.innerHTML = `계약번호 <b>${esc(current.contractNo)}</b> <span id="dirty-flag" class="muted">✔ 저장됨</span>`;
  } catch (err) {
    alert('저장에 실패했습니다: ' + err.message);
  }
}

// 저장 안 한 채 창 닫기 경고
window.addEventListener('beforeunload', (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});
