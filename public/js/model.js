// 계약서 데이터 모델 / 기본값 / 자동계산
// 금액 단위는 '만원' (원본 양식의 우측 '만원' 열과 동일)

export const SUPPLIER = {
  company: '주식회사 세움 디자인하우징',
  bizNo: '587-81-03537',
  ceo: '김민석',
  bankAccount: '332-910069-81104 하나은행',
  sealImage: '/img/seal.png', // 공급자(대표) 법인 인감 이미지 경로 (없으면 '(인)' 표시)
  logoImage: '/img/logo.png', // 계약서 상단 로고 이미지 경로 (없으면 'SEUM' 글씨 표시)
};

// 이동 설치비 요금표 — 종류 × 거리구간 (+ 일반트럭 추가요금). 금액 단위: 만원
// 구간/금액을 여기서 수정하면 화면·계산에 바로 반영됩니다.
export const MOVE_OPTIONS = {
  categories: [
    {
      key: 'farm', label: '농막', truck: false,
      tiers: [
        { label: '100km 미만', base: 180 },
        { label: '200km 미만', base: 220 },
        { label: '200km 이상', base: 250 },
      ],
    },
    {
      key: 'stay35', label: '체류형쉼터·이동식주택 (높이 3.5m 이하)', truck: true,
      tiers: [
        { label: '100km 미만', base: 220, truckAdd: 60 },
        { label: '200km 미만', base: 360, truckAdd: 80 },
        { label: '200km 이상', base: 310, truckAdd: 100 },
      ],
    },
    {
      key: 'stay40', label: '체류형쉼터·이동식주택 (높이 3.5~4m)', truck: true,
      tiers: [
        { label: '100km 미만', base: 280, truckAdd: 60 },
        { label: '200km 미만', base: 330, truckAdd: 80 },
        { label: '200km 이상', base: 390, truckAdd: 100 },
      ],
    },
  ],
};

// 이동 설치비 항목의 선택값(종류·거리·트럭)으로 금액(만원) 계산. 미선택이면 '' 반환
export function computeMoveFee(item) {
  const cat = MOVE_OPTIONS.categories.find((c) => c.key === item.moveCategory);
  if (!cat) return '';
  const tier = cat.tiers.find((t) => t.label === item.tier);
  if (!tier) return '';
  let amt = tier.base;
  if (cat.truck && item.truck) amt += (tier.truckAdd || 0);
  return amt;
}

// 주문내용 8개 항목 (원본 양식 단가 그대로) — unit: '평당' | '정액' | '거리'
export function defaultItems() {
  return [
    { no: '1', name: '<인허가> 토목설계', unit: '정액', unitPrice: 450, area: '', amount: '', note: '인허가 기간 평균 1~2달 이상 소요' },
    { no: '1', name: '<인허가> 건축설계', unit: '정액', unitPrice: 450, area: '', amount: '', note: '' },
    { no: '2', name: '약식 기초공사(평당)', unit: '평당', priceRule: 'foundation', priceLabel: '12평↓ 140 / 12평↑ 110', unitPrice: '', area: '', amount: '', note: '높이400T / 기초에 관한 기본설비 포함' },
    { no: '3', name: '건물건축비(평당)', unit: '평당', unitPrice: 380, area: '', amount: '', note: '' },
    { no: '4', name: '현장 시공비(평당)', unit: '평당', unitPrice: 80, area: '', amount: '', note: '현장시공시 처마 가능함' },
    { no: '5', name: '이동 설치비', unit: '거리', unitPrice: '', area: '', amount: '', moveCategory: '', tier: '', truck: false, note: '트럭+크레인(25톤기준)+주춧돌+설치인원 포함 (현장상황에 따른 추가금 있음)' },
    { no: '6', name: '포치(평당)', unit: '평당', unitPrice: 190, area: '', amount: '', note: '아연각관+합성데크판 사용(방부목X)' },
    { no: '', name: '데크(평당)', unit: '평당', unitPrice: 85, area: '', amount: '', note: '합성데크판 사용(방부목X)' },
    { no: '7', name: '썬룸(평당)', unit: '평당', key: 'sunroom', unitPrice: 300, area: '', amount: '', note: '썬룸,포치는 하부3면 사이딩 마감. 폴딩도어는 추가금 발생' },
    { no: '', name: '└ 썬룸 약식기초(300T)', unit: '정액', key: 'sunroomFoundation', priceRule: 'sunroomFoundation', priceLabel: '평당 65만원', unitPrice: '', area: '', amount: '', note: '썬룸 선택(면적 입력) 시 자동 적용 · 300T' },
    { no: '8', name: '습식난방 가스/기름(평당)', unit: '평당', priceRule: 'heating', priceLabel: '10~15평 550 / 16~24평 600 / 24평↑ 초과분 평당20', unitPrice: '', area: '', amount: '', note: '토목공사 및 정화조는 현장답사하여 건축주와 협의 후 진행' },
  ];
}

