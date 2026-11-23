import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DAILY_SESSION_CONFIG,
  DEFAULT_WEEKLY_ROTATION_CONFIG,
  addViolationToSpreadsheet,
  assignWeeklyRotationDistribution,
  calculateDailyOfficerProductivity,
  calculateStudentSummaries,
  canCreateRole,
  canDeleteAccount,
  canEditAccountProfile,
  canModifyViolationRow,
  createOrJoinDailySpreadsheet,
  evaluateAutoSpreadsheetLifecycle,
  findHolidayForDate,
  normalizeHolidays,
  exportSpreadsheetToCsv,
  formatScheduledWeeksLabel,
  generateUniqueUsername,
  getActiveRotationWeek,
  getAutoSessionWindowStatus,
  getCategoryBreakdown,
  getConsensusProgress,
  getMondayDateKey,
  getScheduleStatus,
  getTingkatPembinaan,
  groupViolationsByClass,
  isUnrestrictedTrialMode,
  paginateItems,
  parseBulkAccountEntries,
  removeOfficerFromActiveSpreadsheet,
  searchSimilarStudents,
  shiftAnchorMondayForTargetWeek,
  toggleOfficerFinished,
  validateDailySessionInput,
  validateNewPassword,
  validateOfficerScheduleInput,
  validatePresetInput,
  validateViolationInput,
} from './piketLogic';
import type { DailySpreadsheet, Officer, StudentRecord, ViolationEntry } from './types';
import { SMAN1_KEMANGKON_STUDENTS } from '../server/studentRoster';
import {
  deriveConnectionStatus,
  getConnectionBannerInfo,
  isReachableApiResponse,
} from './connectionLogic';
import { calculateTiltTransform, easeOutCubic } from './motionMath';
import {
  applyClockPatchToAppState,
  normalizeStudentClass,
  parseStudentRosterRows,
} from './studentImportLogic';

test('getScheduleStatus allows scheduled day within shift hours and blocks off-schedule', () => {
  const officer: Pick<Officer, 'scheduledDays' | 'shiftStart' | 'shiftEnd'> = {
    scheduledDays: ['Senin', 'Rabu'],
    shiftStart: '06:30',
    shiftEnd: '08:30',
  };

  const mondayMorning = new Date('2026-11-16T07:15:00+07:00');
  const okStatus = getScheduleStatus(officer, mondayMorning);
  assert.equal(okStatus.allowed, true);
  assert.equal(okStatus.isDayMatch, true);
  assert.equal(okStatus.isTimeMatch, true);

  const mondayLate = new Date('2026-11-16T10:00:00+07:00');
  const lateStatus = getScheduleStatus(officer, mondayLate);
  assert.equal(lateStatus.allowed, false);
  assert.equal(lateStatus.isDayMatch, true);
  assert.equal(lateStatus.isTimeMatch, false);

  const tuesdayMorning = new Date('2026-11-17T07:15:00+07:00');
  const wrongDayStatus = getScheduleStatus(officer, tuesdayMorning);
  assert.equal(wrongDayStatus.allowed, false);
  assert.equal(wrongDayStatus.isDayMatch, false);

  const simulated = getScheduleStatus(officer, tuesdayMorning, {
    enabled: true,
    simulatedDay: 'Senin',
    simulatedTime: '07:15',
  });
  assert.equal(simulated.allowed, true);
});

test('createOrJoinDailySpreadsheet auto-creates once per day and joins additional officers', () => {
  const initial: DailySpreadsheet[] = [];
  const officer1 = { id: 'off-1', name: 'Petugas Satu' };
  const officer2 = { id: 'off-2', name: 'Petugas Dua' };

  const first = createOrJoinDailySpreadsheet(
    initial,
    '2026-11-14',
    'Sabtu',
    officer1,
    '2026-11-14T07:00:00.000Z'
  );

  assert.equal(first.created, true);
  assert.equal(first.spreadsheets.length, 1);
  assert.deepEqual(first.spreadsheet.activeOfficers, ['off-1']);
  assert.equal(first.spreadsheet.status, 'ACTIVE');

  const second = createOrJoinDailySpreadsheet(
    first.spreadsheets,
    '2026-11-14',
    'Sabtu',
    officer2,
    '2026-11-14T07:05:00.000Z'
  );

  assert.equal(second.created, false);
  assert.equal(second.spreadsheets.length, 1);
  assert.deepEqual(second.spreadsheet.activeOfficers, ['off-1', 'off-2']);
});

test('multi-officer consensus requires ALL active officers to press Selesai before finalizing & unlocking export', () => {
  const officer1 = { id: 'off-1', name: 'Petugas Satu' };
  const officer2 = { id: 'off-2', name: 'Petugas Dua' };

  let { spreadsheet } = createOrJoinDailySpreadsheet(
    [],
    '2026-11-14',
    'Sabtu',
    officer1,
    '2026-11-14T07:00:00.000Z'
  );

  spreadsheet = addViolationToSpreadsheet(
    spreadsheet,
    officer1,
    {
      studentName: 'Budi Santoso',
      studentNis: '20250101',
      kelas: 'XI-IPA-1',
      violationCode: 'A1',
      violationLabel: 'Terlambat masuk sekolah',
      category: 'A. Kedisiplinan & Kehadiran',
      points: 5,
      actionTaken: 'Catat & pembinaan pagi',
      notes: 'Datang pukul 07:12',
    },
    '2026-11-14T07:12:00.000Z',
    '07:12',
    'viol-1'
  );

  spreadsheet = addViolationToSpreadsheet(
    spreadsheet,
    officer2,
    {
      studentName: 'Citra Dewi',
      studentNis: '20250102',
      kelas: 'X-B',
      violationCode: 'E1',
      violationLabel: 'Tidak mengenakan seragam, sepatu, kerudung, dan atribut tidak lengkap/tidak sesuai ketentuan sekolah',
      category: 'E. Kerapian',
      points: 5,
      actionTaken: 'Lengkapi atribut di pos OSIS',
      notes: '',
    },
    '2026-11-14T07:18:00.000Z',
    '07:18',
    'viol-2'
  );

  spreadsheet = toggleOfficerFinished(
    spreadsheet,
    'off-1',
    true,
    '2026-11-14T08:00:00.000Z'
  );
  let progress = getConsensusProgress(spreadsheet);
  assert.equal(progress.activeCount, 2);
  assert.equal(progress.finishedCount, 1);
  assert.equal(progress.allFinished, false);
  assert.equal(progress.exportUnlocked, false);
  assert.equal(spreadsheet.status, 'ACTIVE');

  spreadsheet = toggleOfficerFinished(
    spreadsheet,
    'off-2',
    true,
    '2026-11-14T08:05:00.000Z'
  );
  progress = getConsensusProgress(spreadsheet);
  assert.equal(progress.activeCount, 2);
  assert.equal(progress.finishedCount, 2);
  assert.equal(progress.allFinished, true);
  assert.equal(progress.exportUnlocked, true);
  assert.equal(spreadsheet.status, 'FINALIZED');
  assert.ok(spreadsheet.finalizedAt);

  const csv = exportSpreadsheetToCsv(spreadsheet);
  assert.ok(csv.includes('Budi Santoso'));
  assert.ok(csv.includes('Citra Dewi'));
  assert.ok(csv.includes('A1'));
  assert.ok(csv.includes('E1'));

  const groups = groupViolationsByClass(spreadsheet.rows);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].kelas, 'X-B');
  assert.equal(groups[1].kelas, 'XI-IPA-1');

  const breakdown = getCategoryBreakdown(spreadsheet.rows);
  assert.equal(breakdown.length, 6);
});

