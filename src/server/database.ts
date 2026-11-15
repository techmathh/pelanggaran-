import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ALL_ROTATION_WEEKS,
  HARI_LIST,
  addViolationToSpreadsheet,
  assignWeeklyRotationDistribution,
  clampCycleWeeks,
  createOrJoinDailySpreadsheet,
  formatDateKey,
  generateUniqueUsername,
  getEffectiveClock,
  getMondayDateKey,
  shiftAnchorMondayForTargetWeek,
  toggleOfficerFinished,
  type AddViolationInput,
} from '../shared/piketLogic';
import type {
  DailySpreadsheet,
  GeneratedAccountCredential,
  HariPiket,
  Officer,
  PublicAppState,
  PublicMetaState,
  PublicOfficer,
  RolePetugas,
  SimulationConfig,
  StudentRecord,
  ViolationEntry,
  ViolationPreset,
  WeeklyRotationConfig,
} from '../shared/types';
import { DEVELOPER_BOOTSTRAP, OFFICIAL_AKPS_PRESETS } from './seedData';
import { SMAN1_KEMANGKON_STUDENTS } from './studentRoster';

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');
const SQLITE_PATH = path.join(DATA_DIR, 'sipiket.db');

const AVATAR_PALETTE = ['#2563EB', '#0D9488', '#D97706', '#4F46E5', '#DB2777', '#059669'];
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

let dbInstance: DatabaseSync | null = null;
let cachedSessionSecret: string | null = null;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

export function generateTemporaryPassword(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PASSWORD_CHARS[crypto.randomInt(0, PASSWORD_CHARS.length)];
  }
  return out;
}

export interface SessionTokenPayload {
  sub: string;
  role: RolePetugas;
  scope: 'full' | 'password_change_only';
  exp: number;
}

function getSessionSecret(db: DatabaseSync): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (cachedSessionSecret) return cachedSessionSecret;

  const row = db
    .prepare('SELECT value_json FROM app_settings WHERE key = ?')
    .get('session_secret') as { value_json: string } | undefined;

  if (row) {
    cachedSessionSecret = JSON.parse(row.value_json) as string;
    return cachedSessionSecret;
  }

  const secret = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value_json) VALUES (?, ?)').run(
    'session_secret',
    JSON.stringify(secret)
  );
  cachedSessionSecret = secret;
  return secret;
}

