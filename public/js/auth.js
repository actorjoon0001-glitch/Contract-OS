// 인증(로그인) — 세움os와 동일한 Supabase 프로젝트의 직원 계정으로 로그인.
// 외부 라이브러리 없이 Supabase Auth(GoTrue) REST API를 fetch로 직접 호출한다.
// 액세스 토큰은 localStorage에 보관하고, /api 호출 시 Authorization 헤더로 붙인다.

const LS_KEY = 'contractos.session';
let _config = null;       // { authEnabled, supabaseUrl, anonKey }
let _onAuthLost = () => {}; // 세션 만료 등으로 재로그인이 필요할 때 호출

// 서버에서 공개 설정(로그인 필요 여부·Supabase 주소·익명키)을 받아온다.
export async function loadAuthConfig() {
  if (_config) return _config;
  try {
    const res = await fetch('/api/config');
    _config = await res.json();
  } catch {
    _config = { authEnabled: false }; // 설정을 못 받으면 개방 모드로 취급
  }
  return _config;
}
export function authEnabled() { return !!_config?.authEnabled; }
export function setOnAuthLost(fn) { _onAuthLost = fn || (() => {}); }

function saveSession(s) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }
function loadSession() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
}
export function currentUser() { return loadSession()?.user || null; }
export function logout() {
  localStorage.removeItem(LS_KEY);
  try { sessionStorage.setItem('contractos.ssoSkip', '1'); } catch { /* ignore */ } // 로그아웃 후 자동 재로그인 방지
}

function storeToken(data, prevUser) {
  const user = data.user
    ? {
        id: data.user.id,
        email: data.user.email || '',
        name: data.user.user_metadata?.name || data.user.user_metadata?.full_name || data.user.user_metadata?.username || '',
      }
    : prevUser;
  saveSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    user,
  });
  return user;
}

// ── 자동 로그인(SSO) ────────────────────────────────────────────────
// 세움os(부모창)에 임베드(iframe)돼 있을 때, 부모가 넘겨주는 로그인 세션으로
// 자동 로그인한다. 세움os와 같은 Supabase 프로젝트라 그 토큰이 그대로 유효하다.
// 프로토콜: (자식) 'seum-sso:ready' 전송 → (부모) 'seum-sso:token' 응답.
const SSO_SKIP_KEY = 'contractos.ssoSkip'; // 명시적 로그아웃 후 자동 재로그인 방지(탭 한정)

// JWT 페이로드 디코드 (검증은 서버가 함 — 여기선 사용자/만료 표시용)
function decodeJwt(token) {
  const part = token.split('.')[1] || '';
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(part.length + (4 - (part.length % 4)) % 4, '=');
  const json = decodeURIComponent(escape(atob(b64))); // UTF-8(한글 이름) 대응
  return JSON.parse(json);
}

// 부모가 넘겨준 토큰으로 세션 저장
export function storeExternalSession(access_token, refresh_token) {
  const p = decodeJwt(access_token);
  const user = {
    id: p.sub,
    email: p.email || '',
    name: p.user_metadata?.name || p.user_metadata?.full_name || p.user_metadata?.username || '',
  };
  saveSession({
    access_token,
    refresh_token: refresh_token || '',
    expires_at: p.exp ? p.exp * 1000 : Date.now() + 3600 * 1000,
    user,
  });
  return user;
}

// 임베드 상태면 부모에게 세션을 요청해 자동 로그인 시도. 성공 true / 실패·비임베드 false.
export function trySSO(timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (window.parent === window) return resolve(false);           // 임베드 아님
    if (sessionStorage.getItem(SSO_SKIP_KEY)) return resolve(false); // 방금 로그아웃함
    let done = false;
    const finish = (ok) => { if (done) return; done = true; window.removeEventListener('message', onMsg); resolve(ok); };
    function onMsg(e) {
      if (e.source !== window.parent) return;                       // 우리를 감싼 부모창만 신뢰
      const d = e.data || {};
      if (d.type === 'seum-sso:token' && d.access_token) {
        try { storeExternalSession(d.access_token, d.refresh_token); finish(true); }
        catch { finish(false); }
      }
    }
    window.addEventListener('message', onMsg);
    try { window.parent.postMessage({ type: 'seum-sso:ready' }, '*'); } catch { /* ignore */ }
    setTimeout(() => finish(false), timeoutMs);
  });
}

// 이메일 + 비밀번호 로그인 (세움os 계정 그대로)
export async function login(email, password) {
  const { supabaseUrl, anonKey } = _config || {};
  if (!supabaseUrl || !anonKey) throw new Error('로그인 설정이 아직 준비되지 않았습니다. 관리자에게 문의하세요.');
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ email: String(email).trim(), password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error_description || data.msg || data.error || '이메일 또는 비밀번호를 확인해 주세요.';
    throw new Error(msg);
  }
  return storeToken(data);
}

// 리프레시 토큰으로 액세스 토큰 갱신
async function refresh() {
  const s = loadSession();
  const { supabaseUrl, anonKey } = _config || {};
  if (!s?.refresh_token || !supabaseUrl || !anonKey) { logout(); return null; }
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!res.ok) { logout(); return null; }
  const data = await res.json().catch(() => ({}));
  return { token: data.access_token, user: storeToken(data, s.user) };
}

// 현재 유효한 액세스 토큰 (만료 임박 시 자동 갱신). 없으면 null.
export async function accessToken() {
  const s = loadSession();
  if (!s) return null;
  if (Date.now() > s.expires_at - 60_000) {
    const r = await refresh();
    return r?.token || null;
  }
  return s.access_token;
}

// 세션이 끊겼을 때 (401 등) — 저장 세션을 지우고 재로그인 화면을 띄운다.
export function authLost() { logout(); _onAuthLost(); }
