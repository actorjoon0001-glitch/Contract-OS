import { api } from './api.js';
import {
  SUPPLIER, emptyContract, recalc, paymentRemaining,
  fmtMan, manToKorean, normalizeContract, computeIntegrityHash,
  MOVE_OPTIONS, computeMoveFee, moveTruckQty,
} from './model.js';
import { openSignaturePad } from './sign.js';

let editorLocked = false; // 확정 상태이면 true (입력·서명 잠금)

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

// ---------- 라우팅 ----------
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);

async function route() {
  const hash = location.hash || '#/';
  if (hash === '#/' || hash === '') return renderList();
  if (hash === '#/new') return openEditor(null);
  const m = hash.match(/^#\/edit\/(\d+)$/);
  if (m) return openEditor(Number(m[1]));
  renderList();
}

function go(hash) {
  if (dirty && !confirm('저장하지 않은 변경사항이 있습니다. 이동하시겠습니까?')) return;
  dirty = false;
  location.hash = hash;
}

// ---------- 목록 화면 ----------
let listRows = []; // 전체 목록 캐시 (전시장/영업사원/검색 필터는 클라이언트에서 처리)
const LIST_COLS = 10;

async function renderList() {
  current = null; currentId = null; dirty = false;
  app.innerHTML = `
    <div class="topbar no-print">
      <div class="brand"><span class="logo">SEUM</span> 전산 계약서 <small>Contract-OS</small></div>
      <div class="actions">
        <input id="search" class="search" type="search" placeholder="건축주 · 현장주소 · 계약번호 · 전시장 · 영업사원 검색" />
        <select id="filter-showroom" class="filter-sel"><option value="">전시장 전체</option></select>
        <select id="filter-sales" class="filter-sel"><option value="">영업사원 전체</option></select>
        <button class="btn primary" id="new-btn">+ 새 계약서</button>
      </div>
    </div>
    <div class="list-wrap no-print">
      <table class="list-table">
        <thead>
          <tr>
            <th>계약번호</th><th>전시장</th><th>영업사원</th><th>건축주</th><th>현장주소</th>
            <th class="right">제품합계(만원)</th><th>계약일자</th><th>상태</th><th>수정일</th><th></th>
          </tr>
        </thead>
        <tbody id="list-body"><tr><td colspan="${LIST_COLS}" class="muted center">불러오는 중...</td></tr></tbody>
      </table>
    </div>`;

  document.getElementById('new-btn').onclick = () => go('#/new');
  document.getElementById('search').oninput = applyListFilters;
  document.getElementById('filter-showroom').onchange = applyListFilters;
  document.getElementById('filter-sales').onchange = applyListFilters;
  loadList();
}

async function loadList() {
  const body = document.getElementById('list-body');
  try {
    listRows = await api.list('');
    populateFilter('filter-showroom', '전시장 전체', listRows.map((r) => r.showroom));
    populateFilter('filter-sales', '영업사원 전체', listRows.map((r) => r.salesperson));
    applyListFilters();
  } catch (err) {
    body.innerHTML = `<tr><td colspan="${LIST_COLS}" class="center danger">목록을 불러오지 못했습니다: ${esc(err.message)}</td></tr>`;
  }
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
  const sr = document.getElementById('filter-showroom').value;
  const sp = document.getElementById('filter-sales').value;
  let rows = listRows;
  if (sr) rows = rows.filter((r) => (r.showroom || '') === sr);
  if (sp) rows = rows.filter((r) => (r.salesperson || '') === sp);
  if (q) rows = rows.filter((r) =>
    [r.client_name, r.site_address, r.contract_no, r.showroom, r.salesperson]
      .some((v) => (v || '').toLowerCase().includes(q)));
  renderListRows(rows);
}

function renderListRows(rows) {
  const body = document.getElementById('list-body');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${LIST_COLS}" class="muted center">조건에 맞는 계약서가 없습니다.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((r) => `
    <tr data-id="${r.id}" class="row">
      <td>${esc(r.contract_no || '-')}</td>
      <td>${esc(r.showroom || '-')}</td>
      <td>${esc(r.salesperson || '-')}</td>
      <td>${esc(r.client_name || '-')}</td>
      <td class="ellipsis">${esc(r.site_address || '-')}</td>
      <td class="right">${fmtMan(r.total_amount) || '-'}</td>
      <td>${esc(r.contract_date || '-')}</td>
      <td><span class="badge ${r.status}">${r.status === 'confirmed' ? '확정' : '작성중'}</span></td>
      <td class="muted small">${esc((r.updated_at || '').slice(0, 16))}</td>
      <td><button class="btn tiny danger" data-del="${r.id}">삭제</button></td>
    </tr>`).join('');

  body.querySelectorAll('.row').forEach((tr) => {
    tr.onclick = (e) => { if (e.target.dataset.del) return; go(`#/edit/${tr.dataset.id}`); };
  });
  body.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('이 계약서를 삭제할까요? 되돌릴 수 없습니다.')) return;
      await api.remove(b.dataset.del);
      loadList();
    };
  });
}

