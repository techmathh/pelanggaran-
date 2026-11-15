import type {
  CategoryBreakdownItem,
  ClassViolationGroup,
  DailySessionConfig,
  DailySessionProductivitySummary,
  DailySpreadsheet,
  HariPiket,
  KategoriPelanggaran,
  Officer,
  OfficerProductivityItem,
  RolePetugas,
  ScheduleStatus,
  SimulationConfig,
  StudentRecord,
  StudentSummary,
  TingkatPembinaan,
  ViolationEntry,
  WeeklyRotationConfig,
} from './types';

export const DEFAULT_DAILY_SESSION_CONFIG: DailySessionConfig = {
  activeDays: ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
  startTime: '06:30',
  endTime: '08:30',
};

export const DEFAULT_WEEKLY_ROTATION_CONFIG: WeeklyRotationConfig = {
  cycleWeeks: 4,
  anchorMonday: '2026-11-02',
};

export const ALL_ROTATION_WEEKS = [1, 2, 3, 4];

export const HARI_LIST: HariPiket[] = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
];

export const AKPS_CATEGORIES: KategoriPelanggaran[] = [
  'A. Kedisiplinan & Kehadiran',
  'B. Perilaku & Sikap',
  'C. Penggunaan Sepeda Motor',
  'D. Penggunaan Teknologi',
  'E. Kerapian',
  'F. Pelanggaran Lain-lain',
];

export const SCHOOL_IDENTITY = {
  pemerintah: 'PEMERINTAH PROVINSI JAWA TENGAH',
  dinas: 'DINAS PENDIDIKAN',
  sekolah: 'SEKOLAH MENENGAH ATAS NEGERI 1 KEMANGKON',
  alamat: 'Jalan Raya Panican Kemangkon Purbalingga 53381 Telp. 0281.6591606',
  kontak: 'Website : http://sman1kemangkon.sch.id · Email : sman1kmk@yahoo.com',
  kepalaSekolah: 'Laksono Tri Pambudi, S.Pd',
  nipKepalaSekolah: 'NIP 19850331 201101 1 012',
  kota: 'Purbalingga',
};

const BULAN_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

function getJakartaParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekdayIndex: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const rawHour = Number(get('hour'));
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(get('minute')),
    weekdayIndex: weekdayMap[get('weekday')] ?? date.getDay(),
  };
}

export function getHariFromDate(date: Date): HariPiket {
  return HARI_LIST[getJakartaParts(date).weekdayIndex];
}

