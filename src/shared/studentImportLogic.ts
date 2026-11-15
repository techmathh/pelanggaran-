import type { HariPiket, PublicAppState, StudentImportEntry } from './types';

export interface ParsedStudentRosterSkip {
  rowNumber: number;
  reason: string;
}

export interface ParsedStudentRosterResult {
  entries: StudentImportEntry[];
  skipped: ParsedStudentRosterSkip[];
  detectedColumns: {
    nameCol: number;
    kelasCol: number;
    nisCol: number;
  };
  headerRowNumber: number | null;
  duplicateCount: number;
}

function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

export function normalizeStudentClass(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/^KELAS\s+/i, '')
    .replace(/\s+/g, ' ');
}

function normalizeHeaderToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyNameHeader(token: string): boolean {
  return (
    token === 'nama' ||
    token === 'name' ||
    token === 'nama siswa' ||
    token === 'nama lengkap' ||
    token === 'student name' ||
    token === 'peserta didik'
  );
}

function isLikelyKelasHeader(token: string): boolean {
  return token === 'kelas' || token === 'class' || token === 'rombel' || token === 'tingkat kelas';
}

function isLikelyNisHeader(token: string): boolean {
  return (
    token === 'nis' ||
    token === 'nisn' ||
    token === 'no induk' ||
    token === 'nomor induk' ||
    token === 'student id'
  );
}

function isLikelyNoColumn(token: string): boolean {
  return token === 'no' || token === 'nomor' || token === 'no urut' || token === 'id';
}

