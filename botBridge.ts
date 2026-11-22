/**
 * botBridge.ts – jembatan HANYA-BACA antara backend SiPiket/Pelanggaran dan Bot WhatsApp OSIS.
 *
 * Fungsi: bot memakai token tetap (BOT_BRIDGE_TOKEN) sehingga tidak perlu akun/password, tidak terkena
 * kedaluwarsa sesi 12 jam, dan hanya menerima data minimum (pelanggaran pada tanggal tertentu).
 *
 * Pemasangan (2 baris di server.ts, setelah route /api/health):
 *
 *   import { registerBotBridge } from './botBridge';
 *   ...
 *   registerBotBridge(app, { getPublicAppState, getStateVersion, getDatabase });
 *
 * (ketiganya sudah diimpor di server.ts dari './src/server/database'; tambahkan `getStateVersion` bila belum.)
 * Lalu isi variabel BOT_BRIDGE_TOKEN (acak, minimal 24 karakter) di environment backend. Tanpa token, bridge nonaktif.
 *
 * Endpoint (semua butuh header  Authorization: Bearer <BOT_BRIDGE_TOKEN>):
 *   GET /api/bot/ping                    status server, tanggal/jam server, versi data, mode simulasi
 *   GET /api/bot/perubahan?since=<ver>   murah: apakah data berubah sejak versi tertentu
 *   GET /api/bot/laporan?date=YYYY-MM-DD pelanggaran pada tanggal itu + poin akumulasi siswa terkait
 */
import crypto from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';

interface BridgeRow {
  id: string;
  timestamp: string;
  timeLabel: string;
  studentName: string;
  kelas: string;
  violationCode: string;
  violationLabel: string;
  category: string;
  points: number;
  actionTaken: string;
  notes: string;
  recordedByName: string;
}

interface BridgeSheet {
  id: string;
  date: string;
  title: string;
  hari: string;
  status: string;
  activeOfficers: string[];
  finishedOfficers: string[];
  rows: BridgeRow[];
}

interface BridgeState {
  serverDate: string;
  serverTime: string;
  serverHari: string;
  simulation: { enabled: boolean };
  spreadsheets: BridgeSheet[];
}

export interface BotBridgeDeps {
  getPublicAppState: () => BridgeState;
  getStateVersion: () => string;
  getDatabase: () => { prepare: (sql: string) => { get: () => unknown } };
}

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const sha = (s: string): Buffer => crypto.createHash('sha256').update(s).digest();

function tanggalValid(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === s;
}

// Identitas siswa = sama dengan website (nama huruf kecil + kelas huruf besar)
const keySiswa = (r: { studentName: string; kelas: string }): string =>
  `${String(r.studentName).toLowerCase()}__${String(r.kelas).toUpperCase()}`;

const tingkat = (poin: number): string =>
  poin >= 100 ? 'Surat Pernyataan Bermaterai (≥ 100)'
  : poin >= 76 ? 'Panggilan Orang Tua 3 (76–99)'
  : poin >= 51 ? 'Surat Pernyataan 2 & Panggilan Orang Tua 2 (51–75)'
  : poin >= 26 ? 'Surat Pernyataan 1 & Panggilan Orang Tua 1 (26–50)'
  : poin >= 15 ? 'Teguran Lisan (15–25)'
  : 'Pembinaan Awal (< 15)';

