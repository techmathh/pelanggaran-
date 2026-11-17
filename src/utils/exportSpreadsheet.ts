import * as XLSX from 'xlsx';
import {
  SCHOOL_IDENTITY,
  escapeCsvCell,
  exportSpreadsheetToCsv,
  formatIndonesianDateLabel,
  formatScheduledWeeksLabel,
  getConsensusProgress,
  getRoleLabel,
  groupViolationsByClass,
} from '../shared/piketLogic';
import type {
  DailySpreadsheet,
  GeneratedAccountCredential,
  PublicOfficer,
  StudentRecord,
  StudentSummary,
} from '../shared/types';

function sanitizeSheetName(raw: string, usedNames: Set<string>): string {
  // Excel sheet names max 31 chars and cannot contain: \ / ? * [ ] :
  const cleaned = raw.replace(/[\\/?*[\]:]/g, '-').trim() || 'Sheet';
  let candidate = cleaned.slice(0, 31);
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const suffixStr = `-${suffix++}`;
    candidate = cleaned.slice(0, 31 - suffixStr.length) + suffixStr;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

export function downloadSpreadsheetCsv(spreadsheet: DailySpreadsheet): void {
  const csvContent = '\uFEFF' + exportSpreadsheetToCsv(spreadsheet);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, `Laporan-AKPS-Piket-${spreadsheet.date}.csv`);
}