function isMetadataOrTitleLine(firstCell: string, nonEmptyCount: number): boolean {
  if (nonEmptyCount <= 1) {
    const lower = firstCell.toLowerCase();
    if (
      lower.includes('sma negeri') ||
      lower.includes('daftar siswa') ||
      lower.includes('direktori') ||
      lower.includes('tahun ajaran') ||
      lower.includes('tanggal')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Parses a 2D spreadsheet matrix (from Excel or CSV) into validated, deduplicated student records.
 * Supports flexible Indonesian/English headers, optional leading "No" column, and headerless 2/3-column sheets.
 */
export function parseStudentRosterRows(rawRows: unknown[][]): ParsedStudentRosterResult {
  const skipped: ParsedStudentRosterSkip[] = [];
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return {
      entries: [],
      skipped: [],
      detectedColumns: { nameCol: 0, kelasCol: 1, nisCol: 2 },
      headerRowNumber: null,
      duplicateCount: 0,
    };
  }

  // 1. Scan first 15 non-empty rows to locate a header row if present
  let headerRowIndex = -1;
  let nameCol = -1;
  let kelasCol = -1;
  let nisCol = -1;

  const scanLimit = Math.min(rawRows.length, 15);
  for (let r = 0; r < scanLimit; r++) {
    const row = Array.isArray(rawRows[r]) ? rawRows[r] : [];
    const tokens = row.map((cell) => normalizeHeaderToken(cleanCell(cell)));
    const foundName = tokens.findIndex((t) => isLikelyNameHeader(t));
    const foundKelas = tokens.findIndex((t) => isLikelyKelasHeader(t));
    const foundNis = tokens.findIndex((t) => isLikelyNisHeader(t));

    if (foundName >= 0 && foundKelas >= 0) {
      headerRowIndex = r;
      nameCol = foundName;
      kelasCol = foundKelas;
      nisCol = foundNis;
      break;
    }
  }

  // Fallback column layout if no explicit header row is detected
  if (headerRowIndex === -1) {
    // Inspect first non-empty content row to guess whether col 0 is "No" (numeric) or "NIS"/"Nama"
    const sampleRow = rawRows.find(
      (r) => Array.isArray(r) && r.some((c) => cleanCell(c).length > 0)
    );
    const cells = (sampleRow ?? []).map(cleanCell);
    if (cells.length >= 4 && /^\d{1,3}$/.test(cells[0])) {
      // Likely: No | NIS | Nama | Kelas  OR  No | Nama | Kelas | NIS
      if (/^\d{4,}$/.test(cells[1])) {
        nisCol = 1;
        nameCol = 2;
        kelasCol = 3;
      } else {
        nameCol = 1;
        kelasCol = 2;
        nisCol = 3;
      }
    } else if (cells.length >= 3 && /^\d{4,}$/.test(cells[0])) {
      // Likely: NIS | Nama | Kelas
      nisCol = 0;
      nameCol = 1;
      kelasCol = 2;
    } else {
      // Default: Nama | Kelas | NIS
      nameCol = 0;
      kelasCol = 1;
      nisCol = cells.length >= 3 ? 2 : -1;
    }
  }

  const deduped = new Map<string, StudentImportEntry>();
  let duplicateCount = 0;

  const startRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;
  for (let r = startRow; r < rawRows.length; r++) {
    const row = Array.isArray(rawRows[r]) ? rawRows[r] : [];
    const cleaned = row.map(cleanCell);
    const nonEmptyCount = cleaned.filter(Boolean).length;
    if (nonEmptyCount === 0) continue;

    if (headerRowIndex === -1 && isMetadataOrTitleLine(cleaned[0] || '', nonEmptyCount)) {
      continue;
    }

    const rawName = cleaned[nameCol] ?? '';
    const rawKelas = cleaned[kelasCol] ?? '';
    const rawNis = nisCol >= 0 ? (cleaned[nisCol] ?? '') : '';

    // Skip repeated header lines if pasted mid-sheet
    if (
      isLikelyNameHeader(normalizeHeaderToken(rawName)) &&
      isLikelyKelasHeader(normalizeHeaderToken(rawKelas))
    ) {
      continue;
    }

    // Skip single-cell summary rows like "TOTAL" or leading "No" header fragments
    if (!rawName && !rawKelas) continue;
    if (isLikelyNoColumn(normalizeHeaderToken(cleaned[0] ?? '')) && nonEmptyCount <= 1) continue;

    if (!rawName) {
      skipped.push({ rowNumber: r + 1, reason: 'Nama siswa kosong' });
      continue;
    }
    if (!rawKelas) {
      skipped.push({ rowNumber: r + 1, reason: `Kelas untuk "${rawName}" kosong` });
      continue;
    }

    const normalizedKelas = normalizeStudentClass(rawKelas);
    const normalizedNis = rawNis && rawNis !== '-' ? rawNis : '-';
    const dedupeKey = `${rawName.toLowerCase()}__${normalizedKelas}`;

    const existing = deduped.get(dedupeKey);
    if (existing) {
      duplicateCount++;
      // Prefer non-empty NIS if duplicate entry brings one
      if (existing.nis === '-' && normalizedNis !== '-') {
        existing.nis = normalizedNis;
      }
      continue;
    }

    deduped.set(dedupeKey, {
      name: rawName,
      kelas: normalizedKelas,
      nis: normalizedNis,
    });
  }

  return {
    entries: Array.from(deduped.values()),
    skipped,
    detectedColumns: { nameCol, kelasCol, nisCol },
    headerRowNumber: headerRowIndex >= 0 ? headerRowIndex + 1 : null,
    duplicateCount,
  };
}

/**
 * Applies lightweight server clock updates without overwriting full appState arrays
 * when /api/auth/session reports stateVersion unchanged.
 */
export function applyClockPatchToAppState(
  prev: PublicAppState | null,
  patch: { serverDate?: string; serverTime?: string; serverHari?: HariPiket }
): PublicAppState | null {
  if (!prev) return prev;
  const nextDate = patch.serverDate ?? prev.serverDate;
  const nextTime = patch.serverTime ?? prev.serverTime;
  const nextHari = patch.serverHari ?? prev.serverHari;
  if (
    nextDate === prev.serverDate &&
    nextTime === prev.serverTime &&
    nextHari === prev.serverHari
  ) {
    return prev;
  }
  return {
    ...prev,
    serverDate: nextDate,
    serverTime: nextTime,
    serverHari: nextHari,
  };
}