test('getTingkatPembinaan & calculateStudentSummaries follow official AKPS sanction thresholds', () => {
  assert.equal(getTingkatPembinaan(10), 'Pembinaan Awal (< 15)');
  assert.equal(getTingkatPembinaan(15), 'Teguran Lisan (15–25)');
  assert.equal(getTingkatPembinaan(25), 'Teguran Lisan (15–25)');
  assert.equal(getTingkatPembinaan(26), 'Surat Pernyataan 1 & Panggilan Orang Tua 1 (26–50)');
  assert.equal(getTingkatPembinaan(51), 'Surat Pernyataan 2 & Panggilan Orang Tua 2 (51–75)');
  assert.equal(getTingkatPembinaan(76), 'Panggilan Orang Tua 3 (76–99)');
  assert.equal(getTingkatPembinaan(100), 'Surat Pernyataan Bermaterai (≥ 100)');

  const students: StudentRecord[] = [
    { id: 's1', nis: '240101', name: 'Aldi Pratama', kelas: 'XI-IPA-1' },
  ];

  const sheets: DailySpreadsheet[] = [
    {
      id: 'sheet-2026-11-12',
      date: '2026-11-12',
      hari: 'Kamis',
      title: 'Spreadsheet Piket',
      status: 'FINALIZED',
      createdAt: '2026-11-12T06:40:00.000Z',
      createdById: 'off-1',
      createdByName: 'Petugas Satu',
      activeOfficers: ['off-1'],
      finishedOfficers: ['off-1'],
      finalizedAt: '2026-11-12T08:15:00.000Z',
      rows: [
        {
          id: 'r1',
          timestamp: '2026-11-12T07:05:00.000Z',
          timeLabel: '07:05',
          studentName: 'Aldi Pratama',
          studentNis: '240101',
          kelas: 'XI-IPA-1',
          violationCode: 'B8',
          violationLabel: 'Berperilaku yang melanggar norma/etika',
          category: 'B. Perilaku & Sikap',
          points: 50,
          actionTaken: 'Surat Pernyataan 1 & Panggilan Orang Tua 1',
          notes: '',
          recordedById: 'off-1',
          recordedByName: 'Petugas Satu',
        },
        {
          id: 'r2',
          timestamp: '2026-11-12T07:15:00.000Z',
          timeLabel: '07:15',
          studentName: 'Aldi Pratama',
          studentNis: '240101',
          kelas: 'XI-IPA-1',
          violationCode: 'A1',
          violationLabel: 'Terlambat masuk sekolah',
          category: 'A. Kedisiplinan & Kehadiran',
          points: 5,
          actionTaken: 'Catat & pembinaan pagi',
          notes: '',
          recordedById: 'off-1',
          recordedByName: 'Petugas Satu',
        },
      ],
    },
  ];

  const summaries = calculateStudentSummaries(sheets, students);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].totalPoints, 55);
  assert.equal(summaries[0].incidentCount, 2);
  assert.equal(summaries[0].tier, 'Surat Pernyataan 2 & Panggilan Orang Tua 2 (51–75)');
});

test('RBAC permissions enforce developer > admin > petugas hierarchy and protect developer account', () => {
  assert.equal(canCreateRole('developer', 'admin'), true);
  assert.equal(canCreateRole('developer', 'petugas'), true);
  assert.equal(canCreateRole('developer', 'developer'), false);

  assert.equal(canCreateRole('admin', 'petugas'), true);
  assert.equal(canCreateRole('admin', 'admin'), false);
  assert.equal(canCreateRole('admin', 'developer'), false);

  assert.equal(canCreateRole('petugas', 'petugas'), false);

  assert.equal(canDeleteAccount('developer', { role: 'developer', isProtected: true }), false);
  assert.equal(canDeleteAccount('developer', { role: 'admin', isProtected: false }), true);
  assert.equal(canDeleteAccount('developer', { role: 'petugas', isProtected: false }), true);
  assert.equal(canDeleteAccount('admin', { role: 'admin', isProtected: false }), false);
  assert.equal(canDeleteAccount('admin', { role: 'petugas', isProtected: false }), true);
});

test('bulk account name parser, unique username generator, and first-login password validator', () => {
  const parsed = parseBulkAccountEntries('Nama Lengkap\nAhmad Fauzi\nAhmad Fauzi | XI-IPA-2\n\nSiti Nurhaliza');
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].name, 'Ahmad Fauzi');
  assert.equal(parsed[1].kelas, 'XI-IPA-2');

  const taken = new Set(['developer']);
  const u1 = generateUniqueUsername('Ahmad Fauzi', taken);
  const u2 = generateUniqueUsername('Ahmad Fauzi', taken);
  const u3 = generateUniqueUsername('Siti Nurhaliza', taken);
  assert.equal(u1, 'ahmad.fauzi');
  assert.equal(u2, 'ahmad.fauzi2');
  assert.equal(u3, 'siti.nurhaliza');

  assert.ok(validateNewPassword('12345', '12345'));
  assert.ok(validateNewPassword('abc123', 'abc999'));
  assert.ok(validateNewPassword('TempPass1', 'TempPass1', 'TempPass1'));
  assert.equal(validateNewPassword('NewStrong9', 'NewStrong9', 'TempPass1'), null);
});

test('SMAN 1 Kemangkon roster integrity and searchSimilarStudents fuzzy/partial matching', () => {
  assert.equal(SMAN1_KEMANGKON_STUDENTS.length, 610);
  const g10 = SMAN1_KEMANGKON_STUDENTS.filter((s) => s.kelas.startsWith('10'));
  const g11 = SMAN1_KEMANGKON_STUDENTS.filter((s) => s.kelas.startsWith('11'));
  const g12 = SMAN1_KEMANGKON_STUDENTS.filter((s) => s.kelas.startsWith('12'));
  assert.equal(g10.length, 213);
  assert.equal(g11.length, 201);
  assert.equal(g12.length, 196);
  assert.ok(g12.every((s) => /^\d{4}$/.test(s.nis)));
  assert.ok(!SMAN1_KEMANGKON_STUDENTS.some((s) => s.name.startsWith('12D')));

  // Partial prefix ("abd" & "abdi")
  const abdMatches = searchSimilarStudents(SMAN1_KEMANGKON_STUDENTS, 'abd', 8);
  assert.ok(abdMatches.length >= 2);
  assert.ok(abdMatches.some((m) => m.student.name === 'Abdi Pamungkas' && m.student.kelas === '10A'));
  const abdiMatches = searchSimilarStudents(SMAN1_KEMANGKON_STUDENTS, 'abdi', 5);
  assert.equal(abdiMatches[0]?.student.name, 'Abdi Pamungkas');
  assert.equal(abdiMatches[0]?.student.kelas, '10A');

  // Punctuation-insensitive ("maruf")
  const marufMatches = searchSimilarStudents(SMAN1_KEMANGKON_STUDENTS, 'maruf', 5);
  assert.ok(marufMatches.some((m) => m.student.name === 'Ikhwan Ma`ruf' && m.student.kelas === '11D'));

  // Similar spelling / typo tolerance ("muhamad fahmi" & "nurlia estiningish")
  const muhamadMatches = searchSimilarStudents(SMAN1_KEMANGKON_STUDENTS, 'muhamad fahmi', 5);
  assert.ok(
    muhamadMatches.some(
      (m) => m.student.name === 'Muhammad Fahmi Adhana Ilham' && m.student.kelas === '11A'
    )
  );

  const typoNurlia = searchSimilarStudents(SMAN1_KEMANGKON_STUDENTS, 'nurlia estiningish', 5);
  assert.equal(typoNurlia[0]?.student.name, 'Nurlia Estiningsih');
  assert.equal(typoNurlia[0]?.student.kelas, '11D');

  const aisahMatches = searchSimilarStudents(SMAN1_KEMANGKON_STUDENTS, 'aisah', 8);
  assert.ok(aisahMatches.length >= 1);
  assert.ok(aisahMatches.some((m) => m.student.name.toLowerCase().includes('aisyah')));

  // Class token refinement + Grade 12 NIS auto-fill
  const classSpecific = searchSimilarStudents(SMAN1_KEMANGKON_STUDENTS, 'ahmad 12c', 5);
  assert.equal(classSpecific[0]?.student.name, 'Ahmad Slamet Fauzan');
  assert.equal(classSpecific[0]?.student.kelas, '12C');
  assert.equal(classSpecific[0]?.student.nis, '2942');

  // Class-only query & "kelas 10a" / "10 a" variants return full class sorted A-Z
  const class10ABrowse = searchSimilarStudents(SMAN1_KEMANGKON_STUDENTS, '10A', 10);
  assert.ok(class10ABrowse.length > 20);
  assert.ok(class10ABrowse.every((m) => m.student.kelas === '10A'));
  assert.equal(class10ABrowse[0]?.student.name, 'Abdi Pamungkas');

  const classWithWord = searchSimilarStudents(SMAN1_KEMANGKON_STUDENTS, 'kelas 10 a', 10);
  assert.equal(classWithWord.length, class10ABrowse.length);
  assert.ok(classWithWord.every((m) => m.student.kelas === '10A'));

  // Explicit classFilter scopes empty query & name query strictly to that class
  const filter11DBrowse = searchSimilarStudents(SMAN1_KEMANGKON_STUDENTS, '', 10, '11D');
  assert.ok(filter11DBrowse.length > 20);
  assert.ok(filter11DBrowse.every((m) => m.student.kelas === '11D'));
  const filter11DName = searchSimilarStudents(SMAN1_KEMANGKON_STUDENTS, 'nurlia', 5, '11D');
  assert.equal(filter11DName[0]?.student.name, 'Nurlia Estiningsih');
  assert.equal(filter11DName[0]?.student.kelas, '11D');
});

