import type { AddViolationInput } from './piketLogic';
import type {
  KategoriPelanggaran,
  StudentRecord,
  ViolationEntry,
  ViolationPreset,
} from './types';

export const MAX_BATCH_VIOLATION_ROWS = 150;

export interface BatchStudentItem {
  key: string;
  id?: string;
  name: string;
  kelas: string;
  nis: string;
  saveToStudentDirectory?: boolean;
}

export interface BatchRuleItem {
  key: string;
  presetId?: string;
  violationCode: string;
  violationLabel: string;
  category: KategoriPelanggaran;
  points: number;
  actionTaken: string;
}

export interface BatchViolationPayloadItem extends AddViolationInput {
  saveToStudentDirectory?: boolean;
}

export interface QuickPickPresetItem {
  preset: ViolationPreset;
  todayCount: number;
  isRecent: boolean;
}

const DEFAULT_MORNING_CODES = ['A1', 'E1', 'E2', 'E5', 'E4'];

export function buildBatchViolationInputs(
  students: BatchStudentItem[],
  rules: BatchRuleItem[],
  sharedNotes = ''
): { entries: BatchViolationPayloadItem[]; error: string | null } {
  if (!Array.isArray(students) || students.length === 0) {
    return { entries: [], error: 'Pilih minimal 1 siswa terlebih dahulu.' };
  }
  if (!Array.isArray(rules) || rules.length === 0) {
    return { entries: [], error: 'Pilih minimal 1 jenis pelanggaran terlebih dahulu.' };
  }

  const total = students.length * rules.length;
  if (total > MAX_BATCH_VIOLATION_ROWS) {
    return {
      entries: [],
      error: `Maksimal ${MAX_BATCH_VIOLATION_ROWS} catatan dalam satu kali simpan massal (saat ini ${total} catatan). Kurangi jumlah siswa atau kirim bertahap.`,
    };
  }

  const trimmedNotes = sharedNotes.trim();
  const entries: BatchViolationPayloadItem[] = [];

  for (let sIdx = 0; sIdx < students.length; sIdx++) {
    const stu = students[sIdx];
    const cleanName = stu.name.trim();
    const cleanKelas = stu.kelas.trim().toUpperCase();
    const cleanNis = stu.nis.trim() || '-';

    if (!cleanName || !cleanKelas) {
      return {
        entries: [],
        error: `Data siswa ke-${sIdx + 1} belum lengkap (nama dan kelas wajib diisi).`,
      };
    }

    for (let rIdx = 0; rIdx < rules.length; rIdx++) {
      const rule = rules[rIdx];
      const cleanLabel = rule.violationLabel.trim();
      const pts = Math.round(Number(rule.points));

      if (!cleanLabel) {
        return {
          entries: [],
          error: `Keterangan pelanggaran ke-${rIdx + 1} belum diisi.`,
        };
      }
      if (!Number.isFinite(pts) || pts < 1 || pts > 100) {
        return {
          entries: [],
          error: `Poin untuk "${cleanLabel}" harus antara 1 hingga 100.`,
        };
      }

      entries.push({
        studentName: cleanName,
        studentNis: cleanNis,
        kelas: cleanKelas,
        violationCode: (rule.violationCode || 'CUSTOM').trim().toUpperCase(),
        violationLabel: cleanLabel,
        category: rule.category,
        points: pts,
        actionTaken: rule.actionTaken.trim() || 'Teguran Lisan & Catat',
        notes: trimmedNotes,
        // Only register manual student to directory on the first violation for that student
        saveToStudentDirectory: rIdx === 0 ? Boolean(stu.saveToStudentDirectory) : false,
      });
    }
  }

  return { entries, error: null };
}

export function getQuickPickPresetsWithRecent(
  presets: ViolationPreset[],
  todayRows: ViolationEntry[] = [],
  recentPresetIds: string[] = [],
  limit = 6
): QuickPickPresetItem[] {
  if (!Array.isArray(presets) || presets.length === 0) return [];

  const todayCountsByCode = new Map<string, number>();
  for (const row of todayRows) {
    const code = (row.violationCode || '').trim().toUpperCase();
    if (!code || code === 'CUSTOM') continue;
    todayCountsByCode.set(code, (todayCountsByCode.get(code) ?? 0) + 1);
  }

  const presetById = new Map(presets.map((p) => [p.id, p]));
  const presetByCode = new Map(presets.map((p) => [p.code.toUpperCase(), p]));
  const seenIds = new Set<string>();
  const result: QuickPickPresetItem[] = [];

  const pushPreset = (preset: ViolationPreset | undefined, isRecent: boolean) => {
    if (!preset || seenIds.has(preset.id) || result.length >= limit) return;
    seenIds.add(preset.id);
    result.push({
      preset,
      todayCount: todayCountsByCode.get(preset.code.toUpperCase()) ?? 0,
      isRecent,
    });
  };

  // 1. Most recently used by officer in this session
  for (const id of recentPresetIds) {
    pushPreset(presetById.get(id), true);
  }

  // 2. Most frequently recorded today on today's sheet
  const sortedTodayCodes = Array.from(todayCountsByCode.entries()).sort((a, b) => b[1] - a[1]);
  for (const [code] of sortedTodayCodes) {
    pushPreset(presetByCode.get(code), true);
  }

  // 3. Default morning presets so common items stay ready even on empty days
  for (const code of DEFAULT_MORNING_CODES) {
    pushPreset(presetByCode.get(code), false);
  }

  return result;
}

function parseClassSortParts(kelas: string): { grade: number; section: string; raw: string } {
  const upper = kelas.trim().toUpperCase();
  const match = upper.match(/^(\d+)(.*)$/);
  if (!match) {
    return { grade: 999, section: upper, raw: upper };
  }
  return {
    grade: Number(match[1]),
    section: match[2].trim(),
    raw: upper,
  };
}

export function getSortedStudentClasses(students: StudentRecord[]): string[] {
  const classes = new Set<string>();
  for (const stu of students) {
    const normalized = stu.kelas?.trim().toUpperCase();
    if (normalized) classes.add(normalized);
  }
  return Array.from(classes).sort((a, b) => {
    const pa = parseClassSortParts(a);
    const pb = parseClassSortParts(b);
    if (pa.grade !== pb.grade) return pa.grade - pb.grade;
    return pa.section.localeCompare(pb.section, 'id');
  });
}

export function filterStudentsByClassAndQuery(
  students: StudentRecord[],
  selectedClass: string,
  query = ''
): StudentRecord[] {
  const targetClass = selectedClass.trim().toUpperCase();
  const q = query.trim().toLowerCase();

  return students
    .filter((stu) => {
      if (targetClass && targetClass !== 'ALL' && stu.kelas.trim().toUpperCase() !== targetClass) {
        return false;
      }
      if (!q) return true;
      return (
        stu.name.toLowerCase().includes(q) ||
        stu.kelas.toLowerCase().includes(q) ||
        (stu.nis && stu.nis !== '-' && stu.nis.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => {
      const ca = parseClassSortParts(a.kelas);
      const cb = parseClassSortParts(b.kelas);
      if (ca.grade !== cb.grade) return ca.grade - cb.grade;
      const secCmp = ca.section.localeCompare(cb.section, 'id');
      if (secCmp !== 0) return secCmp;
      return a.name.localeCompare(b.name, 'id');
    });
}
