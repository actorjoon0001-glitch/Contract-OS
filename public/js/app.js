import { api } from './api.js';
import {
  SUPPLIER, emptyContract, recalc, paymentRemaining,
  fmtMan, manToKorean,
} from './model.js';

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
async function renderList() {
  current = null; currentId = null; dirty = false;
  app.innerHTML = `
    <div class="topbar no-print">
      <div class="brand"><span class="logo">SEUM</span> 전산 계약서 <small>Contract-OS</small></div>
      <div class="actions">
        <input id="search" class="search" type="search" placeholder="건축주명 · 현장주소 · 계약번호 검색" />
        <button class="btn primary" id="new-btn">+ 새 계약서</button>
      </div>
    </div>
    <div class="list-wrap no-print">
      <table class="list-table">
        <thead>
          <tr>
            <th>계약번호</th><th>건축주</th><th>현장주소</th><th class="right">제품합계(만원)</th>
            <th>계약일자</th><th>상태</th><th>수정일</th><th></th>
          </tr>
        </thead>
        <tbody id="list-body"><tr><td colspan="8" class="muted center">불러오는 중...</td></tr></tbody>
      </table>
    </div>`;

  document.getElementById('new-btn').onclick = () => go('#/new');
  const search = document.getElementById('search');
  let timer;
  search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => loadList(search.value), 250); };
  loadList('');
}

async function loadList(q) {
  const body = document.getElementById('list-body');
  try {
    const rows = await api.list(q);
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="8" class="muted center">계약서가 없습니다. <b>+ 새 계약서</b>로 시작하세요.</td></tr>`;
      return;
    }
    body.innerHTML = rows.map((r) => `
      <tr data-id="${r.id}" class="row">
        <td>${esc(r.contract_no || '-')}</td>
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
        loadList(document.getElementById('search').value);
      };
    });
  } catch (err) {
    body.innerHTML = `<tr><td colspan="8" class="center danger">목록을 불러오지 못했습니다: ${esc(err.message)}</td></tr>`;
  }
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
  recalc(current);
  renderEditor();
}

function renderEditor() {
  const c = current;
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

    <div id="contract" class="contract">
      <header class="c-head">
        <div class="c-logo"><span class="logo">SEUM</span><div>㈜세움디자인하우징</div></div>
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
          <td class="sign-field"><span class="fl">건축주</span> ${field('client.name', c.client.name, 'name')} <span class="seal">(인)</span></td>
        </tr>
        <tr>
          <td class="sign-co">사업자번호 : ${esc(SUPPLIER.bizNo)}</td>
          <td class="sign-field"><span class="fl">생년월일</span> ${field('client.birth', c.client.birth)}</td>
        </tr>
        <tr>
          <td class="sign-co">대표 ${esc(SUPPLIER.ceo)} <span class="seal">(인)</span></td>
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
    { label: '제품공급가', type: 'calc', key: 'productSupply' },
    { label: '부가세(Vat)', type: 'calc', key: 'vat' },
    { label: '제품 합계', type: 'calc', key: 'productTotal', strong: true },
    { label: '계약금', type: 'pay', key: 'downPayment' },
    { label: '중도금 1', type: 'pay', key: 'interim1', cond: '기초공사 완료 후 입금' },
    { label: '중도금 2', type: 'pay', key: 'interim2', cond: '철골공사 완료 후 입금' },
    { label: '중도금 3', type: 'pay', key: 'interim3', cond: '지붕·외장 완료 후 입금' },
    { label: '잔금', type: 'pay', key: 'balance', cond: '준공서류 전달 / 이동설치시 출고 전 입금' },
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
  if (row.type === 'pay') {
    return `<td class="lbl">${row.label}</td>
      <td class="amt">${field('amounts.' + row.key, c.amounts[row.key], 'amt', 'right')} <span class="unit">만원</span></td>
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
  const priceLabel = item.unitPrice !== '' ? `${item.unitPrice}만원` : '';
  return `
    <td class="item-name">
      <span class="item-no">${item.no}.</span> ${esc(item.name)}
      ${priceLabel ? `<span class="item-price">${esc(priceLabel)}</span>` : ''}
      ${item.unit === '평당'
        ? `<span class="area-input">${field(`items.${i}.area`, item.area, 'area', 'right')}<span class="unit2">평</span></span>`
        : ''}
    </td>
    <td class="amt">${field(`items.${i}.amount`, item.amount, 'amt', 'right')} <span class="unit">만원</span></td>
    <td class="note">${field(`items.${i}.note`, item.note, 'note')}</td>`;
}

function renderTerms() {
  return current.terms.map((t) => `<li>${esc(t)}</li>`).join('');
}

// 입력 필드 생성 (인쇄 시 밑줄/테두리 없는 텍스트처럼 보임)
function field(path, value, cls = '', align = '') {
  return `<input class="f ${cls} ${align}" data-path="${path}" value="${esc(value)}" />`;
}
function dateField(part, value, suffix, size) {
  return `<input class="f date ${part}" data-date="${part}" value="${esc(value || '')}" size="${size}" placeholder="${suffix === '년' ? '____' : '__'}" /><span class="unit3">${suffix}</span>`;
}

// ---------- 편집 이벤트 ----------
function bindEditor() {
  document.getElementById('save-btn').onclick = saveContract;
  document.getElementById('print-btn').onclick = () => window.print();
  document.getElementById('status-confirmed').onchange = (e) => {
    current.status = e.target.checked ? 'confirmed' : 'draft';
    markDirty();
  };

  app.querySelectorAll('input.f[data-path]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const path = inp.dataset.path;
      let v = inp.value;
      // 금액/면적 입력은 숫자(콤마 허용)
      if (inp.classList.contains('amt') || inp.classList.contains('area')) {
        v = v.replace(/[^\d.,]/g, '');
      }
      setPath(current, path, v);
      if (path.startsWith('items.') || path.startsWith('amounts.')) updateTotals();
      markDirty();
    });
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

// 자동계산 결과를 화면에 반영
function updateTotals() {
  recalc(current);
  app.querySelectorAll('[data-total]').forEach((el) => {
    el.textContent = fmtMan(current.amounts[el.dataset.total]);
  });
  // 평당 항목은 금액칸도 자동 갱신 (사용자가 평수 입력 시)
  current.items.forEach((it, i) => {
    if (it.unit === '평당') {
      const inp = app.querySelector(`input[data-path="items.${i}.amount"]`);
      if (inp && document.activeElement !== inp) inp.value = fmtMan(it.amount);
    }
  });
  // 결제 스케줄 잔액 안내
  const remain = paymentRemaining(current);
  let hint = document.getElementById('pay-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'pay-hint';
    hint.className = 'pay-hint no-print';
    document.getElementById('contract')?.prepend(hint);
  }
  if (current.amounts.productTotal > 0) {
    const won = manToKorean(current.amounts.productTotal);
    if (Math.abs(remain) < 0.5) {
      hint.innerHTML = `<span class="ok">✔ 결제 스케줄 합계가 제품합계와 일치합니다.</span> 제품합계 ${won}`;
    } else if (remain > 0) {
      hint.innerHTML = `<span class="warn">⚠ 미배정 잔액 ${fmtMan(remain)}만원</span> · 제품합계 ${won}`;
    } else {
      hint.innerHTML = `<span class="warn">⚠ 결제 합계가 제품합계를 ${fmtMan(-remain)}만원 초과</span> · 제품합계 ${won}`;
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