test('weekly rotation cycle rotates automatically every Monday and enforces per-week officer access', () => {
  // Monday 2026-11-16 is Week 1, Monday 2026-11-23 is Week 2, Monday 2026-11-30 returns to Week 1 (2-week cycle)
  assert.equal(getMondayDateKey('2026-11-15'), '2026-11-09'); // Sunday belongs to previous Monday's week
  assert.equal(getMondayDateKey('2026-11-18'), '2026-11-16');

  const weeklyCfg = { cycleWeeks: 2, anchorMonday: '2026-11-16' };
  const week1Info = getActiveRotationWeek('2026-11-18', weeklyCfg);
  assert.equal(week1Info.currentWeek, 1);
  assert.equal(week1Info.nextWeek, 2);

  const week2Info = getActiveRotationWeek('2026-11-24', weeklyCfg);
  assert.equal(week2Info.currentWeek, 2);
  assert.equal(week2Info.nextWeek, 1);

  const week3Info = getActiveRotationWeek('2026-11-30', weeklyCfg);
  assert.equal(week3Info.currentWeek, 1);

  const petugasMinggu1 = {
    scheduledDays: ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] as Officer['scheduledDays'],
    scheduledWeeks: [1],
    shiftStart: '06:30',
    shiftEnd: '08:30',
  };
  const petugasMinggu2 = {
    ...petugasMinggu1,
    scheduledWeeks: [2],
  };

  // On Monday Nov 16 07:15 (Week 1): Petugas 1 allowed, Petugas 2 blocked
  const monWeek1 = new Date('2026-11-16T07:15:00+07:00');
  assert.equal(getScheduleStatus(petugasMinggu1, monWeek1, undefined, weeklyCfg).allowed, true);
  const blockedW2 = getScheduleStatus(petugasMinggu2, monWeek1, undefined, weeklyCfg);
  assert.equal(blockedW2.allowed, false);
  assert.equal(blockedW2.isWeekMatch, false);
  assert.ok(blockedW2.reason.includes('Minggu ke-1'));

  // On Monday Nov 23 07:15 (Week 2): Petugas 1 blocked, Petugas 2 allowed
  const monWeek2 = new Date('2026-11-23T07:15:00+07:00');
  assert.equal(getScheduleStatus(petugasMinggu1, monWeek2, undefined, weeklyCfg).allowed, false);
  assert.equal(getScheduleStatus(petugasMinggu2, monWeek2, undefined, weeklyCfg).allowed, true);

  // Simulation week override allows testing Week 2 on Week 1
  const simWeek2 = getScheduleStatus(
    petugasMinggu2,
    monWeek1,
    { enabled: true, simulatedTime: '07:15', simulatedDay: 'Senin', simulatedWeek: 2 },
    weeklyCfg
  );
  assert.equal(simWeek2.allowed, true);

  // Shifting anchorMonday so current week becomes Week 2 also advances Week 1 -> Week 2 on next Monday
  const shiftedAnchor = shiftAnchorMondayForTargetWeek('2026-11-16', 2, 2);
  const shiftedCfg = { cycleWeeks: 2, anchorMonday: shiftedAnchor };
  assert.equal(getActiveRotationWeek('2026-11-16', shiftedCfg).currentWeek, 2);
  assert.equal(getActiveRotationWeek('2026-11-23', shiftedCfg).currentWeek, 1);

  // Round-robin auto-distribution keeps developer/admin on all weeks and splits petugas evenly
  const dist = assignWeeklyRotationDistribution(
    [
      { id: 'dev', role: 'developer' },
      { id: 'adm', role: 'admin' },
      { id: 'p1', role: 'petugas' },
      { id: 'p2', role: 'petugas' },
      { id: 'p3', role: 'petugas' },
      { id: 'p4', role: 'petugas' },
    ],
    2
  );
  assert.deepEqual(dist.get('dev'), [1, 2, 3, 4]);
  assert.deepEqual(dist.get('adm'), [1, 2, 3, 4]);
  assert.deepEqual(dist.get('p1'), [1]);
  assert.deepEqual(dist.get('p2'), [2]);
  assert.deepEqual(dist.get('p3'), [1]);
  assert.deepEqual(dist.get('p4'), [2]);

  assert.equal(formatScheduledWeeksLabel([1, 2], 2), 'Semua Minggu');
  assert.equal(formatScheduledWeeksLabel([1], 2), 'Minggu 1');
  assert.equal(formatScheduledWeeksLabel([1, 3], 4), 'Minggu 1, Minggu 3');
});

test('calculateDailyOfficerProductivity summarizes total violations and per-officer productivity', () => {
  const officers = [
    { id: 'off-1', name: 'Nadia Putri', division: 'Sekbid Kesiswaan' },
    { id: 'off-2', name: 'Rizky Pratama', division: 'Sekbid Kedisiplinan' },
  ];

  const emptySummary = calculateDailyOfficerProductivity(undefined, officers);
  assert.equal(emptySummary.totalViolations, 0);
  assert.equal(emptySummary.totalPoints, 0);
  assert.equal(emptySummary.uniqueStudents, 0);
  assert.equal(emptySummary.officers.length, 0);

  let sheet = createOrJoinDailySpreadsheet(
    [],
    '2026-11-16',
    'Senin',
    { id: 'off-1', name: 'Nadia Putri' },
    '2026-11-16T07:00:00.000Z'
  ).spreadsheet;
  sheet = createOrJoinDailySpreadsheet(
    [sheet],
    '2026-11-16',
    'Senin',
    { id: 'off-2', name: 'Rizky Pratama' },
    '2026-11-16T07:02:00.000Z'
  ).spreadsheet;

  sheet = addViolationToSpreadsheet(
    sheet,
    { id: 'off-1', name: 'Nadia Putri' },
    {
      studentName: 'Abdi Pamungkas',
      studentNis: '-',
      kelas: '10A',
      violationCode: 'A1',
      violationLabel: 'Terlambat masuk sekolah',
      category: 'A. Kedisiplinan & Kehadiran',
      points: 5,
      actionTaken: 'Pembinaan pagi',
      notes: '',
    },
    '2026-11-16T07:05:00.000Z',
    '07:05',
    'viol-p1'
  );
  sheet = addViolationToSpreadsheet(
    sheet,
    { id: 'off-1', name: 'Nadia Putri' },
    {
      studentName: 'Abdi Pamungkas',
      studentNis: '-',
      kelas: '10A',
      violationCode: 'E1',
      violationLabel: 'Atribut tidak lengkap',
      category: 'E. Kerapian',
      points: 5,
      actionTaken: 'Teguran',
      notes: '',
    },
    '2026-11-16T07:10:00.000Z',
    '07:10',
    'viol-p2'
  );
  sheet = addViolationToSpreadsheet(
    sheet,
    { id: 'off-2', name: 'Rizky Pratama' },
    {
      studentName: 'Nurlia Estiningsih',
      studentNis: '-',
      kelas: '11D',
      violationCode: 'E2',
      violationLabel: 'Rambut gondrong',
      category: 'E. Kerapian',
      points: 10,
      actionTaken: 'Penyitaan HP',
      notes: '',
    },
    '2026-11-16T07:12:00.000Z',
    '07:12',
    'viol-p3'
  );
  sheet = toggleOfficerFinished(sheet, 'off-1', true, '2026-11-16T08:00:00.000Z');

  const populated = calculateDailyOfficerProductivity(sheet, officers);
  assert.equal(populated.totalViolations, 3);
  assert.equal(populated.totalPoints, 20);
  assert.equal(populated.uniqueStudents, 2);
  assert.equal(populated.activeOfficerCount, 2);
  assert.equal(populated.recordingOfficerCount, 2);
  assert.equal(populated.averagePerRecordingOfficer, 1.5);
  assert.equal(populated.officers[0].officerId, 'off-1');
  assert.equal(populated.officers[0].violationCount, 2);
  assert.equal(populated.officers[0].totalPoints, 10);
  assert.equal(populated.officers[0].percentage, 67);
  assert.equal(populated.officers[0].isFinished, true);
  assert.equal(populated.officers[1].officerId, 'off-2');
  assert.equal(populated.officers[1].violationCount, 1);
  assert.equal(populated.officers[1].percentage, 33);
  assert.equal(populated.officers[1].isFinished, false);
});

