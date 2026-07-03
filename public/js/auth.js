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
export function logout() { localStorage.removeItem(LS_KEY); }

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
