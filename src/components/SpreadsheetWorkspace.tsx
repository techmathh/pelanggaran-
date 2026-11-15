import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Lock,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import {
  AKPS_CATEGORIES,
  SCHOOL_IDENTITY,
  calculateDailyOfficerProductivity,
  calculateStudentSummaries,
  formatIndonesianDateLabel,
  getConsensusProgress,
  getScheduleStatus,
  getTingkatPembinaan,
  groupViolationsByClass,
  isManagerRole,
  searchSimilarStudents,
} from '../shared/piketLogic';
import type {
  DailySpreadsheet,
  KategoriPelanggaran,
  PublicAppState,
  PublicOfficer,
  StudentRecord,
} from '../shared/types';
import { downloadSpreadsheetCsv, downloadSpreadsheetXlsx } from '../utils/exportSpreadsheet';
import { downloadVisualPdfReport } from '../utils/exportVisualPdf';
import { CuteMascot3D, type MascotMood } from './CuteMascot3D';
import { VisualReportModal } from './VisualReportModal';

interface SpreadsheetWorkspaceProps {
  officer: PublicOfficer;
  appState: PublicAppState;
  onStateUpdate: (nextState: PublicAppState) => void;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function SpreadsheetWorkspace({
  officer,
  appState,
  onStateUpdate,
  onNotify,
}: SpreadsheetWorkspaceProps) {
  const now = new Date();
  const scheduleStatus = getScheduleStatus(
    officer,
    now,
    appState.simulation,
    appState.weeklySchedule
  );

  const todaySheet: DailySpreadsheet | undefined = appState.spreadsheets.find(
    (s) => s.date === appState.serverDate
  );

  const consensus = todaySheet
    ? getConsensusProgress(todaySheet)
    : { activeCount: 0, finishedCount: 0, allFinished: false, exportUnlocked: false };

  const officerMap = useMemo(
    () => new Map(appState.officers.map((o) => [o.id, o])),
    [appState.officers]
  );

  const studentSummaries = useMemo(
    () => calculateStudentSummaries(appState.spreadsheets, appState.students),
    [appState.spreadsheets, appState.students]
  );

  const dailyProductivity = useMemo(
    () => calculateDailyOfficerProductivity(todaySheet, appState.officers),
    [todaySheet, appState.officers]
  );

  const myProductivity = dailyProductivity.officers.find(
    (item) => item.officerId === officer.id
  );

  const [studentName, setStudentName] = useState('');
  const [studentNis, setStudentNis] = useState('');
  const [kelas, setKelas] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<KategoriPelanggaran | 'CUSTOM' | ''>('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [violationCode, setViolationCode] = useState('');
  const [violationLabel, setViolationLabel] = useState('');
  const [category, setCategory] = useState<KategoriPelanggaran>('A. Kedisiplinan & Kehadiran');
  const [points, setPoints] = useState<number>(5);
  const [actionTaken, setActionTaken] = useState('');
  const [notes, setNotes] = useState('');
  const [showStudentDropdown, setShowStudentDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  // Grid filter & grouping view state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [groupByClassView, setGroupByClassView] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mascotPulse, setMascotPulse] = useState(0);
  const [showVisualPreview, setShowVisualPreview] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showManualDetails, setShowManualDetails] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const matchingStudents = useMemo(
    () => searchSimilarStudents(appState.students, studentName, 10),
    [appState.students, studentName]
  );

  function handleSelectStudent(stu: StudentRecord) {
    setStudentName(stu.name);
    setKelas(stu.kelas);
    setStudentNis(stu.nis && stu.nis !== '-' ? stu.nis : '');
    setSelectedStudentId(stu.id);
    setShowStudentDropdown(false);
    setHighlightedIndex(0);
  }

  const matchedStudentSummary = useMemo(() => {
    const qName = studentName.trim().toLowerCase();
    const qKelas = kelas.trim().toUpperCase();
    if (!qName) return null;
    return studentSummaries.find(
      (s) =>
        s.studentName.toLowerCase() === qName &&
        (!qKelas || s.kelas.toUpperCase() === qKelas)
    );
  }, [studentSummaries, studentName, kelas]);

  const filteredRows = useMemo(() => {
    if (!todaySheet) return [];
    const q = searchQuery.trim().toLowerCase();
    return todaySheet.rows.filter((row) => {
      const matchesCat = filterCategory === 'ALL' || row.category === filterCategory;
      const matchesQuery =
        !q ||
        row.studentName.toLowerCase().includes(q) ||
        row.kelas.toLowerCase().includes(q) ||
        row.violationLabel.toLowerCase().includes(q) ||
        (row.violationCode ?? '').toLowerCase().includes(q) ||
        row.recordedByName.toLowerCase().includes(q);
      return matchesCat && matchesQuery;
    });
  }, [todaySheet, searchQuery, filterCategory]);

  const groupedFilteredRows = useMemo(
    () => groupViolationsByClass(filteredRows),
    [filteredRows]
  );

  const isSheetFinalized = todaySheet?.status === 'FINALIZED';
  const canRecordNow = scheduleStatus.allowed && !isSheetFinalized;
  const isOfficerActiveInSheet = todaySheet?.activeOfficers.includes(officer.id) ?? false;
  const isOfficerFinished = todaySheet?.finishedOfficers.includes(officer.id) ?? false;

  const mascotMood: MascotMood = !scheduleStatus.allowed
    ? 'locked'
    : isSheetFinalized
      ? 'celebrate'
      : todaySheet
        ? 'recording'
        : 'idle';

  const quickPickPresets = useMemo(() => {
    const preferredCodes = ['A1', 'E1', 'E2', 'E5', 'E4'];
    return preferredCodes
      .map((code) => appState.presets.find((p) => p.code === code))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  }, [appState.presets]);

  const presetsForSelectedCategory = useMemo(() => {
    if (!selectedCategory || selectedCategory === 'CUSTOM') return [];
    return appState.presets.filter((p) => p.category === selectedCategory);
  }, [appState.presets, selectedCategory]);

  function handleCategoryChange(nextVal: string) {
    if (!nextVal) {
      setSelectedCategory('');
      setSelectedPresetId('');
      setViolationCode('');
      setViolationLabel('');
      setPoints(5);
      setActionTaken('');
      setShowManualDetails(false);
      return;
    }

    if (nextVal === 'CUSTOM') {
      setSelectedCategory('CUSTOM');
      setSelectedPresetId('custom');
      setViolationCode('CUSTOM');
      setViolationLabel('');
      setPoints(5);
      setActionTaken('');
      setShowManualDetails(true);
      return;
    }

    const nextCat = nextVal as KategoriPelanggaran;
    setSelectedCategory(nextCat);
    setCategory(nextCat);
    setSelectedPresetId('');
    setViolationCode('');
    setViolationLabel('');
    setPoints(5);
    setActionTaken('');
    setShowManualDetails(false);
  }

  function handlePresetChange(presetId: string) {
    setSelectedPresetId(presetId);
    if (!presetId) {
      setViolationCode('');
      setViolationLabel('');
      setPoints(5);
      setActionTaken('');
      setShowManualDetails(false);
      return;
    }
    if (presetId === 'custom') {
      setSelectedCategory('CUSTOM');
      setViolationCode('CUSTOM');
      setViolationLabel('');
      setPoints(5);
      setActionTaken('');
      setShowManualDetails(true);
      return;
    }
    const preset = appState.presets.find((p) => p.id === presetId);
    if (preset) {
      setSelectedCategory(preset.category);
      setViolationCode(preset.code);
      setViolationLabel(preset.label);
      setCategory(preset.category);
      setPoints(preset.points);
      setActionTaken(preset.defaultAction);
    }
  }

  async function handleStartSession() {
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/spreadsheets/start', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal memulai sesi piket.', 'error');
        return;
      }
      onStateUpdate(data.state);
      setMascotPulse((c) => c + 1);
      onNotify(
        data.created
          ? 'Spreadsheet piket hari ini berhasil dibuat otomatis!'
          : 'Anda telah bergabung ke sesi spreadsheet piket hari ini.',
        'success'
      );
    } catch {
      onNotify('Terjadi kesalahan jaringan saat memulai sesi.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddViolation(e: FormEvent) {
    e.preventDefault();
    if (!canRecordNow) return;
    if (!selectedCategory || (selectedCategory !== 'CUSTOM' && !selectedPresetId)) {
      onNotify('Silakan pilih kategori dan aturan pelanggaran terlebih dahulu.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/violations', {
        method: 'POST',
        body: JSON.stringify({
          studentName,
          studentNis,
          kelas,
          violationCode,
          violationLabel,
          category,
          points,
          actionTaken,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal mencatat pelanggaran.', 'error');
        return;
      }
      onStateUpdate(data.state);
      setMascotPulse((c) => c + 1);
      setStudentName('');
      setStudentNis('');
      setKelas('');
      setSelectedStudentId(null);
      setSelectedCategory('');
      setSelectedPresetId('');
      setViolationCode('');
      setViolationLabel('');
      setPoints(5);
      setActionTaken('');
      setShowManualDetails(false);
      setNotes('');
      onNotify(
        data.createdSpreadsheet
          ? 'Spreadsheet hari ini dibuat otomatis & pelanggaran pertama tercatat!'
          : 'Pelanggaran AKPS berhasil dicatat ke spreadsheet.',
        'success'
      );
    } catch {
      onNotify('Tidak dapat menyimpan catatan ke server.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteRow(violationId: string, name: string) {
    if (!todaySheet || !canRecordNow) return;
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/violations/${todaySheet.id}/${violationId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal menghapus baris.', 'error');
        return;
      }
      onStateUpdate(data.state);
      setConfirmDeleteId(null);
      onNotify(`Catatan pelanggaran ${name} dihapus.`, 'info');
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleFinish(finished: boolean) {
    if (!todaySheet) return;
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/spreadsheets/${todaySheet.id}/finish`, {
        method: 'POST',
        body: JSON.stringify({ finished }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal memperbarui status selesai.', 'error');
        return;
      }
      onStateUpdate(data.state);
      setMascotPulse((c) => c + 1);
      if (data.spreadsheet.status === 'FINALIZED') {
        onNotify(
          'Semua petugas aktif telah menekan Selesai! Data tersimpan final & ekspor terbuka.',
          'success'
        );
      } else if (finished) {
        onNotify(
          'Status Anda ditandai Selesai. Menunggu petugas aktif lainnya menekan Selesai.',
          'info'
        );
      } else {
        onNotify('Status Selesai dibatalkan. Anda dapat melanjutkan pencatatan.', 'info');
      }
    } catch {
      onNotify('Gagal memperbarui status sesi.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReopenByCoordinator() {
    if (!todaySheet) return;
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/spreadsheets/${todaySheet.id}/reopen`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal membuka kembali spreadsheet.', 'error');
        return;
      }
      onStateUpdate(data.state);
      onNotify('Spreadsheet dibuka kembali untuk revisi oleh Admin / Developer.', 'info');
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function handleExportExcel() {
    if (!todaySheet) return;
    try {
      downloadSpreadsheetXlsx(todaySheet, appState.officers);
      onNotify(`Berhasil mengunduh Laporan-AKPS-Per-Kelas-${todaySheet.date}.xlsx`, 'success');
    } catch (err: any) {
      onNotify(err?.message || 'Ekspor belum tersedia.', 'error');
    }
  }

  function handleExportCsv() {
    if (!todaySheet || !consensus.exportUnlocked) return;
    downloadSpreadsheetCsv(todaySheet);
    onNotify(`Berhasil mengunduh Laporan-AKPS-Piket-${todaySheet.date}.csv`, 'success');
  }

  function handleExportPdfDirect() {
    if (!todaySheet) return;
    try {
      downloadVisualPdfReport(todaySheet, appState.officers);
      onNotify(`Berhasil mengunduh Laporan-Visual-AKPS-${todaySheet.date}.pdf`, 'success');
    } catch (err: any) {
      onNotify(err?.message || 'Ekspor PDF belum tersedia.', 'error');
    }
  }

  const totalPointsToday = todaySheet
    ? todaySheet.rows.reduce((sum, r) => sum + r.points, 0)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header Summary Strip + Cute 3D Companion */}
      <section className="grid grid-cols-1 items-stretch gap-5 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)] sm:gap-6 sm:p-6 lg:grid-cols-12">
        <div className="flex flex-col justify-between lg:col-span-8">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{SCHOOL_IDENTITY.sekolah}</span>
                <span aria-hidden="true">·</span>
                <span>{formatIndonesianDateLabel(appState.serverDate, appState.serverHari)}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num">Waktu {appState.serverTime} WIB</span>
                {appState.weeklySchedule.cycleWeeks > 1 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-blue-700">
                      Giliran Minggu ke-{scheduleStatus.currentWeek} ({scheduleStatus.weekRangeText})
                    </span>
                  </>
                )}
                {appState.simulation.enabled && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-blue-600">Mode Uji Coba Waktu Aktif</span>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowGuide((prev) => !prev)}
                aria-expanded={showGuide}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
              >
                <HelpCircle className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                <span>{showGuide ? 'Tutup Panduan' : 'Cara Pakai'}</span>
              </button>
            </div>

            <div className="mt-2.5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                  {todaySheet
                    ? todaySheet.title
                    : `Piket Harian — ${formatIndonesianDateLabel(appState.serverDate, appState.serverHari)}`}
                </h1>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  {!scheduleStatus.allowed
                    ? `Mode Lihat Saja (${officer.name}): ${scheduleStatus.reason}`
                    : !todaySheet
                      ? 'Langsung isi formulir di bawah untuk mulai mencatat siswa — lembar hari ini akan terbuka otomatis.'
                      : isSheetFinalized
                        ? 'Semua petugas piket hari ini sudah menekan Selesai. Laporan Excel per kelas & PDF siap diunduh.'
                        : 'Catat siswa yang melanggar di formulir kiri. Jika jam piket sudah berakhir, tekan tombol hijau Tandai Selesai.'}
                </p>
              </div>

              {!todaySheet && scheduleStatus.allowed && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleStartSession}
                  className="btn-3d-primary inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                  <span>Buat Spreadsheet Hari Ini</span>
                </button>
              )}
            </div>

            {/* Plain-language 3-step duty orientation */}
            <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">Alur bertugas:</span>
              <span className={!isSheetFinalized ? 'font-semibold text-blue-700' : 'text-emerald-700 font-medium'}>
                1. Catat siswa
              </span>
              <span aria-hidden="true">→</span>
              <span className={todaySheet && !isSheetFinalized ? 'font-semibold text-blue-700' : isSheetFinalized ? 'text-emerald-700 font-medium' : ''}>
                2. Semua petugas tekan Selesai
              </span>
              <span aria-hidden="true">→</span>
              <span className={consensus.exportUnlocked ? 'font-semibold text-emerald-700' : ''}>
                3. Unduh Excel &amp; PDF
              </span>
            </div>

            {showGuide && (
              <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 text-xs text-slate-700 sm:grid-cols-3">
                <div>
                  <p className="font-semibold text-slate-900">1. Cari &amp; Pilih Siswa</p>
                  <p className="mt-0.5 leading-relaxed text-slate-600">
                    Ketik beberapa huruf nama siswa lalu klik dari daftar — kelas langsung terisi otomatis.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">2. Pilih Kategori &amp; Aturan</p>
                  <p className="mt-0.5 leading-relaxed text-slate-600">
                    Klik tombol cepat atau pilih kategori (A–F) dulu lalu pilih aturan yang muncul, kemudian simpan.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">3. Klik Selesai &amp; Unduh</p>
                  <p className="mt-0.5 leading-relaxed text-slate-600">
                    Saat piket berakhir, semua petugas wajib menekan Selesai agar Excel per kelas &amp; PDF terbuka.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">Status Catatan</p>
              <p
                className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${
                  isSheetFinalized
                    ? 'text-emerald-700'
                    : todaySheet
                      ? 'text-blue-700'
                      : 'text-slate-700'
                }`}
              >
                {isSheetFinalized ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Tersimpan &amp; Final</span>
                  </>
                ) : todaySheet ? (
                  <>
                    <FileSpreadsheet className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Aktif Mencatat</span>
                  </>
                ) : (
                  <span>Siap Dimulai</span>
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500">Pelanggaran Tercatat</p>
              <p className="font-mono-num mt-1 text-xl font-bold text-slate-900">
                {todaySheet ? todaySheet.rows.length : 0}
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500">Total Poin Hari Ini</p>
              <p className="font-mono-num mt-1 text-xl font-bold text-slate-900">
                {totalPointsToday}
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500">Petugas Selesai</p>
              <p className="font-mono-num mt-1 text-xl font-bold text-slate-900">
                {consensus.finishedCount}/{consensus.activeCount}
              </p>
            </div>
          </div>
        </div>

        {/* Cute 3D Companion Corner */}
        <div className="flex flex-col justify-center rounded-xl border border-sky-100/90 bg-gradient-to-b from-sky-50/75 via-white to-slate-50/60 p-3 lg:col-span-4">
          <CuteMascot3D
            mood={mascotMood}
            compact
            triggerPulse={mascotPulse}
            caption={
              !scheduleStatus.allowed
                ? 'Piko sedang istirahat — di luar jadwal piket Anda.'
                : !todaySheet
                  ? 'Klik Piko! Siap menemani piket pagi hari ini.'
                  : undefined
            }
          />
        </div>
      </section>

      {/* Schedule Lock Notice */}
      {!scheduleStatus.allowed && (
        <section
          role="status"
          className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/75 p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
            <div>
              <h2 className="font-display text-base font-semibold text-amber-950">
                Pencatatan Terkunci di Luar Jadwal Piket
              </h2>
              <p className="mt-0.5 text-sm text-amber-900">
                {scheduleStatus.reason}
              </p>
              <p className="mt-1 text-xs text-amber-800">
                Jadwal bertugas Anda: <strong>{scheduleStatus.scheduledWeeksText}</strong> · Hari{' '}
                <strong>{scheduleStatus.scheduledDaysText}</strong> · Pukul{' '}
                <span className="font-mono-num font-semibold">{scheduleStatus.shiftWindowText}</span>{' '}
                WIB.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {/* Form Pencatatan AKPS */}
        <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)] sm:p-6 lg:col-span-7">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Catat Pelanggaran Siswa
              </h2>
              <p className="text-xs text-slate-500">
                {todaySheet
                  ? 'Isi nama siswa lalu pilih kategori pelanggaran sesuai buku AKPS.'
                  : 'Mencatat siswa pertama akan otomatis membuka spreadsheet hari ini.'}
              </p>
            </div>
            {isSheetFinalized && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                <span>Sesi Final</span>
              </span>
            )}
          </div>

          <form onSubmit={handleAddViolation} className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
              <div className="relative sm:col-span-6">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="student-name"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Nama Siswa
                  </label>
                  <span className="text-[11px] text-slate-400">
                    Cari dari {appState.students.length} siswa
                  </span>
                </div>
                <div className="relative mt-1.5">
                  <Search
                    className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="student-name"
                    type="text"
                    required
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={showStudentDropdown && canRecordNow}
                    aria-autocomplete="list"
                    aria-controls="student-autocomplete-listbox"
                    disabled={!canRecordNow || submitting}
                    value={studentName}
                    onFocus={() => setShowStudentDropdown(true)}
                    onBlur={() => window.setTimeout(() => setShowStudentDropdown(false), 180)}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      setStudentName(nextVal);
                      setHighlightedIndex(0);
                      setShowStudentDropdown(true);
                      if (selectedStudentId) {
                        setSelectedStudentId(null);
                        if (!nextVal.trim()) {
                          setKelas('');
                          setStudentNis('');
                        }
                      }
                    }}
                    onKeyDown={(e) => {
                      if (!showStudentDropdown || matchingStudents.length === 0) return;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setHighlightedIndex((prev) => (prev + 1) % matchingStudents.length);
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setHighlightedIndex((prev) =>
                          prev <= 0 ? matchingStudents.length - 1 : prev - 1
                        );
                      } else if (e.key === 'Enter' && showStudentDropdown) {
                        const picked = matchingStudents[highlightedIndex] ?? matchingStudents[0];
                        if (picked) {
                          e.preventDefault();
                          handleSelectStudent(picked.student);
                        }
                      } else if (e.key === 'Escape') {
                        setShowStudentDropdown(false);
                      }
                    }}
                    placeholder="Ketik beberapa huruf nama siswa..."
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </div>

                {selectedStudentId && kelas && (
                  <p className="mt-1.5 flex items-center justify-between gap-2 text-xs text-emerald-700">
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        Kelas <strong>{kelas}</strong>
                        {studentNis ? ` · NIS ${studentNis}` : ''} terisi otomatis
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setStudentName('');
                        setKelas('');
                        setStudentNis('');
                        setSelectedStudentId(null);
                      }}
                      className="font-medium text-slate-500 underline hover:text-slate-800"
                    >
                      Ganti
                    </button>
                  </p>
                )}

                {showStudentDropdown && canRecordNow && (
                  <div
                    id="student-autocomplete-listbox"
                    role="listbox"
                    className="absolute left-0 right-0 z-30 mt-1.5 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl sm:right-auto sm:w-[430px] sm:max-w-[calc(100vw-3rem)]"
                  >
                    {!studentName.trim() ? (
                      <div className="px-3.5 py-2.5 text-xs text-slate-500">
                        Ketik beberapa huruf nama (mis. <strong className="text-slate-700">abdi</strong>,{' '}
                        <strong className="text-slate-700">nurlia</strong>, atau{' '}
                        <strong className="text-slate-700">ahmad 12c</strong>) — kelas akan terisi otomatis.
                      </div>
                    ) : matchingStudents.length === 0 ? (
                      <div className="px-3.5 py-2.5 text-xs text-slate-500">
                        Tidak ditemukan nama yang mirip dengan &ldquo;{studentName.trim()}&rdquo;. Anda tetap dapat mengisi kelas secara manual.
                      </div>
                    ) : (
                      <>
                        <div className="border-b border-slate-100 px-3.5 py-1.5 text-[11px] font-medium text-slate-500">
                          Menampilkan {matchingStudents.length} pilihan nama yang cocok — klik untuk isi kelas otomatis
                        </div>
                        {matchingStudents.map(({ student: stu, matchType }, idx) => {
                          const isHighlighted = idx === highlightedIndex;
                          const hasNis = Boolean(stu.nis && stu.nis !== '-');
                          return (
                            <button
                              key={stu.id}
                              type="button"
                              role="option"
                              aria-selected={isHighlighted}
                              onMouseEnter={() => setHighlightedIndex(idx)}
                              onMouseDown={(ev) => {
                                ev.preventDefault();
                                handleSelectStudent(stu);
                              }}
                              className={`flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm transition-colors ${
                                isHighlighted ? 'bg-blue-50 text-blue-950' : 'hover:bg-slate-50'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium text-slate-900">{stu.name}</p>
                                <p className="text-[11px] text-slate-500">
                                  {hasNis ? `NIS ${stu.nis}` : 'Siswa SMAN 1 Kemangkon'}
                                  {matchType === 'similar' ? ' · Ejaan mirip' : ''}
                                </p>
                              </div>
                              <span className="font-mono-num shrink-0 rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800">
                                {stu.kelas}
                              </span>
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="sm:col-span-3">
                <label
                  htmlFor="student-kelas"
                  className="block text-sm font-medium text-slate-700"
                >
                  Kelas
                </label>
                <input
                  id="student-kelas"
                  type="text"
                  required
                  disabled={!canRecordNow || submitting}
                  value={kelas}
                  onChange={(e) => setKelas(e.target.value)}
                  placeholder="Otomatis / mis. 11D"
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>

              <div className="sm:col-span-3">
                <label
                  htmlFor="student-nis"
                  className="block text-sm font-medium text-slate-700"
                >
                  NIS (Opsional)
                </label>
                <input
                  id="student-nis"
                  type="text"
                  disabled={!canRecordNow || submitting}
                  value={studentNis}
                  onChange={(e) => setStudentNis(e.target.value)}
                  placeholder="Otomatis Kls 12"
                  className="font-mono-num mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
            </div>

            {matchedStudentSummary && (
              <div
                className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs ${
                  matchedStudentSummary.totalPoints + Number(points || 0) >= 26
                    ? 'border-red-200 bg-red-50 text-red-900'
                    : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Akumulasi <strong>{matchedStudentSummary.studentName}</strong> saat ini:{' '}
                  <strong className="font-mono-num">{matchedStudentSummary.totalPoints} poin</strong>{' '}
                  (setelah input menjadi{' '}
                  <strong className="font-mono-num">
                    {matchedStudentSummary.totalPoints + Number(points || 0)} poin
                  </strong>{' '}
                  → {getTingkatPembinaan(matchedStudentSummary.totalPoints + Number(points || 0))}).
                </span>
              </div>
            )}

            {/* Quick-pick common morning violations */}
            {quickPickPresets.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-600">
                  Pilih Cepat Pelanggaran Pagi yang Sering Terjadi:
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {quickPickPresets.map((qp) => {
                    const isPicked = selectedPresetId === qp.id;
                    const shortTitle =
                      qp.code === 'A1'
                        ? 'Terlambat'
                        : qp.code === 'E1'
                          ? 'Atribut / Seragam'
                          : qp.code === 'E2'
                            ? 'Rambut Gondrong'
                            : qp.code === 'E5'
                              ? 'Tidak Pakai Ciput'
                              : 'Riasan / Kerudung';
                    return (
                      <button
                        key={qp.id}
                        type="button"
                        disabled={!canRecordNow || submitting}
                        onClick={() => handlePresetChange(qp.id)}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap disabled:opacity-50 ${
                          isPicked
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {qp.code} · {shortTitle} (+{qp.points})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="category-select"
                  className="block text-sm font-medium text-slate-700"
                >
                  1. Pilih Kategori Pelanggaran (A – F)
                </label>
                <select
                  id="category-select"
                  required
                  disabled={!canRecordNow || submitting}
                  value={selectedCategory}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="">-- Pilih kategori dulu (A sampai F) --</option>
                  {AKPS_CATEGORIES.map((cat) => {
                    const count = appState.presets.filter((p) => p.category === cat).length;
                    return (
                      <option key={cat} value={cat}>
                        {cat} ({count} aturan)
                      </option>
                    );
                  })}
                  <option value="CUSTOM">Pelanggaran Lainnya (Isi Sendiri)</option>
                </select>
                {!selectedCategory && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Daftar aturan akan muncul otomatis setelah Anda memilih kategori di atas.
                  </p>
                )}
              </div>

              {selectedCategory && selectedCategory !== 'CUSTOM' && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
                  <div className="sm:col-span-9">
                    <label
                      htmlFor="preset-select"
                      className="block text-sm font-medium text-slate-700"
                    >
                      2. Pilih Aturan ({selectedCategory})
                    </label>
                    <select
                      id="preset-select"
                      required
                      disabled={!canRecordNow || submitting}
                      value={selectedPresetId}
                      onChange={(e) => handlePresetChange(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <option value="">
                        -- Pilih aturan pelanggaran ({presetsForSelectedCategory.length} pilihan) --
                      </option>
                      {presetsForSelectedCategory.map((p) => (
                        <option key={p.id} value={p.id}>
                          [{p.code}] {p.label} (+{p.points} poin)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    <label
                      htmlFor="violation-points"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Poin
                    </label>
                    <input
                      id="violation-points"
                      type="number"
                      min={1}
                      max={100}
                      required
                      disabled={!canRecordNow || submitting || !selectedPresetId}
                      value={points}
                      onChange={(e) => setPoints(Number(e.target.value))}
                      className="font-mono-num mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </div>
                </div>
              )}

              {selectedCategory && selectedCategory !== 'CUSTOM' && selectedPresetId && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs">
                  <p className="min-w-0 text-slate-600">
                    Tindak lanjut otomatis:{' '}
                    <strong className="text-slate-800">{actionTaken || 'Catat & pembinaan'}</strong>
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowManualDetails((prev) => !prev)}
                    className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{showManualDetails ? 'Sembunyikan Detail' : 'Ubah Detail / Sanksi'}</span>
                    {showManualDetails ? (
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              )}

              {(showManualDetails || selectedCategory === 'CUSTOM') && (
                <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/40 p-3.5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
                    <div className={selectedCategory === 'CUSTOM' ? 'sm:col-span-6' : 'sm:col-span-7'}>
                      <label
                        htmlFor="violation-label"
                        className="block text-sm font-medium text-slate-700"
                      >
                        Keterangan Pelanggaran
                      </label>
                      <input
                        id="violation-label"
                        type="text"
                        required
                        disabled={!canRecordNow || submitting}
                        value={violationLabel}
                        onChange={(e) => setViolationLabel(e.target.value)}
                        placeholder="Contoh: Terlambat masuk sekolah"
                        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                      />
                    </div>

                    <div className={selectedCategory === 'CUSTOM' ? 'sm:col-span-4' : 'sm:col-span-5'}>
                      <label
                        htmlFor="violation-category"
                        className="block text-sm font-medium text-slate-700"
                      >
                        Kategori AKPS
                      </label>
                      <select
                        id="violation-category"
                        disabled={!canRecordNow || submitting}
                        value={category}
                        onChange={(e) => setCategory(e.target.value as KategoriPelanggaran)}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                      >
                        {AKPS_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedCategory === 'CUSTOM' && (
                      <div className="sm:col-span-2">
                        <label
                          htmlFor="violation-points"
                          className="block text-sm font-medium text-slate-700"
                        >
                          Poin
                        </label>
                        <input
                          id="violation-points"
                          type="number"
                          min={1}
                          max={100}
                          required
                          disabled={!canRecordNow || submitting}
                          value={points}
                          onChange={(e) => setPoints(Number(e.target.value))}
                          className="font-mono-num mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="action-taken"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Tindak Lanjut / Sanksi
                    </label>
                    <input
                      id="action-taken"
                      type="text"
                      disabled={!canRecordNow || submitting}
                      value={actionTaken}
                      onChange={(e) => setActionTaken(e.target.value)}
                      placeholder="Contoh: Penyitaan HP sesuai aturan AKPS"
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </div>
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="violation-notes"
                className="block text-sm font-medium text-slate-700"
              >
                Catatan Tambahan (Opsional)
              </label>
              <input
                id="violation-notes"
                type="text"
                disabled={!canRecordNow || submitting}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Boleh dikosongkan jika tidak ada keterangan tambahan..."
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={!canRecordNow || submitting}
                className="btn-3d-primary inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>
                  {submitting
                    ? 'Menyimpan...'
                    : !scheduleStatus.allowed
                      ? 'Terkunci (Di Luar Jadwal Piket)'
                      : isSheetFinalized
                        ? 'Spreadsheet Sudah Disimpan Final'
                        : 'Simpan ke Spreadsheet Hari Ini'}
                </span>
              </button>
            </div>
          </form>
        </section>

        {/* Right Column: Productivity Summary Card + Consensus & Export */}
        <div className="space-y-6 lg:col-span-5">
          {/* Daily Picket Productivity Summary Card */}
          <section
            id="daily-productivity-card"
            aria-label="Ringkasan Produktivitas Piket Hari Ini"
            className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)] sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Ringkasan Produktivitas Piket
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Total pelanggaran dicatat pada sesi hari ini beserta kontribusi tiap petugas.
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[11px] font-medium text-slate-500">Total Hari Ini</p>
                <p
                  id="daily-total-violations"
                  className="font-mono-num text-3xl font-bold tracking-tight text-slate-900"
                >
                  {dailyProductivity.totalViolations}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
              <span>
                <strong className="font-mono-num text-slate-900">{dailyProductivity.uniqueStudents}</strong>{' '}
                siswa
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <strong className="font-mono-num text-slate-900">+{dailyProductivity.totalPoints}</strong>{' '}
                poin
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <strong className="font-mono-num text-slate-900">
                  {dailyProductivity.recordingOfficerCount}/{dailyProductivity.activeOfficerCount}
                </strong>{' '}
                petugas mencatat
              </span>
              {myProductivity && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-blue-700">
                    Anda: <strong className="font-mono-num">{myProductivity.violationCount}</strong>
                  </span>
                </>
              )}
            </div>

            <div className="mt-4 border-t border-slate-100 pt-3.5">
              {dailyProductivity.officers.length === 0 ? (
                <p className="text-xs leading-relaxed text-slate-500">
                  Belum ada catatan masuk hari ini. Kontribusi per petugas akan muncul otomatis setelah catatan pertama disimpan.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {dailyProductivity.officers.map((item) => {
                    const isSelf = item.officerId === officer.id;
                    return (
                      <li key={item.officerId} className="py-2.5 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {item.officerName}
                              {isSelf ? ' (Anda)' : ''}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {item.division} · {item.isFinished ? 'Selesai' : 'Aktif'}
                            </p>
                          </div>
                          <p className="font-mono-num shrink-0 text-xs font-semibold text-slate-800">
                            {item.violationCount} pelanggaran · +{item.totalPoints} poin ({item.percentage}%)
                          </p>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full transition-all duration-300 ${
                              item.isFinished ? 'bg-emerald-600' : 'bg-blue-600'
                            }`}
                            style={{ width: `${item.percentage}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* Panel Konsensus Selesai & Ekspor */}
          <section className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)] sm:p-6">
            <div>
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    Selesaikan Tugas &amp; Unduh
                  </h2>
                  <p className="text-xs text-slate-500">
                    Semua petugas aktif wajib menekan Selesai sebelum Excel &amp; PDF dibuka.
                  </p>
                </div>
                <Users className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
              </div>

              {!todaySheet ? (
                <div className="mt-4 py-4 text-center">
                  <p className="text-sm font-medium text-slate-700">
                    Belum ada petugas aktif hari ini
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Daftar petugas aktif dan tombol Selesai muncul otomatis saat sesi dimulai.
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                      <span>Progres Konfirmasi Selesai</span>
                      <span className="font-mono-num font-semibold text-slate-900">
                        {consensus.finishedCount} dari {consensus.activeCount} petugas selesai
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full transition-all duration-300 ${
                          consensus.allFinished ? 'bg-emerald-600' : 'bg-blue-600'
                        }`}
                        style={{
                          width:
                            consensus.activeCount > 0
                              ? `${(consensus.finishedCount / consensus.activeCount) * 100}%`
                              : '0%',
                        }}
                      />
                    </div>
                  </div>

                  <ul className="divide-y divide-slate-100 border-t border-slate-100">
                    {todaySheet.activeOfficers.map((id) => {
                      const activeOff = officerMap.get(id);
                      const done = todaySheet.finishedOfficers.includes(id);
                      const isSelf = id === officer.id;
                      return (
                        <li
                          key={id}
                          className="flex items-center justify-between gap-3 py-2.5"
                        >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {activeOff?.name ?? id}
                            {isSelf ? ' (Anda)' : ''}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {activeOff?.division ?? 'Petugas Piket'}
                          </p>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap shrink-0 ${
                            done ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {done ? (
                            <>
                              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                              <span>Sudah Selesai</span>
                            </>
                          ) : (
                            <span>Sedang Mencatat</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {scheduleStatus.allowed && !isSheetFinalized && (
                  <div className="pt-1">
                    {!isOfficerActiveInSheet ? (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={handleStartSession}
                        className="btn-3d-soft flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                      >
                        <UserCheck className="h-4 w-4" aria-hidden="true" />
                        <span>Gabung sebagai Petugas Aktif Hari Ini</span>
                      </button>
                    ) : isOfficerFinished ? (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleToggleFinish(false)}
                        className="btn-3d-soft flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        <span>Batalkan Selesai (Lanjut Mencatat)</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleToggleFinish(true)}
                        className="btn-3d-success flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        <span>Tandai Selesai Mencatat</span>
                      </button>
                    )}
                  </div>
                )}

                {isSheetFinalized && isManagerRole(officer.role) && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleReopenByCoordinator}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Buka Kembali Sesi (Admin / Developer)</span>
                  </button>
                )}
              </div>
            )}
          </div>

            {/* Export Section */}
            <div className="mt-6 border-t border-slate-100 pt-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">
                  Unduh Laporan Hari Ini
                </span>
                <span
                  className={`text-xs font-medium ${
                    consensus.exportUnlocked ? 'text-emerald-700' : 'text-slate-500'
                  }`}
                >
                  {consensus.exportUnlocked ? 'Siap Diunduh' : 'Belum Selesai'}
                </span>
              </div>

              {!consensus.exportUnlocked && (
                <p className="mb-3 text-xs text-slate-500">
                  Tombol unduh akan aktif otomatis setelah semua petugas piket di atas menekan{' '}
                  <strong className="text-slate-700">Tandai Selesai Mencatat</strong>.
                </p>
              )}

              <div className="space-y-2.5">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={!consensus.exportUnlocked}
                    onClick={handleExportExcel}
                    className="btn-3d-soft inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    <span>Excel per Kelas (.xlsx)</span>
                  </button>

                  <button
                    type="button"
                    disabled={!consensus.exportUnlocked}
                    onClick={handleExportPdfDirect}
                    className="btn-3d-soft inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    <span>Unduh PDF Visual</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={!consensus.exportUnlocked}
                    onClick={() => setShowVisualPreview(true)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Pratinjau Laporan Visual</span>
                  </button>

                  <button
                    type="button"
                    disabled={!consensus.exportUnlocked}
                    onClick={handleExportCsv}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Unduh CSV</span>
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Live Spreadsheet Table */}
      <section className="rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Lembar Spreadsheet Pelanggaran Hari Ini
            </h2>
            <p className="text-xs text-slate-500">
              {todaySheet
                ? `Menampilkan ${filteredRows.length} dari ${todaySheet.rows.length} catatan`
                : 'Spreadsheet akan terisi otomatis saat pelanggaran pertama dicatat.'}
            </p>
          </div>

          <div className="flex w-full flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto">
            <div className="flex items-center gap-1 self-start rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setGroupByClassView(false)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  !groupByClassView ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Semua Baris
              </button>
              <button
                type="button"
                onClick={() => setGroupByClassView(true)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  groupByClassView ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Pisahkan per Kelas
              </button>
            </div>

            <div className="relative w-full sm:w-52">
              <Search
                className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Cari siswa atau pelanggaran"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari siswa / kelas / kode..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <select
              aria-label="Filter kategori pelanggaran"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-blue-600 focus:outline-none sm:w-auto"
            >
              <option value="ALL">Semua Kategori AKPS</option>
              {AKPS_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          {!todaySheet || todaySheet.rows.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium text-slate-700">
                Belum ada data pelanggaran pada spreadsheet hari ini.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {canRecordNow
                  ? 'Gunakan formulir di atas untuk mencatat siswa pertama.'
                  : 'Menunggu petugas yang terjadwal mencatat pelanggaran.'}
              </p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">
              Tidak ada baris yang cocok dengan pencarian Anda.
            </div>
          ) : groupByClassView ? (
            <div className="divide-y divide-slate-200">
              {groupedFilteredRows.map((grp) => (
                <div key={grp.kelas}>
                  <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5 border-b border-slate-200">
                    <span className="font-display text-sm font-bold text-slate-900">
                      Kelas {grp.kelas}
                    </span>
                    <span className="font-mono-num text-xs font-semibold text-slate-600">
                      {grp.totalIncidents} catatan · Total +{grp.totalPoints} poin
                    </span>
                  </div>
                  <table className="min-w-[760px] w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-white text-xs font-semibold text-slate-500">
                        <th className="px-4 py-2.5 w-12 text-center">No</th>
                        <th className="px-4 py-2.5 w-20">Jam</th>
                        <th className="px-4 py-2.5 w-16">Kode</th>
                        <th className="px-4 py-2.5">Siswa & NIS</th>
                        <th className="px-4 py-2.5">Pelanggaran AKPS</th>
                        <th className="px-4 py-2.5 text-right w-20">Poin</th>
                        <th className="px-4 py-2.5">Tindak Lanjut</th>
                        <th className="px-4 py-2.5">Petugas</th>
                        {canRecordNow && <th className="px-4 py-2.5 text-right w-16">Aksi</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {grp.rows.map((row, idx) => (
                        <tr key={row.id} className="hover:bg-slate-50/80">
                          <td className="font-mono-num px-4 py-2.5 text-center text-xs text-slate-500">
                            {idx + 1}
                          </td>
                          <td className="font-mono-num px-4 py-2.5 text-xs text-slate-700">
                            {row.timeLabel}
                          </td>
                          <td className="font-mono-num px-4 py-2.5 text-xs font-semibold text-blue-700">
                            {row.violationCode || '-'}
                          </td>
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-slate-900">{row.studentName}</p>
                            <p className="font-mono-num text-xs text-slate-500">
                              NIS {row.studentNis}
                            </p>
                          </td>
                          <td className="px-4 py-2.5">
                            <p className="text-slate-900">{row.violationLabel}</p>
                            <p className="text-xs text-slate-500">
                              {row.category}
                              {row.notes ? ` · ${row.notes}` : ''}
                            </p>
                          </td>
                          <td className="font-mono-num px-4 py-2.5 text-right font-semibold text-red-700">
                            +{row.points}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-600">{row.actionTaken}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-700 whitespace-nowrap">
                            {row.recordedByName}
                          </td>
                          {canRecordNow && (
                            <td className="px-4 py-2.5 text-right whitespace-nowrap">
                              {confirmDeleteId === row.id ? (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={submitting}
                                    onClick={() => handleDeleteRow(row.id, row.studentName)}
                                    className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700"
                                  >
                                    Hapus
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                                  >
                                    Batal
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  disabled={submitting}
                                  onClick={() => setConfirmDeleteId(row.id)}
                                  aria-label={`Hapus catatan ${row.studentName}`}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : (
            <table className="min-w-[820px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3 text-center w-12">No</th>
                  <th className="px-4 py-3 w-20">Jam</th>
                  <th className="px-4 py-3 w-16">Kode</th>
                  <th className="px-4 py-3">Siswa & NIS</th>
                  <th className="px-4 py-3 w-24">Kelas</th>
                  <th className="px-4 py-3">Pelanggaran & Kategori</th>
                  <th className="px-4 py-3 text-right w-20">Poin</th>
                  <th className="px-4 py-3">Tindak Lanjut</th>
                  <th className="px-4 py-3">Petugas</th>
                  {canRecordNow && <th className="px-4 py-3 text-right w-16">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="font-mono-num px-4 py-3 text-center text-xs text-slate-500">
                      {filteredRows.length - idx}
                    </td>
                    <td className="font-mono-num px-4 py-3 text-xs font-medium text-slate-700">
                      {row.timeLabel}
                    </td>
                    <td className="font-mono-num px-4 py-3 text-xs font-semibold text-blue-700">
                      {row.violationCode || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{row.studentName}</p>
                      <p className="font-mono-num text-xs text-slate-500">NIS {row.studentNis}</p>
                    </td>
                    <td className="font-mono-num px-4 py-3 text-xs font-semibold text-slate-800">
                      {row.kelas}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-900">{row.violationLabel}</p>
                      <p className="text-xs text-slate-500">
                        {row.category}
                        {row.notes ? ` · ${row.notes}` : ''}
                      </p>
                    </td>
                    <td className="font-mono-num px-4 py-3 text-right font-semibold text-red-700">
                      +{row.points}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{row.actionTaken}</td>
                    <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap">
                      {row.recordedByName}
                    </td>
                    {canRecordNow && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {confirmDeleteId === row.id ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => handleDeleteRow(row.id, row.studentName)}
                              className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700"
                            >
                              Hapus
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                            >
                              Batal
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => setConfirmDeleteId(row.id)}
                            aria-label={`Hapus catatan ${row.studentName}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {showVisualPreview && todaySheet && (
        <VisualReportModal
          spreadsheet={todaySheet}
          officers={appState.officers}
          onClose={() => setShowVisualPreview(false)}
          onNotify={onNotify}
        />
      )}
    </div>
  );
}
