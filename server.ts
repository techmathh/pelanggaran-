import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  canCreateRole,
  canDeleteAccount,
  getScheduleStatus,
  isManagerRole,
  parseBulkAccountEntries,
  validateNewPassword,
  validateViolationInput,
} from './src/shared/piketLogic';
import type { HariPiket, Officer, RolePetugas, ViolationPreset } from './src/shared/types';
import {
  addPresetRecord,
  autoDistributePetugasWeeksRecord,
  createAccountsBulk,
  deleteAccountRecord,
  deleteViolationInDb,
  findAccountById,
  findAccountByUsername,
  finishSpreadsheetInDb,
  getDatabase,
  getPublicAppState,
  getPublicMeta,
  recordViolationInDb,
  reopenSpreadsheetInDb,
  resetAccountTemporaryPassword,
  sanitizeOfficer,
  setSimulationConfig,
  setWeeklyRotationConfigRecord,
  signSessionToken,
  startOrJoinTodaySpreadsheet,
  updateAccountPassword,
  updateAccountScheduleRecord,
  verifyPassword,
  verifySessionToken,
  type SessionTokenPayload,
} from './src/server/database';

const PORT = 3000;

interface AuthedRequest extends Request {
  auth?: SessionTokenPayload;
  account?: Officer;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

function requireAnySession(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Sesi login tidak ditemukan. Silakan masuk kembali.' });
    return;
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Sesi login telah kedaluwarsa. Silakan masuk kembali.' });
    return;
  }
  const account = findAccountById(payload.sub);
  if (!account) {
    res.status(401).json({ error: 'Akun tidak ditemukan atau sudah dihapus.' });
    return;
  }
  req.auth = payload;
  req.account = account;
  next();
}

function requireFullAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  requireAnySession(req, res, () => {
    if (req.auth?.scope !== 'full' || req.account?.mustChangePassword) {
      res.status(403).json({
        error: 'Anda wajib mengganti password sementara terlebih dahulu sebelum mengakses sistem.',
        requiresPasswordChange: true,
      });
      return;
    }
    next();
  });
}

