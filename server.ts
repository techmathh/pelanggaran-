import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  canCreateRole,
  canDeleteAccount,
  canEditAccountProfile,
  canModifyViolationRow,
  getScheduleStatus,
  isManagerRole,
  parseBulkAccountEntries,
  validateDailySessionInput,
  validateNewPassword,
  validateOfficerScheduleInput,
  validatePresetInput,
  validateViolationInput,
} from './src/shared/piketLogic';
import type {
  HariPiket,
  Officer,
  RolePetugas,
  StudentImportEntry,
  StudentImportMode,
  SystemBackupPayload,
  ViolationPreset,
} from './src/shared/types';
import {
  addCustomStudentRecord,
  addPresetRecord,
  autoDistributePetugasWeeksRecord,
  closeSpreadsheetManuallyInDb,
  createAccountsBulk,
  deleteAccountRecord,
  deleteCustomStudentRecord,
  deletePresetRecord,
  deleteViolationInDb,
  exportSystemBackupPayload,
  findAccountById,
  findAccountByUsername,
  getDatabase,
  getPublicAppState,
  getPublicMeta,
  getSessionSyncSnapshot,
  importStudentsRosterRecord,
  recordViolationInDb,
  reopenSpreadsheetInDb,
  resetAccountTemporaryPassword,
  resetAllDataExceptSelf,
  restoreSystemBackupPayload,
  sanitizeOfficer,
  setDailySessionConfigRecord,
  setSimulationConfig,
  setWeeklyRotationConfigRecord,
  signSessionToken,
  syncAutoDailySpreadsheets,
  updateAccountPassword,
  updateAccountProfileRecord,
  updateAccountScheduleRecord,
  updatePresetRecord,
  updateViolationInDb,
  verifyPassword,
  verifySessionToken,
  type SessionTokenPayload,
} from './src/server/database';