export function formatDateKey(date: Date): string {
  const p = getJakartaParts(date);
  const year = p.year;
  const month = String(p.month).padStart(2, '0');
  const day = String(p.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTimeHHMM(date: Date): string {
  const p = getJakartaParts(date);
  const hh = String(p.hour).padStart(2, '0');
  const mm = String(p.minute).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatIndonesianDateLabel(dateKey: string, hari?: HariPiket): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey;
  const parsed = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dayName = hari ?? getHariFromDate(parsed);
  const monthName = BULAN_ID[m - 1] ?? '';
  return `${dayName}, ${d} ${monthName} ${y}`;
}

export function formatIndonesianDateShort(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey;
  const monthName = BULAN_ID[m - 1] ?? '';
  return `${d} ${monthName} ${y}`;
}

export function parseMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  return h * 60 + m;
}

export function getEffectiveClock(
  now: Date,
  simulation?: SimulationConfig
): { dateKey: string; timeHHMM: string; hari: HariPiket } {
  const dateKey = formatDateKey(now);
  const realHari = getHariFromDate(now);
  const realTime = formatTimeHHMM(now);

  if (simulation?.enabled) {
    return {
      dateKey,
      timeHHMM: simulation.simulatedTime || '07:15',
      hari: simulation.simulatedDay || realHari,
    };
  }

  return {
    dateKey,
    timeHHMM: realTime,
    hari: realHari,
  };
}

const BULAN_SHORT_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

function parseDateKeyUtcNoon(dateKey: string): Date | null {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export function getMondayDateKey(dateKey: string): string {
  const dt = parseDateKeyUtcNoon(dateKey);
  if (!dt) return dateKey;
  const dayOfWeek = dt.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  dt.setUTCDate(dt.getUTCDate() + diffToMonday);
  return dt.toISOString().slice(0, 10);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const dt = parseDateKeyUtcNoon(dateKey);
  if (!dt) return dateKey;
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function formatWeekRangeShort(startKey: string, endKey: string): string {
  const [sy, sm, sd] = startKey.split('-').map(Number);
  const [ey, em, ed] = endKey.split('-').map(Number);
  if (!sy || !sm || !sd || !ey || !em || !ed) return `${startKey} – ${endKey}`;
  if (sy === ey && sm === em) {
    return `${sd}–${ed} ${BULAN_SHORT_ID[sm - 1] ?? ''} ${sy}`;
  }
  if (sy === ey) {
    return `${sd} ${BULAN_SHORT_ID[sm - 1] ?? ''}–${ed} ${BULAN_SHORT_ID[em - 1] ?? ''} ${sy}`;
  }
  return `${sd} ${BULAN_SHORT_ID[sm - 1] ?? ''} ${sy}–${ed} ${BULAN_SHORT_ID[em - 1] ?? ''} ${ey}`;
}

export function clampCycleWeeks(cycleWeeks?: number): number {
  const n = Number(cycleWeeks);
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.min(4, Math.max(1, Math.round(n)));
}

export function getActiveRotationWeek(
  dateKey: string,
  weeklySchedule?: WeeklyRotationConfig,
  simulation?: SimulationConfig
): {
  currentWeek: number;
  nextWeek: number;
  cycleWeeks: number;
  weekStartDate: string;
  weekEndDate: string;
  weekRangeText: string;
  nextWeekRangeText: string;
  isSimulatedWeek: boolean;
} {
  const cycleWeeks = clampCycleWeeks(weeklySchedule?.cycleWeeks ?? 2);
  const monday = getMondayDateKey(dateKey);
  const saturday = addDaysToDateKey(monday, 5);
  const nextMonday = addDaysToDateKey(monday, 7);
  const nextSaturday = addDaysToDateKey(nextMonday, 5);

  const anchor = getMondayDateKey(weeklySchedule?.anchorMonday || monday);
  const mondayDt = parseDateKeyUtcNoon(monday);
  const anchorDt = parseDateKeyUtcNoon(anchor);

  let weeksElapsed = 0;
  if (mondayDt && anchorDt) {
    const diffDays = Math.round((mondayDt.getTime() - anchorDt.getTime()) / 86400000);
    weeksElapsed = Math.floor(diffDays / 7);
  }

  let currentWeek = (((weeksElapsed % cycleWeeks) + cycleWeeks) % cycleWeeks) + 1;
  let isSimulatedWeek = false;

  if (simulation?.enabled && simulation.simulatedWeek && simulation.simulatedWeek >= 1) {
    currentWeek = ((Math.round(simulation.simulatedWeek) - 1) % cycleWeeks) + 1;
    isSimulatedWeek = true;
  }

  const nextWeek = (currentWeek % cycleWeeks) + 1;

  return {
    currentWeek,
    nextWeek,
    cycleWeeks,
    weekStartDate: monday,
    weekEndDate: saturday,
    weekRangeText: formatWeekRangeShort(monday, saturday),
    nextWeekRangeText: formatWeekRangeShort(nextMonday, nextSaturday),
    isSimulatedWeek,
  };
}

export function shiftAnchorMondayForTargetWeek(
  dateKey: string,
  targetWeek: number,
  cycleWeeks: number
): string {
  const safeCycle = clampCycleWeeks(cycleWeeks);
  const safeTarget = Math.min(safeCycle, Math.max(1, Math.round(targetWeek)));
  const currentMonday = getMondayDateKey(dateKey);
  return addDaysToDateKey(currentMonday, -7 * (safeTarget - 1));
}

export function formatScheduledWeeksLabel(
  scheduledWeeks: number[] | undefined,
  cycleWeeks = 2
): string {
  const safeCycle = clampCycleWeeks(cycleWeeks);
  if (safeCycle === 1) return 'Setiap Minggu';
  if (!scheduledWeeks) return 'Semua Minggu';
  if (scheduledWeeks.length === 0) return 'Belum dijadwalkan';

  const activeInCycle = Array.from(
    new Set(scheduledWeeks.filter((w) => w >= 1 && w <= safeCycle))
  ).sort((a, b) => a - b);

  if (activeInCycle.length === safeCycle) return 'Semua Minggu';
  if (activeInCycle.length > 0) {
    return activeInCycle.map((w) => `Minggu ${w}`).join(', ');
  }
  const fallback = Array.from(new Set(scheduledWeeks)).sort((a, b) => a - b);
  return fallback.map((w) => `Minggu ${w}`).join(', ');
}

export function assignWeeklyRotationDistribution(
  officers: Array<{ id: string; role: RolePetugas }>,
  cycleWeeks: number
): Map<string, number[]> {
  const safeCycle = clampCycleWeeks(cycleWeeks);
  const assignments = new Map<string, number[]>();
  let petugasIdx = 0;

  for (const off of officers) {
    if (off.role === 'developer' || off.role === 'admin' || safeCycle === 1) {
      assignments.set(off.id, [...ALL_ROTATION_WEEKS]);
    } else {
      const assignedWeek = (petugasIdx % safeCycle) + 1;
      assignments.set(off.id, [assignedWeek]);
      petugasIdx += 1;
    }
  }
  return assignments;
}

export function getScheduleStatus(
  officer: Pick<Officer, 'scheduledDays' | 'shiftStart' | 'shiftEnd'> & {
    scheduledWeeks?: number[];
  },
  now: Date,
  simulation?: SimulationConfig,
  weeklySchedule?: WeeklyRotationConfig
): ScheduleStatus {
  const { dateKey, hari, timeHHMM } = getEffectiveClock(now, simulation);
  const weekInfo = getActiveRotationWeek(dateKey, weeklySchedule, simulation);

  const isWeekMatch =
    weekInfo.cycleWeeks === 1 ||
    officer.scheduledWeeks === undefined ||
    officer.scheduledWeeks.includes(weekInfo.currentWeek);
  const isDayMatch = officer.scheduledDays.includes(hari);

  const currentMin = parseMinutes(timeHHMM);
  const startMin = parseMinutes(officer.shiftStart);
  const endMin = parseMinutes(officer.shiftEnd);

  const isTimeMatch =
    currentMin >= 0 &&
    startMin >= 0 &&
    endMin >= 0 &&
    currentMin >= startMin &&
    currentMin <= endMin;

  const scheduledWeeksText = formatScheduledWeeksLabel(
    officer.scheduledWeeks,
    weekInfo.cycleWeeks
  );
  const scheduledDaysText =
    officer.scheduledDays.length > 0
      ? officer.scheduledDays.join(', ')
      : 'Belum dijadwalkan';
  const shiftWindowText = `${officer.shiftStart} – ${officer.shiftEnd}`;

  let reason =
    weekInfo.cycleWeeks > 1
      ? `Jadwal Minggu ke-${weekInfo.currentWeek} (${weekInfo.weekRangeText}) · Sesi piket Anda sedang berlangsung.`
      : 'Sesi piket Anda sedang berlangsung dan aktif untuk mencatat.';

  if (!isWeekMatch) {
    reason = `Minggu ini bukan giliran piket Anda (saat ini Minggu ke-${weekInfo.currentWeek}, ${weekInfo.weekRangeText}).`;
  } else if (!isDayMatch) {
    reason = `Hari ini (${hari}) bukan jadwal piket Anda.`;
  } else if (!isTimeMatch) {
    reason = `Waktu saat ini (${timeHHMM} WIB) berada di luar jam tugas piket Anda.`;
  }

  return {
    allowed: isWeekMatch && isDayMatch && isTimeMatch,
    reason,
    currentHari: hari,
    currentTime: timeHHMM,
    currentWeek: weekInfo.currentWeek,
    weekRangeText: weekInfo.weekRangeText,
    scheduledWeeksText,
    scheduledDaysText,
    shiftWindowText,
    isWeekMatch,
    isDayMatch,
    isTimeMatch,
  };
}

export function createOrJoinDailySpreadsheet(
  spreadsheets: DailySpreadsheet[],
  dateKey: string,
  hari: HariPiket,
  officer: Pick<Officer, 'id' | 'name'>,
  nowIso: string
): { spreadsheets: DailySpreadsheet[]; spreadsheet: DailySpreadsheet; created: boolean } {
  const existingIndex = spreadsheets.findIndex((sheet) => sheet.date === dateKey);

  if (existingIndex >= 0) {
    const existing = spreadsheets[existingIndex];
    if (existing.status === 'FINALIZED') {
      return {
        spreadsheets,
        spreadsheet: existing,
        created: false,
      };
    }

    const alreadyActive = existing.activeOfficers.includes(officer.id);
    if (alreadyActive) {
      return {
        spreadsheets,
        spreadsheet: existing,
        created: false,
      };
    }

    const updated: DailySpreadsheet = {
      ...existing,
      activeOfficers: [...existing.activeOfficers, officer.id],
    };
    const nextList = [...spreadsheets];
    nextList[existingIndex] = updated;
    return {
      spreadsheets: nextList,
      spreadsheet: updated,
      created: false,
    };
  }

  const newSheet: DailySpreadsheet = {
    id: `sheet-${dateKey}`,
    date: dateKey,
    hari,
    title: `Spreadsheet Piket OSIS — ${formatIndonesianDateLabel(dateKey, hari)}`,
    status: 'ACTIVE',
    createdAt: nowIso,
    createdById: officer.id,
    createdByName: officer.name,
    activeOfficers: [officer.id],
    finishedOfficers: [],
    rows: [],
  };

  return {
    spreadsheets: [newSheet, ...spreadsheets],
    spreadsheet: newSheet,
    created: true,
  };
}

export interface AddViolationInput {
  studentName: string;
  studentNis: string;
  kelas: string;
  violationCode?: string;
  violationLabel: string;
  category: KategoriPelanggaran;
  points: number;
  actionTaken: string;
  notes: string;
}

export function validateViolationInput(input: AddViolationInput): string | null {
  if (!input.studentName.trim()) {
    return 'Nama siswa wajib diisi.';
  }
  if (!input.kelas.trim()) {
    return 'Kelas siswa wajib diisi.';
  }
  if (!input.violationLabel.trim()) {
    return 'Jenis pelanggaran wajib diisi.';
  }
  if (!AKPS_CATEGORIES.includes(input.category)) {
    return 'Kategori pelanggaran AKPS tidak valid.';
  }
  if (!Number.isFinite(input.points) || input.points < 1 || input.points > 100) {
    return 'Angka kredit pelanggaran harus antara 1 hingga 100.';
  }
  return null;
}

export function validatePresetInput(input: {
  label?: string;
  category?: KategoriPelanggaran;
  points?: number;
}): string | null {
  if (!input.label || !input.label.trim()) {
    return 'Nama aturan pelanggaran wajib diisi.';
  }
  if (input.category !== undefined && !AKPS_CATEGORIES.includes(input.category)) {
    return 'Kategori pelanggaran AKPS tidak valid.';
  }
  const pts = Number(input.points);
  if (!Number.isFinite(pts) || !Number.isInteger(pts) || pts < 1 || pts > 100) {
    return 'Poin pelanggaran harus berupa bilangan bulat antara 1 hingga 100.';
  }
  return null;
}

const HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function validateOfficerScheduleInput(input: {
  scheduledDays?: HariPiket[];
  shiftStart?: string;
  shiftEnd?: string;
}): string | null {
  if (!Array.isArray(input.scheduledDays) || input.scheduledDays.length === 0) {
    return 'Pilih minimal satu hari jadwal piket.';
  }
  const hasInvalidDay = input.scheduledDays.some((d) => !HARI_LIST.includes(d));
  if (hasInvalidDay) {
    return 'Hari jadwal piket tidak valid.';
  }
  if (!input.shiftStart || !HHMM_REGEX.test(input.shiftStart)) {
    return 'Format jam mulai harus HH:MM (00:00–23:59).';
  }
  if (!input.shiftEnd || !HHMM_REGEX.test(input.shiftEnd)) {
    return 'Format jam selesai harus HH:MM (00:00–23:59).';
  }
  if (parseMinutes(input.shiftStart) > parseMinutes(input.shiftEnd)) {
    return 'Jam mulai piket tidak boleh lebih besar dari jam selesai.';
  }
  return null;
}

export function addViolationToSpreadsheet(
  spreadsheet: DailySpreadsheet,
  officer: Pick<Officer, 'id' | 'name'>,
  input: AddViolationInput,
  nowIso: string,
  timeLabel: string,
  entryId: string
): DailySpreadsheet {
  if (spreadsheet.status === 'FINALIZED') {
    throw new Error('Spreadsheet hari ini sudah selesai dan disimpan final.');
  }

  const nextActive = spreadsheet.activeOfficers.includes(officer.id)
    ? spreadsheet.activeOfficers
    : [...spreadsheet.activeOfficers, officer.id];

  const nextFinished = spreadsheet.finishedOfficers.filter((id) => id !== officer.id);

  const newEntry: ViolationEntry = {
    id: entryId,
    timestamp: nowIso,
    timeLabel,
    studentName: input.studentName.trim(),
    studentNis: input.studentNis.trim() || '-',
    kelas: input.kelas.trim().toUpperCase(),
    violationCode: (input.violationCode || 'CUSTOM').trim().toUpperCase(),
    violationLabel: input.violationLabel.trim(),
    category: input.category,
    points: Math.round(input.points),
    actionTaken: input.actionTaken.trim() || 'Teguran Lisan & Catat',
    notes: input.notes.trim(),
    recordedById: officer.id,
    recordedByName: officer.name,
  };

  return {
    ...spreadsheet,
    activeOfficers: nextActive,
    finishedOfficers: nextFinished,
    rows: [newEntry, ...spreadsheet.rows],
  };
}

export function validateDailySessionInput(input: {
  activeDays?: HariPiket[];
  startTime?: string;
  endTime?: string;
}): string | null {
  if (!Array.isArray(input.activeDays) || input.activeDays.length === 0) {
    return 'Pilih minimal satu hari aktif spreadsheet piket.';
  }
  if (input.activeDays.some((d) => !HARI_LIST.includes(d))) {
    return 'Hari aktif spreadsheet tidak valid.';
  }
  if (!input.startTime || !HHMM_REGEX.test(input.startTime)) {
    return 'Format jam mulai spreadsheet harus HH:MM (00:00–23:59).';
  }
  if (!input.endTime || !HHMM_REGEX.test(input.endTime)) {
    return 'Format jam selesai spreadsheet harus HH:MM (00:00–23:59).';
  }
  if (parseMinutes(input.startTime) >= parseMinutes(input.endTime)) {
    return 'Jam selesai spreadsheet harus lebih akhir daripada jam mulai.';
  }
  return null;
}

export type AutoSessionPhase = 'NON_ACTIVE_DAY' | 'BEFORE_START' | 'OPEN' | 'CLOSED';

export interface AutoSessionWindowStatus {
  isActiveDay: boolean;
  phase: AutoSessionPhase;
  startTime: string;
  endTime: string;
  currentTime: string;
  hari: HariPiket;
  dateKey: string;
  minutesUntilStart: number;
  minutesUntilClose: number;
}

export function getAutoSessionWindowStatus(
  dailySession: DailySessionConfig,
  now: Date,
  simulation?: SimulationConfig
): AutoSessionWindowStatus {
  const { dateKey, hari, timeHHMM } = getEffectiveClock(now, simulation);
  const startTime = dailySession?.startTime || DEFAULT_DAILY_SESSION_CONFIG.startTime;
  const endTime = dailySession?.endTime || DEFAULT_DAILY_SESSION_CONFIG.endTime;
  const activeDays =
    Array.isArray(dailySession?.activeDays) && dailySession.activeDays.length > 0
      ? dailySession.activeDays
      : DEFAULT_DAILY_SESSION_CONFIG.activeDays;

  const isActiveDay = activeDays.includes(hari);
  const currentMin = parseMinutes(timeHHMM);
  const startMin = parseMinutes(startTime);
  const endMin = parseMinutes(endTime);

  if (!isActiveDay) {
    return {
      isActiveDay: false,
      phase: 'NON_ACTIVE_DAY',
      startTime,
      endTime,
      currentTime: timeHHMM,
      hari,
      dateKey,
      minutesUntilStart: 0,
      minutesUntilClose: 0,
    };
  }

  if (currentMin < startMin) {
    return {
      isActiveDay: true,
      phase: 'BEFORE_START',
      startTime,
      endTime,
      currentTime: timeHHMM,
      hari,
      dateKey,
      minutesUntilStart: Math.max(0, startMin - currentMin),
      minutesUntilClose: 0,
    };
  }

  if (currentMin < endMin) {
    return {
      isActiveDay: true,
      phase: 'OPEN',
      startTime,
      endTime,
      currentTime: timeHHMM,
      hari,
      dateKey,
      minutesUntilStart: 0,
      minutesUntilClose: Math.max(0, endMin - currentMin),
    };
  }

  return {
    isActiveDay: true,
    phase: 'CLOSED',
    startTime,
    endTime,
    currentTime: timeHHMM,
    hari,
    dateKey,
    minutesUntilStart: 0,
    minutesUntilClose: 0,
  };
}

export function evaluateAutoSpreadsheetLifecycle(
  spreadsheets: DailySpreadsheet[],
  dailySession: DailySessionConfig,
  now: Date,
  simulation: SimulationConfig | undefined,
  nowIso: string
): {
  changedSheets: DailySpreadsheet[];
  windowStatus: AutoSessionWindowStatus;
} {
  const windowStatus = getAutoSessionWindowStatus(dailySession, now, simulation);
  const changedSheets: DailySpreadsheet[] = [];

  // 1. Auto-finalize any stale past-day ACTIVE spreadsheets that weren't closed before midnight
  for (const sheet of spreadsheets) {
    if (sheet.date < windowStatus.dateKey && sheet.status === 'ACTIVE' && !sheet.reopenedManually) {
      changedSheets.push({
        ...sheet,
        status: 'FINALIZED',
        finishedOfficers: [...sheet.activeOfficers],
        finalizedAt: sheet.finalizedAt || nowIso,
      });
    }
  }

  const todaySheet = spreadsheets.find((s) => s.date === windowStatus.dateKey);

  // 2. Automatically open at startTime and automatically finalize at endTime
  if (windowStatus.phase === 'OPEN') {
    if (!todaySheet) {
      changedSheets.push({
        id: `sheet-${windowStatus.dateKey}`,
        date: windowStatus.dateKey,
        hari: windowStatus.hari,
        title: `Spreadsheet Piket OSIS — ${formatIndonesianDateLabel(windowStatus.dateKey, windowStatus.hari)}`,
        status: 'ACTIVE',
        createdAt: nowIso,
        createdById: 'system-auto',
        createdByName: 'Sistem Otomatis',
        activeOfficers: [],
        finishedOfficers: [],
        reopenedManually: false,
        rows: [],
      });
    } else if (todaySheet.status === 'FINALIZED' && !todaySheet.reopenedManually) {
      // If Jam Selesai was extended while today is back inside OPEN hours, reopen automatically
      changedSheets.push({
        ...todaySheet,
        status: 'ACTIVE',
        finishedOfficers: [],
        finalizedAt: undefined,
        reopenedManually: false,
      });
    }
  } else if (windowStatus.phase === 'CLOSED') {
    if (!todaySheet) {
      changedSheets.push({
        id: `sheet-${windowStatus.dateKey}`,
        date: windowStatus.dateKey,
        hari: windowStatus.hari,
        title: `Spreadsheet Piket OSIS — ${formatIndonesianDateLabel(windowStatus.dateKey, windowStatus.hari)}`,
        status: 'FINALIZED',
        createdAt: nowIso,
        createdById: 'system-auto',
        createdByName: 'Sistem Otomatis',
        activeOfficers: [],
        finishedOfficers: [],
        finalizedAt: nowIso,
        reopenedManually: false,
        rows: [],
      });
    } else if (todaySheet.status === 'ACTIVE' && !todaySheet.reopenedManually) {
      changedSheets.push({
        ...todaySheet,
        status: 'FINALIZED',
        finishedOfficers: [...todaySheet.activeOfficers],
        finalizedAt: todaySheet.finalizedAt || nowIso,
      });
    }
  }

  return { changedSheets, windowStatus };
}

export function getConsensusProgress(spreadsheet: DailySpreadsheet): {
  activeCount: number;
  finishedCount: number;
  allFinished: boolean;
  exportUnlocked: boolean;
} {
  const activeCount = spreadsheet.activeOfficers.length;
  const finishedSet = new Set(spreadsheet.finishedOfficers);
  const isFinal = spreadsheet.status === 'FINALIZED';
  const finishedCount = isFinal
    ? activeCount
    : spreadsheet.activeOfficers.filter((id) => finishedSet.has(id)).length;
  const allFinished = isFinal || (activeCount > 0 && finishedCount === activeCount);
  const exportUnlocked = isFinal;

  return {
    activeCount,
    finishedCount,
    allFinished,
    exportUnlocked,
  };
}

export function toggleOfficerFinished(
  spreadsheet: DailySpreadsheet,
  officerId: string,
  finished: boolean,
  nowIso: string
): DailySpreadsheet {
  if (spreadsheet.status === 'FINALIZED') {
    throw new Error('Spreadsheet sudah tersimpan final dan tidak dapat diubah.');
  }

  const nextActive = spreadsheet.activeOfficers.includes(officerId)
    ? spreadsheet.activeOfficers
    : [...spreadsheet.activeOfficers, officerId];

  const finishedSet = new Set(spreadsheet.finishedOfficers);
  if (finished) {
    finishedSet.add(officerId);
  } else {
    finishedSet.delete(officerId);
  }

  const nextFinished = nextActive.filter((id) => finishedSet.has(id));
  const everyoneDone = nextActive.length > 0 && nextFinished.length === nextActive.length;

  return {
    ...spreadsheet,
    activeOfficers: nextActive,
    finishedOfficers: nextFinished,
    status: everyoneDone ? 'FINALIZED' : 'ACTIVE',
    finalizedAt: everyoneDone ? nowIso : undefined,
  };
}

/**
 * Sanksi resmi berdasarkan akumulasi Angka Kredit Pelanggaran Siswa (AKPS) SMAN 1 Kemangkon:
 * - < 15     : Pembinaan Awal (< 15)
 * - 15 - 25  : Teguran Lisan (15–25)
 * - 26 - 50  : Surat Pernyataan 1 & Panggilan Orang Tua 1 (26–50)
 * - 51 - 75  : Surat Pernyataan 2 & Panggilan Orang Tua 2 (51–75)
 * - 76 - 99  : Panggilan Orang Tua 3 (76–99)
 * - >= 100   : Surat Pernyataan Bermaterai (≥ 100)
 */
export function getTingkatPembinaan(totalPoints: number): TingkatPembinaan {
  if (totalPoints >= 100) return 'Surat Pernyataan Bermaterai (≥ 100)';
  if (totalPoints >= 76) return 'Panggilan Orang Tua 3 (76–99)';
  if (totalPoints >= 51) return 'Surat Pernyataan 2 & Panggilan Orang Tua 2 (51–75)';
  if (totalPoints >= 26) return 'Surat Pernyataan 1 & Panggilan Orang Tua 1 (26–50)';
  if (totalPoints >= 15) return 'Teguran Lisan (15–25)';
  return 'Pembinaan Awal (< 15)';
}

export function calculateStudentSummaries(
  spreadsheets: DailySpreadsheet[],
  directory: StudentRecord[] = []
): StudentSummary[] {
  const map = new Map<string, StudentSummary>();

  for (const s of directory) {
    const key = `${s.name.toLowerCase()}__${s.kelas.toUpperCase()}`;
    map.set(key, {
      key,
      studentName: s.name,
      studentNis: s.nis,
      kelas: s.kelas.toUpperCase(),
      totalPoints: 0,
      incidentCount: 0,
      lastViolationDate: '-',
      lastViolationLabel: 'Belum ada pelanggaran',
      tier: 'Pembinaan Awal (< 15)',
    });
  }

  const sortedSheets = [...spreadsheets].sort((a, b) => a.date.localeCompare(b.date));

  for (const sheet of sortedSheets) {
    for (const row of sheet.rows) {
      const key = `${row.studentName.toLowerCase()}__${row.kelas.toUpperCase()}`;
      const existing = map.get(key);
      if (existing) {
        const nextPoints = existing.totalPoints + row.points;
        existing.totalPoints = nextPoints;
        existing.incidentCount += 1;
        existing.lastViolationDate = sheet.date;
        existing.lastViolationLabel = row.violationLabel;
        if (existing.studentNis === '-' && row.studentNis !== '-') {
          existing.studentNis = row.studentNis;
        }
        existing.tier = getTingkatPembinaan(nextPoints);
      } else {
        map.set(key, {
          key,
          studentName: row.studentName,
          studentNis: row.studentNis || '-',
          kelas: row.kelas.toUpperCase(),
          totalPoints: row.points,
          incidentCount: 1,
          lastViolationDate: sheet.date,
          lastViolationLabel: row.violationLabel,
          tier: getTingkatPembinaan(row.points),
        });
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    return a.studentName.localeCompare(b.studentName);
  });
}

export function groupViolationsByClass(rows: ViolationEntry[]): ClassViolationGroup[] {
  const orderedChronologically = [...rows].reverse();
  const groupMap = new Map<string, ViolationEntry[]>();

  for (const row of orderedChronologically) {
    const kelasKey = (row.kelas || 'TANPA-KELAS').trim().toUpperCase();
    const list = groupMap.get(kelasKey);
    if (list) {
      list.push(row);
    } else {
      groupMap.set(kelasKey, [row]);
    }
  }

  const sortedClasses = Array.from(groupMap.keys()).sort((a, b) =>
    a.localeCompare(b, 'id', { numeric: true })
  );

  return sortedClasses.map((kelas) => {
    const classRows = groupMap.get(kelas) ?? [];
    const totalPoints = classRows.reduce((sum, r) => sum + r.points, 0);
    const uniqueStudents = new Set(
      classRows.map((r) => `${r.studentName.toLowerCase()}__${r.studentNis}`)
    ).size;

    return {
      kelas,
      rows: classRows,
      totalIncidents: classRows.length,
      totalPoints,
      uniqueStudents,
    };
  });
}

export function getCategoryBreakdown(rows: ViolationEntry[]): CategoryBreakdownItem[] {
  const total = rows.length;
  const counts = new Map<KategoriPelanggaran, { count: number; totalPoints: number }>();

  for (const cat of AKPS_CATEGORIES) {
    counts.set(cat, { count: 0, totalPoints: 0 });
  }

  for (const row of rows) {
    const current = counts.get(row.category) ?? { count: 0, totalPoints: 0 };
    current.count += 1;
    current.totalPoints += row.points;
    counts.set(row.category, current);
  }

  return AKPS_CATEGORIES.map((category) => {
    const entry = counts.get(category) ?? { count: 0, totalPoints: 0 };
    return {
      category,
      count: entry.count,
      totalPoints: entry.totalPoints,
      percentage: total > 0 ? Math.round((entry.count / total) * 100) : 0,
    };
  });
}

export function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportSpreadsheetToCsv(spreadsheet: DailySpreadsheet): string {
  const headers = [
    'No',
    'Tanggal',
    'Waktu',
    'Kelas',
    'NIS',
    'Nama Siswa',
    'Kode AKPS',
    'Jenis Pelanggaran',
    'Kategori',
    'Angka Kredit (Poin)',
    'Tindak Lanjut',
    'Catatan',
    'Petugas Piket',
  ];

  // Sort by class then chronologically for clean CSV grouping
  const groups = groupViolationsByClass(spreadsheet.rows);
  const lines = [headers.map(escapeCsvCell).join(',')];

  let num = 1;
  for (const group of groups) {
    for (const row of group.rows) {
      lines.push(
        [
          num++,
          spreadsheet.date,
          row.timeLabel,
          row.kelas,
          row.studentNis,
          row.studentName,
          row.violationCode || '-',
          row.violationLabel,
          row.category,
          row.points,
          row.actionTaken,
          row.notes,
          row.recordedByName,
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
  }

  return lines.join('\r\n');
}

export function isManagerRole(role: RolePetugas): boolean {
  return role === 'developer' || role === 'admin';
}

export function getRoleLabel(role: RolePetugas): string {
  if (role === 'developer') return 'Developer';
  if (role === 'admin') return 'Admin OSIS';
  return 'Petugas Piket';
}

export function canCreateRole(actorRole: RolePetugas, targetRole: RolePetugas): boolean {
  if (actorRole === 'developer') {
    return targetRole === 'admin' || targetRole === 'petugas';
  }
  if (actorRole === 'admin') {
    return targetRole === 'petugas';
  }
  return false;
}

export function removeOfficerFromActiveSpreadsheet(
  spreadsheet: DailySpreadsheet,
  deletedOfficerId: string,
  nowIso: string
): DailySpreadsheet {
  if (spreadsheet.status === 'FINALIZED') {
    return spreadsheet;
  }
  if (
    !spreadsheet.activeOfficers.includes(deletedOfficerId) &&
    !spreadsheet.finishedOfficers.includes(deletedOfficerId)
  ) {
    return spreadsheet;
  }

  const nextActive = spreadsheet.activeOfficers.filter((id) => id !== deletedOfficerId);
  const finishedSet = new Set(
    spreadsheet.finishedOfficers.filter((id) => id !== deletedOfficerId)
  );
  const nextFinished = nextActive.filter((id) => finishedSet.has(id));
  const everyoneDone = nextActive.length > 0 && nextFinished.length === nextActive.length;

  return {
    ...spreadsheet,
    activeOfficers: nextActive,
    finishedOfficers: nextFinished,
    status: everyoneDone ? 'FINALIZED' : 'ACTIVE',
    finalizedAt: everyoneDone ? nowIso : undefined,
  };
}

export function canModifyViolationRow(
  actor: Pick<Officer, 'id' | 'role'>,
  row: Pick<ViolationEntry, 'recordedById'>
): boolean {
  if (isManagerRole(actor.role)) return true;
  return row.recordedById === actor.id;
}

export function canEditAccountProfile(
  actorRole: RolePetugas,
  actorId: string,
  target: Pick<Officer, 'id' | 'role' | 'isProtected'>
): boolean {
  if (actorRole === 'developer') return true;
  if (actorRole === 'admin') {
    if (target.isProtected || target.role === 'developer') return false;
    return target.role === 'petugas' || target.id === actorId;
  }
  return false;
}

export function canDeleteAccount(
  actorRole: RolePetugas,
  target: Pick<Officer, 'role' | 'isProtected'>
): boolean {
  if (target.isProtected || target.role === 'developer') {
    return false;
  }
  if (actorRole === 'developer') {
    return target.role === 'admin' || target.role === 'petugas';
  }
  if (actorRole === 'admin') {
    return target.role === 'petugas';
  }
  return false;
}

export function parseBulkAccountEntries(
  rawText: string
): Array<{ name: string; kelas?: string }> {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const results: Array<{ name: string; kelas?: string }> = [];
  for (const line of lines) {
    // Allow optional "Nama Lengkap | Kelas" or "Nama Lengkap, Kelas", or plain "Nama Lengkap"
    const sepMatch = line.split(/[|;\t]/).map((s) => s.trim());
    const rawName = (sepMatch[0] ?? '').replace(/\s+/g, ' ').trim();
    if (!rawName || rawName.toLowerCase() === 'nama lengkap') continue;
    const rawKelas = sepMatch[1] ? sepMatch[1].toUpperCase() : undefined;
    results.push({ name: rawName, kelas: rawKelas });
  }
  return results;
}

export function generateUniqueUsername(
  fullName: string,
  existingUsernames: Set<string>
): string {
  const normalized = fullName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let base = 'petugas';
  if (normalized.length === 1) {
    base = normalized[0].slice(0, 20);
  } else if (normalized.length >= 2) {
    base = `${normalized[0]}.${normalized[1]}`.slice(0, 22);
  }
  if (!base) base = 'petugas';

  let candidate = base;
  let suffix = 2;
  while (existingUsernames.has(candidate.toLowerCase())) {
    const suffixStr = String(suffix++);
    candidate = `${base.slice(0, Math.max(4, 24 - suffixStr.length))}${suffixStr}`;
  }
  existingUsernames.add(candidate.toLowerCase());
  return candidate;
}

export function validateNewPassword(
  newPassword: string,
  confirmPassword: string,
  currentPassword?: string
): string | null {
  const trimmed = newPassword.trim();
  if (trimmed.length < 6) {
    return 'Password baru minimal terdiri dari 6 karakter.';
  }
  if (trimmed.length > 64) {
    return 'Password baru maksimal 64 karakter.';
  }
  if (trimmed !== confirmPassword.trim()) {
    return 'Konfirmasi password tidak cocok dengan password baru.';
  }
  if (currentPassword !== undefined && trimmed === currentPassword.trim()) {
    return 'Password baru tidak boleh sama dengan password sementara sebelumnya.';
  }
  return null;
}

export interface StudentMatchResult {
  student: StudentRecord;
  score: number;
  matchType: 'exact' | 'prefix' | 'contains' | 'similar';
}

function normalizeStudentText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[`'’‘´]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phoneticIndonesian(text: string): string {
  return normalizeStudentText(text)
    .replace(/kh/g, 'h')
    .replace(/sy|sh/g, 's')
    .replace(/dh/g, 'd')
    .replace(/th/g, 't')
    .replace(/dz|zh/g, 'z')
    .replace(/q/g, 'k')
    .replace(/v/g, 'f')
    .replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1');
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) ?? 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigramsA.get(bg) ?? 0;
    if (count > 0) {
      bigramsA.set(bg, count - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

function scoreTokenAgainstWords(
  token: string,
  phoneticToken: string,
  words: string[],
  phoneticWords: string[]
): { score: number; type: StudentMatchResult['matchType'] } {
  let bestScore = 0;
  let bestType: StudentMatchResult['matchType'] = 'similar';

  for (let idx = 0; idx < words.length; idx++) {
    const word = words[idx];
    const pWord = phoneticWords[idx] ?? word;

    if (word === token) {
      const s = idx === 0 ? 115 : 105;
      if (s > bestScore) {
        bestScore = s;
        bestType = 'exact';
      }
      continue;
    }

    if (word.startsWith(token)) {
      const s = idx === 0 ? 100 : 92;
      if (s > bestScore) {
        bestScore = s;
        bestType = 'prefix';
      }
      continue;
    }

    if (token.length >= 2 && word.includes(token)) {
      if (82 > bestScore) {
        bestScore = 82;
        bestType = 'contains';
      }
      continue;
    }

    if (phoneticToken.length >= 2 && pWord.startsWith(phoneticToken)) {
      if (76 > bestScore) {
        bestScore = 76;
        bestType = 'similar';
      }
      continue;
    }

    if (phoneticToken.length >= 3 && pWord.includes(phoneticToken)) {
      if (68 > bestScore) {
        bestScore = 68;
        bestType = 'similar';
      }
      continue;
    }

    // Typo tolerance against full word or word prefix of comparable length
    if (token.length >= 3) {
      const prefixSlice = word.slice(0, Math.min(word.length, token.length + 1));
      const pPrefixSlice = pWord.slice(0, Math.min(pWord.length, phoneticToken.length + 1));
      const rawDist = Math.min(
        levenshteinDistance(token, word),
        levenshteinDistance(token, prefixSlice)
      );
      const pDist = Math.min(
        levenshteinDistance(phoneticToken, pWord),
        levenshteinDistance(phoneticToken, pPrefixSlice)
      );
      const bestDist = Math.min(rawDist, pDist);
      const maxAllowedDist = token.length >= 6 ? 2 : 1;

      if (bestDist <= maxAllowedDist) {
        const s = Math.max(45, 70 - bestDist * 14);
        if (s > bestScore) {
          bestScore = s;
          bestType = 'similar';
        }
        continue;
      }

      const sim = Math.max(
        diceSimilarity(token, word),
        diceSimilarity(phoneticToken, pWord),
        diceSimilarity(token, prefixSlice)
      );
      if (sim >= 0.48) {
        const s = Math.round(sim * 62);
        if (s > bestScore) {
          bestScore = s;
          bestType = 'similar';
        }
      }
    }
  }

  return { score: bestScore, type: bestType };
}

export function searchSimilarStudents(
  students: StudentRecord[],
  query: string,
  limit = 10
): StudentMatchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const normQuery = normalizeStudentText(trimmed);
  if (!normQuery) return [];

  const rawTokens = normQuery.split(' ').filter(Boolean);
  const classTokens = rawTokens.filter((t) => /^(10|11|12)[a-f]?$/.test(t));
  const nameTokens = rawTokens.filter((t) => !/^(10|11|12)[a-f]?$/.test(t));
  const normNameQuery = nameTokens.join(' ');
  const phoneticQuery = phoneticIndonesian(normNameQuery || normQuery);

  const results: StudentMatchResult[] = [];

  for (const stu of students) {
    const kelasLower = stu.kelas.toLowerCase();
    const nisLower = stu.nis && stu.nis !== '-' ? stu.nis.toLowerCase() : '';

    // Filter strictly on explicit class tokens if user included one (e.g. "abdi 10a" or "ahmad 12")
    if (classTokens.length > 0) {
      const allClassMatch = classTokens.every((ct) => kelasLower.startsWith(ct));
      if (!allClassMatch) continue;
    }

    if (nameTokens.length === 0) {
      results.push({ student: stu, score: 90, matchType: 'prefix' });
      continue;
    }

    // Direct NIS match
    if (nisLower && rawTokens.length === 1 && nisLower.includes(rawTokens[0])) {
      results.push({
        student: stu,
        score: nisLower === rawTokens[0] ? 130 : 100,
        matchType: nisLower === rawTokens[0] ? 'exact' : 'prefix',
      });
      continue;
    }

    const normName = normalizeStudentText(stu.name);
    const phoneticName = phoneticIndonesian(stu.name);
    const words = normName.split(' ').filter(Boolean);
    const phoneticWords = phoneticName.split(' ').filter(Boolean);

    // Check full-string direct matches first
    if (normName === normNameQuery) {
      results.push({ student: stu, score: 150, matchType: 'exact' });
      continue;
    }
    if (normName.startsWith(normNameQuery)) {
      results.push({ student: stu, score: 135, matchType: 'prefix' });
      continue;
    }

    let totalScore = 0;
    let matchedCount = 0;
    let bestTokenType: StudentMatchResult['matchType'] = 'similar';

    for (const tok of nameTokens) {
      const pTok = phoneticIndonesian(tok);
      const tokenMatch = scoreTokenAgainstWords(tok, pTok, words, phoneticWords);
      if (tokenMatch.score > 0) {
        totalScore += tokenMatch.score;
        matchedCount++;
        if (tokenMatch.type === 'exact') bestTokenType = 'exact';
        else if (tokenMatch.type === 'prefix' && bestTokenType !== 'exact') bestTokenType = 'prefix';
        else if (tokenMatch.type === 'contains' && bestTokenType === 'similar') {
          bestTokenType = 'contains';
        }
      }
    }

    // Whole-query substring or phonetic/Dice fallback when someone types concatenated words or typos
    if (normName.includes(normNameQuery)) {
      totalScore = Math.max(totalScore, 95);
      matchedCount = nameTokens.length;
      if (bestTokenType === 'similar') bestTokenType = 'contains';
    } else if (phoneticQuery.length >= 3 && phoneticName.includes(phoneticQuery)) {
      totalScore = Math.max(totalScore, 78);
      matchedCount = nameTokens.length;
    } else if (matchedCount === 0 && normNameQuery.length >= 3) {
      const fullDice = Math.max(
        diceSimilarity(normNameQuery, normName),
        diceSimilarity(phoneticQuery, phoneticName)
      );
      if (fullDice >= 0.42) {
        totalScore = Math.round(fullDice * 70);
        matchedCount = 1;
      }
    }

    if (matchedCount === 0) continue;

    // Require all tokens to contribute if multi-token (or heavily reward matching all tokens)
    if (nameTokens.length > 1 && matchedCount < nameTokens.length) {
      if (matchedCount / nameTokens.length < 0.5) continue;
      totalScore = Math.round(totalScore * (matchedCount / nameTokens.length) * 0.75);
    }

    const avgScore = Math.round(totalScore / nameTokens.length) + (classTokens.length > 0 ? 10 : 0);
    if (avgScore >= 38) {
      results.push({
        student: stu,
        score: avgScore,
        matchType: bestTokenType,
      });
    }
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.student.name.localeCompare(b.student.name, 'id');
  });

  return results.slice(0, limit);
}

export function calculateDailyOfficerProductivity(
  sheet: DailySpreadsheet | undefined,
  officers: Array<Pick<Officer, 'id' | 'name' | 'division'>>
): DailySessionProductivitySummary {
  if (!sheet) {
    return {
      totalViolations: 0,
      totalPoints: 0,
      uniqueStudents: 0,
      activeOfficerCount: 0,
      recordingOfficerCount: 0,
      averagePerRecordingOfficer: 0,
      officers: [],
    };
  }

  const officerLookup = new Map(officers.map((o) => [o.id, o]));
  const map = new Map<string, OfficerProductivityItem>();
  const uniqueStudentKeys = new Set<string>();
  let totalPoints = 0;

  for (const activeId of sheet.activeOfficers) {
    const info = officerLookup.get(activeId);
    map.set(activeId, {
      officerId: activeId,
      officerName: info?.name ?? activeId,
      division: info?.division ?? 'Petugas Piket',
      violationCount: 0,
      totalPoints: 0,
      percentage: 0,
      isFinished: sheet.finishedOfficers.includes(activeId),
      isActiveSession: true,
    });
  }

  for (const row of sheet.rows) {
    totalPoints += row.points;
    uniqueStudentKeys.add(
      `${row.studentName.trim().toLowerCase()}|${row.kelas.trim().toUpperCase()}`
    );

    const existing = map.get(row.recordedById);
    if (existing) {
      existing.violationCount += 1;
      existing.totalPoints += row.points;
    } else {
      const info = officerLookup.get(row.recordedById);
      map.set(row.recordedById, {
        officerId: row.recordedById,
        officerName: info?.name ?? (row.recordedByName || row.recordedById),
        division: info?.division ?? 'Petugas Piket',
        violationCount: 1,
        totalPoints: row.points,
        percentage: 0,
        isFinished: sheet.finishedOfficers.includes(row.recordedById),
        isActiveSession: sheet.activeOfficers.includes(row.recordedById),
      });
    }
  }

  const totalViolations = sheet.rows.length;
  const items = Array.from(map.values()).map((item) => ({
    ...item,
    percentage:
      totalViolations > 0 ? Math.round((item.violationCount / totalViolations) * 100) : 0,
  }));

  items.sort((a, b) => {
    if (b.violationCount !== a.violationCount) return b.violationCount - a.violationCount;
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    return a.officerName.localeCompare(b.officerName, 'id');
  });

  const recordingOfficerCount = items.filter((item) => item.violationCount > 0).length;
  const averagePerRecordingOfficer =
    recordingOfficerCount > 0
      ? Math.round((totalViolations / recordingOfficerCount) * 10) / 10
      : 0;

  return {
    totalViolations,
    totalPoints,
    uniqueStudents: uniqueStudentKeys.size,
    activeOfficerCount: sheet.activeOfficers.length,
    recordingOfficerCount,
    averagePerRecordingOfficer,
    officers: items,
  };
}