// ---------- 편집 화면 ----------
async function openEditor(id) {
  currentId = id;
  if (id) {
    try {
      const rec = await api.get(id);
      current = rec.data;
      current.contractNo = rec.contract_no;
    } catch (err) {
      alert('계약서를 불러오지 못했습니다: ' + err.message);
      return go('#/');
    }
  } else {
    current = emptyContract();
  }
  normalizeContract(current);
  recalc(current);
  renderEditor();
}

function renderEditor() {
  const c = current;
  editorLocked = c.status === 'confirmed';
  const [y, mo, d] = (c.contractDate || '').split('-');

  app.innerHTML = `
    <div class="topbar no-print">
      <div class="brand"><a href="#/" class="back">← 목록</a></div>
      <div class="doc-meta">
        ${c.contractNo ? `계약번호 <b>${esc(c.contractNo)}</b>` : '<span class="muted">새 계약서 (저장 시 번호 부여)</span>'}
        <span id="dirty-flag" class="muted"></span>
      </div>
      <div class="actions">
        <label class="status-toggle"><input type="checkbox" id="status-confirmed" ${c.status === 'confirmed' ? 'checked' : ''}/> 확정</label>
        <button class="btn" id="print-btn">🖨 인쇄 / PDF</button>
        <button class="btn primary" id="save-btn">💾 저장</button>
      </div>
    </div>

    <div class="manage-bar no-print">
      <span class="mb-title">관리</span>
      <label>전시장 ${field('showroom', c.showroom, 'manage')}</label>
      <label>영업사원 ${field('salesperson', c.salesperson, 'manage')}</label>
      <span class="mb-hint muted small">※ 목록 분류·검색용 (계약서 인쇄에는 표시 안 됨)</span>
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
          <td class="sign-field"><span class="fl">건축주</span> <span class="sign-name">${field('client.name', c.client.name, 'name')}</span> ${signSlot('client')}</td>
        </tr>
        <tr>
          <td class="sign-co">사업자번호 : ${esc(SUPPLIER.bizNo)}</td>
          <td class="sign-field"><span class="fl">생년월일</span> ${field('client.birth', c.client.birth)}</td>
        </tr>
        <tr>
          <td class="sign-co sign-co-rep">대표 ${esc(SUPPLIER.ceo)} ${signSlot('supplier')}</td>
          <td class="sign-field"><span class="fl">연락처</span> ${field('client.phone', c.client.phone)}</td>
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
    { label: '중도금 1', type: 'pay', key: 'interim1', cond: '기초공사 완료 후 입금 (40%)' },
    { label: '중도금 2', type: 'pay', key: 'interim2', cond: '골조·외장·지붕 공사 완료 후 입금 (45%)' },
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
    return `<td class="lbl">${row.label}</td>
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
  return current.terms.map((t) => `<li>${esc(t)}</li>`).join('');
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
// 비고/설명: 여러 줄로 줄바꿈되는 textarea (높이는 내용에 맞춰 자동 조절)
function noteField(path, value) {
  const lock = editorLocked ? 'readonly' : '';
  const lc = editorLocked ? 'locked' : '';
  return `<textarea class="f note ${lc}" data-path="${path}" rows="1" ${lock}>${esc(value)}</textarea>`;
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

// ---------- 편집 이벤트 ----------
function bindEditor() {
  document.getElementById('save-btn').onclick = saveContract;
  document.getElementById('print-btn').onclick = () => window.print();
  document.getElementById('status-confirmed').onchange = async (e) => {
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
    ['downPayment', 'interim1', 'interim2', 'balance'].forEach((k) => {
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
      hint.innerHTML = `<span class="ok">✔ 결제 스케줄 자동 배분</span> 계약금 10% · 중도금1 40% · 중도금2 45% (백만원 단위 내림) · 잔금 나머지 · 제품합계 ${won}`;
    }
  } else {
    hint.innerHTML = '';
  }
}

// ---------- 저장 ----------
async function saveContract() {
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