test('removeOfficerFromActiveSpreadsheet prevents stuck consensus when an active officer account is deleted, and RBAC helpers validate row/profile edits', () => {
  let sheet: DailySpreadsheet = {
    id: 'sheet-2026-11-16',
    date: '2026-11-16',
    hari: 'Senin',
    title: 'Spreadsheet Piket',
    status: 'ACTIVE',
    createdAt: '2026-11-16T06:40:00.000Z',
    createdById: 'off-1',
    createdByName: 'Petugas Satu',
    activeOfficers: ['off-1', 'off-2'],
    finishedOfficers: ['off-1'],
    rows: [],
  };

  // off-1 already finished, off-2 has NOT finished yet. Now off-2 account is deleted:
  sheet = removeOfficerFromActiveSpreadsheet(sheet, 'off-2', '2026-11-16T08:10:00.000Z');
  assert.deepEqual(sheet.activeOfficers, ['off-1']);
  assert.deepEqual(sheet.finishedOfficers, ['off-1']);
  assert.equal(sheet.status, 'FINALIZED');
  assert.equal(getConsensusProgress(sheet).exportUnlocked, true);

  // Row edit/delete RBAC
  assert.equal(canModifyViolationRow({ id: 'off-1', role: 'petugas' }, { recordedById: 'off-1' }), true);
  assert.equal(canModifyViolationRow({ id: 'off-2', role: 'petugas' }, { recordedById: 'off-1' }), false);
  assert.equal(canModifyViolationRow({ id: 'adm-1', role: 'admin' }, { recordedById: 'off-1' }), true);
  assert.equal(canModifyViolationRow({ id: 'dev-1', role: 'developer' }, { recordedById: 'off-1' }), true);

  // Account profile edit RBAC
  assert.equal(canEditAccountProfile('developer', 'dev-1', { id: 'adm-1', role: 'admin', isProtected: false }), true);
  assert.equal(canEditAccountProfile('admin', 'adm-1', { id: 'off-1', role: 'petugas', isProtected: false }), true);
  assert.equal(canEditAccountProfile('admin', 'adm-1', { id: 'adm-2', role: 'admin', isProtected: false }), false);
  assert.equal(canEditAccountProfile('admin', 'adm-1', { id: 'adm-1', role: 'admin', isProtected: false }), true);
  assert.equal(canEditAccountProfile('petugas', 'off-1', { id: 'off-1', role: 'petugas', isProtected: false }), false);
});

test('finalized spreadsheets with empty activeOfficers unlock export and backend validators enforce bounds', () => {
  const finalizedEmpty: DailySpreadsheet = {
    id: 'sheet-2026-11-10',
    date: '2026-11-10',
    hari: 'Selasa',
    title: 'Spreadsheet Kosong Final',
    status: 'FINALIZED',
    createdAt: '2026-11-10T07:00:00.000Z',
    createdById: 'dev-1',
    createdByName: 'Developer',
    activeOfficers: [],
    finishedOfficers: [],
    finalizedAt: '2026-11-10T08:00:00.000Z',
    rows: [],
  };
  assert.equal(getConsensusProgress(finalizedEmpty).exportUnlocked, true);
  assert.equal(getConsensusProgress({ ...finalizedEmpty, status: 'ACTIVE' }).exportUnlocked, false);

  assert.ok(
    validateViolationInput({
      studentName: 'Budi',
      studentNis: '1234',
      kelas: '10A',
      violationLabel: 'Terlambat',
      category: 'Z. Tidak Valid' as any,
      points: 5,
      actionTaken: 'Catat',
      notes: '',
    })
  );

  assert.ok(validatePresetInput({ label: 'Test', category: 'E. Kerapian', points: 101 }));
  assert.ok(validatePresetInput({ label: 'Test', category: 'E. Kerapian', points: 5.5 }));
  assert.equal(validatePresetInput({ label: 'Test', category: 'E. Kerapian', points: 15 }), null);

  assert.ok(
    validateOfficerScheduleInput({
      scheduledDays: [],
      shiftStart: '06:30',
      shiftEnd: '08:30',
    })
  );
  assert.ok(
    validateOfficerScheduleInput({
      scheduledDays: ['Senin'],
      shiftStart: '09:00',
      shiftEnd: '08:00',
    })
  );
  assert.equal(
    validateOfficerScheduleInput({
      scheduledDays: ['Senin', 'Kamis'],
      shiftStart: '06:30',
      shiftEnd: '08:30',
    }),
    null
  );
});

test('connectionLogic derives offline, server-unreachable, reconnecting, and reconnected states accurately', () => {
  assert.equal(isReachableApiResponse(200, 'application/json'), true);
  assert.equal(isReachableApiResponse(401, 'application/json'), true);
  assert.equal(isReachableApiResponse(502, 'text/plain'), false);
  assert.equal(isReachableApiResponse(503, 'application/json'), false);
  assert.equal(isReachableApiResponse(200, 'text/html; charset=utf-8'), false);

  assert.equal(
    deriveConnectionStatus({ browserOnline: false, serverReachable: false, isChecking: false }),
    'offline'
  );
  assert.equal(
    deriveConnectionStatus({ browserOnline: true, serverReachable: false, isChecking: false }),
    'server-unreachable'
  );
  assert.equal(
    deriveConnectionStatus({ browserOnline: true, serverReachable: false, isChecking: true }),
    'reconnecting'
  );
  assert.equal(
    deriveConnectionStatus({ browserOnline: true, serverReachable: true, isChecking: false }),
    'online'
  );

  const offlineBanner = getConnectionBannerInfo({ status: 'offline', justReconnected: false });
  assert.equal(offlineBanner.visible, true);
  assert.equal(offlineBanner.tone, 'red');
  assert.equal(offlineBanner.role, 'alert');
  assert.equal(offlineBanner.actionLabel, 'Cek Koneksi');

  const serverDownBanner = getConnectionBannerInfo({
    status: 'server-unreachable',
    justReconnected: false,
  });
  assert.equal(serverDownBanner.visible, true);
  assert.equal(serverDownBanner.actionLabel, 'Coba Sambungkan');

  const recoveredBanner = getConnectionBannerInfo({ status: 'online', justReconnected: true });
  assert.equal(recoveredBanner.visible, true);
  assert.equal(recoveredBanner.tone, 'emerald');

  const hiddenBanner = getConnectionBannerInfo({ status: 'online', justReconnected: false });
  assert.equal(hiddenBanner.visible, false);
});

