// 계약서 데이터 모델 / 기본값 / 자동계산
// 금액 단위는 '만원' (원본 양식의 우측 '만원' 열과 동일)

export const SUPPLIER = {
  company: '주식회사 세움 디자인하우징',
  bizNo: '587-81-03537',
  ceo: '김민석',
  bankAccount: '332-910069-81104 하나은행',
};

// 주문내용 8개 항목 (원본 양식 단가 그대로) — unit: '평당' | '정액'
export function defaultItems() {
  return [
    { no: '1', name: '<인허가> 토목설계', unit: '정액', unitPrice: 450, area: '', amount: '', note: '인허가 기간 평균 1~2달 이상 소요' },
    { no: '1', name: '<인허가> 건축설계', unit: '정액', unitPrice: 450, area: '', amount: '', note: '' },
    { no: '2', name: '약식 기초공사(평당)', unit: '평당', unitPrice: 110, area: '', amount: '', note: '높이400T / 기초에 관한 기본설비 포함' },
    { no: '3', name: '건물건축비(평당)', unit: '평당', unitPrice: 380, area: '', amount: '', note: '' },
    { no: '4', name: '현장 시공비', unit: '정액', unitPrice: 80, area: '', amount: '', note: '현장시공시 처마 가능함' },
    { no: '5', name: '이동 설치비', unit: '정액', unitPrice: '', area: '', amount: '', note: '트럭+크레인(25톤기준)+주춧돌+설치인원 포함 (현장상황에 따른 추가금 있음)' },
    { no: '6', name: '포치/데크(평당)', unit: '평당', unitPrice: 190, area: '', amount: '', note: '아연각관+합성데크판 사용(방부목X) / 데크 평당 85만원' },
    { no: '7', name: '썬룸(평당)', unit: '평당', unitPrice: 300, area: '', amount: '', note: '썬룸,포치는 하부3면 사이딩 마감. 폴딩도어는 추가금 발생' },
    { no: '8', name: '습식난방 가스/기름', unit: '정액', unitPrice: 600, area: '', amount: '', note: '토목공사 및 정화조는 현장답사하여 건축주와 협의 후 진행' },
  ];
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
    items: defaultItems(),
    terms: defaultTerms(),
    amounts: {
      productSupply: 0, // 제품공급가 (항목 합계, 자동)
      vat: 0,           // 부가세 (자동)
      productTotal: 0,  // 제품 합계 (자동)
      downPayment: '',  // 계약금
      interim1: '',     // 중도금1 (기초공사 완료 후)
      interim2: '',     // 중도금2 (철골공사 완료 후)
      interim3: '',     // 중도금3 (지붕·외장 완료 후)
      balance: '',      // 잔금 (준공서류 전달/출고 전)
    },
    client: {
      name: '',
      birth: '',
      phone: '',
      address: '',
    },
  };
}

const num = (v) => {
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// 항목 금액(평당이면 평수×단가) 및 합계/부가세/제품합계 자동계산
export function recalc(contract) {
  let supply = 0;
  for (const it of contract.items) {
    if (it.unit === '평당' && num(it.area) > 0 && num(it.unitPrice) > 0) {
      it.amount = num(it.area) * num(it.unitPrice);
    }
    supply += num(it.amount);
  }
  const a = contract.amounts;
  a.productSupply = Math.round(supply);
  a.vat = Math.round(supply * 0.1);
  a.productTotal = a.productSupply + a.vat;
  return contract;
}

// 결제 스케줄 합계와 미배정 잔액(만원)
export function paymentRemaining(contract) {
  const a = contract.amounts;
  const scheduled = num(a.downPayment) + num(a.interim1) + num(a.interim2) + num(a.interim3) + num(a.balance);
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