// 서비스·기타 내용 기본 양식 (작성 시작 시 미리 채워짐) — 한 줄
export function defaultExtraNotes() {
  return '담당 영업사원 :   /  전시장 :   /  모델명 :   /  평수 : ';
}

// 약관 (원본 양식 그대로)
export function defaultTerms() {
  return [
    '건축주 신청사항 - 전기계량기 신청(전기업자) / 수도계량기 신청(상수도사업소)',
    '현장 설치 제작시 전기, 용수 등은 건축주가 제공함.',
    '본 계약은 쌍방합의 하에 진행하며 공급자가 해지할 경우 계약금의 배액 배상하고, 계약자가 해지할 경우 계약금은 포기한다.',
    "모든 계약은 건축주와의 충분한 상담 후 계약이며 '주문제작' 상품으로 제작이 시작된 이후에는 제품의 특성상 변경 및 취소가 불가하며 기 납입 계약금은 반환하지 않음.",
    '계약 이후 천재지변에 의한 제작·시공·출고 지연시 계약파기의 원인이 되지 않음.',
    '진행시 관공서 승인 지연에 의한 준공허가 지연이 발생할 수 있음.',
    '외부 인입비용 별도(전기, 가스, 수도 기타 등의 비용)는 건축주가 부담함.',
    '제세공과금(특별경비, 산재보험료, 현장관리인 선정비용) 별도.',
    '모델하우스, 홍보물(유튜브·SNS 등)의 이미지·색상·마감재는 참고용이며, 자재수급 및 생산사정에 따라 동등 품질의 대체 자재가 적용될 수 있습니다.',
    'A/S 기간 - 준공서류 전달완료(이동설치시는 출고일로부터) 24개월 (건축주 사용상 부주의에 의한 하자는 제외)',
    '견적유효기간 : 견적일로부터 5일간입니다.',
  ];
}

export function emptyContract() {
  const today = new Date();
  return {
    contractNo: '',
    status: 'draft',
    contractDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
    siteAddress: '',
    showroom: '',     // 전시장 (목록 분류·관리용)
    salesperson: '',  // 영업사원 (목록 분류·관리용)
    items: defaultItems(),
    terms: defaultTerms(),
    extraNotes: defaultExtraNotes(), // 약관 위 자유 기입란 (담당 영업사원·전시장·모델·평수 등)
    amounts: {
      supplyManual: '',  // 제품공급가 직접 입력 (비우면 항목 합계 사용)
      itemsSupply: 0,    // 우측 항목 금액 합계 (참고/플레이스홀더용)
      productSupply: 0,  // 제품공급가 (직접입력 우선, 없으면 항목 합계)
      vat: 0,            // 부가세 (자동)
      productTotal: 0,   // 제품 합계 (자동)
      downPayment: 0,    // 계약금 (총액 10%, 자동)
      interim1: 0,       // 중도금1 (총액 40%, 기초공사 완료 후)
      interim2: 0,       // 중도금2 (총액 45%, 골조·외장·지붕 공사 완료 후)
      balance: 0,        // 잔금 (나머지 5%, 자동)
      payManual: false,  // 결제 스케줄 수동 조정 여부 (true면 자동 배분 건너뜀)
    },
    client: {
      name: '',
      birth: '',
      phone: '',
      address: '',
    },
    // 전자 서명 (캔버스로 그린 PNG data URL + 서명 시각 + 서명 기기)
    signatures: {
      supplier: { image: '', signedAt: '', agent: '' }, // 공급자(대표)
      client: { image: '', signedAt: '', agent: '' },   // 계약자(건축주)
    },
    // 무결성 봉인 (확정 시 계약 내용+서명의 해시를 기록 → 이후 변경 여부 검증)
    integrity: { hash: '', sealedAt: '', agent: '' },
  };
}