async function startServer() {
  // Initialize SQLite database & ensure permanent protected developer account + official AKPS presets
  getDatabase();

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Public metadata for login screen (zero dummy or user data exposed)
  app.get('/api/public-meta', (_req, res) => {
    res.json(getPublicMeta());
  });

  // Login endpoint
  app.post('/api/auth/login', (req, res) => {
    const { username, password, pin } = req.body as {
      username?: string;
      password?: string;
      pin?: string;
    };
    const rawPassword = (password ?? pin ?? '').trim();
    if (!username?.trim() || !rawPassword) {
      res.status(400).json({ error: 'Username dan password wajib diisi.' });
      return;
    }

    const account = findAccountByUsername(username);
    if (!account || !account.passwordHash || !verifyPassword(rawPassword, account.passwordHash)) {
      res.status(401).json({ error: 'Username atau password tidak valid.' });
      return;
    }

    if (account.mustChangePassword) {
      const tempToken = signSessionToken(account, 'password_change_only');
      res.json({
        requiresPasswordChange: true,
        token: tempToken,
        officer: sanitizeOfficer(account),
      });
      return;
    }

    const fullToken = signSessionToken(account, 'full');
    const state = getPublicAppState();
    const scheduleStatus = getScheduleStatus(
      account,
      new Date(),
      state.simulation,
      state.weeklySchedule
    );

    res.json({
      requiresPasswordChange: false,
      token: fullToken,
      officer: sanitizeOfficer(account),
      scheduleStatus,
      state,
    });
  });

  // Mandatory first-login (or voluntary) password change — invalidates old password
  app.post('/api/auth/change-password', requireAnySession, (req: AuthedRequest, res) => {
    const account = req.account!;
    const { currentPassword, newPassword, confirmPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
      confirmPassword?: string;
    };

    const current = (currentPassword ?? '').trim();
    if (!current || !account.passwordHash || !verifyPassword(current, account.passwordHash)) {
      res.status(401).json({ error: 'Password saat ini tidak sesuai.' });
      return;
    }

    const validationError = validateNewPassword(
      newPassword ?? '',
      confirmPassword ?? '',
      current
    );
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const updatedOfficer = updateAccountPassword(account.id, (newPassword ?? '').trim());
    const fullToken = signSessionToken(
      { id: updatedOfficer.id, role: updatedOfficer.role },
      'full'
    );
    const state = getPublicAppState();
    const scheduleStatus = getScheduleStatus(
      updatedOfficer,
      new Date(),
      state.simulation,
      state.weeklySchedule
    );

    res.json({
      token: fullToken,
      officer: updatedOfficer,
      scheduleStatus,
      state,
    });
  });

  // Full sanitized application state (authenticated)
  app.get('/api/state', requireFullAuth, (req: AuthedRequest, res) => {
    res.json({
      officer: sanitizeOfficer(req.account!),
      state: getPublicAppState(),
    });
  });

  // Explicitly start / create or join today's spreadsheet session
  app.post('/api/spreadsheets/start', requireFullAuth, (req: AuthedRequest, res) => {
    const officer = req.account!;
    const now = new Date();
    const stateBefore = getPublicAppState();
    const scheduleStatus = getScheduleStatus(
      officer,
      now,
      stateBefore.simulation,
      stateBefore.weeklySchedule
    );

    if (!scheduleStatus.allowed) {
      res.status(403).json({
        error: `Akses pencatatan ditolak: ${scheduleStatus.reason}`,
      });
      return;
    }

    const result = startOrJoinTodaySpreadsheet(officer, now);
    res.json(result);
  });

  // Record a new student violation (auto-creates today's spreadsheet if first record of the day)
  app.post('/api/violations', requireFullAuth, (req: AuthedRequest, res) => {
    const officer = req.account!;
    const now = new Date();
    const stateBefore = getPublicAppState();
    const scheduleStatus = getScheduleStatus(
      officer,
      now,
      stateBefore.simulation,
      stateBefore.weeklySchedule
    );

    if (!scheduleStatus.allowed) {
      res.status(403).json({
        error: `Anda hanya dapat mencatat saat jadwal piket Anda. ${scheduleStatus.reason}`,
      });
      return;
    }

    const {
      studentName,
      studentNis,
      kelas,
      violationCode,
      violationLabel,
      category,
      points,
      actionTaken,
      notes,
    } = req.body as {
      studentName?: string;
      studentNis?: string;
      kelas?: string;
      violationCode?: string;
      violationLabel?: string;
      category?: string;
      points?: number;
      actionTaken?: string;
      notes?: string;
    };

    const input = {
      studentName: studentName ?? '',
      studentNis: studentNis ?? '',
      kelas: kelas ?? '',
      violationCode: violationCode ?? 'CUSTOM',
      violationLabel: violationLabel ?? '',
      category: (category as any) ?? 'A. Kedisiplinan & Kehadiran',
      points: Number(points ?? 0),
      actionTaken: actionTaken ?? '',
      notes: notes ?? '',
    };

    const validationError = validateViolationInput(input);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    try {
      const result = recordViolationInDb(officer, input, now);
      res.json(result);
    } catch (err: any) {
      res.status(409).json({
        error: err?.message || 'Spreadsheet hari ini sudah final.',
      });
    }
  });

  // Delete a violation entry (only while spreadsheet is ACTIVE and officer is on schedule)
  app.delete('/api/violations/:spreadsheetId/:violationId', requireFullAuth, (req: AuthedRequest, res) => {
    const officer = req.account!;
    const { spreadsheetId, violationId } = req.params;
    const stateBefore = getPublicAppState();
    const scheduleStatus = getScheduleStatus(
      officer,
      new Date(),
      stateBefore.simulation,
      stateBefore.weeklySchedule
    );

    if (!scheduleStatus.allowed) {
      res.status(403).json({
        error: 'Tidak dapat menghapus baris di luar jadwal piket Anda.',
      });
      return;
    }

    const sheet = stateBefore.spreadsheets.find((s) => s.id === spreadsheetId);
    if (!sheet) {
      res.status(404).json({ error: 'Spreadsheet tidak ditemukan.' });
      return;
    }
    if (sheet.status === 'FINALIZED') {
      res.status(409).json({ error: 'Spreadsheet sudah final dan tidak bisa diubah.' });
      return;
    }

    const state = deleteViolationInDb(spreadsheetId, violationId);
    res.json({ state });
  });

  // Officer presses "Selesai" (or cancels their Selesai while still ACTIVE)
  app.post('/api/spreadsheets/:id/finish', requireFullAuth, (req: AuthedRequest, res) => {
    const officer = req.account!;
    const { id } = req.params;
    const { finished } = req.body as { finished?: boolean };

    const now = new Date();
    const stateBefore = getPublicAppState();
    const scheduleStatus = getScheduleStatus(
      officer,
      now,
      stateBefore.simulation,
      stateBefore.weeklySchedule
    );

    if (!scheduleStatus.allowed) {
      res.status(403).json({
        error: `Hanya petugas yang sedang terjadwal dapat menyelesaikan sesi. ${scheduleStatus.reason}`,
      });
      return;
    }

    try {
      const result = finishSpreadsheetInDb(id, officer.id, finished !== false, now.toISOString());
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Gagal menyelesaikan sesi.' });
    }
  });

  // Developer / Admin: reopen finalized spreadsheet
  app.post('/api/spreadsheets/:id/reopen', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (!isManagerRole(requester.role)) {
      res.status(403).json({
        error: 'Hanya Developer atau Admin yang dapat membuka kembali sesi final.',
      });
      return;
    }
    try {
      const state = reopenSpreadsheetInDb(req.params.id);
      res.json({ state });
    } catch (err: any) {
      res.status(404).json({ error: err?.message || 'Spreadsheet tidak ditemukan.' });
    }
  });

  // Developer / Admin: bulk account creation from full names (auto-generates username + password)
  app.post('/api/accounts/bulk', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    const {
      namesText,
      role,
      division,
      defaultKelas,
      scheduledDays,
      scheduledWeeks,
      rotationMode,
      shiftStart,
      shiftEnd,
    } = req.body as {
      namesText?: string;
      role?: RolePetugas;
      division?: string;
      defaultKelas?: string;
      scheduledDays?: HariPiket[];
      scheduledWeeks?: number[];
      rotationMode?: 'auto_split' | 'all' | 'custom';
      shiftStart?: string;
      shiftEnd?: string;
    };

    const targetRole: RolePetugas = role ?? 'petugas';
    if (!canCreateRole(requester.role, targetRole)) {
      res.status(403).json({
        error:
          requester.role === 'admin'
            ? 'Admin hanya diperbolehkan membuat akun dengan role Petugas Piket.'
            : 'Anda tidak memiliki izin untuk membuat role tersebut.',
      });
      return;
    }

    const entries = parseBulkAccountEntries(namesText ?? '');
    if (entries.length === 0) {
      res.status(400).json({
        error: 'Masukkan minimal satu nama lengkap (satu nama per baris).',
      });
      return;
    }
    if (entries.length > 200) {
      res.status(400).json({ error: 'Maksimal 200 akun dalam satu kali pembuatan massal.' });
      return;
    }

    const validDays =
      Array.isArray(scheduledDays) && scheduledDays.length > 0
        ? scheduledDays
        : (['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] as HariPiket[]);

    const result = createAccountsBulk({
      entries,
      role: targetRole as 'admin' | 'petugas',
      creatorId: requester.id,
      division: division?.trim() || '',
      defaultKelas: defaultKelas?.trim().toUpperCase() || '',
      scheduledDays: validDays,
      scheduledWeeks,
      rotationMode,
      shiftStart: shiftStart || '06:30',
      shiftEnd: shiftEnd || '08:30',
    });

    res.json(result);
  });

  // Developer / Admin: reset password of a subordinate account (generates new temp password + forces change)
  app.post('/api/accounts/:id/reset-password', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (!isManagerRole(requester.role)) {
      res.status(403).json({ error: 'Akses ditolak.' });
      return;
    }

    const target = findAccountById(req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Akun tidak ditemukan.' });
      return;
    }

    if (target.isProtected || target.role === 'developer') {
      res.status(403).json({
        error: 'Password akun Developer utama hanya dapat diubah langsung oleh Developer melalui ganti password.',
      });
      return;
    }

    if (requester.role === 'admin' && target.role !== 'petugas') {
      res.status(403).json({
        error: 'Admin hanya dapat mereset password akun Petugas Piket.',
      });
      return;
    }

    const result = resetAccountTemporaryPassword(target.id);
    res.json(result);
  });

  // Developer / Admin: delete account (strictly protects permanent developer account)
  app.delete('/api/accounts/:id', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    const target = findAccountById(req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Akun tidak ditemukan.' });
      return;
    }

    if (target.isProtected || target.role === 'developer') {
      res.status(403).json({
        error: 'Akun Developer utama dilindungi oleh sistem dan tidak dapat dihapus.',
      });
      return;
    }

    if (!canDeleteAccount(requester.role, target)) {
      res.status(403).json({
        error:
          requester.role === 'admin'
            ? 'Admin hanya dapat menghapus akun Petugas Piket.'
            : 'Anda tidak memiliki izin untuk menghapus akun ini.',
      });
      return;
    }

    const state = deleteAccountRecord(target.id);
    res.json({ state });
  });

  // Developer / Admin: update account schedule
  app.put('/api/officers/:id/schedule', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (!isManagerRole(requester.role)) {
      res.status(403).json({
        error: 'Hanya Developer atau Admin yang dapat mengubah jadwal piket.',
      });
      return;
    }

    const target = findAccountById(req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Akun tidak ditemukan.' });
      return;
    }

    if (requester.role === 'admin' && target.role !== 'petugas') {
      res.status(403).json({
        error: 'Admin hanya dapat mengubah jadwal Petugas Piket.',
      });
      return;
    }

    const { scheduledDays, scheduledWeeks, shiftStart, shiftEnd } = req.body as {
      scheduledDays?: HariPiket[];
      scheduledWeeks?: number[];
      shiftStart?: string;
      shiftEnd?: string;
    };

    const state = updateAccountScheduleRecord(
      target.id,
      Array.isArray(scheduledDays) ? scheduledDays : target.scheduledDays,
      shiftStart || target.shiftStart,
      shiftEnd || target.shiftEnd,
      Array.isArray(scheduledWeeks) ? scheduledWeeks : target.scheduledWeeks
    );
    res.json({ state });
  });

  // Developer / Admin: add violation preset
  app.post('/api/presets', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (!isManagerRole(requester.role)) {
      res.status(403).json({
        error: 'Hanya Developer atau Admin yang dapat menambah aturan pelanggaran.',
      });
      return;
    }

    const { code, label, category, points, defaultAction } = req.body as {
      code?: string;
      label?: string;
      category?: ViolationPreset['category'];
      points?: number;
      defaultAction?: string;
    };

    if (!label?.trim() || !points || points < 1) {
      res.status(400).json({ error: 'Nama pelanggaran dan poin wajib diisi.' });
      return;
    }

    const selectedCat = category || 'F. Pelanggaran Lain-lain';
    const prefix = selectedCat.charAt(0) || 'F';
    const currentPresets = getPublicAppState().presets;
    const nextNum = currentPresets.filter((p) => p.category === selectedCat).length + 1;

    const preset: ViolationPreset = {
      id: `pre-${Date.now()}`,
      code: code?.trim().toUpperCase() || `${prefix}${nextNum}`,
      label: label.trim(),
      category: selectedCat,
      points: Math.round(points),
      defaultAction: defaultAction?.trim() || 'Catat & teguran lisan',
    };

    const state = addPresetRecord(preset);
    res.json({ state });
  });

  // Developer / Admin: toggle morning clock simulation for testing schedule windows anytime
  app.post('/api/settings/simulation', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (!isManagerRole(requester.role)) {
      res.status(403).json({
        error: 'Hanya Developer atau Admin yang dapat mengubah simulasi waktu.',
      });
      return;
    }

    const { enabled, simulatedTime, simulatedDay, simulatedWeek } = req.body as {
      enabled?: boolean;
      simulatedTime?: string;
      simulatedDay?: HariPiket | null;
      simulatedWeek?: number | null;
    };

    const state = setSimulationConfig({
      enabled: Boolean(enabled),
      simulatedTime: simulatedTime || '07:15',
      simulatedDay: simulatedDay || null,
      simulatedWeek: simulatedWeek && simulatedWeek >= 1 ? Number(simulatedWeek) : null,
    });
    res.json({ state });
  });

  // Developer / Admin: update weekly rotation cycle length or switch active week
  app.post('/api/settings/weekly-schedule', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (!isManagerRole(requester.role)) {
      res.status(403).json({
        error: 'Hanya Developer atau Admin yang dapat mengatur jadwal mingguan.',
      });
      return;
    }

    const { cycleWeeks, activeWeek } = req.body as {
      cycleWeeks?: number;
      activeWeek?: number;
    };

    const state = setWeeklyRotationConfigRecord({ cycleWeeks, activeWeek }, new Date());
    res.json({ state });
  });

  // Developer / Admin: auto-distribute all petugas evenly across weekly rotation groups
  app.post('/api/settings/weekly-schedule/auto-distribute', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (!isManagerRole(requester.role)) {
      res.status(403).json({
        error: 'Hanya Developer atau Admin yang dapat membagi jadwal mingguan otomatis.',
      });
      return;
    }

    const { cycleWeeks } = req.body as { cycleWeeks?: number };
    const state = autoDistributePetugasWeeksRecord(cycleWeeks);
    res.json({ state });
  });

  // Mount Vite middleware in dev, or serve dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SiPiket OSIS server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
