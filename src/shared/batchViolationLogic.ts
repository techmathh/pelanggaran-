import type { AddViolationInput } from './piketLogic';
import type {
  DailySpreadsheet,
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

export interface BatchColumnRow {
  rowKey: string;
  studentId?: string;
  studentName: string;
  kelas: string;
  nis: string;
  saveToStudentDirectory?: boolean;
  presetId: string; // '' | preset.id | 'CUSTOM'
  violationCode: string;
  violationLabel: string;
  category: KategoriPelanggaran;
  points: number;
  actionTaken: string;
  notes: string;
}

export interface OrderedPresetOption {
  preset: ViolationPreset;
  totalCount: number;
  todayCount: number;
  isRecent: boolean;
}

const DEFAULT_MORNING_CODES = ['A1', 'E1', 'E2', 'E5', 'E4'];

export function createEmptyBatchColumnRow(seed = ''): BatchColumnRow {
  const unique = seed || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    rowKey: `row-${unique}`,
    studentId: undefined,
    studentName: '',
    kelas: '',
    nis: '',
    saveToStudentDirectory: false,
    presetId: '',
    violationCode: '',
    violationLabel: '',
    category: 'A. Kedisiplinan & Kehadiran',
    points: 5,
    actionTaken: '',
    notes: '',
  };
}

export function buildBatchColumnEntries(
  rows: BatchColumnRow[]
): { entries: BatchViolationPayloadItem[]; startedRowCount: number; error: string | null } {
  if (!Array.isArray(rows)) {
    return { entries: [], startedRowCount: 0, error: 'Daftar baris tidak valid.' };
  }

  const activeRows = rows.filter(
    (r) =>
      Boolean(r.studentName.trim()) ||
      Boolean(r.kelas.trim()) ||
      Boolean(r.presetId) ||
      Boolean(r.violationLabel.trim()) ||
      Boolean(r.notes.trim())
  );

  if (activeRows.length === 0) {
    return {
      entries: [],
      startedRowCount: 0,
      error: 'Isi minimal 1 baris (nama siswa dan pelanggaran) terlebih dahulu.',
    };
  }

  if (activeRows.length > MAX_BATCH_VIOLATION_ROWS) {
    return {
      entries: [],
      startedRowCount: activeRows.length,
      error: `Maksimal ${MAX_BATCH_VIOLATION_ROWS} baris dalam satu kali simpan (saat ini ${activeRows.length} baris).`,
    };
  }

  const entries: BatchViolationPayloadItem[] = [];
  const savedDirKeys = new Set<string>();

  for (let i = 0; i < activeRows.length; i++) {
    const row = activeRows[i];
    const rowNo = rows.indexOf(row) + 1 || i + 1;
    const cleanName = row.studentName.trim();
    const cleanKelas = row.kelas.trim().toUpperCase();
    const cleanNis = row.nis.trim() || '-';
    const cleanLabel = row.violationLabel.trim();
    const pts = Math.round(Number(row.points));

    if (!cleanName) {
      return {
        entries: [],
        startedRowCount: activeRows.length,
        error: `Baris ${rowNo}: Nama siswa belum diisi.`,
      };
    }
    if (!cleanKelas) {
      return {
        entries: [],
        startedRowCount: activeRows.length,
        error: `Baris ${rowNo} (${cleanName}): Kelas wajib diisi.`,
      };
    }
    if (!cleanLabel) {
      return {
        entries: [],
        startedRowCount: activeRows.length,
        error: `Baris ${rowNo} (${cleanName}): Jenis pelanggaran belum dipilih atau diisi.`,
      };
    }
    if (!Number.isFinite(pts) || pts < 1 || pts > 100) {
      return {
        entries: [],
        startedRowCount: activeRows.length,
        error: `Baris ${rowNo} (${cleanName}): Poin harus antara 1 hingga 100.`,
      };
    }

    const dirKey = `${cleanName.toLowerCase()}::${cleanKelas}`;
    const shouldSaveDir = Boolean(row.saveToStudentDirectory) && !savedDirKeys.has(dirKey);
    if (shouldSaveDir) savedDirKeys.add(dirKey);

    entries.push({
      studentName: cleanName,
      studentNis: cleanNis,
      kelas: cleanKelas,
      violationCode: (row.violationCode || 'CUSTOM').trim().toUpperCase(),
      violationLabel: cleanLabel,
      category: row.category,
      points: pts,
      actionTaken: row.actionTaken.trim() || 'Teguran Lisan & Catat',
      notes: row.notes.trim(),
      saveToStudentDirectory: shouldSaveDir,
    });
  }

  return { entries, startedRowCount: activeRows.length, error: null };
}