test('validateDailySessionInput, getAutoSessionWindowStatus, and evaluateAutoSpreadsheetLifecycle automate daily open/close by time', () => {
  assert.ok(validateDailySessionInput({ activeDays: [], startTime: '06:30', endTime: '08:30' }));
  assert.ok(validateDailySessionInput({ activeDays: ['Senin'], startTime: '08:30', endTime: '08:30' }));
  assert.ok(validateDailySessionInput({ activeDays: ['Senin'], startTime: '09:00', endTime: '08:30' }));
  assert.ok(validateDailySessionInput({ activeDays: ['Senin'], startTime: '25:00', endTime: '08:30' }));
  assert.equal(
    validateDailySessionInput({
      activeDays: ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
      startTime: '06:30',
      endTime: '08:30',
    }),
    null
  );

  const mondayBase = new Date('2026-11-16T07:00:00+07:00');
  const sundayDate = new Date('2026-11-15T07:15:00+07:00');

  const sundayStatus = getAutoSessionWindowStatus(DEFAULT_DAILY_SESSION_CONFIG, sundayDate);
  assert.equal(sundayStatus.isActiveDay, false);
  assert.equal(sundayStatus.phase, 'NON_ACTIVE_DAY');

  const beforeStart = getAutoSessionWindowStatus(DEFAULT_DAILY_SESSION_CONFIG, mondayBase, {
    enabled: true,
    unrestricted: false,
    simulatedDay: 'Senin',
    simulatedTime: '06:00',
  });
  assert.equal(beforeStart.phase, 'BEFORE_START');
  assert.equal(beforeStart.minutesUntilStart, 30);

  const openWindow = getAutoSessionWindowStatus(DEFAULT_DAILY_SESSION_CONFIG, mondayBase, {
    enabled: true,
    unrestricted: false,
    simulatedDay: 'Senin',
    simulatedTime: '07:15',
  });
  assert.equal(openWindow.phase, 'OPEN');
  assert.equal(openWindow.minutesUntilClose, 75);

  const closedWindow = getAutoSessionWindowStatus(DEFAULT_DAILY_SESSION_CONFIG, mondayBase, {
    enabled: true,
    unrestricted: false,
    simulatedDay: 'Senin',
    simulatedTime: '08:30',
  });
  assert.equal(closedWindow.phase, 'CLOSED');

  // Before startTime: no spreadsheet created automatically
  const beforeEval = evaluateAutoSpreadsheetLifecycle(
    [],
    DEFAULT_DAILY_SESSION_CONFIG,
    mondayBase,
    { enabled: true, unrestricted: false, simulatedDay: 'Senin', simulatedTime: '06:00' },
    '2026-11-16T06:00:00+07:00'
  );
  assert.equal(beforeEval.changedSheets.length, 0);

  // At OPEN time: today's spreadsheet is automatically created as ACTIVE
  const openEval = evaluateAutoSpreadsheetLifecycle(
    [],
    DEFAULT_DAILY_SESSION_CONFIG,
    mondayBase,
    { enabled: true, unrestricted: false, simulatedDay: 'Senin', simulatedTime: '07:15' },
    '2026-11-16T07:15:00+07:00'
  );
  assert.equal(openEval.changedSheets.length, 1);
  const autoOpened = openEval.changedSheets[0];
  assert.equal(autoOpened.date, '2026-11-16');
  assert.equal(autoOpened.status, 'ACTIVE');
  assert.equal(autoOpened.createdById, 'system-auto');
  assert.equal(getConsensusProgress(autoOpened).exportUnlocked, false);

  // At CLOSED time with NO records: empty sheet is not saved at all (and none is created)
  const emptyClosedEval = evaluateAutoSpreadsheetLifecycle(
    [autoOpened],
    DEFAULT_DAILY_SESSION_CONFIG,
    mondayBase,
    { enabled: true, unrestricted: false, simulatedDay: 'Senin', simulatedTime: '08:30' },
    '2026-11-16T08:30:00+07:00'
  );
  assert.equal(emptyClosedEval.changedSheets.length, 0);
  assert.deepEqual(emptyClosedEval.deletedSheetIds, [autoOpened.id]);

  const noSheetClosedEval = evaluateAutoSpreadsheetLifecycle(
    [],
    DEFAULT_DAILY_SESSION_CONFIG,
    mondayBase,
    { enabled: true, unrestricted: false, simulatedDay: 'Senin', simulatedTime: '09:00' },
    '2026-11-16T09:00:00+07:00'
  );
  assert.equal(noSheetClosedEval.changedSheets.length, 0);
  assert.equal(noSheetClosedEval.deletedSheetIds.length, 0);

  // At CLOSED time with records: ACTIVE sheet transitions automatically to FINALIZED & unlocks export
  const sampleRow: ViolationEntry = {
    id: 'viol-sample-1',
    timestamp: '2026-11-16T07:20:00+07:00',
    timeLabel: '07:20',
    studentName: 'Siswa Contoh',
    studentNis: '-',
    kelas: 'X-1',
    violationCode: 'A1',
    violationLabel: 'Terlambat',
    category: 'A. Kedisiplinan & Kehadiran',
    points: 5,
    actionTaken: 'Teguran Lisan & Catat',
    notes: '',
    recordedById: 'o1',
    recordedByName: 'Petugas',
  };
  const autoOpenedWithRow: DailySpreadsheet = { ...autoOpened, rows: [sampleRow] };
  const closedEval = evaluateAutoSpreadsheetLifecycle(
    [autoOpenedWithRow],
    DEFAULT_DAILY_SESSION_CONFIG,
    mondayBase,
    { enabled: true, unrestricted: false, simulatedDay: 'Senin', simulatedTime: '08:30' },
    '2026-11-16T08:30:00+07:00'
  );
  assert.equal(closedEval.changedSheets.length, 1);
  const autoClosed = closedEval.changedSheets[0];
  assert.equal(autoClosed.status, 'FINALIZED');
  assert.equal(getConsensusProgress(autoClosed).exportUnlocked, true);

  // Extending endTime puts the day back in OPEN -> auto-finalized sheet reopens automatically
  const extendedEval = evaluateAutoSpreadsheetLifecycle(
    [autoClosed],
    { ...DEFAULT_DAILY_SESSION_CONFIG, endTime: '10:00' },
    mondayBase,
    { enabled: true, unrestricted: false, simulatedDay: 'Senin', simulatedTime: '09:00' },
    '2026-11-16T09:00:00+07:00'
  );
  assert.equal(extendedEval.changedSheets.length, 1);
  assert.equal(extendedEval.changedSheets[0].status, 'ACTIVE');

  // Manually reopened sheet stays ACTIVE during CLOSED until coordinator manually closes it
  const reopenedManual: DailySpreadsheet = {
    ...autoClosed,
    status: 'ACTIVE',
    reopenedManually: true,
  };
  const keepReopenedEval = evaluateAutoSpreadsheetLifecycle(
    [reopenedManual],
    DEFAULT_DAILY_SESSION_CONFIG,
    mondayBase,
    { enabled: true, unrestricted: false, simulatedDay: 'Senin', simulatedTime: '10:00' },
    '2026-11-16T10:00:00+07:00'
  );
  assert.equal(keepReopenedEval.changedSheets.length, 0);

  // Past-day stale ACTIVE sheet is auto-finalized automatically
  const stalePastSheet: DailySpreadsheet = {
    ...autoOpened,
    id: 'sheet-2026-11-14',
    date: '2026-11-14',
    hari: 'Sabtu',
    reopenedManually: false,
    rows: [sampleRow],
  };
  const pastFinalizeEval = evaluateAutoSpreadsheetLifecycle(
    [stalePastSheet],
    DEFAULT_DAILY_SESSION_CONFIG,
    mondayBase,
    { enabled: true, unrestricted: false, simulatedDay: 'Senin', simulatedTime: '06:00' },
    '2026-11-16T06:00:00+07:00'
  );
  assert.equal(pastFinalizeEval.changedSheets.length, 1);
  assert.equal(pastFinalizeEval.changedSheets[0].status, 'FINALIZED');

  // Past-day stale ACTIVE sheet WITHOUT records is dropped instead of finalized
  const pastEmptyEval = evaluateAutoSpreadsheetLifecycle(
    [{ ...stalePastSheet, rows: [] }],
    DEFAULT_DAILY_SESSION_CONFIG,
    mondayBase,
    { enabled: true, unrestricted: false, simulatedDay: 'Senin', simulatedTime: '06:00' },
    '2026-11-16T06:00:00+07:00'
  );
  assert.equal(pastEmptyEval.changedSheets.length, 0);
  assert.deepEqual(pastEmptyEval.deletedSheetIds, ['sheet-2026-11-14']);
});