export function signSessionToken(
  account: Pick<Officer, 'id' | 'role'>,
  scope: 'full' | 'password_change_only'
): string {
  const db = getDatabase();
  const secret = getSessionSecret(db);
  const payload: SessionTokenPayload = {
    sub: account.id,
    role: account.role,
    scope,
    exp: Date.now() + 1000 * 60 * 60 * 12, // 12 hours
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const db = getDatabase();
  const secret = getSessionSecret(db);
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf-8')
    ) as SessionTokenPayload;
    if (!payload.sub || !payload.exp || payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function createSchemaAndSeed(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('developer', 'admin', 'petugas')),
      division TEXT NOT NULL,
      kelas TEXT NOT NULL,
      avatar_color TEXT NOT NULL,
      scheduled_days_json TEXT NOT NULL,
      scheduled_weeks_json TEXT NOT NULL DEFAULT '[1,2,3,4]',
      shift_start TEXT NOT NULL,
      shift_end TEXT NOT NULL,
      is_protected INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL,
      password_changed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      category TEXT NOT NULL,
      points INTEGER NOT NULL,
      default_action TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      nis TEXT NOT NULL,
      name TEXT NOT NULL,
      kelas TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spreadsheets (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      hari TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'FINALIZED')),
      created_at TEXT NOT NULL,
      created_by_id TEXT NOT NULL,
      created_by_name TEXT NOT NULL,
      finalized_at TEXT
    );

    CREATE TABLE IF NOT EXISTS spreadsheet_officers (
      spreadsheet_id TEXT NOT NULL,
      officer_id TEXT NOT NULL,
      finished INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (spreadsheet_id, officer_id),
      FOREIGN KEY (spreadsheet_id) REFERENCES spreadsheets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS violations (
      id TEXT PRIMARY KEY,
      spreadsheet_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      time_label TEXT NOT NULL,
      student_name TEXT NOT NULL,
      student_nis TEXT NOT NULL,
      kelas TEXT NOT NULL,
      violation_code TEXT NOT NULL,
      violation_label TEXT NOT NULL,
      category TEXT NOT NULL,
      points INTEGER NOT NULL,
      action_taken TEXT NOT NULL,
      notes TEXT NOT NULL,
      recorded_by_id TEXT NOT NULL,
      recorded_by_name TEXT NOT NULL,
      FOREIGN KEY (spreadsheet_id) REFERENCES spreadsheets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
  `);

  // Ensure scheduled_weeks_json column exists on pre-existing databases
  const accountCols = db.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>;
  if (!accountCols.some((c) => c.name === 'scheduled_weeks_json')) {
    db.exec(
      "ALTER TABLE accounts ADD COLUMN scheduled_weeks_json TEXT NOT NULL DEFAULT '[1,2,3,4]'"
    );
  }

  // Ensure the 1 permanent non-deletable developer account exists
  const existingDev = db
    .prepare('SELECT id FROM accounts WHERE id = ? OR role = ?')
    .get(DEVELOPER_BOOTSTRAP.id, 'developer') as { id: string } | undefined;

  if (!existingDev) {
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO accounts (
        id, name, username, password_hash, role, division, kelas, avatar_color,
        scheduled_days_json, scheduled_weeks_json, shift_start, shift_end, is_protected, must_change_password,
        created_by, created_at, password_changed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      DEVELOPER_BOOTSTRAP.id,
      DEVELOPER_BOOTSTRAP.name,
      DEVELOPER_BOOTSTRAP.username,
      hashPassword(DEVELOPER_BOOTSTRAP.defaultPassword),
      'developer',
      DEVELOPER_BOOTSTRAP.division,
      DEVELOPER_BOOTSTRAP.kelas,
      DEVELOPER_BOOTSTRAP.avatarColor,
      JSON.stringify(HARI_LIST),
      JSON.stringify(ALL_ROTATION_WEEKS),
      '00:00',
      '23:59',
      1,
      0,
      'system',
      nowIso,
      null
    );
  } else {
    // Guarantee developer protection flag cannot be stripped
    db.prepare('UPDATE accounts SET is_protected = 1, role = ? WHERE id = ?').run(
      'developer',
      existingDev.id
    );
  }

  // Ensure the 33 official AKPS presets exist (official rules, NOT dummy data)
  const presetCountRow = db.prepare('SELECT COUNT(*) as cnt FROM presets').get() as {
    cnt: number;
  };
  if (presetCountRow.cnt === 0) {
    const insertPreset = db.prepare(
      'INSERT INTO presets (id, code, label, category, points, default_action) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const p of OFFICIAL_AKPS_PRESETS) {
      insertPreset.run(p.id, p.code, p.label, p.category, p.points, p.defaultAction);
    }
  }

  // Ensure the official SMA Negeri 1 Kemangkon student roster (610 students) is seeded idempotently
  const insertStudent = db.prepare(
    'INSERT OR IGNORE INTO students (id, nis, name, kelas) VALUES (?, ?, ?, ?)'
  );
  const updateStudentNisIfMissing = db.prepare(
    "UPDATE students SET nis = ? WHERE id = ? AND (nis = '-' OR nis = '')"
  );
  db.exec('BEGIN');
  try {
    for (const s of SMAN1_KEMANGKON_STUDENTS) {
      insertStudent.run(s.id, s.nis, s.name, s.kelas);
      if (s.nis && s.nis !== '-') {
        updateStudentNisIfMissing.run(s.nis, s.id);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // Ensure default simulation setting exists
  const simRow = db
    .prepare('SELECT value_json FROM app_settings WHERE key = ?')
    .get('simulation') as { value_json: string } | undefined;
  if (!simRow) {
    const defaultSim: SimulationConfig = {
      enabled: false,
      simulatedTime: '07:15',
      simulatedDay: null,
      simulatedWeek: null,
    };
    db.prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?)').run(
      'simulation',
      JSON.stringify(defaultSim)
    );
  }

  // Ensure default weekly rotation setting exists (2-week alternating cycle starting current week's Monday)
  const weeklyRow = db
    .prepare('SELECT value_json FROM app_settings WHERE key = ?')
    .get('weekly_schedule') as { value_json: string } | undefined;
  if (!weeklyRow) {
    const defaultWeekly: WeeklyRotationConfig = {
      cycleWeeks: 2,
      anchorMonday: getMondayDateKey(formatDateKey(new Date())),
    };
    db.prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?)').run(
      'weekly_schedule',
      JSON.stringify(defaultWeekly)
    );
  }
}

export function getDatabase(): DatabaseSync {
  if (dbInstance) return dbInstance;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const db = new DatabaseSync(SQLITE_PATH);
  createSchemaAndSeed(db);
  dbInstance = db;
  return db;
}

interface AccountRow {
  id: string;
  name: string;
  username: string;
  password_hash: string;
  role: RolePetugas;
  division: string;
  kelas: string;
  avatar_color: string;
  scheduled_days_json: string;
  scheduled_weeks_json?: string;
  shift_start: string;
  shift_end: string;
  is_protected: number;
  must_change_password: number;
  created_by: string | null;
  created_at: string;
  password_changed_at: string | null;
}

function rowToOfficer(row: AccountRow): Officer {
  let scheduledWeeks = [...ALL_ROTATION_WEEKS];
  if (row.scheduled_weeks_json) {
    try {
      const parsed = JSON.parse(row.scheduled_weeks_json);
      if (Array.isArray(parsed)) {
        scheduledWeeks = parsed.map(Number).filter((n) => Number.isFinite(n) && n >= 1);
      }
    } catch {
      scheduledWeeks = [...ALL_ROTATION_WEEKS];
    }
  }
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    division: row.division,
    kelas: row.kelas,
    avatarColor: row.avatar_color,
    scheduledDays: JSON.parse(row.scheduled_days_json) as HariPiket[],
    scheduledWeeks,
    shiftStart: row.shift_start,
    shiftEnd: row.shift_end,
    isProtected: row.is_protected === 1,
    mustChangePassword: row.must_change_password === 1,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    passwordChangedAt: row.password_changed_at ?? undefined,
  };
}

export function sanitizeOfficer(officer: Officer): PublicOfficer {
  const { passwordHash: _hash, ...rest } = officer;
  return rest;
}

export function getSimulationConfig(): SimulationConfig {
  const db = getDatabase();
  const row = db
    .prepare('SELECT value_json FROM app_settings WHERE key = ?')
    .get('simulation') as { value_json: string } | undefined;
  if (!row) {
    return { enabled: false, simulatedTime: '07:15', simulatedDay: null, simulatedWeek: null };
  }
  const parsed = JSON.parse(row.value_json) as SimulationConfig;
  return {
    enabled: Boolean(parsed.enabled),
    simulatedTime: parsed.simulatedTime || '07:15',
    simulatedDay: parsed.simulatedDay ?? null,
    simulatedWeek: parsed.simulatedWeek ?? null,
  };
}

export function setSimulationConfig(config: SimulationConfig): PublicAppState {
  const db = getDatabase();
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value_json) VALUES (?, ?)').run(
    'simulation',
    JSON.stringify(config)
  );
  return getPublicAppState();
}

export function getWeeklyRotationConfig(): WeeklyRotationConfig {
  const db = getDatabase();
  const row = db
    .prepare('SELECT value_json FROM app_settings WHERE key = ?')
    .get('weekly_schedule') as { value_json: string } | undefined;
  if (!row) {
    return {
      cycleWeeks: 2,
      anchorMonday: getMondayDateKey(formatDateKey(new Date())),
    };
  }
  const parsed = JSON.parse(row.value_json) as Partial<WeeklyRotationConfig>;
  return {
    cycleWeeks: clampCycleWeeks(parsed.cycleWeeks),
    anchorMonday: parsed.anchorMonday || getMondayDateKey(formatDateKey(new Date())),
  };
}

export function setWeeklyRotationConfigRecord(
  params: { cycleWeeks?: number; activeWeek?: number },
  now: Date
): PublicAppState {
  const db = getDatabase();
  const current = getWeeklyRotationConfig();
  const nextCycleWeeks = clampCycleWeeks(params.cycleWeeks ?? current.cycleWeeks);
  const dateKey = formatDateKey(now);
  const nextAnchorMonday =
    params.activeWeek !== undefined
      ? shiftAnchorMondayForTargetWeek(dateKey, params.activeWeek, nextCycleWeeks)
      : current.anchorMonday;

  const updated: WeeklyRotationConfig = {
    cycleWeeks: nextCycleWeeks,
    anchorMonday: nextAnchorMonday,
  };
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value_json) VALUES (?, ?)').run(
    'weekly_schedule',
    JSON.stringify(updated)
  );
  return getPublicAppState();
}

export function autoDistributePetugasWeeksRecord(cycleWeeksOverride?: number): PublicAppState {
  const db = getDatabase();
  const current = getWeeklyRotationConfig();
  const cycleWeeks = clampCycleWeeks(cycleWeeksOverride ?? current.cycleWeeks);
  if (cycleWeeks !== current.cycleWeeks) {
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value_json) VALUES (?, ?)').run(
      'weekly_schedule',
      JSON.stringify({ ...current, cycleWeeks })
    );
  }

  const allOfficers = getAllAccounts();
  const map = assignWeeklyRotationDistribution(allOfficers, cycleWeeks);
  const updateStmt = db.prepare('UPDATE accounts SET scheduled_weeks_json = ? WHERE id = ?');

  db.exec('BEGIN');
  try {
    for (const off of allOfficers) {
      const weeks = map.get(off.id) ?? [...ALL_ROTATION_WEEKS];
      updateStmt.run(JSON.stringify(weeks), off.id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getPublicAppState();
}

export function getAllAccounts(): Officer[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM accounts ORDER BY
        CASE role WHEN 'developer' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
        created_at ASC`
    )
    .all() as unknown as AccountRow[];
  return rows.map(rowToOfficer);
}