export function downloadSpreadsheetXlsx(
  spreadsheet: DailySpreadsheet,
  officers: PublicOfficer[]
): void {
  const progress = getConsensusProgress(spreadsheet);
  if (!progress.exportUnlocked) {
    throw new Error('Spreadsheet hanya dapat diekspor setelah jam selesai piket (status Final).');
  }

  const wb = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();
  const officerMap = new Map(officers.map((o) => [o.id, o]));
  const classGroups = groupViolationsByClass(spreadsheet.rows);
  const totalPointsAll = spreadsheet.rows.reduce((sum, r) => sum + r.points, 0);

  // Sheet 1: Ringkasan Sesi & Rekap Per Kelas
  const summaryAoA: (string | number)[][] = [
    [SCHOOL_IDENTITY.sekolah],
    ['LAPORAN HARIAN ANGKA KREDIT PELANGGARAN SISWA (AKPS) — OSIS'],
    [`Hari / Tanggal: ${formatIndonesianDateLabel(spreadsheet.date, spreadsheet.hari)}`],
    [
      `Petugas Aktif: ${spreadsheet.activeOfficers
        .map((id) => officerMap.get(id)?.name ?? id)
        .join(', ')}`,
    ],
    [
      `Status Sesi: Tersimpan & Final (${
        spreadsheet.finalizedAt
          ? new Date(spreadsheet.finalizedAt).toLocaleString('id-ID')
          : '-'
      })`,
    ],
    [],
    ['REKAPITULASI PELANGGARAN PER KELAS'],
    ['No', 'Kelas', 'Jumlah Pelanggaran', 'Jumlah Siswa Terdampak', 'Total Angka Kredit (Poin)'],
  ];

  if (classGroups.length === 0) {
    summaryAoA.push([1, '-', 0, 0, 0]);
  } else {
    classGroups.forEach((grp, idx) => {
      summaryAoA.push([
        idx + 1,
        grp.kelas,
        grp.totalIncidents,
        grp.uniqueStudents,
        grp.totalPoints,
      ]);
    });
    summaryAoA.push([
      '',
      'TOTAL KESELURUHAN',
      spreadsheet.rows.length,
      new Set(spreadsheet.rows.map((r) => `${r.studentName}__${r.kelas}`)).size,
      totalPointsAll,
    ]);
  }

  summaryAoA.push([]);
  summaryAoA.push(['KETERANGAN SANKSI AKPS']);
  summaryAoA.push(['15 – 25 Poin', 'Teguran Lisan']);
  summaryAoA.push(['26 – 50 Poin', 'Surat Pernyataan 1 & Panggilan Orang Tua 1']);
  summaryAoA.push(['51 – 75 Poin', 'Surat Pernyataan 2 & Panggilan Orang Tua 2']);
  summaryAoA.push(['76 – 99 Poin', 'Panggilan Orang Tua 3']);
  summaryAoA.push(['≥ 100 Poin', 'Membuat Surat Pernyataan Bermaterai']);

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoA);
  wsSummary['!cols'] = [
    { wch: 16 },
    { wch: 38 },
    { wch: 22 },
    { wch: 24 },
    { wch: 26 },
  ];
  wsSummary['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 4 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: 4 } },
    { s: { r: 6, c: 0 }, e: { r: 6, c: 4 } },
  ];
  XLSX.utils.book_append_sheet(
    wb,
    wsSummary,
    sanitizeSheetName('Ringkasan & Kelas', usedSheetNames)
  );

  // Sheet 2: Gabungan Semua Kelas (Dikelompokkan per Kelas)
  const allAoA: (string | number)[][] = [
    [SCHOOL_IDENTITY.sekolah],
    [`DAFTAR PELANGGARAN SISWA (SEMUA KELAS) — ${formatIndonesianDateLabel(spreadsheet.date, spreadsheet.hari)}`],
    [],
    [
      'No',
      'Kelas',
      'Jam',
      'NIS',
      'Nama Siswa',
      'Kode AKPS',
      'Jenis Pelanggaran',
      'Kategori',
      'Poin',
      'Tindak Lanjut / Sanksi',
      'Catatan',
      'Petugas',
    ],
  ];

  let globalRowNo = 1;
  for (const grp of classGroups) {
    for (const row of grp.rows) {
      allAoA.push([
        globalRowNo++,
        row.kelas,
        row.timeLabel,
        row.studentNis,
        row.studentName,
        row.violationCode || '-',
        row.violationLabel,
        row.category,
        row.points,
        row.actionTaken,
        row.notes || '-',
        row.recordedByName,
      ]);
    }
  }

  if (classGroups.length === 0) {
    allAoA.push([
      '-',
      '-',
      '-',
      '-',
      'Nihil (Tidak ada pelanggaran tercatat)',
      '-',
      '-',
      '-',
      0,
      '-',
      '-',
      '-',
    ]);
  } else {
    allAoA.push(['', 'TOTAL', '', '', '', '', '', '', totalPointsAll, '', '', '']);
  }

  const wsAll = XLSX.utils.aoa_to_sheet(allAoA);
  wsAll['!cols'] = [
    { wch: 5 },
    { wch: 12 },
    { wch: 8 },
    { wch: 12 },
    { wch: 24 },
    { wch: 11 },
    { wch: 42 },
    { wch: 26 },
    { wch: 8 },
    { wch: 36 },
    { wch: 26 },
    { wch: 18 },
  ];
  wsAll['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } },
  ];
  XLSX.utils.book_append_sheet(
    wb,
    wsAll,
    sanitizeSheetName('Semua Kelas', usedSheetNames)
  );

  // Dedicated Worksheets Separated by Kelas
  for (const grp of classGroups) {
    const classAoA: (string | number)[][] = [
      [SCHOOL_IDENTITY.sekolah],
      [`LAPORAN PELANGGARAN SISWA — KELAS ${grp.kelas}`],
      [`Tanggal: ${formatIndonesianDateLabel(spreadsheet.date, spreadsheet.hari)}`],
      [],
      [
        'No',
        'Jam',
        'NIS',
        'Nama Siswa',
        'Kode AKPS',
        'Jenis Pelanggaran',
        'Kategori',
        'Angka Kredit (Poin)',
        'Tindak Lanjut / Sanksi',
        'Catatan',
        'Petugas',
      ],
    ];

    grp.rows.forEach((row, idx) => {
      classAoA.push([
        idx + 1,
        row.timeLabel,
        row.studentNis,
        row.studentName,
        row.violationCode || '-',
        row.violationLabel,
        row.category,
        row.points,
        row.actionTaken,
        row.notes || '-',
        row.recordedByName,
      ]);
    });

    classAoA.push([
      '',
      '',
      '',
      `Total Kelas ${grp.kelas} (${grp.totalIncidents} catatan)`,
      '',
      '',
      '',
      grp.totalPoints,
      '',
      '',
      '',
    ]);

    const wsClass = XLSX.utils.aoa_to_sheet(classAoA);
    wsClass['!cols'] = [
      { wch: 5 },
      { wch: 8 },
      { wch: 12 },
      { wch: 24 },
      { wch: 11 },
      { wch: 42 },
      { wch: 26 },
      { wch: 18 },
      { wch: 36 },
      { wch: 26 },
      { wch: 18 },
    ];
    wsClass['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 10 } },
    ];

    XLSX.utils.book_append_sheet(
      wb,
      wsClass,
      sanitizeSheetName(`Kelas ${grp.kelas}`, usedSheetNames)
    );
  }

  const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, `Laporan-AKPS-Per-Kelas-${spreadsheet.date}.xlsx`);
}

