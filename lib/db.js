// 계약 데이터 저장소 (Node 내장 SQLite 사용 - 외부 의존성 없음)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, 'contracts.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS contracts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_no   TEXT UNIQUE,
    status        TEXT NOT NULL DEFAULT 'draft',
    client_name   TEXT,
    site_address  TEXT,
    contract_date TEXT,
    total_amount  REAL,
    data          TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

// 기존 DB 호환: 전시장·영업사원 컬럼이 없으면 추가
for (const col of ['showroom', 'salesperson']) {
  try { db.exec(`ALTER TABLE contracts ADD COLUMN ${col} TEXT`); } catch { /* 이미 존재 */ }
}

// 연도별 계약번호 채번 (예: 2026-0001)
function nextContractNo(year) {
  const prefix = `${year}-`;
  const row = db
    .prepare(`SELECT contract_no FROM contracts WHERE contract_no LIKE ? ORDER BY contract_no DESC LIMIT 1`)
    .get(`${prefix}%`);
  let seq = 1;
  if (row && row.contract_no) {
    const n = parseInt(row.contract_no.slice(prefix.length), 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return prefix + String(seq).padStart(4, '0');
}

// 목록/검색용 요약 필드를 본문 JSON에서 추출
function summarize(data) {
  return {
    client_name: data?.client?.name || '',
    site_address: data?.siteAddress || '',
    showroom: data?.showroom || '',
    salesperson: data?.salesperson || '',
    contract_date: data?.contractDate || '',
    total_amount: Number(data?.amounts?.productTotal) || 0,
    status: data?.status || 'draft',
  };
}

export const Contracts = {
  list({ q = '' } = {}) {
    if (q) {
      const like = `%${q}%`;
      return db
        .prepare(
          `SELECT id, contract_no, status, client_name, site_address, showroom, salesperson, contract_date, total_amount, updated_at
           FROM contracts
           WHERE client_name LIKE ? OR site_address LIKE ? OR contract_no LIKE ? OR showroom LIKE ? OR salesperson LIKE ?
           ORDER BY updated_at DESC`
        )
        .all(like, like, like, like, like);
    }
    return db
      .prepare(
        `SELECT id, contract_no, status, client_name, site_address, showroom, salesperson, contract_date, total_amount, updated_at
         FROM contracts ORDER BY updated_at DESC`
      )
      .all();
  },

  get(id) {
    const row = db.prepare(`SELECT * FROM contracts WHERE id = ?`).get(id);
    if (!row) return null;
    return { ...row, data: JSON.parse(row.data) };
  },

  create(data = {}) {
    const year = (data.contractDate?.slice(0, 4)) || String(new Date().getFullYear());
    const contractNo = data.contractNo || nextContractNo(year);
    const s = summarize(data);
    const info = db
      .prepare(
        `INSERT INTO contracts (contract_no, status, client_name, site_address, showroom, salesperson, contract_date, total_amount, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(contractNo, s.status, s.client_name, s.site_address, s.showroom, s.salesperson, s.contract_date, s.total_amount, JSON.stringify(data));
    return this.get(info.lastInsertRowid);
  },

  update(id, data = {}) {
    const s = summarize(data);
    db.prepare(
      `UPDATE contracts
       SET status = ?, client_name = ?, site_address = ?, showroom = ?, salesperson = ?, contract_date = ?, total_amount = ?, data = ?,
           updated_at = datetime('now','localtime')
       WHERE id = ?`
    ).run(s.status, s.client_name, s.site_address, s.showroom, s.salesperson, s.contract_date, s.total_amount, JSON.stringify(data), id);
    return this.get(id);
  },

  remove(id) {
    return db.prepare(`DELETE FROM contracts WHERE id = ?`).run(id).changes > 0;
  },
};

export default db;