export function findAccountByUsername(username: string): Officer | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM accounts WHERE LOWER(username) = LOWER(?)')
    .get(username.trim()) as unknown as AccountRow | undefined;
  return row ? rowToOfficer(row) : null;
}

export function findAccountById(id: string): Officer | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM accounts WHERE id = ?')
    .get(id) as unknown as AccountRow | undefined;
  return row ? rowToOfficer(row) : null;
}

export function updateAccountPassword(accountId: string, newPlainPassword: string): PublicOfficer {
  const db = getDatabase();
  const nowIso = new Date().toISOString();
  const newHash = hashPassword(newPlainPassword);
  db.prepare(
    'UPDATE accounts SET password_hash = ?, must_change_password = 0, password_changed_at = ? WHERE id = ?'
  ).run(newHash, nowIso, accountId);

  const updated = findAccountById(accountId);
  if (!updated) throw new Error('Akun tidak ditemukan setelah pembaruan.');
  return sanitizeOfficer(updated);
}

export function getAllPresets(): ViolationPreset[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT id, code, label, category, points, default_action FROM presets ORDER BY code ASC')
    .all() as unknown as Array<{
    id: string;
    code: string;
    label: string;
    category: ViolationPreset['category'];
    points: number;
    default_action: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    category: r.category,
    points: r.points,
    defaultAction: r.default_action,
  }));
}