const PORT = Number(process.env.PORT) || 3000;

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
    res.status(401).json({
      error: 'Akun Anda telah dihapus oleh pengelola sistem. Sesi otomatis keluar.',
      accountDeleted: true,
    });
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
  syncAutoDailySpreadsheets(new Date());
  const autoLifecycleTimer = setInterval(() => {
    try {
      syncAutoDailySpreadsheets(new Date());
    } catch (err) {
      console.error('Auto spreadsheet sync failed:', err);
    }
  }, 15_000);
  autoLifecycleTimer.unref?.();

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.length === 0) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
    } else if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Health check (verifies SQLite readiness for Railway healthcheck)
  app.get('/api/health', (_req, res) => {
    try {
      getDatabase().prepare('SELECT 1').get();
      res.json({ ok: true, db: 'sqlite' });
    } catch {
      res.status(503).json({ ok: false, db: 'unavailable' });
    }
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

  // Session & live state sync endpoint (lightweight stateVersion check avoids resending full state when unchanged)
  app.get('/api/auth/session', requireAnySession, (req: AuthedRequest, res) => {
    const account = req.account!;
    const mustChange = Boolean(account.mustChangePassword);
    const includeFullState = !mustChange && req.auth?.scope === 'full';
    if (!includeFullState) {
      res.json({
        ok: true,
        officer: sanitizeOfficer(account),
        requiresPasswordChange: mustChange,
      });
      return;
    }

    const clientVersion = typeof req.query.v === 'string' ? req.query.v.trim() : undefined;
    const sync = getSessionSyncSnapshot(clientVersion);
    res.json({
      ok: true,
      officer: sanitizeOfficer(account),
      requiresPasswordChange: false,
      unchanged: sync.unchanged,
      stateVersion: sync.stateVersion,
      serverDate: sync.serverDate,
      serverTime: sync.serverTime,
      serverHari: sync.serverHari,
      ...(sync.state ? { state: sync.state } : {}),
    });
  });

  // Full sanitized application state (authenticated)
  app.get('/api/state', requireFullAuth, (req: AuthedRequest, res) => {
    res.json({
      officer: sanitizeOfficer(req.account!),
      state: getPublicAppState(),
    });
  });

  // Record a new student violation (requires today's auto-opened ACTIVE spreadsheet)
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
      saveToStudentDirectory,
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
      saveToStudentDirectory?: boolean;
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
      const result = recordViolationInDb(
        officer,
        input,
        now,
        Boolean(saveToStudentDirectory)
      );
      res.json(result);
    } catch (err: any) {
      res.status(409).json({
        error: err?.message || 'Spreadsheet hari ini sudah final.',
      });
    }
  });

  // Edit an existing violation entry (only while spreadsheet is ACTIVE, officer is on schedule, and owns the row or is Admin/Developer)
  app.put('/api/violations/:spreadsheetId/:violationId', requireFullAuth, (req: AuthedRequest, res) => {
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
        error: 'Tidak dapat mengubah baris di luar jadwal piket Anda.',
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

    const targetRow = sheet.rows.find((r) => r.id === violationId);
    if (!targetRow) {
      res.status(404).json({ error: 'Baris pelanggaran tidak ditemukan.' });
      return;
    }

    if (!canModifyViolationRow(officer, targetRow)) {
      res.status(403).json({
        error: 'Anda hanya dapat mengubah baris pelanggaran yang Anda catat sendiri.',
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
      studentName: studentName ?? targetRow.studentName,
      studentNis: studentNis ?? targetRow.studentNis,
      kelas: kelas ?? targetRow.kelas,
      violationCode: violationCode ?? targetRow.violationCode,
      violationLabel: violationLabel ?? targetRow.violationLabel,
      category: (category as any) ?? targetRow.category,
      points: points !== undefined ? Number(points) : targetRow.points,
      actionTaken: actionTaken ?? targetRow.actionTaken,
      notes: notes ?? targetRow.notes,
    };

    const validationError = validateViolationInput(input);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    try {
      const state = updateViolationInDb(spreadsheetId, violationId, input);
      res.json({ state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Gagal memperbarui baris pelanggaran.' });
    }
  });

  // Delete a violation entry (only while spreadsheet is ACTIVE, officer is on schedule, and owns the row or is Admin/Developer)
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

    const targetRow = sheet.rows.find((r) => r.id === violationId);
    if (!targetRow) {
      res.status(404).json({ error: 'Baris pelanggaran tidak ditemukan.' });
      return;
    }

    if (!canModifyViolationRow(officer, targetRow)) {
      res.status(403).json({
        error: 'Anda hanya dapat menghapus baris pelanggaran yang Anda catat sendiri.',
      });
      return;
    }

    const state = deleteViolationInDb(spreadsheetId, violationId);
    res.json({ state });
  });

  // Developer / Admin: manually close & finalize a reopened spreadsheet
  app.post('/api/spreadsheets/:id/close', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (!isManagerRole(requester.role)) {
      res.status(403).json({
        error: 'Hanya Developer atau Admin yang dapat menutup dan memfinalkan spreadsheet.',
      });
      return;
    }
    try {
      const state = closeSpreadsheetManuallyInDb(req.params.id, new Date().toISOString());
      res.json({ state });
    } catch (err: any) {
      res.status(404).json({ error: err?.message || 'Spreadsheet tidak ditemukan.' });
    }
  });

  // Developer / Admin: reopen finalized spreadsheet for revision
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

  // Developer / Admin: edit account profile (name, kelas, division, and role if Developer)
  app.put('/api/accounts/:id', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    const target = findAccountById(req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Akun tidak ditemukan.' });
      return;
    }

    if (!canEditAccountProfile(requester.role, requester.id, target)) {
      res.status(403).json({
        error:
          requester.role === 'admin'
            ? 'Admin hanya dapat mengedit profil akun Petugas Piket atau akun sendiri.'
            : 'Anda tidak memiliki izin untuk mengedit akun ini.',
      });
      return;
    }

    const { name, kelas, division, role } = req.body as {
      name?: string;
      kelas?: string;
      division?: string;
      role?: 'admin' | 'petugas';
    };

    if (name !== undefined && !name.trim()) {
      res.status(400).json({ error: 'Nama lengkap akun tidak boleh kosong.' });
      return;
    }
    if (kelas !== undefined && !kelas.trim()) {
      res.status(400).json({ error: 'Kelas akun tidak boleh kosong.' });
      return;
    }
    if (division !== undefined && !division.trim()) {
      res.status(400).json({ error: 'Divisi atau sekbid akun tidak boleh kosong.' });
      return;
    }

    if (role !== undefined && role !== target.role) {
      if (requester.role !== 'developer') {
        res.status(403).json({ error: 'Hanya Developer yang dapat mengubah role akun.' });
        return;
      }
      if (target.isProtected || target.role === 'developer') {
        res.status(403).json({ error: 'Role akun Developer utama tidak dapat diubah.' });
        return;
      }
    }

    try {
      const state = updateAccountProfileRecord(target.id, {
        name,
        kelas,
        division,
        role: requester.role === 'developer' ? role : undefined,
      });
      res.json({ state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Gagal memperbarui profil akun.' });
    }
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

  // Developer / Admin: delete account (strictly protects permanent developer account & cleans active consensus)
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

    const nextDays = scheduledDays !== undefined ? scheduledDays : target.scheduledDays;
    const nextStart = shiftStart !== undefined ? shiftStart : target.shiftStart;
    const nextEnd = shiftEnd !== undefined ? shiftEnd : target.shiftEnd;

    const scheduleValidationError = validateOfficerScheduleInput({
      scheduledDays: nextDays,
      shiftStart: nextStart,
      shiftEnd: nextEnd,
    });
    if (scheduleValidationError) {
      res.status(400).json({ error: scheduleValidationError });
      return;
    }

    const state = updateAccountScheduleRecord(
      target.id,
      nextDays,
      nextStart,
      nextEnd,
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

    const selectedCat = category || 'F. Pelanggaran Lain-lain';
    const presetValidationError = validatePresetInput({
      label,
      category: selectedCat,
      points: Number(points),
    });
    if (presetValidationError) {
      res.status(400).json({ error: presetValidationError });
      return;
    }

    const prefix = selectedCat.charAt(0) || 'F';
    const currentPresets = getPublicAppState().presets;
    const nextNum = currentPresets.filter((p) => p.category === selectedCat).length + 1;

    const preset: ViolationPreset = {
      id: `pre-${Date.now()}`,
      code: code?.trim().toUpperCase() || `${prefix}${nextNum}`,
      label: label!.trim(),
      category: selectedCat,
      points: Math.round(Number(points)),
      defaultAction: defaultAction?.trim() || 'Catat & teguran lisan',
    };

    const state = addPresetRecord(preset);
    res.json({ state });
  });

  // Developer / Admin: update violation preset
  app.put('/api/presets/:id', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (!isManagerRole(requester.role)) {
      res.status(403).json({
        error: 'Hanya Developer atau Admin yang dapat mengubah aturan pelanggaran.',
      });
      return;
    }

    const existing = getPublicAppState().presets.find((p) => p.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Aturan pelanggaran tidak ditemukan.' });
      return;
    }

    const { code, label, category, points, defaultAction } = req.body as {
      code?: string;
      label?: string;
      category?: ViolationPreset['category'];
      points?: number;
      defaultAction?: string;
    };

    const mergedLabel = label !== undefined ? label : existing.label;
    const mergedCategory = category !== undefined ? category : existing.category;
    const mergedPoints = points !== undefined ? Number(points) : existing.points;

    const presetValidationError = validatePresetInput({
      label: mergedLabel,
      category: mergedCategory,
      points: mergedPoints,
    });
    if (presetValidationError) {
      res.status(400).json({ error: presetValidationError });
      return;
    }

    try {
      const state = updatePresetRecord(req.params.id, {
        code,
        label: mergedLabel,
        category: mergedCategory,
        points: mergedPoints,
        defaultAction,
      });
      res.json({ state });
    } catch (err: any) {
      res.status(404).json({ error: err?.message || 'Aturan tidak ditemukan.' });
    }
  });

  // Developer / Admin: delete violation preset
  app.delete('/api/presets/:id', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (!isManagerRole(requester.role)) {
      res.status(403).json({
        error: 'Hanya Developer atau Admin yang dapat menghapus aturan pelanggaran.',
      });
      return;
    }

    try {
      const state = deletePresetRecord(req.params.id);
      res.json({ state });
    } catch (err: any) {
      res.status(404).json({ error: err?.message || 'Aturan tidak ditemukan.' });
    }
  });

  // Developer / Admin: add custom student to school directory
  app.post('/api/students', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (!isManagerRole(requester.role)) {
      res.status(403).json({
        error: 'Hanya Developer atau Admin yang dapat menambah data siswa.',
      });
      return;
    }

    const { name, kelas, nis } = req.body as {
      name?: string;
      kelas?: string;
      nis?: string;
    };

    try {
      const state = addCustomStudentRecord({
        name: name ?? '',
        kelas: kelas ?? '',
        nis: nis ?? '',
      });
      res.json({ state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Gagal menambah siswa.' });
    }
  });

  // Developer / Admin: bulk import student roster from parsed Excel/CSV entries
  app.post('/api/students/import', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (!isManagerRole(requester.role)) {
      res.status(403).json({
        error: 'Hanya Developer atau Admin yang dapat mengimpor roster siswa.',
      });
      return;
    }

    const { mode, students } = (req.body ?? {}) as {
      mode?: StudentImportMode;
      students?: StudentImportEntry[];
    };

    if (mode !== 'append' && mode !== 'replace_all') {
      res.status(400).json({ error: 'Mode import roster siswa tidak valid.' });
      return;
    }
    if (!Array.isArray(students) || students.length === 0) {
      res.status(400).json({ error: 'Daftar siswa yang akan diimpor tidak boleh kosong.' });
      return;
    }
    if (students.length > 5000) {
      res.status(400).json({ error: 'Maksimal 5.000 baris siswa per proses import.' });
      return;
    }

    try {
      const result = importStudentsRosterRecord({ mode, entries: students });
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Gagal mengimpor roster siswa.' });
    }
  });

  // Developer / Admin: delete custom student from school directory (official 610 roster is protected unless replaced)
  app.delete('/api/students/:id', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (!isManagerRole(requester.role)) {
      res.status(403).json({
        error: 'Hanya Developer atau Admin yang dapat menghapus data siswa tambahan.',
      });
      return;
    }

    try {
      const state = deleteCustomStudentRecord(req.params.id);
      res.json({ state });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Gagal menghapus siswa.' });
    }
  });

  // Developer-only: export portable JSON backup
  app.get('/api/backup/export', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (requester.role !== 'developer') {
      res.status(403).json({
        error: 'Hanya akun Developer yang dapat mengunduh cadangan sistem penuh.',
      });
      return;
    }

    const backup = exportSystemBackupPayload();
    res.json({ backup });
  });

  // Developer-only: restore portable JSON backup (from local file or Firestore snapshot)
  app.post('/api/backup/restore', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (requester.role !== 'developer') {
      res.status(403).json({
        error: 'Hanya akun Developer yang dapat memulihkan cadangan sistem penuh.',
      });
      return;
    }

    const { backup } = (req.body ?? {}) as { backup?: SystemBackupPayload };
    if (!backup || typeof backup !== 'object' || !Array.isArray(backup.spreadsheets)) {
      res.status(400).json({
        error: 'Format data cadangan tidak valid atau rusak.',
      });
      return;
    }

    try {
      const result = restoreSystemBackupPayload(backup, requester.id);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(400).json({
        error: err?.message || 'Gagal memulihkan cadangan data.',
      });
    }
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

  // Developer / Admin: configure automatic daily spreadsheet open/close schedule
  app.put('/api/settings/daily-session', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (!isManagerRole(requester.role)) {
      res.status(403).json({
        error: 'Hanya Developer atau Admin yang dapat mengatur jadwal otomatis spreadsheet.',
      });
      return;
    }

    const { activeDays, startTime, endTime, syncOfficers } = req.body as {
      activeDays?: HariPiket[];
      startTime?: string;
      endTime?: string;
      syncOfficers?: boolean;
    };

    const validationError = validateDailySessionInput({ activeDays, startTime, endTime });
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const state = setDailySessionConfigRecord(
      {
        activeDays: activeDays!,
        startTime: startTime!,
        endTime: endTime!,
      },
      syncOfficers !== false,
      new Date()
    );
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

  // Developer-only: reset/delete all system data except the calling developer account itself
  app.post('/api/developer/reset-all', requireFullAuth, (req: AuthedRequest, res) => {
    const requester = req.account!;
    if (requester.role !== 'developer') {
      res.status(403).json({
        error: 'Hanya akun Developer yang dapat mereset seluruh data sistem.',
      });
      return;
    }

    const { confirmText } = (req.body ?? {}) as { confirmText?: string };
    if ((confirmText ?? '').trim().toUpperCase() !== 'RESET DATA') {
      res.status(400).json({
        error: 'Ketik RESET DATA dengan benar untuk mengonfirmasi penghapusan seluruh data.',
      });
      return;
    }

    const result = resetAllDataExceptSelf(requester.id);
    res.json({ ok: true, ...result });
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