/** Mengembalikan true jika bridge aktif. */
export function registerBotBridge(app: Express, deps: BotBridgeDeps): boolean {
  const token = (process.env.BOT_BRIDGE_TOKEN || '').trim();
  if (token.length < 24) {
    console.warn('[BotBridge] Nonaktif: isi BOT_BRIDGE_TOKEN (acak, minimal 24 karakter) untuk mengaktifkan.');
    return false;
  }
  const expected = sha(token);

  // Pembatas laju sederhana per IP (120 permintaan/menit, 20 gagal-autentikasi/menit)
  const hits = new Map<string, { n: number; gagal: number; reset: number }>();
  const guard = (req: Request, res: Response, next: NextFunction): void => {
    res.set('Cache-Control', 'no-store');
    const ip = req.ip || 'unknown';
    const now = Date.now();
    if (hits.size > 1000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    let h = hits.get(ip);
    if (!h || h.reset < now) {
      h = { n: 0, gagal: 0, reset: now + 60_000 };
      hits.set(ip, h);
    }
    h.n++;
    if (h.n > 120 || h.gagal > 20) {
      res.status(429).json({ ok: false, error: 'Terlalu banyak permintaan.' });
      return;
    }
    const auth = req.get('authorization') || '';
    const given = /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '').trim() : req.get('x-bot-token') || '';
    if (!crypto.timingSafeEqual(sha(given), expected)) {
      h.gagal++;
      res.status(401).json({ ok: false, error: 'Token bot tidak valid.' });
      return;
    }
    next();
  };

  app.get('/api/bot/ping', guard, (_req: Request, res: Response) => {
    try {
      deps.getDatabase().prepare('SELECT 1').get();
      const st = deps.getPublicAppState();
      res.json({
        ok: true,
        bridge: '1.0',
        serverDate: st.serverDate,
        serverTime: st.serverTime,
        serverHari: st.serverHari,
        simulation: Boolean(st.simulation?.enabled),
        stateVersion: deps.getStateVersion(),
        uptimeSec: Math.round(process.uptime()),
      });
    } catch {
      res.status(503).json({ ok: false, error: 'Database belum siap.' });
    }
  });

  app.get('/api/bot/perubahan', guard, (req: Request, res: Response) => {
    const since = typeof req.query.since === 'string' ? req.query.since : '';
    const version = deps.getStateVersion();
    res.json({ ok: true, version, changed: since !== version });
  });

  app.get('/api/bot/laporan', guard, (req: Request, res: Response) => {
    try {
      const st = deps.getPublicAppState();
      const date = tanggalValid(req.query.date) ? req.query.date : st.serverDate;
      const sheets = st.spreadsheets.filter((s) => s.date === date);

      const rows = new Map<string, BridgeRow>();
      for (const s of sheets) {
        for (const r of s.rows || []) {
          rows.set(r.id, {
            id: r.id, timestamp: r.timestamp, timeLabel: r.timeLabel, studentName: r.studentName, kelas: r.kelas,
            violationCode: r.violationCode, violationLabel: r.violationLabel, category: r.category, points: r.points,
            actionTaken: r.actionTaken, notes: r.notes, recordedByName: r.recordedByName,
          });
        }
      }

      // Poin akumulasi (seluruh riwayat) hanya untuk siswa yang muncul pada tanggal ini
      const target = new Set([...rows.values()].map(keySiswa));
      const total = new Map<string, number>();
      for (const s of st.spreadsheets) {
        for (const r of s.rows || []) {
          const k = keySiswa(r);
          if (target.has(k)) total.set(k, (total.get(k) || 0) + (Number(r.points) || 0));
        }
      }
      const akumulasi: Record<string, { total: number; tier: string }> = {};
      for (const [k, v] of total) akumulasi[k] = { total: v, tier: tingkat(v) };

      const [y, m, d] = date.split('-').map(Number);
      res.json({
        ok: true,
        date,
        hari: HARI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()],
        serverDate: st.serverDate,
        serverTime: st.serverTime,
        simulation: Boolean(st.simulation?.enabled),
        stateVersion: deps.getStateVersion(),
        sheets: sheets.map((s) => ({
          id: s.id, title: s.title, status: s.status, hari: s.hari,
          activeOfficers: s.activeOfficers?.length ?? 0, finishedOfficers: s.finishedOfficers?.length ?? 0,
          rowCount: (s.rows || []).length,
        })),
        rows: [...rows.values()],
        akumulasi,
      });
    } catch {
      res.status(500).json({ ok: false, error: 'Gagal menyusun laporan.' });
    }
  });

  console.log('[BotBridge] Aktif (hanya-baca): /api/bot/ping, /api/bot/perubahan, /api/bot/laporan');
  return true;
}