export function addPresetRecord(preset: ViolationPreset): PublicAppState {
  const db = getDatabase();
  db.prepare(
    'INSERT INTO presets (id, code, label, category, points, default_action) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    preset.id,
    preset.code,
    preset.label,
    preset.category,
    preset.points,
    preset.defaultAction
  );
  return getPublicAppState();
}

export function getAllStudents(): StudentRecord[] {
  const db = getDatabase();
  return db
    .prepare('SELECT id, nis, name, kelas FROM students ORDER BY kelas ASC, name ASC')
    .all() as unknown as StudentRecord[];
}

export function getAllSpreadsheets(): DailySpreadsheet[] {
  const db = getDatabase();
  const sheetRows = db
    .prepare('SELECT * FROM spreadsheets ORDER BY date DESC')
    .all() as unknown as Array<{
    id: string;
    date: string;
    title: string;
    hari: HariPiket;
    status: 'ACTIVE' | 'FINALIZED';
    created_at: string;
    created_by_id: string;
    created_by_name: string;
    finalized_at: string | null;
  }>;

  const officerJoinRows = db
    .prepare('SELECT spreadsheet_id, officer_id, finished FROM spreadsheet_officers')
    .all() as unknown as Array<{
    spreadsheet_id: string;
    officer_id: string;
    finished: number;
  }>;

  const violationRows = db
    .prepare('SELECT * FROM violations ORDER BY timestamp DESC')
    .all() as unknown as Array<{
    id: string;
    spreadsheet_id: string;
    timestamp: string;
    time_label: string;
    student_name: string;
    student_nis: string;
    kelas: string;
    violation_code: string;
    violation_label: string;
    category: ViolationEntry['category'];
    points: number;
    action_taken: string;
    notes: string;
    recorded_by_id: string;
    recorded_by_name: string;
  }>;

  return sheetRows.map((s) => {
    const officers = officerJoinRows.filter((o) => o.spreadsheet_id === s.id);
    const activeOfficers = officers.map((o) => o.officer_id);
    const finishedOfficers = officers.filter((o) => o.finished === 1).map((o) => o.officer_id);

    const rows: ViolationEntry[] = violationRows
      .filter((v) => v.spreadsheet_id === s.id)
      .map((v) => ({
        id: v.id,
        timestamp: v.timestamp,
        timeLabel: v.time_label,
        studentName: v.student_name,
        studentNis: v.student_nis,
        kelas: v.kelas,
        violationCode: v.violation_code,
        violationLabel: v.violation_label,
        category: v.category,
        points: v.points,
        actionTaken: v.action_taken,
        notes: v.notes,
        recordedById: v.recorded_by_id,
        recordedByName: v.recorded_by_name,
      }));

    return {
      id: s.id,
      date: s.date,
      title: s.title,
      hari: s.hari,
      status: s.status,
      createdAt: s.created_at,
      createdById: s.created_by_id,
      createdByName: s.created_by_name,
      activeOfficers,
      finishedOfficers,
      finalizedAt: s.finalized_at ?? undefined,
      rows,
    };
  });
}