test('holiday periods (single day, range, whole week) block the automatic spreadsheet', () => {
  const mondayBase = new Date('2026-11-16T00:30:00Z');
  const sim = { enabled: true, unrestricted: false, simulatedDay: 'Senin' as const, simulatedTime: '07:15' };

  assert.equal(validateDailySessionInput({ activeDays: ['Senin'], startTime: '06:30', endTime: '08:30', holidays: 'x' }) !== null, true);
  assert.equal(
    validateDailySessionInput({
      activeDays: ['Senin'],
      startTime: '06:30',
      endTime: '08:30',
      holidays: [{ startDate: '2026-13-40' }],
    }) !== null,
    true
  );

  const holidays = normalizeHolidays([
    { id: 'a', startDate: '2026-11-18', endDate: '2026-11-16', label: ' Libur Semester ' },
    { startDate: 'bukan-tanggal', endDate: '2026-11-20', label: 'x' },
    { startDate: '2026-12-25', label: 'Natal' },
  ]);
  assert.equal(holidays.length, 2);
  assert.equal(holidays[0].startDate, '2026-11-16'); // tanggal terbalik otomatis ditukar
  assert.equal(holidays[0].endDate, '2026-11-18');
  assert.equal(holidays[0].label, 'Libur Semester');
  assert.equal(holidays[1].endDate, '2026-12-25'); // libur 1 hari

  assert.ok(findHolidayForDate(holidays, '2026-11-17'));
  assert.equal(findHolidayForDate(holidays, '2026-11-19'), undefined);

  const config = { ...DEFAULT_DAILY_SESSION_CONFIG, holidays };
  const windowStatus = getAutoSessionWindowStatus(config, mondayBase, sim);
  assert.equal(windowStatus.phase, 'NON_ACTIVE_DAY');
  assert.equal(windowStatus.isHoliday, true);
  assert.equal(windowStatus.holidayLabel, 'Libur Semester');

  // Hari libur: tidak ada spreadsheet yang dibuat otomatis
  const holidayEval = evaluateAutoSpreadsheetLifecycle([], config, mondayBase, sim, '2026-11-16T07:15:00+07:00');
  assert.equal(holidayEval.changedSheets.length, 0);
  assert.equal(holidayEval.deletedSheetIds.length, 0);

  // Tanpa libur, hari yang sama OPEN seperti biasa
  const normalWindow = getAutoSessionWindowStatus(DEFAULT_DAILY_SESSION_CONFIG, mondayBase, sim);
  assert.equal(normalWindow.phase, 'OPEN');
});

test('motionMath computes clamped 3D tilt angles, glare coords, and cubic ease-out cleanly', () => {
  const center = calculateTiltTransform(0, 0, 8);
  assert.equal(center.rotateX, 0);
  assert.equal(center.rotateY, 0);
  assert.equal(center.glareX, 50);
  assert.equal(center.glareY, 50);

  const clamped = calculateTiltTransform(2.5, -2.5, 8);
  assert.equal(clamped.rotateY, 8);
  assert.equal(clamped.rotateX, 8);
  assert.equal(clamped.glareX, 100);
  assert.equal(clamped.glareY, 0);

  const safeNonFinite = calculateTiltTransform(Number.NaN, Number.POSITIVE_INFINITY, 6);
  assert.equal(safeNonFinite.rotateY, 0);
  assert.equal(safeNonFinite.rotateX, 0);

  const angled = calculateTiltTransform(-2, 0.5, 6);
  assert.equal(angled.rotateY, -6);
  assert.equal(angled.rotateX, -3);

  assert.equal(easeOutCubic(-1), 0);
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.5) > 0.85 && easeOutCubic(0.5) < 0.9);
});

test('studentImportLogic parses Excel/CSV matrices with flexible headers, deduplication, and lightweight clock patching', () => {
  assert.equal(normalizeStudentClass('Kelas 10a'), '10A');
  assert.equal(normalizeStudentClass(' 11d '), '11D');

  const matrixWithTitleAndHeaders: unknown[][] = [
    ['SMA NEGERI 1 KEMANGKON'],
    ['DAFTAR SISWA TAHUN AJARAN BARU'],
    [],
    ['No', 'NIS', 'Nama Lengkap', 'Kelas'],
    ['1', '3201', 'Budi Santoso', '10a'],
    ['2', '', 'Siti Aminah', 'Kelas 11B'],
    ['3', '', 'Budi Santoso', '10A'], // duplicate without NIS should merge
    ['4', '3204', '', '10C'], // missing name -> skipped
    ['5', '3205', 'Andi Wijaya', ''], // missing class -> skipped
    ['6', '3206', 'Siti Aminah', '11B'], // duplicate bringing NIS should enrich
  ];

  const parsed = parseStudentRosterRows(matrixWithTitleAndHeaders);
  assert.equal(parsed.headerRowNumber, 4);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.duplicateCount, 2);
  assert.equal(parsed.skipped.length, 2);
  assert.deepEqual(parsed.entries[0], { name: 'Budi Santoso', kelas: '10A', nis: '3201' });
  assert.deepEqual(parsed.entries[1], { name: 'Siti Aminah', kelas: '11B', nis: '3206' });

  // Headerless fallback: Nama | Kelas | NIS
  const headerless = parseStudentRosterRows([
    ['Rina Putri', '12A', '2901'],
    ['Dika Pratama', '12B'],
  ]);
  assert.equal(headerless.headerRowNumber, null);
  assert.equal(headerless.entries.length, 2);
  assert.deepEqual(headerless.entries[1], { name: 'Dika Pratama', kelas: '12B', nis: '-' });

  // Clock patch helper keeps referential equality when clock unchanged
  const mockState: import('./types').PublicAppState = {
    officers: [],
    presets: [],
    students: [],
    spreadsheets: [],
    simulation: { enabled: false, simulatedTime: '07:15', simulatedDay: null, simulatedWeek: null },
    weeklySchedule: { cycleWeeks: 2, anchorMonday: '2026-11-16' },
    dailySession: DEFAULT_DAILY_SESSION_CONFIG,
    serverDate: '2026-11-16',
    serverTime: '07:15',
    serverHari: 'Senin',
    stateVersion: 'abc-1',
  };
  const sameRef = applyClockPatchToAppState(mockState, {
    serverDate: '2026-11-16',
    serverTime: '07:15',
    serverHari: 'Senin',
  });
  assert.equal(sameRef, mockState);

  const ticked = applyClockPatchToAppState(mockState, {
    serverDate: '2026-11-16',
    serverTime: '07:16',
    serverHari: 'Senin',
  });
  assert.notEqual(ticked, mockState);
  assert.equal(ticked?.serverTime, '07:16');
  assert.equal(ticked?.stateVersion, 'abc-1');
});

test('DEFAULT_WEEKLY_ROTATION_CONFIG places Sunday 2026-11-15 in Minggu 2 and Monday 2026-11-16 in Minggu 3', () => {
  const sundayNov15 = getActiveRotationWeek('2026-11-15', DEFAULT_WEEKLY_ROTATION_CONFIG);
  assert.equal(sundayNov15.cycleWeeks, 4);
  assert.equal(sundayNov15.currentWeek, 2);
  assert.equal(sundayNov15.nextWeek, 3);

  const mondayNov16 = getActiveRotationWeek('2026-11-16', DEFAULT_WEEKLY_ROTATION_CONFIG);
  assert.equal(mondayNov16.currentWeek, 3);
  assert.equal(mondayNov16.nextWeek, 4);

  const mondayNov23 = getActiveRotationWeek('2026-11-23', DEFAULT_WEEKLY_ROTATION_CONFIG);
  assert.equal(mondayNov23.currentWeek, 4);
  assert.equal(mondayNov23.nextWeek, 1);

  const mondayNov30 = getActiveRotationWeek('2026-11-30', DEFAULT_WEEKLY_ROTATION_CONFIG);
  assert.equal(mondayNov30.currentWeek, 1);
});

import {
  MAX_BATCH_VIOLATION_ROWS,
  buildBatchColumnEntries,
  buildBatchViolationInputs,
  createEmptyBatchColumnRow,
  filterStudentsByClassAndQuery,
  getOrderedViolationOptions,
  getQuickPickPresetsWithRecent,
  getSortedStudentClasses,
} from './batchViolationLogic';
import type { ViolationEntry, ViolationPreset } from './types';