const oneSig = (s) => ({ image: s?.image || '', signedAt: s?.signedAt || '', agent: s?.agent || '' });

// 이전에 저장된 계약(서명/무결성 필드 없음)도 안전하게 다루도록 기본 구조 보정
export function normalizeContract(contract) {
  const s = contract.signatures || {};
  contract.signatures = { supplier: oneSig(s.supplier), client: oneSig(s.client) };
  const i = contract.integrity || {};
  contract.integrity = { hash: i.hash || '', sealedAt: i.sealedAt || '', agent: i.agent || '' };
  if (typeof contract.extraNotes !== 'string') contract.extraNotes = contract.extraNotes || '';
  if (typeof contract.showroom !== 'string') contract.showroom = contract.showroom || '';
  if (typeof contract.salesperson !== 'string') contract.salesperson = contract.salesperson || '';
  // 결제 스케줄: 구버전 중도금3 제거, 수동 조정 플래그 기본값 보정
  const am = contract.amounts;
  if (am) {
    if (am.interim3 !== undefined) delete am.interim3; // 중도금3 폐지 (4단계로)
    if (typeof am.payManual !== 'boolean') am.payManual = false;
  }
  return contract;
}

// 키 순서에 무관하게 안정적인 JSON 문자열 (해시 입력용)
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// 계약 내용(integrity 필드 제외)의 SHA-256 지문 — 브라우저 Web Crypto 사용
export async function computeIntegrityHash(contract) {
  const { integrity, contractNo, ...rest } = contract; // 봉인값·채번은 내용 변경과 무관하므로 제외
  const bytes = new TextEncoder().encode(stableStringify(rest));
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const num = (v) => {
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// 결제 스케줄 자동 배분 비율 (제품합계 기준)
//  계약금 10% · 중도금1 40% · 중도금2 45% · 잔금 5%(나머지)
export const PAY_DOWN_RATE = 0.10;      // 계약금 10%
export const PAY_INTERIM1_RATE = 0.40;  // 중도금1 40% (기초공사 완료 후)
export const PAY_INTERIM2_RATE = 0.45;  // 중도금2 45% (골조·외장·지붕 공사 완료 후)
export const PAY_UNIT_MAN = 100;        // 계약금·중도금 내림 단위: 백만원(=100만원)
// 계약금·중도금은 백만원 단위로 내림, 잔금은 나머지(= 총액 - 계약금 - 중도금 합계)

// 항목 금액(평당이면 평수×단가) 및 공급가/부가세/제품합계/결제스케줄 자동계산
export function recalc(contract) {
  // 썬룸 면적(썬룸 약식기초 계산용)
  const sun = contract.items.find((it) => it.key === 'sunroom');
  const sunArea = sun ? num(sun.area) : 0;

  let itemsSum = 0;
  for (const it of contract.items) {
    const a = num(it.area);
    if (it.priceRule === 'foundation') {
      // 기초공사: 12평 미만 평당 140, 12평 이상 평당 110
      it.amount = a > 0 ? a * (a < 12 ? 140 : 110) : '';
    } else if (it.priceRule === 'heating') {
      // 습식난방: 10~15평 550, 16~24평 600, 24평 초과 시 600 + 초과분 평당 20
      it.amount = a > 0 ? (a < 16 ? 550 : a <= 24 ? 600 : 600 + (a - 24) * 20) : '';
    } else if (it.priceRule === 'sunroomFoundation') {
      // 썬룸 약식기초(300T): 썬룸 면적 × 65
      it.amount = sunArea > 0 ? sunArea * 65 : '';
    } else if (it.unit === '평당' && num(it.unitPrice) > 0) {
      // 평수 입력 시 평수×단가, 평수를 지우면 금액도 비움
      it.amount = a > 0 ? a * num(it.unitPrice) : '';
    } else if (it.unit === '거리') {
      const fee = computeMoveFee(it);
      if (fee !== '') it.amount = fee;
    }
    itemsSum += num(it.amount);
  }
  const a = contract.amounts;
  a.itemsSupply = Math.round(itemsSum);
  // 제품공급가: 직접 입력값이 있으면 우선, 없으면 항목 합계
  const hasManual = a.supplyManual !== '' && a.supplyManual != null;
  a.productSupply = hasManual ? Math.round(num(a.supplyManual)) : a.itemsSupply;
  a.vat = Math.round(a.productSupply * 0.1);
  a.productTotal = a.productSupply + a.vat;

  // 결제 스케줄 자동 배분 (총액 기준) — 수동 조정 모드면 건너뜀
  // 계약금·중도금은 백만원 단위로 내림, 끝자리는 잔금이 흡수
  if (!a.payManual) {
    const total = a.productTotal;
    const floorUnit = (v) => Math.floor(v / PAY_UNIT_MAN) * PAY_UNIT_MAN;
    a.downPayment = floorUnit(total * PAY_DOWN_RATE);
    a.interim1 = floorUnit(total * PAY_INTERIM1_RATE);
    a.interim2 = floorUnit(total * PAY_INTERIM2_RATE);
    a.balance = total - a.downPayment - a.interim1 - a.interim2;
  }
  return contract;
}

// 결제 스케줄 합계와 미배정 잔액(만원)
export function paymentRemaining(contract) {
  const a = contract.amounts;
  const scheduled = num(a.downPayment) + num(a.interim1) + num(a.interim2) + num(a.balance);
  return a.productTotal - scheduled;
}

// 만원 → '12,345' 형태
export function fmtMan(v) {
  const n = num(v);
  if (!n) return '';
  return n.toLocaleString('ko-KR');
}

// 만원 → 원 환산 표시 ('1억 2,345만원' 형태는 한글 변환 함수 사용)
export function manToWon(v) {
  return num(v) * 10000;
}

// 만원 금액을 한글 표기로 (예: 11400 -> '일억 일천사백만원')
export function manToKorean(manValue) {
  const man = Math.round(num(manValue));
  if (!man) return '';
  const won = man * 10000;
  return numberToKorean(won) + '원';
}

const DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SMALL_UNIT = ['', '십', '백', '천'];
const BIG_UNIT = ['', '만', '억', '조'];

function numberToKorean(n) {
  if (n === 0) return '영';
  let result = '';
  let groupIdx = 0;
  while (n > 0) {
    const group = n % 10000;
    if (group > 0) {
      result = group4ToKorean(group) + BIG_UNIT[groupIdx] + ' ' + result;
    }
    n = Math.floor(n / 10000);
    groupIdx++;
  }
  return result.trim();
}

function group4ToKorean(n) {
  let s = '';
  let pos = 0;
  while (n > 0) {
    const d = n % 10;
    if (d > 0) {
      // '일십','일백','일천'은 통상 '십','백','천'으로 표기
      const digit = d === 1 && pos > 0 ? '' : DIGITS[d];
      s = digit + SMALL_UNIT[pos] + s;
    }
    n = Math.floor(n / 10);
    pos++;
  }
  return s;
}