export function getOrderedViolationOptions(
  presets: ViolationPreset[],
  spreadsheets: DailySpreadsheet[] = [],
  recentPresetIds: string[] = [],
  todayDate = '',
  topLimit = 8
): {
  topFrequentAndRecent: OrderedPresetOption[];
  byCategory: Array<{ category: KategoriPelanggaran; items: OrderedPresetOption[] }>;
} {
  if (!Array.isArray(presets) || presets.length === 0) {
    return { topFrequentAndRecent: [], byCategory: [] };
  }

  const totalCountsByCode = new Map<string, number>();
  const todayCountsByCode = new Map<string, number>();

  for (const sheet of spreadsheets) {
    const isToday = Boolean(todayDate) && sheet.date === todayDate;
    for (const row of sheet.rows ?? []) {
      const code = (row.violationCode || '').trim().toUpperCase();
      if (!code || code === 'CUSTOM') continue;
      totalCountsByCode.set(code, (totalCountsByCode.get(code) ?? 0) + 1);
      if (isToday) {
        todayCountsByCode.set(code, (todayCountsByCode.get(code) ?? 0) + 1);
      }
    }
  }

  const recentIndexMap = new Map<string, number>();
  recentPresetIds.forEach((id, idx) => {
    if (!recentIndexMap.has(id)) recentIndexMap.set(id, idx);
  });

  const makeOption = (preset: ViolationPreset): OrderedPresetOption => {
    const upperCode = preset.code.toUpperCase();
    return {
      preset,
      totalCount: totalCountsByCode.get(upperCode) ?? 0,
      todayCount: todayCountsByCode.get(upperCode) ?? 0,
      isRecent: recentIndexMap.has(preset.id),
    };
  };

  // Build Top "Terbaru & Sering Dipakai" list:
  // 1) Session recent picks in exact reverse-chronological order
  // 2) Most frequently recorded across today + history (today weighted higher)
  // 3) Default morning rules if fewer than topLimit
  const seenTopIds = new Set<string>();
  const topFrequentAndRecent: OrderedPresetOption[] = [];
  const presetById = new Map(presets.map((p) => [p.id, p]));
  const presetByCode = new Map(presets.map((p) => [p.code.toUpperCase(), p]));

  const pushTop = (preset: ViolationPreset | undefined) => {
    if (!preset || seenTopIds.has(preset.id) || topFrequentAndRecent.length >= topLimit) return;
    seenTopIds.add(preset.id);
    topFrequentAndRecent.push(makeOption(preset));
  };

  for (const id of recentPresetIds) {
    pushTop(presetById.get(id));
  }

  const sortedByUsage = [...presets]
    .map((p) => {
      const upperCode = p.code.toUpperCase();
      const todayCount = todayCountsByCode.get(upperCode) ?? 0;
      const totalCount = totalCountsByCode.get(upperCode) ?? 0;
      const score = todayCount * 3 + totalCount;
      return { preset: p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const item of sortedByUsage) {
    pushTop(item.preset);
  }

  for (const code of DEFAULT_MORNING_CODES) {
    pushTop(presetByCode.get(code));
  }

  // Group all presets by category in order, prioritizing frequent items within each category too
  const categoryOrder: KategoriPelanggaran[] = [];
  const catMap = new Map<KategoriPelanggaran, OrderedPresetOption[]>();
  for (const preset of presets) {
    if (!catMap.has(preset.category)) {
      catMap.set(preset.category, []);
      categoryOrder.push(preset.category);
    }
    catMap.get(preset.category)!.push(makeOption(preset));
  }

  const byCategory = categoryOrder.map((cat) => {
    const items = catMap.get(cat)!.sort((a, b) => {
      const ra = recentIndexMap.get(a.preset.id);
      const rb = recentIndexMap.get(b.preset.id);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      if (b.todayCount !== a.todayCount) return b.todayCount - a.todayCount;
      if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
      return a.preset.code.localeCompare(b.preset.code, 'id');
    });
    return { category: cat, items };
  });

  return { topFrequentAndRecent, byCategory };
}

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