test('batchViolationLogic builds Cartesian batch entries, enforces max cap, sorts classes, and prioritizes recent/today presets', () => {
  const students = [
    { key: '1', id: 's1', name: 'Abdi Pamungkas', kelas: '10A', nis: '', saveToStudentDirectory: false },
    { key: '2', id: 's2', name: 'Nurlia Estiningsih', kelas: '11D', nis: '', saveToStudentDirectory: false },
  ];
  const rules = [
    {
      key: 'r1',
      presetId: 'p-a1',
      violationCode: 'A1',
      violationLabel: 'Terlambat masuk sekolah',
      category: 'A. Kedisiplinan & Kehadiran' as const,
      points: 5,
      actionTaken: 'Pembinaan pagi',
    },
    {
      key: 'r2',
      presetId: 'p-e1',
      violationCode: 'E1',
      violationLabel: 'Atribut tidak lengkap',
      category: 'E. Kerapian' as const,
      points: 5,
      actionTaken: 'Lengkapi atribut',
    },
  ];

  const built = buildBatchViolationInputs(students, rules, 'Razia gerbang pagi');
  assert.equal(built.error, null);
  assert.equal(built.entries.length, 4);
  assert.equal(built.entries[0].studentName, 'Abdi Pamungkas');
  assert.equal(built.entries[0].violationCode, 'A1');
  assert.equal(built.entries[1].studentName, 'Abdi Pamungkas');
  assert.equal(built.entries[1].violationCode, 'E1');
  assert.equal(built.entries[2].studentName, 'Nurlia Estiningsih');
  assert.equal(built.entries[3].notes, 'Razia gerbang pagi');

  // Empty & over-limit validation
  assert.ok(buildBatchViolationInputs([], rules, '').error);
  assert.ok(buildBatchViolationInputs(students, [], '').error);
  const tooManyStudents = Array.from({ length: MAX_BATCH_VIOLATION_ROWS }, (_, i) => ({
    key: `k-${i}`,
    name: `Siswa ${i}`,
    kelas: '10A',
    nis: '',
  }));
  assert.ok(buildBatchViolationInputs(tooManyStudents, rules, '').error);

  // Class sorting & filtering
  const sortedClasses = getSortedStudentClasses([
    { id: '1', nis: '-', name: 'Zaki', kelas: '12B' },
    { id: '2', nis: '-', name: 'Abdi', kelas: '10A' },
    { id: '3', nis: '-', name: 'Budi', kelas: '10B' },
    { id: '4', nis: '-', name: 'Cici', kelas: '11A' },
  ]);
  assert.deepEqual(sortedClasses, ['10A', '10B', '11A', '12B']);

  const filtered10A = filterStudentsByClassAndQuery(SMAN1_KEMANGKON_STUDENTS, '10A', 'abdi');
  assert.equal(filtered10A.length >= 1, true);
  assert.equal(filtered10A[0].name, 'Abdi Pamungkas');

  // Quick-pick prioritizes session recents and today's frequent codes, then defaults
  const samplePresets: ViolationPreset[] = [
    { id: 'p-a1', code: 'A1', label: 'Terlambat', category: 'A. Kedisiplinan & Kehadiran', points: 5, defaultAction: 'Catat' },
    { id: 'p-c2', code: 'C2', label: 'Knalpot Brong', category: 'C. Penggunaan Sepeda Motor', points: 15, defaultAction: 'Sita' },
    { id: 'p-e1', code: 'E1', label: 'Atribut', category: 'E. Kerapian', points: 5, defaultAction: 'Lengkapi' },
    { id: 'p-d1', code: 'D1', label: 'Main HP', category: 'D. Penggunaan Teknologi', points: 10, defaultAction: 'Sita HP' },
  ];
  const todayRows: ViolationEntry[] = [
    {
      id: 'v1', timestamp: '2026-11-16T07:05:00Z', timeLabel: '07:05', studentName: 'A', studentNis: '-',
      kelas: '10A', violationCode: 'D1', violationLabel: 'Main HP', category: 'D. Penggunaan Teknologi',
      points: 10, actionTaken: 'Sita HP', notes: '', recordedById: 'o1', recordedByName: 'O1',
    },
    {
      id: 'v2', timestamp: '2026-11-16T07:06:00Z', timeLabel: '07:06', studentName: 'B', studentNis: '-',
      kelas: '10A', violationCode: 'D1', violationLabel: 'Main HP', category: 'D. Penggunaan Teknologi',
      points: 10, actionTaken: 'Sita HP', notes: '', recordedById: 'o1', recordedByName: 'O1',
    },
  ];

  const quickPicks = getQuickPickPresetsWithRecent(samplePresets, todayRows, ['p-c2'], 4);
  assert.equal(quickPicks[0].preset.code, 'C2'); // Recent session pick comes first
  assert.equal(quickPicks[1].preset.code, 'D1'); // Today's most frequent comes next
  assert.equal(quickPicks[1].todayCount, 2);
  assert.equal(quickPicks[2].preset.code, 'A1'); // Morning default fills remaining
});

test('unrestricted Mode Uji Coba lifts all time, day, week, and auto-close limits until turned off', () => {
  const trialOn = {
    enabled: true,
    simulatedTime: '07:15',
    simulatedDay: 'Senin' as const,
    simulatedWeek: 1,
  };
  assert.equal(isUnrestrictedTrialMode(trialOn), true);
  assert.equal(isUnrestrictedTrialMode({ ...trialOn, unrestricted: false }), false);
  assert.equal(isUnrestrictedTrialMode({ ...trialOn, enabled: false }), false);

  // Sunday late night (23:30) and off-duty week/day/hours
  const sundayNight = new Date('2026-11-15T23:30:00+07:00');
  const offDutyOfficer: Pick<Officer, 'scheduledDays' | 'shiftStart' | 'shiftEnd' | 'scheduledWeeks'> = {
    scheduledDays: ['Rabu'],
    scheduledWeeks: [4],
    shiftStart: '06:30',
    shiftEnd: '07:30',
  };

  // Normal enforcement blocks off-duty officer on Sunday night
  const normalSchedule = getScheduleStatus(
    offDutyOfficer,
    sundayNight,
    { enabled: false, simulatedTime: '07:15', simulatedDay: null, simulatedWeek: null },
    DEFAULT_WEEKLY_ROTATION_CONFIG
  );
  assert.equal(normalSchedule.allowed, false);

  // Unrestricted Trial Mode unlocks schedule, keeps real clock (23:30 Minggu), and opens sheet indefinitely
  const trialSchedule = getScheduleStatus(
    offDutyOfficer,
    sundayNight,
    trialOn,
    DEFAULT_WEEKLY_ROTATION_CONFIG
  );
  assert.equal(trialSchedule.allowed, true);
  assert.equal(trialSchedule.isWeekMatch, true);
  assert.equal(trialSchedule.isDayMatch, true);
  assert.equal(trialSchedule.isTimeMatch, true);
  assert.equal(trialSchedule.currentHari, 'Minggu');
  assert.equal(trialSchedule.currentTime, '23:30');

  const trialWindow = getAutoSessionWindowStatus(DEFAULT_DAILY_SESSION_CONFIG, sundayNight, trialOn);
  assert.equal(trialWindow.isActiveDay, true);
  assert.equal(trialWindow.phase, 'OPEN');

  // Even a finalized today's sheet is reopened unconditionally during unrestricted Trial Mode
  const finalizedSundaySheet: DailySpreadsheet = {
    id: 'sheet-2026-11-15',
    date: '2026-11-15',
    hari: 'Minggu',
    title: 'Spreadsheet Piket',
    status: 'FINALIZED',
    createdAt: '2026-11-15T06:30:00+07:00',
    createdById: 'system-auto',
    createdByName: 'Sistem Otomatis',
    activeOfficers: [],
    finishedOfficers: [],
    reopenedManually: true,
    finalizedAt: '2026-11-15T08:30:00+07:00',
    rows: [],
  };
  const evalReopen = evaluateAutoSpreadsheetLifecycle(
    [finalizedSundaySheet],
    DEFAULT_DAILY_SESSION_CONFIG,
    sundayNight,
    trialOn,
    '2026-11-15T23:30:00+07:00'
  );
  assert.equal(evalReopen.changedSheets.length, 1);
  assert.equal(evalReopen.changedSheets[0].status, 'ACTIVE');

  // Turning Trial Mode OFF restores normal Sunday non-active day enforcement
  const evalAfterOff = evaluateAutoSpreadsheetLifecycle(
    [evalReopen.changedSheets[0]],
    DEFAULT_DAILY_SESSION_CONFIG,
    sundayNight,
    { ...trialOn, enabled: false },
    '2026-11-15T23:31:00+07:00'
  );
  assert.equal(evalAfterOff.windowStatus.phase, 'NON_ACTIVE_DAY');
});

