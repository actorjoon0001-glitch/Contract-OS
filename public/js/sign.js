// 전자 서명 패드 - 캔버스에 마우스/터치/펜으로 서명을 그려 PNG data URL 로 반환
// 외부 라이브러리 없이 Pointer Events 만 사용 (마우스·터치·스타일러스 모두 지원)

export function openSignaturePad({ title = '전자 서명', initial = '', onSave } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'sign-modal-overlay no-print';
  overlay.innerHTML = `
    <div class="sign-modal" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="sign-modal-head">
        <h3>${title}</h3>
        <button class="sign-x" type="button" aria-label="닫기">✕</button>
      </div>
      <div class="sign-canvas-wrap">
        <canvas class="sign-canvas"></canvas>
        <div class="sign-guide">이 칸에 서명해 주세요</div>
        <div class="sign-baseline"></div>
      </div>
      <div class="sign-modal-actions">
        <button class="btn" data-act="clear" type="button">지우기</button>
        <span class="grow"></span>
        <button class="btn" data-act="cancel" type="button">취소</button>
        <button class="btn primary" data-act="save" type="button">서명 완료</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector('.sign-canvas');
  const guide = overlay.querySelector('.sign-guide');
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let hasInk = false;
  let last = null;

  // 고해상도(레티나) 대응: CSS 크기 × devicePixelRatio 로 백버퍼 구성
  function setupCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#15233b';
    if (initial) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
        hasInk = true;
        guide.style.display = 'none';
      };
      img.src = initial;
    }
  }

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e) {
    drawing = true;
    hasInk = true;
    guide.style.display = 'none';
    last = pos(e);
    // 점 하나만 찍어도 보이도록
    ctx.beginPath();
    ctx.arc(last.x, last.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function move(e) {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
    e.preventDefault();
  }

  function end() { drawing = false; }

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);

  function close() {
    window.removeEventListener('pointerup', end);
    window.removeEventListener('keydown', onKey);
    overlay.remove();
  }

  function onKey(e) { if (e.key === 'Escape') close(); }
  window.addEventListener('keydown', onKey);

  overlay.querySelector('.sign-x').onclick = close;
  overlay.querySelector('[data-act="cancel"]').onclick = close;
  overlay.querySelector('[data-act="clear"]').onclick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk = false;
    guide.style.display = '';
  };
  overlay.querySelector('[data-act="save"]').onclick = () => {
    const dataUrl = hasInk ? canvas.toDataURL('image/png') : '';
    close();
    onSave?.(dataUrl);
  };
  // 배경 클릭 시 닫기 (모달 내부 클릭은 무시)
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });

  // DOM 배치 후 크기 측정이 가능하므로 다음 프레임에 캔버스 구성
  requestAnimationFrame(setupCanvas);
}