export function downloadStudentRecapXlsx(
  summaries: StudentSummary[],
  dateLabel: string
): void {
  const wb = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();

  // Group student summaries by class
  const classMap = new Map<string, StudentSummary[]>();
  for (const s of summaries) {
    const k = (s.kelas || 'TANPA-KELAS').toUpperCase();
    const arr = classMap.get(k);
    if (arr) arr.push(s);
    else classMap.set(k, [s]);
  }
  const sortedClasses = Array.from(classMap.keys()).sort((a, b) =>
    a.localeCompare(b, 'id', { numeric: true })
  );

  // Sheet 1: Ringkasan Akumulasi per Kelas
  const summaryAoA: (string | number)[][] = [
    [SCHOOL_IDENTITY.sekolah],
    ['REKAPITULASI AKUMULASI POIN AKPS SISWA PER KELAS'],
    [`Tanggal Cetak: ${dateLabel}`],
    [],
    ['No', 'Kelas', 'Jumlah Siswa', 'Siswa Bermasalah (≥15 Poin)', 'Total Poin Kelas'],
  ];

  sortedClasses.forEach((kelas, idx) => {
    const list = classMap.get(kelas) ?? [];
    const flagged = list.filter((x) => x.totalPoints >= 15).length;
    const pts = list.reduce((sum, x) => sum + x.totalPoints, 0);
    summaryAoA.push([idx + 1, kelas, list.length, flagged, pts]);
  });

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoA);
  wsSummary['!cols'] = [
    { wch: 6 },
    { wch: 16 },
    { wch: 16 },
    { wch: 28 },
    { wch: 18 },
  ];
  wsSummary['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } },
  ];
  XLSX.utils.book_append_sheet(
    wb,
    wsSummary,
    sanitizeSheetName('Ringkasan Per Kelas', usedSheetNames)
  );

  // Per-class student sheets
  for (const kelas of sortedClasses) {
    const list = classMap.get(kelas) ?? [];
    const classAoA: (string | number)[][] = [
      [SCHOOL_IDENTITY.sekolah],
      [`REKAP AKPS SISWA — KELAS ${kelas}`],
      [`Tanggal Cetak: ${dateLabel}`],
      [],
      ['No', 'NIS', 'Nama Siswa', 'Jumlah Pelanggaran', 'Total Poin', 'Pelanggaran Terakhir', 'Status Sanksi AKPS'],
    ];

    list.forEach((stu, idx) => {
      classAoA.push([
        idx + 1,
        stu.studentNis,
        stu.studentName,
        stu.incidentCount,
        stu.totalPoints,
        stu.lastViolationLabel,
        stu.tier,
      ]);
    });

    const wsClass = XLSX.utils.aoa_to_sheet(classAoA);
    wsClass['!cols'] = [
      { wch: 5 },
      { wch: 12 },
      { wch: 26 },
      { wch: 18 },
      { wch: 12 },
      { wch: 40 },
      { wch: 44 },
    ];
    wsClass['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } },
    ];
    XLSX.utils.book_append_sheet(
      wb,
      wsClass,
      sanitizeSheetName(`Kelas ${kelas}`, usedSheetNames)
    );
  }

  const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, `Rekap-AKPS-Siswa-Per-Kelas-${dateLabel}.xlsx`);
}

