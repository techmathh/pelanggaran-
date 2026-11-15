export type RolePetugas = 'developer' | 'admin' | 'petugas';

export type HariPiket =
  | 'Minggu'
  | 'Senin'
  | 'Selasa'
  | 'Rabu'
  | 'Kamis'
  | 'Jumat'
  | 'Sabtu';

export type StatusSpreadsheet = 'ACTIVE' | 'FINALIZED';

export type KategoriPelanggaran =
  | 'A. Kedisiplinan & Kehadiran'
  | 'B. Perilaku & Sikap'
  | 'C. Penggunaan Sepeda Motor'
  | 'D. Penggunaan Teknologi'
  | 'E. Kerapian'
  | 'F. Pelanggaran Lain-lain';

export type TingkatPembinaan =
  | 'Pembinaan Awal (< 15)'
  | 'Teguran Lisan (15–25)'
  | 'Surat Pernyataan 1 & Panggilan Orang Tua 1 (26–50)'
  | 'Surat Pernyataan 2 & Panggilan Orang Tua 2 (51–75)'
  | 'Panggilan Orang Tua 3 (76–99)'
  | 'Surat Pernyataan Bermaterai (≥ 100)';

export interface Officer {
  id: string;
  name: string;
  username: string;
  passwordHash?: string;
  role: RolePetugas;
  division: string;
  kelas: string;
  avatarColor: string;
  scheduledDays: HariPiket[];
  scheduledWeeks?: number[]; // 1..cycleWeeks (default: all weeks)
  shiftStart: string; // HH:mm (24h)
  shiftEnd: string;   // HH:mm (24h)
  isProtected?: boolean;
  mustChangePassword?: boolean;
  createdBy?: string;
  createdAt?: string;
  passwordChangedAt?: string;
}

export type PublicOfficer = Omit<Officer, 'passwordHash'>;

export interface GeneratedAccountCredential {
  id: string;
  name: string;
  username: string;
  temporaryPassword: string;
  role: RolePetugas;
  division: string;
  kelas: string;
  scheduledDays: HariPiket[];
  scheduledWeeks: number[];
  shiftStart: string;
  shiftEnd: string;
}

export interface ViolationPreset {
  id: string;
  code: string; // e.g. 'A1', 'E2', 'F4'
  label: string;
  category: KategoriPelanggaran;
  points: number;
  defaultAction: string;
}

export interface StudentRecord {
  id: string;
  nis: string;
  name: string;
  kelas: string;
}

export interface ViolationEntry {
  id: string;
  timestamp: string;
  timeLabel: string;
  studentName: string;
  studentNis: string;
  kelas: string;
  violationCode: string;
  violationLabel: string;
  category: KategoriPelanggaran;
  points: number;
  actionTaken: string;
  notes: string;
  recordedById: string;
  recordedByName: string;
}

export interface DailySpreadsheet {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  hari: HariPiket;
  status: StatusSpreadsheet;
  createdAt: string;
  createdById: string;
  createdByName: string;
  activeOfficers: string[];
  finishedOfficers: string[];
  finalizedAt?: string;
  reopenedManually?: boolean;
  rows: ViolationEntry[];
}

export interface ScheduleStatus {
  allowed: boolean;
  reason: string;
  currentHari: HariPiket;
  currentTime: string;
  currentWeek: number;
  weekRangeText: string;
  scheduledWeeksText: string;
  scheduledDaysText: string;
  shiftWindowText: string;
  isWeekMatch: boolean;
  isDayMatch: boolean;
  isTimeMatch: boolean;
}

export interface StudentSummary {
  key: string;
  studentName: string;
  studentNis: string;
  kelas: string;
  totalPoints: number;
  incidentCount: number;
  lastViolationDate: string;
  lastViolationLabel: string;
  tier: TingkatPembinaan;
}

export interface ClassViolationGroup {
  kelas: string;
  rows: ViolationEntry[];
  totalIncidents: number;
  totalPoints: number;
  uniqueStudents: number;
}

export interface CategoryBreakdownItem {
  category: KategoriPelanggaran;
  count: number;
  totalPoints: number;
  percentage: number;
}

export interface OfficerProductivityItem {
  officerId: string;
  officerName: string;
  division: string;
  violationCount: number;
  totalPoints: number;
  percentage: number;
  isFinished: boolean;
  isActiveSession: boolean;
}

export interface DailySessionProductivitySummary {
  totalViolations: number;
  totalPoints: number;
  uniqueStudents: number;
  activeOfficerCount: number;
  recordingOfficerCount: number;
  averagePerRecordingOfficer: number;
  officers: OfficerProductivityItem[];
}

export interface SimulationConfig {
  enabled: boolean;
  simulatedTime: string;
  simulatedDay: HariPiket | null;
  simulatedWeek?: number | null;
}

export interface WeeklyRotationConfig {
  cycleWeeks: number; // 1 = tetap setiap minggu, 2..4 = bergilir per minggu
  anchorMonday: string; // YYYY-MM-DD (Senin minggu ke-1 siklus)
}

export interface DailySessionConfig {
  activeDays: HariPiket[];
  startTime: string; // HH:mm (24h)
  endTime: string;   // HH:mm (24h)
}

export interface PublicMetaState {
  serverDate: string;
  serverTime: string;
  serverHari: HariPiket;
  simulation: SimulationConfig;
  developerUsesDefaultPassword: boolean;
}

export interface PublicAppState {
  officers: PublicOfficer[];
  presets: ViolationPreset[];
  students: StudentRecord[];
  spreadsheets: DailySpreadsheet[];
  simulation: SimulationConfig;
  weeklySchedule: WeeklyRotationConfig;
  dailySession: DailySessionConfig;
  serverDate: string;
  serverTime: string;
  serverHari: HariPiket;
}

export interface SystemBackupPayload {
  version: number;
  createdAt: string;
  schoolName: string;
  officers: PublicOfficer[];
  presets: ViolationPreset[];
  customStudents?: StudentRecord[];
  spreadsheets: DailySpreadsheet[];
  weeklySchedule: WeeklyRotationConfig;
  dailySession?: DailySessionConfig;
  simulation?: SimulationConfig;
}