test('paginateItems handles empty lists, page clamping, and ALL mode', () => {
  const empty = paginateItems([], 3, 15);
  assert.equal(empty.items.length, 0);
  assert.equal(empty.page, 1);
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.startIndex, 0);
  assert.equal(empty.endIndex, 0);

  const items = Array.from({ length: 35 }, (_, i) => i + 1);
  const page2 = paginateItems(items, 2, 15);
  assert.equal(page2.page, 2);
  assert.equal(page2.totalPages, 3);
  assert.equal(page2.startIndex, 16);
  assert.equal(page2.endIndex, 30);
  assert.deepEqual(page2.items.slice(0, 3), [16, 17, 18]);

  const clampedHigh = paginateItems(items, 99, 15);
  assert.equal(clampedHigh.page, 3);
  assert.equal(clampedHigh.startIndex, 31);
  assert.equal(clampedHigh.endIndex, 35);
  assert.equal(clampedHigh.items.length, 5);

  const allMode = paginateItems(items, 2, 'ALL');
  assert.equal(allMode.page, 1);
  assert.equal(allMode.totalPages, 1);
  assert.equal(allMode.startIndex, 1);
  assert.equal(allMode.endIndex, 35);
  assert.equal(allMode.items.length, 35);
});

test('batchViolationLogic per-column builder & recent/frequent violation option ordering', () => {
  const blank1 = createEmptyBatchColumnRow('r1');
  const blank2 = createEmptyBatchColumnRow('r2');

  // Completely blank rows produce validation notice
  assert.ok(buildBatchColumnEntries([blank1, blank2]).error);

  const populatedRow1 = {
    ...blank1,
    studentName: 'Abdi Pamungkas',
    kelas: '10a',
    nis: '',
    saveToStudentDirectory: true,
    presetId: 'p-a1',
    violationCode: 'A1',
    violationLabel: 'Terlambat masuk sekolah',
    category: 'A. Kedisiplinan & Kehadiran' as const,
    points: 5,
    actionTaken: 'Pembinaan pagi',
    notes: 'Gerbang timur',
  };

  // Second row for the same manual student should deduplicate saveToStudentDirectory
  const populatedRow2 = {
    ...blank2,
    studentName: 'Abdi Pamungkas',
    kelas: '10A',
    nis: '',
    saveToStudentDirectory: true,
    presetId: 'CUSTOM',
    violationCode: 'CUSTOM',
    violationLabel: 'Tidak memakai dasi',
    category: 'E. Kerapian' as const,
    points: 10,
    actionTaken: '',
    notes: '',
  };

  const blank3 = createEmptyBatchColumnRow('r3'); // trailing blank row ignored
  const built = buildBatchColumnEntries([populatedRow1, populatedRow2, blank3]);
  assert.equal(built.error, null);
  assert.equal(built.startedRowCount, 2);
  assert.equal(built.entries.length, 2);
  assert.equal(built.entries[0].kelas, '10A');
  assert.equal(built.entries[0].studentNis, '-');
  assert.equal(built.entries[0].saveToStudentDirectory, true);
  assert.equal(built.entries[1].saveToStudentDirectory, false);
  assert.equal(built.entries[1].actionTaken, 'Teguran Lisan & Catat');

  // Row validation errors catch missing kelas, missing violation, or invalid points
  assert.ok(buildBatchColumnEntries([{ ...populatedRow1, kelas: '' }]).error);
  assert.ok(buildBatchColumnEntries([{ ...populatedRow1, violationLabel: '' }]).error);
  assert.ok(buildBatchColumnEntries([{ ...populatedRow1, points: 0 }]).error);
  assert.ok(buildBatchColumnEntries([{ ...populatedRow1, points: 101 }]).error);

  // Recent & frequent ordering puts session recents first, then highest weighted count (today*3 + total), then defaults
  const samplePresets: ViolationPreset[] = [
    { id: 'p-a1', code: 'A1', label: 'Terlambat', category: 'A. Kedisiplinan & Kehadiran', points: 5, defaultAction: 'Catat' },
    { id: 'p-b1', code: 'B1', label: 'Ramai di Kelas', category: 'B. Perilaku & Sikap', points: 10, defaultAction: 'Tegur' },
    { id: 'p-d1', code: 'D1', label: 'Main HP', category: 'D. Penggunaan Teknologi', points: 15, defaultAction: 'Sita HP' },
    { id: 'p-e1', code: 'E1', label: 'Atribut', category: 'E. Kerapian', points: 5, defaultAction: 'Lengkapi' },
  ];

  const historySheets: DailySpreadsheet[] = [
    {
      id: 'sheet-old',
      date: '2026-11-15',
      hari: 'Sabtu',
      title: 'Arsip',
      status: 'FINALIZED',
      createdAt: '2026-11-15T07:00:00Z',
      createdById: 'o1',
      createdByName: 'O1',
      activeOfficers: ['o1'],
      finishedOfficers: ['o1'],
      rows: [
        {
          id: 'v-old-1', timestamp: '2026-11-15T07:05:00Z', timeLabel: '07:05',
          studentName: 'X', studentNis: '-', kelas: '10A', violationCode: 'B1',
          violationLabel: 'Ramai di Kelas', category: 'B. Perilaku & Sikap',
          points: 10, actionTaken: 'Tegur', notes: '', recordedById: 'o1', recordedByName: 'O1',
        },
        {
          id: 'v-old-2', timestamp: '2026-11-15T07:06:00Z', timeLabel: '07:06',
          studentName: 'Y', studentNis: '-', kelas: '10A', violationCode: 'B1',
          violationLabel: 'Ramai di Kelas', category: 'B. Perilaku & Sikap',
          points: 10, actionTaken: 'Tegur', notes: '', recordedById: 'o1', recordedByName: 'O1',
        },
      ],
    },
    {
      id: 'sheet-today',
      date: '2026-11-16',
      hari: 'Senin',
      title: 'Hari Ini',
      status: 'ACTIVE',
      createdAt: '2026-11-16T07:00:00Z',
      createdById: 'o1',
      createdByName: 'O1',
      activeOfficers: ['o1'],
      finishedOfficers: [],
      rows: [
        {
          id: 'v-today-1', timestamp: '2026-11-16T07:05:00Z', timeLabel: '07:05',
          studentName: 'Z', studentNis: '-', kelas: '10A', violationCode: 'D1',
          violationLabel: 'Main HP', category: 'D. Penggunaan Teknologi',
          points: 15, actionTaken: 'Sita HP', notes: '', recordedById: 'o1', recordedByName: 'O1',
        },
      ],
    },
  ];

  const ordered = getOrderedViolationOptions(samplePresets, historySheets, ['p-e1'], '2026-11-16', 4);
  assert.equal(ordered.topFrequentAndRecent[0].preset.code, 'E1'); // session recent first
  assert.equal(ordered.topFrequentAndRecent[0].isRecent, true);
  assert.equal(ordered.topFrequentAndRecent[1].preset.code, 'D1'); // today weight 3+1=4 beats old 2
  assert.equal(ordered.topFrequentAndRecent[2].preset.code, 'B1'); // historical frequent
  assert.equal(ordered.topFrequentAndRecent[2].totalCount, 2);
  assert.equal(ordered.topFrequentAndRecent[3].preset.code, 'A1'); // morning default
  assert.equal(ordered.byCategory.length, 4);
});