export function downloadAccountsCredentialsXlsx(
  credentials: GeneratedAccountCredential[],
  dateLabel: string
): void {
  const wb = XLSX.utils.book_new();
  const aoa: (string | number)[][] = [
    [SCHOOL_IDENTITY.sekolah],
    ['DAFTAR AKUN & PASSWORD SEMENTARA SIPIKET OSIS'],
    [`Dibuat pada: ${dateLabel} · Catatan: User wajib mengganti password saat login pertama.`],
    [],
    [
      'No',
      'Nama Lengkap',
      'Role',
      'Username',
      'Password Sementara',
      'Kelas / Unit',
      'Minggu Piket',
      'Hari Piket',
      'Jam Shift',
      'Status Password',
    ],
  ];

  credentials.forEach((cred, idx) => {
    aoa.push([
      idx + 1,
      cred.name,
      getRoleLabel(cred.role),
      cred.username,
      cred.temporaryPassword,
      cred.kelas,
      formatScheduledWeeksLabel(cred.scheduledWeeks, 4),
      cred.scheduledDays.join(', '),
      `${cred.shiftStart} - ${cred.shiftEnd}`,
      'Wajib Ganti Saat Login Pertama',
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 5 },
    { wch: 26 },
    { wch: 16 },
    { wch: 22 },
    { wch: 20 },
    { wch: 14 },
    { wch: 18 },
    { wch: 28 },
    { wch: 16 },
    { wch: 30 },
  ];
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 9 } },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Kredensial Akun');
  const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, `Akun-SiPiket-OSIS-${dateLabel}.xlsx`);
}