function persistSpreadsheet(db: DatabaseSync, sheet: DailySpreadsheet): void {
  db.prepare(
    `INSERT OR REPLACE INTO spreadsheets (
      id, date, title, hari, status, created_at, created_by_id, created_by_name, finalized_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sheet.id,
    sheet.date,
    sheet.title,
    sheet.hari,
    sheet.status,
    sheet.createdAt,
    sheet.createdById,
    sheet.createdByName,
    sheet.finalizedAt ?? null
  );

  db.prepare('DELETE FROM spreadsheet_officers WHERE spreadsheet_id = ?').run(sheet.id);
  const insertOff = db.prepare(
    'INSERT INTO spreadsheet_officers (spreadsheet_id, officer_id, finished) VALUES (?, ?, ?)'
  );
  const finishedSet = new Set(sheet.finishedOfficers);
  for (const officerId of sheet.activeOfficers) {
    insertOff.run(sheet.id, officerId, finishedSet.has(officerId) ? 1 : 0);
  }
}

export function getPublicMeta(): PublicMetaState {
  const now = new Date();
  const sim = getSimulationConfig();
  const clock = getEffectiveClock(now, sim);
  const dev = findAccountById(DEVELOPER_BOOTSTRAP.id);
  const devUsesDefault =
    Boolean(dev?.passwordHash) &&
    !dev?.passwordChangedAt &&
    verifyPassword(DEVELOPER_BOOTSTRAP.defaultPassword, dev!.passwordHash!);

  return {
    serverDate: clock.dateKey,
    serverTime: clock.timeHHMM,
    serverHari: clock.hari,
    simulation: sim,
    developerUsesDefaultPassword: devUsesDefault,
  };
}

export function getPublicAppState(): PublicAppState {
  const now = new Date();
  const simulation = getSimulationConfig();
  const weeklySchedule = getWeeklyRotationConfig();
  const clock = getEffectiveClock(now, simulation);
  return {
    officers: getAllAccounts().map(sanitizeOfficer),
    presets: getAllPresets(),
    students: getAllStudents(),
    spreadsheets: getAllSpreadsheets(),
    simulation,
    weeklySchedule,
    serverDate: clock.dateKey,
    serverTime: clock.timeHHMM,
    serverHari: clock.hari,
  };
}

export function createAccountsBulk(params: {
  entries: Array<{ name: string; kelas?: string }>;
  role: 'admin' | 'petugas';
  creatorId: string;
  division: string;
  defaultKelas: string;
  scheduledDays: HariPiket[];
  scheduledWeeks?: number[];
  rotationMode?: 'auto_split' | 'all' | 'custom';
  shiftStart: string;
  shiftEnd: string;
}): { credentials: GeneratedAccountCredential[]; state: PublicAppState } {
  const db = getDatabase();
  const existingAccounts = getAllAccounts();
  const existingUsernames = new Set(
    existingAccounts.map((a) => a.username.toLowerCase())
  );
  const existingPetugasCount = existingAccounts.filter((a) => a.role === 'petugas').length;
  const weeklyCfg = getWeeklyRotationConfig();
  const cycleWeeks = clampCycleWeeks(weeklyCfg.cycleWeeks);

  const currentCount = existingUsernames.size;
  const nowIso = new Date().toISOString();
  const credentials: GeneratedAccountCredential[] = [];

  const insertStmt = db.prepare(
    `INSERT INTO accounts (
      id, name, username, password_hash, role, division, kelas, avatar_color,
      scheduled_days_json, scheduled_weeks_json, shift_start, shift_end, is_protected, must_change_password,
      created_by, created_at, password_changed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, NULL)`
  );

  const normalizedCustomWeeks =
    Array.isArray(params.scheduledWeeks) && params.scheduledWeeks.length > 0
      ? Array.from(new Set(params.scheduledWeeks.map(Number).filter((w) => w >= 1 && w <= 4))).sort(
          (a, b) => a - b
        )
      : [...ALL_ROTATION_WEEKS];

  db.exec('BEGIN');
  try {
    params.entries.forEach((entry, idx) => {
      const id = `acc-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const username = generateUniqueUsername(entry.name, existingUsernames);
      const temporaryPassword = generateTemporaryPassword(8);
      const passwordHash = hashPassword(temporaryPassword);
      const kelas = entry.kelas || params.defaultKelas || (params.role === 'admin' ? 'OSIS-ADMIN' : 'XI-A');
      const division =
        params.division ||
        (params.role === 'admin' ? 'Admin Pengurus OSIS' : 'Sekbid Kedisiplinan');
      const avatarColor = AVATAR_PALETTE[(currentCount + idx) % AVATAR_PALETTE.length];

      let assignedWeeks: number[];
      if (params.role === 'admin' || params.rotationMode === 'all' || cycleWeeks === 1) {
        assignedWeeks = [...ALL_ROTATION_WEEKS];
      } else if (params.rotationMode === 'auto_split') {
        assignedWeeks = [((existingPetugasCount + idx) % cycleWeeks) + 1];
      } else {
        assignedWeeks = normalizedCustomWeeks;
      }

      insertStmt.run(
        id,
        entry.name,
        username,
        passwordHash,
        params.role,
        division,
        kelas,
        avatarColor,
        JSON.stringify(params.scheduledDays),
        JSON.stringify(assignedWeeks),
        params.shiftStart,
        params.shiftEnd,
        params.creatorId,
        nowIso
      );

      credentials.push({
        id,
        name: entry.name,
        username,
        temporaryPassword,
        role: params.role,
        division,
        kelas,
        scheduledDays: params.scheduledDays,
        scheduledWeeks: assignedWeeks,
        shiftStart: params.shiftStart,
        shiftEnd: params.shiftEnd,
      });
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return {
    credentials,
    state: getPublicAppState(),
  };
}

export function resetAccountTemporaryPassword(accountId: string): {
  credential: GeneratedAccountCredential;
  state: PublicAppState;
} {
  const db = getDatabase();
  const target = findAccountById(accountId);
  if (!target) {
    throw new Error('Akun tidak ditemukan.');
  }
  const temporaryPassword = generateTemporaryPassword(8);
  const newHash = hashPassword(temporaryPassword);

  db.prepare(
    'UPDATE accounts SET password_hash = ?, must_change_password = 1 WHERE id = ?'
  ).run(newHash, accountId);

  return {
    credential: {
      id: target.id,
      name: target.name,
      username: target.username,
      temporaryPassword,
      role: target.role,
      division: target.division,
      kelas: target.kelas,
      scheduledDays: target.scheduledDays,
      scheduledWeeks: target.scheduledWeeks ?? [...ALL_ROTATION_WEEKS],
      shiftStart: target.shiftStart,
      shiftEnd: target.shiftEnd,
    },
    state: getPublicAppState(),
  };
}

export function updateAccountScheduleRecord(
  accountId: string,
  scheduledDays: HariPiket[],
  shiftStart: string,
  shiftEnd: string,
  scheduledWeeks?: number[]
): PublicAppState {
  const db = getDatabase();
  const existing = findAccountById(accountId);
  const nextWeeks = Array.isArray(scheduledWeeks)
    ? Array.from(new Set(scheduledWeeks.map(Number).filter((w) => w >= 1 && w <= 4))).sort(
        (a, b) => a - b
      )
    : (existing?.scheduledWeeks ?? [...ALL_ROTATION_WEEKS]);

  db.prepare(
    'UPDATE accounts SET scheduled_days_json = ?, scheduled_weeks_json = ?, shift_start = ?, shift_end = ? WHERE id = ?'
  ).run(
    JSON.stringify(scheduledDays),
    JSON.stringify(nextWeeks),
    shiftStart,
    shiftEnd,
    accountId
  );
  return getPublicAppState();
}

export function deleteAccountRecord(accountId: string): PublicAppState {
  const db = getDatabase();
  const target = findAccountById(accountId);
  if (!target) {
    throw new Error('Akun tidak ditemukan.');
  }
  if (target.isProtected || target.role === 'developer') {
    throw new Error('Akun Developer utama dilindungi dan tidak dapat dihapus.');
  }
  db.prepare('DELETE FROM accounts WHERE id = ? AND is_protected = 0').run(accountId);
  return getPublicAppState();
}

export function startOrJoinTodaySpreadsheet(officer: Officer, now: Date): {
  created: boolean;
  spreadsheet: DailySpreadsheet;
  state: PublicAppState;
} {
  const db = getDatabase();
  const sim = getSimulationConfig();
  const clock = getEffectiveClock(now, sim);
  const spreadsheets = getAllSpreadsheets();

  const result = createOrJoinDailySpreadsheet(
    spreadsheets,
    clock.dateKey,
    clock.hari,
    officer,
    now.toISOString()
  );

  persistSpreadsheet(db, result.spreadsheet);
  return {
    created: result.created,
    spreadsheet: result.spreadsheet,
    state: getPublicAppState(),
  };
}

export function recordViolationInDb(
  officer: Officer,
  input: AddViolationInput,
  now: Date
): {
  createdSpreadsheet: boolean;
  spreadsheet: DailySpreadsheet;
  state: PublicAppState;
} {
  const db = getDatabase();
  const sim = getSimulationConfig();
  const clock = getEffectiveClock(now, sim);
  const spreadsheets = getAllSpreadsheets();

  const joined = createOrJoinDailySpreadsheet(
    spreadsheets,
    clock.dateKey,
    clock.hari,
    officer,
    now.toISOString()
  );

  if (joined.spreadsheet.status === 'FINALIZED') {
    throw new Error(
      'Spreadsheet hari ini sudah ditandai Selesai oleh semua petugas dan terkunci final.'
    );
  }

  const entryId = `viol-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const updatedSheet = addViolationToSpreadsheet(
    joined.spreadsheet,
    officer,
    input,
    now.toISOString(),
    clock.timeHHMM,
    entryId
  );
  const newEntry = updatedSheet.rows[0];

  db.exec('BEGIN');
  try {
    persistSpreadsheet(db, updatedSheet);

    db.prepare(
      `INSERT INTO violations (
        id, spreadsheet_id, timestamp, time_label, student_name, student_nis, kelas,
        violation_code, violation_label, category, points, action_taken, notes,
        recorded_by_id, recorded_by_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newEntry.id,
      updatedSheet.id,
      newEntry.timestamp,
      newEntry.timeLabel,
      newEntry.studentName,
      newEntry.studentNis,
      newEntry.kelas,
      newEntry.violationCode,
      newEntry.violationLabel,
      newEntry.category,
      newEntry.points,
      newEntry.actionTaken,
      newEntry.notes,
      newEntry.recordedById,
      newEntry.recordedByName
    );

    const existingStudent = db
      .prepare('SELECT id FROM students WHERE LOWER(name) = LOWER(?) AND UPPER(kelas) = UPPER(?)')
      .get(newEntry.studentName, newEntry.kelas) as { id: string } | undefined;

    if (!existingStudent) {
      db.prepare('INSERT INTO students (id, nis, name, kelas) VALUES (?, ?, ?, ?)').run(
        `stu-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        newEntry.studentNis,
        newEntry.studentName,
        newEntry.kelas
      );
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return {
    createdSpreadsheet: joined.created,
    spreadsheet: updatedSheet,
    state: getPublicAppState(),
  };
}

export function deleteViolationInDb(spreadsheetId: string, violationId: string): PublicAppState {
  const db = getDatabase();
  db.prepare('DELETE FROM violations WHERE id = ? AND spreadsheet_id = ?').run(
    violationId,
    spreadsheetId
  );
  return getPublicAppState();
}

export function finishSpreadsheetInDb(
  spreadsheetId: string,
  officerId: string,
  finished: boolean,
  nowIso: string
): { spreadsheet: DailySpreadsheet; state: PublicAppState } {
  const db = getDatabase();
  const sheet = getAllSpreadsheets().find((s) => s.id === spreadsheetId);
  if (!sheet) {
    throw new Error('Spreadsheet tidak ditemukan.');
  }

  const updated = toggleOfficerFinished(sheet, officerId, finished, nowIso);
  persistSpreadsheet(db, updated);

  return {
    spreadsheet: updated,
    state: getPublicAppState(),
  };
}

export function reopenSpreadsheetInDb(spreadsheetId: string): PublicAppState {
  const db = getDatabase();
  const sheet = getAllSpreadsheets().find((s) => s.id === spreadsheetId);
  if (!sheet) {
    throw new Error('Spreadsheet tidak ditemukan.');
  }

  const reopened: DailySpreadsheet = {
    ...sheet,
    status: 'ACTIVE',
    finishedOfficers: [],
    finalizedAt: undefined,
  };
  persistSpreadsheet(db, reopened);
  return getPublicAppState();
}
