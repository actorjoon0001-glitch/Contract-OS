// 서버 REST API 호출 래퍼
const BASE = '/api/contracts';

async function req(url, options) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let msg = `오류 (${res.status})`;
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  list: (q = '', { deleted = false } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (deleted) params.set('deleted', '1');
    const qs = params.toString();
    return req(`${BASE}${qs ? `?${qs}` : ''}`);
  },
  get: (id) => req(`${BASE}/${id}`),
  create: (data) => req(BASE, { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => req(`${BASE}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id) => req(`${BASE}/${id}`, { method: 'DELETE' }),
};