export function downloadAccountsCredentialsCsv(
  credentials: GeneratedAccountCredential[],
  dateLabel: string
): void {
  const headers = [
    'No',
    'Nama Lengkap',
    'Role',
    'Username',
    'Password Sementara',
    'Kelas',
    'Minggu Piket',
    'Hari Piket',
    'Jam Shift',
  ];
  const lines = [headers.map(escapeCsvCell).join(',')];
  credentials.forEach((cred, idx) => {
    lines.push(
      [
        idx + 1,
        cred.name,
        getRoleLabel(cred.role),
        cred.username,
        cred.temporaryPassword,
        cred.kelas,
        formatScheduledWeeksLabel(cred.scheduledWeeks, 4),
        cred.scheduledDays.join('; '),
        `${cred.shiftStart} - ${cred.shiftEnd}`,
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  });
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  triggerDownload(blob, `Akun-SiPiket-OSIS-${dateLabel}.csv`);
}

export function downloadRegisteredAccountsDirectoryXlsx(
  officers: PublicOfficer[],
  dateLabel: string
): void {
  const wb = XLSX.utils.book_new();
  const aoa: (string | number)[][] = [
    [SCHOOL_IDENTITY.sekolah],
    ['DIREKTORI AKUN TERDAFTAR SIPIKET OSIS'],
    [`Tanggal Cetak: ${dateLabel}`],
    [],
    [
      'No',
      'Nama Lengkap',
      'Username',
      'Role',
      'Divisi',
      'Kelas',
      'Minggu Piket',
      'Hari Piket',
      'Jam Shift',
      'Status Password',
    ],
  ];

  officers.forEach((off, idx) => {
    aoa.push([
      idx + 1,
      off.name,
      off.username,
      getRoleLabel(off.role),
      off.division,
      off.kelas,
      formatScheduledWeeksLabel(off.scheduledWeeks, 4),
      off.scheduledDays.join(', '),
      `${off.shiftStart} - ${off.shiftEnd}`,
      off.mustChangePassword
        ? 'Belum Ganti Password Pertama'
        : 'Aktif (Password Sudah Diperbarui)',
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 5 },
    { wch: 24 },
    { wch: 20 },
    { wch: 16 },
    { wch: 22 },
    { wch: 14 },
    { wch: 18 },
    { wch: 28 },
    { wch: 16 },
    { wch: 32 },
  ];
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 9 } },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Direktori Akun');
  const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, `Direktori-Akun-SiPiket-${dateLabel}.xlsx`);
}

export function downloadStudentRosterTemplateXlsx(): void {
  const wb = XLSX.utils.book_new();
  const sheetRows: (string | number)[][] = [
    ['No', 'NIS', 'Nama Lengkap', 'Kelas'],
    [1, '3101', 'Contoh: Budi Santoso', '10A'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  ws['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 32 }, { wch: 12 }];

  const guideRows: string[][] = [
    ['PANDUAN IMPORT ROSTER SISWA SIPIKET OSIS'],
    ['1. Gunakan sheet "Roster Siswa" (hapus baris contoh sebelum mengisi data asli).'],
    ['2. Kolom wajib: Nama Lengkap dan Kelas (contoh: 10A, 11B, 12C). Kolom NIS boleh dikosongkan atau diisi "-".'],
    ['3. Untuk kenaikan kelas tahun ajaran baru, Anda dapat mengunduh Roster Saat Ini, menaikkan kelas di Excel, menghapus kelas 12 yang lulus, lalu menambah siswa kelas 10 baru.'],
    ['4. Pilih mode "Tambah / Gabung" untuk menambah siswa baru, atau "Ganti Total Roster" untuk memperbarui seluruh daftar siswa tahun ajaran baru.'],
  ];
  const wsGuide = XLSX.utils.aoa_to_sheet(guideRows);
  wsGuide['!cols'] = [{ wch: 96 }];

  XLSX.utils.book_append_sheet(wb, ws, 'Roster Siswa');
  XLSX.utils.book_append_sheet(wb, wsGuide, 'Petunjuk');

  const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, 'Template-Import-Roster-Siswa-SiPiket.xlsx');
}

export function downloadCurrentStudentRosterXlsx(
  students: StudentRecord[],
  dateLabel: string
): void {
  const wb = XLSX.utils.book_new();
  const rows: (string | number)[][] = [['No', 'NIS', 'Nama Lengkap', 'Kelas']];
  students.forEach((s, idx) => {
    rows.push([idx + 1, s.nis || '-', s.name, s.kelas]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 34 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Roster Siswa');

  const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, `Roster-Siswa-SMAN1-Kemangkon-${dateLabel}.xlsx`);
}

export function downloadAccountImportTemplateXlsx(cycleWeeks = 4): void {
  const wb = XLSX.utils.book_new();
  const sampleRows: (string | number)[][] = [
    [
      'No',
      'Nama Lengkap',
      'Username',
      'Password',
      'Role',
      'Kelas',
      'Divisi',
      'Jadwal Piket',
      'Minggu Piket',
      'Jam Mulai',
      'Jam Selesai',
    ],
    [
      1,
      'Ahmad Fauzi',
      'ahmad.fauzi',
      'osis1234',
      'Petugas',
      '11A',
      'Sekbid Kedisiplinan',
      'Senin, Rabu, Jumat',
      cycleWeeks > 1 ? '1, 3' : 'Semua',
      '06:30',
      '08:30',
    ],
    [
      2,
      'Siti Nurhaliza',
      'siti.nurhaliza',
      'piket2026',
      'Petugas',
      '11B',
      'Sekbid Kedisiplinan',
      'Selasa, Kamis',
      cycleWeeks > 1 ? '2, 4' : 'Semua',
      '06:30',
      '08:30',
    ],
    [
      3,
      'Rizky Pratama',
      '',
      '',
      'Petugas',
      '10C',
      'Sekbid Kedisiplinan',
      'Senin - Sabtu',
      'Semua',
      '06:30',
      '08:30',
    ],
  ];

  const ws = XLSX.utils.aoa_to_sheet(sampleRows);
  ws['!cols'] = [
    { wch: 5 },
    { wch: 24 },
    { wch: 18 },
    { wch: 15 },
    { wch: 12 },
    { wch: 10 },
    { wch: 22 },
    { wch: 24 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
  ];

  const guideRows: string[][] = [
    ['PANDUAN UPLOAD DATA AKUN EXCEL SIPIKET OSIS'],
    ['1. Gunakan sheet "Data Akun" (hapus atau timpa 3 baris contoh dengan data petugas asli).'],
    ['2. Kolom wajib hanya "Nama Lengkap". Kolom lainnya opsional dan akan memakai nilai default bila dikosongkan.'],
    ['3. Username & Password: boleh diisi langsung di Excel (password minimal 6 karakter), atau dikosongkan agar sistem membuatkan otomatis.'],
    ['4. Jadwal Piket (Hari): tulis dipisah koma seperti "Senin, Rabu" atau rentang seperti "Senin - Sabtu" / "Semua Hari".'],
    ['5. Minggu Piket: tulis angka minggu seperti "1", "1, 3", atau "Semua" sesuai siklus giliran mingguan sekolah.'],
    ['6. Jam Mulai & Jam Selesai: gunakan format 24 jam HH:MM (contoh 06:30 dan 08:30).'],
    ['7. Role: isi "Petugas" atau "Admin" (hanya Developer yang dapat mengimpor role Admin).'],
  ];
  const wsGuide = XLSX.utils.aoa_to_sheet(guideRows);
  wsGuide['!cols'] = [{ wch: 96 }];

  XLSX.utils.book_append_sheet(wb, ws, 'Data Akun');
  XLSX.utils.book_append_sheet(wb, wsGuide, 'Petunjuk');

  const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, 'Template-Upload-Akun-SiPiket.xlsx');
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
