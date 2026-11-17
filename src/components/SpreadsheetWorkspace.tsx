import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import {
  AKPS_CATEGORIES,
  DEFAULT_DAILY_SESSION_CONFIG,
  SCHOOL_IDENTITY,
  calculateDailyOfficerProductivity,
  calculateStudentSummaries,
  canModifyViolationRow,
  formatIndonesianDateLabel,
  getAutoSessionWindowStatus,
  getConsensusProgress,
  getScheduleStatus,
  getTingkatPembinaan,
  groupViolationsByClass,
  isManagerRole,
  isUnrestrictedTrialMode,
  paginateItems,
  searchSimilarStudents,
} from '../shared/piketLogic';
import {
  buildBatchViolationInputs,
  getQuickPickPresetsWithRecent,
  type BatchRuleItem,
} from '../shared/batchViolationLogic';
import type {
  DailySpreadsheet,
  KategoriPelanggaran,
  PublicAppState,
  PublicOfficer,
  StudentRecord,
  ViolationEntry,
} from '../shared/types';
import { downloadSpreadsheetCsv, downloadSpreadsheetXlsx } from '../utils/exportSpreadsheet';
import { downloadVisualPdfReport } from '../utils/exportVisualPdf';
import { AnimatedNumber } from './AnimatedNumber';
import { BatchViolationForm } from './BatchViolationForm';
import { CuteMascot3D, type MascotMood } from './CuteMascot3D';
import { PaginationBar } from './PaginationBar';
import { Tilt3DCard } from './Tilt3DCard';
import { VisualReportModal } from './VisualReportModal';

interface SpreadsheetWorkspaceProps {
  officer: PublicOfficer;
  appState: PublicAppState;
  connectionOffline?: boolean;
  onStateUpdate: (nextState: PublicAppState) => void;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function SpreadsheetWorkspace({
  officer,
  appState,
  connectionOffline = false,
  onStateUpdate,
  onNotify,
}: SpreadsheetWorkspaceProps) {
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTick(Date.now());
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  const now = new Date(nowTick);
  const dailySession = appState.dailySession ?? DEFAULT_DAILY_SESSION_CONFIG;
  const autoWindow = getAutoSessionWindowStatus(
    dailySession,
    now,
    appState.simulation
  );
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
  const [saveToStudentDirectory, setSaveToStudentDirectory] = useState(false);
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

  // Inline row editing state
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editStudentName, setEditStudentName] = useState('');
  const [editStudentNis, setEditStudentNis] = useState('');
  const [editKelas, setEditKelas] = useState('');
  const [editViolationCode, setEditViolationCode] = useState('');
  const [editViolationLabel, setEditViolationLabel] = useState('');
  const [editCategory, setEditCategory] = useState<KategoriPelanggaran>('A. Kedisiplinan & Kehadiran');
  const [editPoints, setEditPoints] = useState<number>(5);
  const [editActionTaken, setEditActionTaken] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Grid filter, grouping & pagination state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [groupByClassView, setGroupByClassView] = useState(false);
  const [rowPage, setRowPage] = useState(1);
  const [rowPageSize, setRowPageSize] = useState<number | 'ALL'>(15);
  const [openClassGroups, setOpenClassGroups] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [mascotPulse, setMascotPulse] = useState(0);
  const [showVisualPreview, setShowVisualPreview] = useState(false);
  const [entryMode, setEntryMode] = useState<'single' | 'batch'>('single');
  const [lockViolationAfterSave, setLockViolationAfterSave] = useState(false);
  const [recentPresetIds, setRecentPresetIds] = useState<string[]>([]);
  const [extraRules, setExtraRules] = useState<BatchRuleItem[]>([]);
  const studentInputRef = useRef<HTMLInputElement | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showManualDetails, setShowManualDetails] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [lastAddedRowId, setLastAddedRowId] = useState<string | null>(null);
  const [lastSaveCelebration, setLastSaveCelebration] = useState<{
    studentName: string;
    totalPoints: number;
    count: number;
  } | null>(null);

  const matchingStudents = useMemo(
    () => searchSimilarStudents(appState.students, studentName, 10),
    [appState.students, studentName]
  );

  const isNewManualStudent = useMemo(() => {
    const q = studentName.trim().toLowerCase();
    if (!q || selectedStudentId) return false;
    return !appState.students.some((s) => s.name.trim().toLowerCase() === q);
  }, [appState.students, studentName, selectedStudentId]);

  function handleSelectStudent(stu: StudentRecord) {
    setStudentName(stu.name);
    setKelas(stu.kelas);
    setStudentNis(stu.nis && stu.nis !== '-' ? stu.nis : '');
    setSelectedStudentId(stu.id);
    setSaveToStudentDirectory(false);
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

  const paginatedRows = useMemo(
    () => paginateItems(filteredRows, rowPage, rowPageSize),
    [filteredRows, rowPage, rowPageSize]
  );

  const isTrialUnrestricted = isUnrestrictedTrialMode(appState.simulation);
  const isSheetFinalized = todaySheet?.status === 'FINALIZED';
  const isSheetActive = Boolean(todaySheet && todaySheet.status === 'ACTIVE');
  const canRecordNow = scheduleStatus.allowed && isSheetActive;

  const mascotMood: MascotMood = !scheduleStatus.allowed
    ? 'locked'
    : isSheetFinalized
      ? 'celebrate'
      : isSheetActive
        ? 'recording'
        : 'idle';

  const quickPickItems = useMemo(
    () =>
      getQuickPickPresetsWithRecent(
        appState.presets,
        todaySheet?.rows ?? [],
        recentPresetIds,
        6
      ),
    [appState.presets, todaySheet?.rows, recentPresetIds]
  );

  function recordPresetUsed(presetId: string) {
    if (!presetId || presetId === 'custom') return;
    setRecentPresetIds((prev) => [presetId, ...prev.filter((id) => id !== presetId)].slice(0, 6));
  }

  const presetsForSelectedCategory = useMemo(() => {
    if (!selectedCategory || selectedCategory === 'CUSTOM') return [];
    return appState.presets.filter((p) => p.category === selectedCategory);
  }, [appState.presets, selectedCategory]);

  const currentDraftRule: BatchRuleItem | null = useMemo(() => {
    if (!selectedCategory) return null;
    if (selectedCategory === 'CUSTOM') {
      if (!violationLabel.trim()) return null;
      return {
        key: 'draft:custom',
        violationCode: 'CUSTOM',
        violationLabel: violationLabel.trim(),
        category,
        points: Math.max(1, Math.min(100, Math.round(Number(points || 5)))),
        actionTaken: actionTaken.trim() || 'Teguran Lisan & Catat',
      };
    }
    if (!selectedPresetId || !violationLabel.trim()) return null;
    return {
      key: `preset:${selectedPresetId}`,
      presetId: selectedPresetId,
      violationCode: violationCode || 'CUSTOM',
      violationLabel: violationLabel.trim(),
      category,
      points: Math.max(1, Math.min(100, Math.round(Number(points || 5)))),
      actionTaken: actionTaken.trim() || 'Teguran Lisan & Catat',
    };
  }, [
    selectedCategory,
    selectedPresetId,
    violationCode,
    violationLabel,
    category,
    points,
    actionTaken,
  ]);

  const combinedSingleStudentRules: BatchRuleItem[] = useMemo(() => {
    if (!currentDraftRule) return extraRules;
    const isDuplicatePreset =
      currentDraftRule.presetId &&
      extraRules.some((r) => r.presetId === currentDraftRule.presetId);
    if (isDuplicatePreset) return extraRules;
    return [...extraRules, currentDraftRule];
  }, [extraRules, currentDraftRule]);

  const combinedSinglePointsTotal = useMemo(
    () => combinedSingleStudentRules.reduce((sum, r) => sum + r.points, 0),
    [combinedSingleStudentRules]
  );

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
      recordPresetUsed(preset.id);
      setSelectedCategory(preset.category);
      setViolationCode(preset.code);
      setViolationLabel(preset.label);
      setCategory(preset.category);
      setPoints(preset.points);
      setActionTaken(preset.defaultAction);
    }
  }

  function handleStackCurrentRule() {
    if (!currentDraftRule) {
      onNotify('Pilih aturan pelanggaran terlebih dahulu sebelum menambah aturan lain.', 'error');
      return;
    }
    setExtraRules((prev) => {
      if (currentDraftRule.presetId && prev.some((r) => r.presetId === currentDraftRule.presetId)) {
        return prev;
      }
      const nextKey =
        currentDraftRule.key === 'draft:custom'
          ? `custom:${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
          : currentDraftRule.key;
      return [...prev, { ...currentDraftRule, key: nextKey }];
    });
    setSelectedCategory('');
    setSelectedPresetId('');
    setViolationCode('');
    setViolationLabel('');
    setPoints(5);
    setActionTaken('');
    setShowManualDetails(false);
  }

  async function handleAddViolation(e: FormEvent) {
    e.preventDefault();
    if (!canRecordNow) return;

    const rulesToSave = combinedSingleStudentRules;
    if (rulesToSave.length === 0) {
      onNotify('Silakan pilih kategori dan aturan pelanggaran terlebih dahulu.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      let data: any;
      if (rulesToSave.length === 1) {
        const single = rulesToSave[0];
        const res = await apiFetch('/api/violations', {
          method: 'POST',
          body: JSON.stringify({
            studentName,
            studentNis,
            kelas,
            violationCode: single.violationCode,
            violationLabel: single.violationLabel,
            category: single.category,
            points: single.points,
            actionTaken: single.actionTaken,
            notes,
            saveToStudentDirectory: isNewManualStudent && saveToStudentDirectory,
          }),
        });
        data = await res.json();
        if (!res.ok) {
          onNotify(data.error || 'Gagal mencatat pelanggaran.', 'error');
          return;
        }
      } else {
        const built = buildBatchViolationInputs(
          [
            {
              key: selectedStudentId || `${studentName}-${kelas}`,
              id: selectedStudentId ?? undefined,
              name: studentName,
              kelas,
              nis: studentNis,
              saveToStudentDirectory: isNewManualStudent && saveToStudentDirectory,
            },
          ],
          rulesToSave,
          notes
        );
        if (built.error) {
          onNotify(built.error, 'error');
          return;
        }
        const res = await apiFetch('/api/violations/bulk', {
          method: 'POST',
          body: JSON.stringify({ entries: built.entries }),
        });
        data = await res.json();
        if (!res.ok) {
          onNotify(data.error || 'Gagal mencatat multi-pelanggaran.', 'error');
          return;
        }
      }

      onStateUpdate(data.state);
      const addedId: string | undefined =
        data.createdIds?.[0] ?? data.violation?.id ?? data.spreadsheet?.rows?.[0]?.id;
      if (addedId) {
        setLastAddedRowId(addedId);
        window.setTimeout(() => {
          setLastAddedRowId((curr) => (curr === addedId ? null : curr));
        }, 2500);
      }
      const savedTotalPts = rulesToSave.reduce((acc, r) => acc + r.points, 0);
      const savedName = studentName.trim();
      setLastSaveCelebration({
        studentName: savedName,
        totalPoints: savedTotalPts,
        count: rulesToSave.length,
      });
      window.setTimeout(() => {
        setLastSaveCelebration((curr) =>
          curr && curr.studentName === savedName ? null : curr
        );
      }, 2800);

      setMascotPulse((c) => c + 1);
      setStudentName('');
      setStudentNis('');
      setKelas('');
      setSelectedStudentId(null);
      setSaveToStudentDirectory(false);
      setNotes('');

      if (!lockViolationAfterSave) {
        setExtraRules([]);
        setSelectedCategory('');
        setSelectedPresetId('');
        setViolationCode('');
        setViolationLabel('');
        setPoints(5);
        setActionTaken('');
        setShowManualDetails(false);
      } else {
        window.requestAnimationFrame(() => {
          studentInputRef.current?.focus();
        });
      }

      if (rulesToSave.length > 1) {
        onNotify(
          `${rulesToSave.length} pelanggaran untuk 1 siswa berhasil dicatat${
            lockViolationAfterSave ? ' (pilihan pelanggaran tetap dikunci)' : ''
          }.`,
          'success'
        );
      } else {
        onNotify(
          data.createdSpreadsheet
            ? 'Spreadsheet hari ini dibuat otomatis & pelanggaran pertama tercatat!'
            : lockViolationAfterSave
              ? 'Pelanggaran tercatat! Silakan langsung ketik nama siswa berikutnya.'
              : 'Pelanggaran AKPS berhasil dicatat ke spreadsheet.',
          'success'
        );
      }
    } catch {
      onNotify('Tidak dapat menyimpan catatan ke server.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function startEditRow(row: ViolationEntry) {
    setConfirmDeleteId(null);
    setEditingRowId(row.id);
    setEditStudentName(row.studentName);
    setEditStudentNis(row.studentNis === '-' ? '' : row.studentNis);
    setEditKelas(row.kelas);
    setEditViolationCode(row.violationCode || 'CUSTOM');
    setEditViolationLabel(row.violationLabel);
    setEditCategory(row.category);
    setEditPoints(row.points);
    setEditActionTaken(row.actionTaken);
    setEditNotes(row.notes || '');
  }

  async function handleSaveEditRow(rowId: string) {
    if (!todaySheet || !canRecordNow) return;
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/violations/${todaySheet.id}/${rowId}`, {
        method: 'PUT',
        body: JSON.stringify({
          studentName: editStudentName,
          studentNis: editStudentNis,
          kelas: editKelas,
          violationCode: editViolationCode,
          violationLabel: editViolationLabel,
          category: editCategory,
          points: Number(editPoints),
          actionTaken: editActionTaken,
          notes: editNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal memperbarui catatan pelanggaran.', 'error');
        return;
      }
      onStateUpdate(data.state);
      setEditingRowId(null);
      onNotify('Catatan pelanggaran berhasil diperbarui.', 'success');
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
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

  async function handleCloseByCoordinator() {
    if (!todaySheet) return;
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/spreadsheets/${todaySheet.id}/close`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal menutup spreadsheet.', 'error');
        return;
      }
      onStateUpdate(data.state);
      setMascotPulse((c) => c + 1);
      onNotify('Spreadsheet ditutup & difinalkan kembali. Laporan siap diunduh.', 'success');
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
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

  async function handleTurnOffTrialMode() {
    if (!isManagerRole(officer.role)) return;
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/settings/simulation', {
        method: 'POST',
        body: JSON.stringify({
          enabled: false,
          unrestricted: true,
          simulatedTime: appState.simulation.simulatedTime || '07:15',
          simulatedDay: appState.simulation.simulatedDay ?? null,
          simulatedWeek: appState.simulation.simulatedWeek ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal mematikan Mode Uji Coba.', 'error');
        return;
      }
      onStateUpdate(data.state);
      onNotify(
        'Mode Uji Coba dimatikan. Sistem kembali mengikuti jadwal & jam piket normal.',
        'info'
      );
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
      <section className="surface-3d animate-stagger-1 grid grid-cols-1 items-stretch gap-5 rounded-2xl border border-slate-200/90 bg-white p-4 sm:gap-6 sm:p-6 lg:grid-cols-12">
        <div className="flex flex-col justify-between lg:col-span-8">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
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
                    <span className="font-semibold text-blue-700">
                      {isTrialUnrestricted
                        ? 'Mode Uji Coba Bebas Aktif (Tanpa Batas Waktu)'
                        : 'Mode Uji Coba Jam Simulasi Aktif'}
                    </span>
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
                  {isTrialUnrestricted && isSheetActive
                    ? 'Mode Uji Coba Bebas aktif: spreadsheet tetap terbuka dan semua petugas dapat mencatat kapan saja tanpa batasan waktu hingga Mode Uji Coba dimatikan.'
                    : !scheduleStatus.allowed
                      ? `Mode Lihat Saja (${officer.name}): ${scheduleStatus.reason}`
                      : autoWindow.phase === 'NON_ACTIVE_DAY'
                        ? `Hari ${autoWindow.hari} bukan jadwal aktif pembuatan spreadsheet otomatis.`
                        : !todaySheet && autoWindow.phase === 'BEFORE_START'
                          ? `Spreadsheet hari ini akan dibuat otomatis pada pukul ${autoWindow.startTime} WIB (${autoWindow.minutesUntilStart} menit lagi).`
                          : todaySheet?.reopenedManually && isSheetActive
                            ? 'Spreadsheet sedang dibuka kembali sementara untuk revisi oleh Admin / Developer.'
                            : isSheetFinalized
                              ? `Spreadsheet hari ini telah tertutup otomatis pada pukul ${autoWindow.endTime} WIB. Laporan Excel per kelas & PDF siap diunduh.`
                              : `Spreadsheet aktif otomatis dan akan tertutup pada pukul ${autoWindow.endTime} WIB (${autoWindow.minutesUntilClose} menit tersisa).`}
                </p>
              </div>

              <div
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 ${
                  isTrialUnrestricted && isSheetActive
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : isSheetFinalized
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : isSheetActive
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : autoWindow.phase === 'BEFORE_START'
                          ? 'border-slate-200 bg-slate-50 text-slate-700'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}
              >
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {isTrialUnrestricted && isSheetActive
                    ? 'Uji Coba Bebas · Tanpa Batas Waktu'
                    : isSheetFinalized
                      ? `Tutup Otomatis (${autoWindow.endTime} WIB)`
                      : todaySheet?.reopenedManually
                        ? 'Mode Revisi Aktif'
                        : isSheetActive
                          ? `Aktif · Tutup ${autoWindow.endTime} WIB`
                          : autoWindow.phase === 'BEFORE_START'
                            ? `Buka Otomatis ${autoWindow.startTime} WIB`
                            : 'Hari Tidak Aktif'}
                </span>
              </div>
            </div>

            {/* Interactive 3-step duty orientation */}
            <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">Alur otomatis:</span>
              <span
                className={`rounded-md px-1.5 py-0.5 ${
                  todaySheet ? 'font-medium text-emerald-700' : 'font-semibold text-blue-700'
                }`}
              >
                1. Buka otomatis ({autoWindow.startTime})
              </span>
              <span aria-hidden="true">→</span>
              <button
                type="button"
                onClick={() => document.getElementById('student-name')?.focus()}
                className={`rounded-md px-1.5 py-0.5 transition-colors hover:bg-blue-50 ${
                  isSheetActive
                    ? 'font-semibold text-blue-700'
                    : isSheetFinalized
                      ? 'font-medium text-emerald-700'
                      : 'hover:text-slate-800'
                }`}
              >
                2. Catat siswa melanggar
              </button>
              <span aria-hidden="true">→</span>
              <button
                type="button"
                onClick={() =>
                  document.getElementById('consensus-export-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
                className={`rounded-md px-1.5 py-0.5 transition-colors hover:bg-emerald-50 ${
                  consensus.exportUnlocked ? 'font-semibold text-emerald-700' : 'hover:text-slate-800'
                }`}
              >
                3. Tutup otomatis ({autoWindow.endTime}) &amp; Unduh
              </button>
            </div>

            <AnimatePresence initial={false}>
            {showGuide && (
              <motion.div
                key="hero-guide-drawer"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 text-xs text-slate-700 sm:grid-cols-3">
                  <div>
                    <p className="font-semibold text-slate-900">1. Buka Otomatis di Jam Mulai</p>
                    <p className="mt-0.5 leading-relaxed text-slate-600">
                      Spreadsheet hari ini otomatis dibuat pukul {autoWindow.startTime} WIB tanpa perlu menekan tombol buat manual.
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">2. Cari Siswa &amp; Pilih AKPS</p>
                    <p className="mt-0.5 leading-relaxed text-slate-600">
                      Ketik beberapa huruf nama siswa agar kelas terisi otomatis, lalu pilih kategori (A–F) dan simpan.
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">3. Tutup Otomatis &amp; Unduh</p>
                    <p className="mt-0.5 leading-relaxed text-slate-600">
                      Saat pukul {autoWindow.endTime} WIB, spreadsheet tertutup &amp; final otomatis sehingga Excel per kelas dan PDF terbuka.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
            </AnimatePresence>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">Status Catatan</p>
              <p
                className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${
                  isSheetFinalized
                    ? 'text-emerald-700'
                    : isSheetActive
                      ? 'text-blue-700'
                      : 'text-slate-700'
                }`}
              >
                {isSheetFinalized ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Ditutup &amp; Final</span>
                  </>
                ) : todaySheet?.reopenedManually ? (
                  <>
                    <FileSpreadsheet className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Mode Revisi</span>
                  </>
                ) : isSheetActive ? (
                  <>
                    <FileSpreadsheet className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Aktif Mencatat</span>
                  </>
                ) : autoWindow.phase === 'NON_ACTIVE_DAY' ? (
                  <span>Hari Tidak Aktif</span>
                ) : (
                  <span>Menunggu {autoWindow.startTime} WIB</span>
                )}
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500">Pelanggaran Tercatat</p>
              <p className="mt-1 text-xl font-bold text-slate-900">
                <AnimatedNumber value={todaySheet ? todaySheet.rows.length : 0} />
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500">Total Poin Hari Ini</p>
              <p className="mt-1 text-xl font-bold text-slate-900">
                <AnimatedNumber value={totalPointsToday} />
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500">Jadwal Otomatis</p>
              <p className="font-mono-num mt-1 text-base font-bold text-slate-900 sm:text-lg">
                {autoWindow.startTime} – {autoWindow.endTime}
              </p>
            </div>
          </div>
        </div>

        {/* Cute 3D Companion Corner */}
        <Tilt3DCard
          maxTiltDeg={5}
          scaleOnHover={1.012}
          className="flex flex-col justify-center rounded-xl border border-sky-100/90 bg-gradient-to-b from-sky-50/75 via-white to-slate-50/60 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] lg:col-span-4"
        >
          <CuteMascot3D
            mood={mascotMood}
            compact
            triggerPulse={mascotPulse}
            caption={
              !scheduleStatus.allowed
                ? 'Piko sedang istirahat — di luar jadwal piket Anda.'
                : !todaySheet && autoWindow.phase === 'BEFORE_START'
                  ? `Piko menunggu jam buka otomatis (${autoWindow.startTime} WIB).`
                  : !todaySheet
                    ? 'Piko sedang istirahat — hari ini tidak ada sesi piket.'
                    : undefined
            }
          />
        </Tilt3DCard>
      </section>

      {/* Schedule or Auto-Window Lock Notice */}
      {!scheduleStatus.allowed ? (
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
      ) : !todaySheet ? (
        <section
          role="status"
          className="flex flex-col gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
            <div>
              <h2 className="font-display text-base font-semibold text-blue-950">
                {autoWindow.phase === 'BEFORE_START'
                  ? `Menunggu Jam Buka Otomatis (${autoWindow.startTime} WIB)`
                  : `Hari ${autoWindow.hari} Tidak Dijadwalkan`}
              </h2>
              <p className="mt-0.5 text-sm text-blue-900">
                {autoWindow.phase === 'BEFORE_START'
                  ? `Spreadsheet hari ini belum dibuat dan akan terbuka secara otomatis pukul ${autoWindow.startTime} WIB (${autoWindow.minutesUntilStart} menit lagi), lalu ditutup otomatis pukul ${autoWindow.endTime} WIB.`
                  : `Pembuatan spreadsheet otomatis tidak dijadwalkan untuk hari ${autoWindow.hari}. Pengaturan hari aktif dan jam otomatis dapat diubah oleh Admin/Developer di menu Jadwal & Aturan.`}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {/* Form Pencatatan AKPS */}
        <section className="surface-3d animate-stagger-2 rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-6 lg:col-span-7">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Catat Pelanggaran Siswa
              </h2>
              <p className="text-xs text-slate-500">
                {isSheetActive
                  ? entryMode === 'batch'
                    ? 'Pilih pelanggaran lalu centang atau cari banyak siswa sekaligus dalam 1 klik simpan.'
                    : 'Isi nama siswa lalu pilih kategori pelanggaran sesuai buku AKPS.'
                  : isSheetFinalized
                    ? `Spreadsheet sudah ditutup otomatis pada pukul ${autoWindow.endTime} WIB.`
                    : autoWindow.phase === 'BEFORE_START'
                      ? `Formulir akan aktif otomatis saat spreadsheet dibuka pukul ${autoWindow.startTime} WIB.`
                      : 'Spreadsheet otomatis sedang tidak aktif hari ini.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isSheetFinalized && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <span>Sesi Final</span>
                </span>
              )}
              <div
                role="tablist"
                aria-label="Mode pencatatan pelanggaran"
                className="inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1"
              >
                {(
                  [
                    { id: 'single', label: 'Catat 1 Siswa' },
                    { id: 'batch', label: 'Catat Banyak Siswa' },
                  ] as const
                ).map((modeTab) => {
                  const active = entryMode === modeTab.id;
                  return (
                    <button
                      key={modeTab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setEntryMode(modeTab.id)}
                      className={`relative rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        active ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="entry-mode-pill"
                          transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                          className="absolute inset-0 rounded-lg bg-white shadow-sm"
                          aria-hidden="true"
                        />
                      )}
                      <span className="relative z-10">{modeTab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {entryMode === 'batch' ? (
            <BatchViolationForm
              appState={appState}
              quickPickItems={quickPickItems}
              canRecordNow={canRecordNow}
              connectionOffline={connectionOffline}
              lockedNoticeText={
                !scheduleStatus.allowed
                  ? 'Terkunci (Di Luar Jadwal Piket)'
                  : isSheetFinalized
                    ? 'Spreadsheet Sudah Ditutup Final'
                    : !todaySheet && autoWindow.phase === 'BEFORE_START'
                      ? `Menunggu Jam Buka (${autoWindow.startTime} WIB)`
                      : 'Spreadsheet Tidak Aktif Hari Ini'
              }
              onRecordPresetUsed={recordPresetUsed}
              onSuccessSubmit={(nextState, createdCount, createdIds) => {
                onStateUpdate(nextState);
                setMascotPulse((c) => c + 1);
                const firstId = createdIds[0];
                if (firstId) {
                  setLastAddedRowId(firstId);
                  window.setTimeout(() => {
                    setLastAddedRowId((curr) => (curr === firstId ? null : curr));
                  }, 2500);
                }
                onNotify(
                  `Berhasil mencatat ${createdCount} pelanggaran sekaligus ke spreadsheet hari ini.`,
                  'success'
                );
              }}
              onNotify={onNotify}
            />
          ) : (
            <form onSubmit={handleAddViolation} className="mt-5 space-y-5">
              {/* LANGKAH 1 · DATA SISWA */}
              <div className="space-y-3 border-b border-slate-100 pb-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900">Langkah 1 · Data Siswa</p>
                  <span className="text-[11px] text-slate-400">
                    Cari dari {appState.students.length} siswa
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <div className="relative sm:col-span-6">
                    <label
                      htmlFor="student-name"
                      className="block text-xs font-medium text-slate-700"
                    >
                      Nama Siswa
                    </label>
                    <div className="relative mt-1">
                      <Search
                        className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400"
                        aria-hidden="true"
                      />
                      <input
                        ref={studentInputRef}
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
                        placeholder="Ketik beberapa huruf nama..."
                        className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                      />
                      {studentName && !submitting && canRecordNow && (
                        <button
                          type="button"
                          aria-label="Kosongkan nama siswa"
                          onClick={() => {
                            setStudentName('');
                            setKelas('');
                            setStudentNis('');
                            setSelectedStudentId(null);
                            studentInputRef.current?.focus();
                          }}
                          className="absolute right-2.5 top-2.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
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
                              {matchingStudents.length} pilihan cocok — klik untuk isi kelas otomatis
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
                                  className={`flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-sm transition-colors ${
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
                      className="block text-xs font-medium text-slate-700"
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
                      placeholder="Otomatis / 11D"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label
                      htmlFor="student-nis"
                      className="block text-xs font-medium text-slate-700"
                    >
                      NIS (Opsional)
                    </label>
                    <input
                      id="student-nis"
                      type="text"
                      disabled={!canRecordNow || submitting}
                      value={studentNis}
                      onChange={(e) => setStudentNis(e.target.value)}
                      placeholder="Otomatis"
                      className="font-mono-num mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </div>
                </div>

                <AnimatePresence>
                  {isNewManualStudent && canRecordNow && (
                    <motion.label
                      key="new-manual-student-opt"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-xs text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={saveToStudentDirectory}
                        onChange={(e) => setSaveToStudentDirectory(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
                      />
                      <span>
                        Nama <strong>{studentName.trim()}</strong> belum ada di direktori resmi. Centang jika ini <strong>siswa baru/pindahan</strong> agar disimpan permanen.
                      </span>
                    </motion.label>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {matchedStudentSummary && (
                    <motion.div
                      key="matched-student-points-alert"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs ${
                        matchedStudentSummary.totalPoints +
                          (combinedSinglePointsTotal || Number(points || 0)) >=
                        26
                          ? 'border-red-200 bg-red-50 text-red-900'
                          : 'border-amber-200 bg-amber-50 text-amber-900'
                      }`}
                    >
                      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        Akumulasi <strong>{matchedStudentSummary.studentName}</strong> saat ini:{' '}
                        <strong className="font-mono-num">{matchedStudentSummary.totalPoints} poin</strong>{' '}
                        (setelah input:{' '}
                        <strong className="font-mono-num">
                          {matchedStudentSummary.totalPoints +
                            (combinedSinglePointsTotal || Number(points || 0))}{' '}
                          poin
                        </strong>{' '}
                        →{' '}
                        {getTingkatPembinaan(
                          matchedStudentSummary.totalPoints +
                            (combinedSinglePointsTotal || Number(points || 0))
                        )}
                        ).
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* LANGKAH 2 · PILIH PELANGGARAN */}
              <div className="space-y-3.5 border-b border-slate-100 pb-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      Langkah 2 · Pilih Pelanggaran (AKPS)
                    </p>
                    <p className="text-xs text-slate-500">
                      Klik langsung tombol cepat atau pilih salah satu kartu kategori A–F di bawah.
                    </p>
                  </div>
                  {selectedCategory && (
                    <button
                      type="button"
                      disabled={!canRecordNow || submitting}
                      onClick={() => handleCategoryChange('')}
                      className="text-xs font-medium text-slate-500 underline hover:text-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      Reset pilihan
                    </button>
                  )}
                </div>

                {/* Quick-pick common + recent/today frequent violations */}
                {quickPickItems.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Pilihan Cepat Hari Ini
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {quickPickItems.map(({ preset: qp, todayCount }) => {
                        const isPicked =
                          selectedPresetId === qp.id ||
                          extraRules.some((r) => r.presetId === qp.id);
                        const shortTitle =
                          qp.label.length > 32 ? `${qp.label.slice(0, 30)}…` : qp.label;
                        return (
                          <motion.button
                            key={qp.id}
                            type="button"
                            whileHover={{ y: -1, scale: 1.015 }}
                            whileTap={{ scale: 0.96 }}
                            transition={{ type: 'spring', stiffness: 450, damping: 28 }}
                            disabled={!canRecordNow || submitting}
                            onClick={() => handlePresetChange(qp.id)}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-50 ${
                              isPicked
                                ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                                : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-300 hover:bg-blue-50/50'
                            }`}
                          >
                            {isPicked && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                            <span>
                              {qp.code} · {shortTitle} (+{qp.points})
                            </span>
                            {todayCount > 0 && (
                              <span
                                className={`font-mono-num text-[11px] ${
                                  isPicked ? 'text-blue-100' : 'text-slate-500'
                                }`}
                              >
                                · {todayCount}×
                              </span>
                            )}
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Stacked multi-violation list for the same student */}
                <AnimatePresence>
                  {extraRules.length > 0 && (
                    <motion.div
                      key="single-extra-rules"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="rounded-xl border border-blue-200 bg-blue-50/45 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-blue-950">
                          Pelanggaran tambahan untuk siswa ini ({extraRules.length}):
                        </span>
                        <button
                          type="button"
                          onClick={() => setExtraRules([])}
                          className="font-medium text-slate-500 underline hover:text-slate-800"
                        >
                          Hapus semua
                        </button>
                      </div>
                      <ul className="mt-1.5 divide-y divide-blue-100">
                        <AnimatePresence initial={false}>
                          {extraRules.map((rule) => (
                            <motion.li
                              key={rule.key}
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 8 }}
                              transition={{ duration: 0.16 }}
                              className="flex items-center justify-between gap-2 py-1.5 text-xs text-slate-800"
                            >
                              <span className="min-w-0 truncate">
                                <strong className="font-mono-num text-blue-800">
                                  [{rule.violationCode}]
                                </strong>{' '}
                                {rule.violationLabel}{' '}
                                <span className="text-slate-500">· +{rule.points} poin</span>
                              </span>
                              <button
                                type="button"
                                aria-label={`Hapus ${rule.violationLabel}`}
                                onClick={() =>
                                  setExtraRules((prev) =>
                                    prev.filter((item) => item.key !== rule.key)
                                  )
                                }
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-blue-100 hover:text-red-700"
                              >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </motion.li>
                          ))}
                        </AnimatePresence>
                      </ul>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Category Grid (Single Clear Picker — No Duplicate Dropdown) */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Kategori Pelanggaran (A – F)
                  </p>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {AKPS_CATEGORIES.map((cat) => {
                      const count = appState.presets.filter((p) => p.category === cat).length;
                      const code = cat.split('.')[0];
                      const cardLabels: Record<string, string> = {
                        A: 'Kedisiplinan',
                        B: 'Perilaku & Sikap',
                        C: 'Sepeda & Motor',
                        D: 'HP & Teknologi',
                        E: 'Kerapihan',
                        F: 'Lain-lain AKPS',
                      };
                      const shortLabel = cardLabels[code] ?? cat.replace(/^[A-F]\.\s*/, '');
                      const isActive = selectedCategory === cat;
                      return (
                        <motion.button
                          key={cat}
                          type="button"
                          title={cat}
                          aria-pressed={isActive}
                          whileHover={{ y: -2, scale: 1.01 }}
                          whileTap={{ scale: 0.97 }}
                          transition={{ type: 'spring', stiffness: 450, damping: 28 }}
                          disabled={!canRecordNow || submitting}
                          onClick={() => handleCategoryChange(cat)}
                          className={`group rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            isActive
                              ? 'border-blue-600 bg-blue-50/95 text-blue-950 ring-2 ring-blue-600/15'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span
                              className={`font-mono-num text-[11px] font-bold ${
                                isActive ? 'text-blue-700' : 'text-slate-500 group-hover:text-blue-600'
                              }`}
                            >
                              Kat. {code}
                            </span>
                            <span className="font-mono-num text-[11px] text-slate-400">
                              {count}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs font-semibold leading-tight">
                            {shortLabel}
                          </p>
                        </motion.button>
                      );
                    })}
                    <motion.button
                      type="button"
                      aria-pressed={selectedCategory === 'CUSTOM'}
                      whileHover={{ y: -2, scale: 1.01 }}
                      whileTap={{ scale: 0.97 }}
                      transition={{ type: 'spring', stiffness: 450, damping: 28 }}
                      disabled={!canRecordNow || submitting}
                      onClick={() => handleCategoryChange('CUSTOM')}
                      className={`rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        selectedCategory === 'CUSTOM'
                          ? 'border-blue-600 bg-blue-50/95 text-blue-950 ring-2 ring-blue-600/15'
                          : 'border-dashed border-slate-300 bg-slate-50/60 text-slate-700 hover:border-blue-300 hover:bg-slate-50'
                      }`}
                    >
                      <span className="font-mono-num text-[11px] font-bold text-slate-500">
                        Lainnya
                      </span>
                      <p className="mt-0.5 truncate text-xs font-semibold leading-tight">
                        Isi Manual
                      </p>
                    </motion.button>
                  </div>
                </div>

                {/* Step 2b: Rule Dropdown + Points (Animated Reveal when A-F picked) */}
                <AnimatePresence initial={false}>
                  {selectedCategory && selectedCategory !== 'CUSTOM' && (
                    <motion.div
                      key={`rule-box-${selectedCategory}`}
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                      className="grid grid-cols-1 gap-3 rounded-xl border border-blue-100 bg-blue-50/35 p-3.5 sm:grid-cols-12"
                    >
                      <div className="sm:col-span-9">
                        <label
                          htmlFor="preset-select"
                          className="block text-xs font-semibold text-slate-700"
                        >
                          Pilih Aturan ({selectedCategory})
                        </label>
                        <select
                          id="preset-select"
                          required={extraRules.length === 0}
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
                          className="block text-xs font-semibold text-slate-700"
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
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Step 2c: Action bar + Progressive Disclosure for Optional Detail & Notes */}
                {(selectedPresetId || selectedCategory === 'CUSTOM' || showManualDetails) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs">
                    <p className="min-w-0 text-slate-600">
                      Sanksi:{' '}
                      <strong className="text-slate-800">{actionTaken || 'Teguran Lisan & Catat'}</strong>
                      {notes.trim() ? ' · Ada catatan tambahan' : ''}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 shrink-0">
                      {currentDraftRule && (
                        <button
                          type="button"
                          disabled={!canRecordNow || submitting}
                          onClick={handleStackCurrentRule}
                          className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:text-emerald-800 whitespace-nowrap disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Tambah Pelanggaran Lain</span>
                        </button>
                      )}
                      {selectedCategory !== 'CUSTOM' && (
                        <button
                          type="button"
                          onClick={() => setShowManualDetails((prev) => !prev)}
                          className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0"
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>
                            {showManualDetails ? 'Tutup Detail / Catatan' : 'Catatan & Ubah Sanksi (Opsional)'}
                          </span>
                          {showManualDetails ? (
                            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <AnimatePresence initial={false}>
                  {(showManualDetails || selectedCategory === 'CUSTOM') && (
                    <motion.div
                      key="single-optional-details"
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                      className="space-y-3.5 rounded-xl border border-slate-200 bg-slate-50/40 p-3.5"
                    >
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                        <div className={selectedCategory === 'CUSTOM' ? 'sm:col-span-6' : 'sm:col-span-7'}>
                          <label
                            htmlFor="violation-label"
                            className="block text-xs font-medium text-slate-700"
                          >
                            Keterangan Pelanggaran
                          </label>
                          <input
                            id="violation-label"
                            type="text"
                            required={extraRules.length === 0}
                            disabled={!canRecordNow || submitting}
                            value={violationLabel}
                            onChange={(e) => setViolationLabel(e.target.value)}
                            placeholder="Contoh: Terlambat masuk sekolah"
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                          />
                        </div>

                        <div className={selectedCategory === 'CUSTOM' ? 'sm:col-span-4' : 'sm:col-span-5'}>
                          <label
                            htmlFor="violation-category"
                            className="block text-xs font-medium text-slate-700"
                          >
                            Kategori AKPS
                          </label>
                          <select
                            id="violation-category"
                            disabled={!canRecordNow || submitting}
                            value={category}
                            onChange={(e) => setCategory(e.target.value as KategoriPelanggaran)}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
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
                              className="block text-xs font-medium text-slate-700"
                            >
                              Poin
                            </label>
                            <input
                              id="violation-points"
                              type="number"
                              min={1}
                              max={100}
                              required={extraRules.length === 0}
                              disabled={!canRecordNow || submitting}
                              value={points}
                              onChange={(e) => setPoints(Number(e.target.value))}
                              className="font-mono-num mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                            />
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor="action-taken"
                            className="block text-xs font-medium text-slate-700"
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
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="violation-notes"
                            className="block text-xs font-medium text-slate-700"
                          >
                            Catatan Tambahan (Opsional)
                          </label>
                          <input
                            id="violation-notes"
                            type="text"
                            disabled={!canRecordNow || submitting}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Boleh dikosongkan..."
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-400"
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* LANGKAH 3 · KUNCI & SIMPAN */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900">Langkah 3 · Simpan Catatan</p>
                  {!selectedPresetId && !showManualDetails && selectedCategory !== 'CUSTOM' && (
                    <button
                      type="button"
                      onClick={() => setShowManualDetails(true)}
                      className="text-xs font-medium text-slate-500 hover:text-blue-700 underline whitespace-nowrap"
                    >
                      + Tambah Catatan / Ubah Sanksi
                    </button>
                  )}
                </div>

                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={lockViolationAfterSave}
                    onChange={(e) => setLockViolationAfterSave(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <span>
                    <strong className="text-slate-900">Kunci jenis pelanggaran ini untuk siswa berikutnya</strong>{' '}
                    (aturan tetap terpilih &amp; kursor langsung siap ketik siswa berikutnya).
                  </span>
                </label>

                <AnimatePresence>
                  {lastSaveCelebration && (
                    <motion.div
                      key="save-celebrate-banner"
                      initial={{ opacity: 0, scale: 0.94, y: 6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -4 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                      className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-900"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                        <span>
                          Tersimpan untuk <strong>{lastSaveCelebration.studentName}</strong> ({lastSaveCelebration.count} aturan)
                        </span>
                      </span>
                      <span className="font-mono-num text-emerald-700">
                        +{lastSaveCelebration.totalPoints} poin
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {connectionOffline && canRecordNow && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-900"
                  >
                    <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                    <span>
                      <strong>Koneksi sedang terputus.</strong> Jangan tekan simpan dulu agar catatan tidak gagal terkirim. Data yang sudah Anda ketik tetap aman menunggu koneksi kembali.
                    </span>
                  </div>
                )}

                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.985 }}
                  disabled={!canRecordNow || submitting || connectionOffline}
                  className="btn-3d-primary inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {connectionOffline ? (
                    <WifiOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>
                    {connectionOffline
                      ? 'Koneksi Terputus — Menunggu Tersambung...'
                      : submitting
                        ? 'Menyimpan...'
                        : !scheduleStatus.allowed
                          ? 'Terkunci (Di Luar Jadwal Piket)'
                          : isSheetFinalized
                            ? 'Spreadsheet Sudah Ditutup Final'
                            : !todaySheet && autoWindow.phase === 'BEFORE_START'
                              ? `Menunggu Jam Buka (${autoWindow.startTime} WIB)`
                              : !todaySheet
                                ? 'Spreadsheet Tidak Aktif Hari Ini'
                                : combinedSingleStudentRules.length > 1
                                  ? `Simpan ${combinedSingleStudentRules.length} Pelanggaran (+${combinedSinglePointsTotal} Poin)`
                                  : 'Simpan ke Spreadsheet Hari Ini'}
                  </span>
                </motion.button>
              </div>
            </form>
          )}
        </section>

        {/* Right Column: Productivity Summary Card + Consensus & Export */}
        <div className="space-y-6 lg:col-span-5">
          {/* Daily Picket Productivity Summary Card */}
          <section
            id="daily-productivity-card"
            aria-label="Ringkasan Produktivitas Piket Hari Ini"
            className="surface-3d animate-stagger-3 rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-6"
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
                  className="text-3xl font-bold tracking-tight text-slate-900"
                >
                  <AnimatedNumber value={dailyProductivity.totalViolations} />
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
                <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto pr-1">
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
                              {item.division} · {isSheetFinalized ? 'Selesai' : 'Aktif'}
                            </p>
                          </div>
                          <p className="font-mono-num shrink-0 text-xs font-semibold text-slate-800">
                            {item.violationCount} pelanggaran · +{item.totalPoints} poin ({item.percentage}%)
                          </p>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`animate-bar-grow h-full transition-all duration-300 ${
                              isSheetFinalized ? 'bg-emerald-600' : 'bg-blue-600'
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

          {/* Panel Jadwal Otomatis Sesi & Ekspor */}
          <section
            id="consensus-export-card"
            className="surface-3d animate-stagger-3 flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-6"
          >
            <div>
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    Status Sesi &amp; Unduh Laporan
                  </h2>
                  <p className="text-xs text-slate-500">
                    {isTrialUnrestricted
                      ? 'Mode Uji Coba Bebas aktif — tidak tertutup otomatis sampai Anda mematikannya.'
                      : `Spreadsheet buka otomatis pukul ${autoWindow.startTime} WIB dan tutup otomatis pukul ${autoWindow.endTime} WIB.`}
                  </p>
                </div>
                <Users className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
              </div>

              {!todaySheet ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-center">
                  <p className="text-sm font-semibold text-slate-800">
                    {autoWindow.phase === 'BEFORE_START'
                      ? `Spreadsheet Dibuka Otomatis Pukul ${autoWindow.startTime} WIB`
                      : `Hari ${autoWindow.hari} Tidak Ada Sesi Piket`}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {autoWindow.phase === 'BEFORE_START'
                      ? `Tersisa sekitar ${autoWindow.minutesUntilStart} menit lagi sebelum spreadsheet dibuat otomatis.`
                      : 'Aktifkan hari ini di menu Jadwal & Aturan jika ingin menjadwalkan sesi otomatis.'}
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div
                    className={`rounded-xl border p-3.5 text-xs ${
                      isSheetFinalized
                        ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
                        : todaySheet.reopenedManually
                          ? 'border-amber-200 bg-amber-50/70 text-amber-900'
                          : 'border-blue-200 bg-blue-50/70 text-blue-900'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-semibold">
                      <span>
                        {isTrialUnrestricted && isSheetActive
                          ? 'Mode Uji Coba Bebas Aktif'
                          : isSheetFinalized
                            ? 'Spreadsheet Ditutup & Final Otomatis'
                            : todaySheet.reopenedManually
                              ? 'Spreadsheet Dibuka Kembali untuk Revisi'
                              : 'Spreadsheet Sedang Aktif Otomatis'}
                      </span>
                      <span className="font-mono-num">
                        {isTrialUnrestricted ? 'Tanpa Batas Waktu' : `${autoWindow.startTime} – ${autoWindow.endTime}`}
                      </span>
                    </div>
                    <p className="mt-1 leading-relaxed opacity-90">
                      {isTrialUnrestricted && isSheetActive
                        ? 'Semua petugas bebas mencatat pelanggaran kapan saja. Spreadsheet tidak akan terkunci otomatis hingga Mode Uji Coba dimatikan.'
                        : isSheetFinalized
                          ? `Sesi telah ditutup pada jam selesai (${autoWindow.endTime} WIB). Seluruh file unduhan laporan sekarang terbuka.`
                          : todaySheet.reopenedManually
                            ? 'Sesi dibuka sementara oleh Admin/Developer. Klik Tutup & Finalkan Kembali setelah revisi selesai.'
                            : `Spreadsheet akan otomatis selesai dan terkunci pada pukul ${autoWindow.endTime} WIB (${autoWindow.minutesUntilClose} menit lagi).`}
                    </p>
                  </div>

                  {todaySheet.activeOfficers.length > 0 && (
                    <ul className="max-h-52 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 pr-1">
                      {todaySheet.activeOfficers.map((id) => {
                        const activeOff = officerMap.get(id);
                        const isSelf = id === officer.id;
                        return (
                          <li
                            key={id}
                            className="flex items-center justify-between gap-3 py-2"
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
                                isSheetFinalized ? 'text-emerald-700' : 'text-blue-700'
                              }`}
                            >
                              {isSheetFinalized ? (
                                <>
                                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                                  <span>Selesai</span>
                                </>
                              ) : (
                                <span>Aktif Mencatat</span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {isManagerRole(officer.role) && (
                    <div className="space-y-2 pt-1">
                      {appState.simulation.enabled && (
                        <button
                          key="turn-off-trial-btn"
                          type="button"
                          disabled={submitting}
                          onClick={handleTurnOffTrialMode}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                        >
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Matikan Mode Uji Coba (Kembali Normal)</span>
                        </button>
                      )}
                      {isSheetFinalized ? (
                        <button
                          key="reopen-sheet-btn"
                          type="button"
                          disabled={submitting}
                          onClick={handleReopenByCoordinator}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Buka Kembali untuk Revisi (Admin / Developer)</span>
                        </button>
                      ) : todaySheet.reopenedManually || autoWindow.phase === 'CLOSED' ? (
                        <button
                          key="close-sheet-btn"
                          type="button"
                          disabled={submitting}
                          onClick={handleCloseByCoordinator}
                          className="btn-3d-success flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          <span>Tutup &amp; Finalkan Kembali</span>
                        </button>
                      ) : null}
                    </div>
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
                  {consensus.exportUnlocked
                    ? 'Siap Diunduh'
                    : isTrialUnrestricted
                      ? 'Menunggu Uji Coba Dimatikan'
                      : `Terkunci s.d. ${autoWindow.endTime} WIB`}
                </span>
              </div>

              {!consensus.exportUnlocked && (
                <p className="mb-3 text-xs text-slate-500">
                  {isTrialUnrestricted ? (
                    'Selama Mode Uji Coba Bebas aktif, spreadsheet tetap terbuka agar bebas mencatat. Matikan Mode Uji Coba jika ingin kembali ke jadwal normal.'
                  ) : (
                    <>
                      Tombol unduh akan aktif otomatis setelah spreadsheet ditutup pada jam selesai (
                      <strong className="font-mono-num text-slate-700">{autoWindow.endTime} WIB</strong>).
                    </>
                  )}
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
      <section className="surface-3d animate-stagger-4 rounded-2xl border border-slate-200/90 bg-white">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Lembar Spreadsheet Pelanggaran Hari Ini
            </h2>
            <p className="text-xs text-slate-500">
              {todaySheet
                ? !groupByClassView && filteredRows.length > 0
                  ? `Menampilkan ${paginatedRows.startIndex}–${paginatedRows.endIndex} dari ${filteredRows.length} catatan`
                  : `Menampilkan ${filteredRows.length} dari ${todaySheet.rows.length} catatan`
                : isTrialUnrestricted
                  ? 'Mode Uji Coba Bebas siap digunakan kapan saja.'
                  : `Spreadsheet akan dibuat otomatis pukul ${autoWindow.startTime} WIB.`}
            </p>
          </div>

          <div className="flex w-full flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto">
            <div className="flex items-center gap-1 self-start rounded-lg bg-slate-100 p-1">
              {(
                [
                  { grouped: false, label: 'Semua Baris' },
                  { grouped: true, label: 'Pisahkan per Kelas' },
                ] as const
              ).map((viewTab) => {
                const active = groupByClassView === viewTab.grouped;
                return (
                  <button
                    key={viewTab.label}
                    type="button"
                    onClick={() => {
                      setGroupByClassView(viewTab.grouped);
                      setRowPage(1);
                    }}
                    className={`relative rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      active ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="row-view-pill"
                        transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                        className="absolute inset-0 rounded-md bg-white shadow-sm"
                        aria-hidden="true"
                      />
                    )}
                    <span className="relative z-10">{viewTab.label}</span>
                  </button>
                );
              })}
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
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setRowPage(1);
                }}
                placeholder="Cari siswa / kelas / kode..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <select
              aria-label="Filter kategori pelanggaran"
              value={filterCategory}
              onChange={(e) => {
                setFilterCategory(e.target.value);
                setRowPage(1);
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-blue-600 focus:outline-none sm:w-auto"
            >
              <option value="ALL">Semua Kategori AKPS</option>
              {AKPS_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {(searchQuery || filterCategory !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setFilterCategory('ALL');
                  setRowPage(1);
                }}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          {!todaySheet || todaySheet.rows.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium text-slate-700">
                {!todaySheet
                  ? 'Spreadsheet hari ini belum dibuka.'
                  : 'Belum ada data pelanggaran pada spreadsheet hari ini.'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {!todaySheet
                  ? autoWindow.phase === 'BEFORE_START'
                    ? `Spreadsheet akan dibuat otomatis pada pukul ${autoWindow.startTime} WIB.`
                    : `Tidak ada sesi otomatis untuk hari ${autoWindow.hari}.`
                  : canRecordNow
                    ? 'Gunakan formulir di atas untuk mencatat siswa pertama.'
                    : 'Menunggu pencatatan pelanggaran oleh petugas piket.'}
              </p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">
              Tidak ada baris yang cocok dengan pencarian Anda.
            </div>
          ) : groupByClassView ? (
            <div className="divide-y divide-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 px-4 py-2 text-xs text-slate-600 sm:px-5">
                <span>
                  <strong className="font-mono-num text-slate-900">{groupedFilteredRows.length}</strong> kelas memiliki catatan (klik nama kelas untuk buka/tutup)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const next: Record<string, boolean> = {};
                      groupedFilteredRows.forEach((g) => {
                        next[g.kelas] = true;
                      });
                      setOpenClassGroups(next);
                    }}
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Buka Semua
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next: Record<string, boolean> = {};
                      groupedFilteredRows.forEach((g) => {
                        next[g.kelas] = false;
                      });
                      setOpenClassGroups(next);
                    }}
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Tutup Semua
                  </button>
                </div>
              </div>
              {groupedFilteredRows.map((grp, grpIdx) => {
                const isExpanded = openClassGroups[grp.kelas] ?? grpIdx === 0;
                return (
                <div key={grp.kelas}>
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() =>
                      setOpenClassGroups((prev) => ({
                        ...prev,
                        [grp.kelas]: !isExpanded,
                      }))
                    }
                    className="flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-2.5 text-left transition-colors hover:bg-slate-100/80"
                  >
                    <span className="font-display text-sm font-bold text-slate-900">
                      Kelas {grp.kelas}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono-num text-xs font-semibold text-slate-600">
                        {grp.totalIncidents} catatan · Total +{grp.totalPoints} poin
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-slate-500" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-slate-500" aria-hidden="true" />
                      )}
                    </span>
                  </button>
                  {isExpanded && (
                  <table className="min-w-[760px] w-full border-collapse border-t border-slate-200 text-left text-sm">
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
                        {canRecordNow && <th className="px-4 py-2.5 text-right w-28">Aksi</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {grp.rows.map((row, idx) => {
                        const canModifyRow = canModifyViolationRow(officer, row);
                        const isEditingRow = editingRowId === row.id;
                        return (
                          <tr
                            key={row.id}
                            className={`hover:bg-slate-50/80 transition-colors ${
                              row.id === lastAddedRowId ? 'animate-row-flash' : ''
                            }`}
                          >
                            <td className="font-mono-num px-4 py-2.5 text-center text-xs text-slate-500">
                              {idx + 1}
                            </td>
                            <td className="font-mono-num px-4 py-2.5 text-xs text-slate-700">
                              {row.timeLabel}
                            </td>
                            <td className="font-mono-num px-4 py-2.5 text-xs font-semibold text-blue-700">
                              {isEditingRow ? (
                                <input
                                  type="text"
                                  aria-label="Edit kode AKPS"
                                  value={editViolationCode}
                                  onChange={(e) => setEditViolationCode(e.target.value)}
                                  placeholder="Kode"
                                  className="font-mono-num w-16 rounded-lg border border-slate-200 px-2 py-1 text-xs uppercase text-slate-900"
                                />
                              ) : (
                                row.violationCode || '-'
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              {isEditingRow ? (
                                <div className="space-y-1.5">
                                  <input
                                    type="text"
                                    value={editStudentName}
                                    onChange={(e) => setEditStudentName(e.target.value)}
                                    placeholder="Nama siswa"
                                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-900"
                                  />
                                  <div className="flex gap-1.5">
                                    <input
                                      type="text"
                                      value={editKelas}
                                      onChange={(e) => setEditKelas(e.target.value)}
                                      placeholder="Kelas"
                                      className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs uppercase"
                                    />
                                    <input
                                      type="text"
                                      value={editStudentNis}
                                      onChange={(e) => setEditStudentNis(e.target.value)}
                                      placeholder="NIS"
                                      className="font-mono-num w-24 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                                    />
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <p className="font-medium text-slate-900">{row.studentName}</p>
                                  <p className="font-mono-num text-xs text-slate-500">
                                    NIS {row.studentNis}
                                  </p>
                                </>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              {isEditingRow ? (
                                <div className="space-y-1.5">
                                  <input
                                    type="text"
                                    value={editViolationLabel}
                                    onChange={(e) => setEditViolationLabel(e.target.value)}
                                    placeholder="Pelanggaran"
                                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-900"
                                  />
                                  <select
                                    aria-label="Edit kategori AKPS"
                                    value={editCategory}
                                    onChange={(e) =>
                                      setEditCategory(e.target.value as KategoriPelanggaran)
                                    }
                                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                                  >
                                    {AKPS_CATEGORIES.map((c) => (
                                      <option key={c} value={c}>
                                        {c}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="text"
                                    value={editNotes}
                                    onChange={(e) => setEditNotes(e.target.value)}
                                    placeholder="Catatan (opsional)"
                                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600"
                                  />
                                </div>
                              ) : (
                                <>
                                  <p className="text-slate-900">{row.violationLabel}</p>
                                  <p className="text-xs text-slate-500">
                                    {row.category}
                                    {row.notes ? ` · ${row.notes}` : ''}
                                  </p>
                                </>
                              )}
                            </td>
                            <td className="font-mono-num px-4 py-2.5 text-right font-semibold text-red-700">
                              {isEditingRow ? (
                                <input
                                  type="number"
                                  min={1}
                                  max={100}
                                  value={editPoints}
                                  onChange={(e) => setEditPoints(Number(e.target.value))}
                                  className="font-mono-num w-16 rounded-lg border border-slate-200 px-2 py-1 text-right text-xs"
                                />
                              ) : (
                                `+${row.points}`
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-600">
                              {isEditingRow ? (
                                <input
                                  type="text"
                                  value={editActionTaken}
                                  onChange={(e) => setEditActionTaken(e.target.value)}
                                  placeholder="Tindak lanjut"
                                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs"
                                />
                              ) : (
                                row.actionTaken
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-700 whitespace-nowrap">
                              {row.recordedByName}
                            </td>
                            {canRecordNow && (
                              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                {!canModifyRow ? (
                                  <span className="text-[11px] text-slate-400">Petugas lain</span>
                                ) : isEditingRow ? (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={submitting}
                                      onClick={() => handleSaveEditRow(row.id)}
                                      className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700"
                                    >
                                      <Save className="h-3 w-3" aria-hidden="true" />
                                      <span>Simpan</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingRowId(null)}
                                      className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                                    >
                                      Batal
                                    </button>
                                  </div>
                                ) : confirmDeleteId === row.id ? (
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
                                  <div className="inline-flex items-center justify-end gap-1">
                                    <button
                                      type="button"
                                      disabled={submitting}
                                      onClick={() => startEditRow(row)}
                                      aria-label={`Edit catatan ${row.studentName}`}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                                    >
                                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={submitting}
                                      onClick={() => setConfirmDeleteId(row.id)}
                                      aria-label={`Hapus catatan ${row.studentName}`}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                                    >
                                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                                    </button>
                                  </div>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  )}
                </div>
                );
              })}
            </div>
          ) : (
            <table className="min-w-[820px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="px-4 py-2.5 text-center w-12">No</th>
                  <th className="px-4 py-2.5 w-20">Jam</th>
                  <th className="px-4 py-2.5 w-16">Kode</th>
                  <th className="px-4 py-2.5">Siswa & NIS</th>
                  <th className="px-4 py-2.5 w-24">Kelas</th>
                  <th className="px-4 py-2.5">Pelanggaran & Kategori</th>
                  <th className="px-4 py-2.5 text-right w-20">Poin</th>
                  <th className="px-4 py-2.5">Tindak Lanjut</th>
                  <th className="px-4 py-2.5">Petugas</th>
                  {canRecordNow && <th className="px-4 py-2.5 text-right w-28">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedRows.items.map((row, idx) => {
                  const canModifyRow = canModifyViolationRow(officer, row);
                  const isEditingRow = editingRowId === row.id;
                  const rowNo =
                    paginatedRows.pageSize === 'ALL'
                      ? filteredRows.length - idx
                      : filteredRows.length -
                        ((paginatedRows.page - 1) * paginatedRows.pageSize + idx);
                  return (
                    <tr
                      key={row.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        row.id === lastAddedRowId ? 'animate-row-flash' : ''
                      }`}
                    >
                      <td className="font-mono-num px-4 py-2.5 text-center text-xs text-slate-500">
                        {rowNo}
                      </td>
                      <td className="font-mono-num px-4 py-2.5 text-xs font-medium text-slate-700">
                        {row.timeLabel}
                      </td>
                      <td className="font-mono-num px-4 py-2.5 text-xs font-semibold text-blue-700">
                        {isEditingRow ? (
                          <input
                            type="text"
                            aria-label="Edit kode AKPS"
                            value={editViolationCode}
                            onChange={(e) => setEditViolationCode(e.target.value)}
                            placeholder="Kode"
                            className="font-mono-num w-16 rounded-lg border border-slate-200 px-2 py-1 text-xs uppercase text-slate-900"
                          />
                        ) : (
                          row.violationCode || '-'
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {isEditingRow ? (
                          <div className="space-y-1.5">
                            <input
                              type="text"
                              value={editStudentName}
                              onChange={(e) => setEditStudentName(e.target.value)}
                              placeholder="Nama siswa"
                              className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-900"
                            />
                            <input
                              type="text"
                              value={editStudentNis}
                              onChange={(e) => setEditStudentNis(e.target.value)}
                              placeholder="NIS"
                              className="font-mono-num w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs"
                            />
                          </div>
                        ) : (
                          <>
                            <p className="font-medium text-slate-900">{row.studentName}</p>
                            <p className="font-mono-num text-xs text-slate-500">
                              NIS {row.studentNis}
                            </p>
                          </>
                        )}
                      </td>
                      <td className="font-mono-num px-4 py-2.5 text-xs font-semibold text-slate-800">
                        {isEditingRow ? (
                          <input
                            type="text"
                            value={editKelas}
                            onChange={(e) => setEditKelas(e.target.value)}
                            placeholder="Kelas"
                            className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs uppercase"
                          />
                        ) : (
                          row.kelas
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {isEditingRow ? (
                          <div className="space-y-1.5">
                            <input
                              type="text"
                              value={editViolationLabel}
                              onChange={(e) => setEditViolationLabel(e.target.value)}
                              placeholder="Pelanggaran"
                              className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-900"
                            />
                            <select
                              aria-label="Edit kategori AKPS"
                              value={editCategory}
                              onChange={(e) =>
                                setEditCategory(e.target.value as KategoriPelanggaran)
                              }
                              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                            >
                              {AKPS_CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              placeholder="Catatan (opsional)"
                              className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600"
                            />
                          </div>
                        ) : (
                          <>
                            <p className="text-slate-900">{row.violationLabel}</p>
                            <p className="text-xs text-slate-500">
                              {row.category}
                              {row.notes ? ` · ${row.notes}` : ''}
                            </p>
                          </>
                        )}
                      </td>
                      <td className="font-mono-num px-4 py-2.5 text-right font-semibold text-red-700">
                        {isEditingRow ? (
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={editPoints}
                            onChange={(e) => setEditPoints(Number(e.target.value))}
                            className="font-mono-num w-16 rounded-lg border border-slate-200 px-2 py-1 text-right text-xs"
                          />
                        ) : (
                          `+${row.points}`
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">
                        {isEditingRow ? (
                          <input
                            type="text"
                            value={editActionTaken}
                            onChange={(e) => setEditActionTaken(e.target.value)}
                            placeholder="Tindak lanjut"
                            className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs"
                          />
                        ) : (
                          row.actionTaken
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-700 whitespace-nowrap">
                        {row.recordedByName}
                      </td>
                      {canRecordNow && (
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {!canModifyRow ? (
                            <span className="text-[11px] text-slate-400">Petugas lain</span>
                          ) : isEditingRow ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => handleSaveEditRow(row.id)}
                                className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700"
                              >
                                <Save className="h-3 w-3" aria-hidden="true" />
                                <span>Simpan</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingRowId(null)}
                                className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                              >
                                <X className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </div>
                          ) : confirmDeleteId === row.id ? (
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
                            <div className="inline-flex items-center justify-end gap-1">
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => startEditRow(row)}
                                aria-label={`Edit catatan ${row.studentName}`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => setConfirmDeleteId(row.id)}
                                aria-label={`Hapus catatan ${row.studentName}`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {!groupByClassView && filteredRows.length > 0 && (
          <PaginationBar
            page={paginatedRows.page}
            totalPages={paginatedRows.totalPages}
            totalItems={paginatedRows.totalItems}
            startIndex={paginatedRows.startIndex}
            endIndex={paginatedRows.endIndex}
            pageSize={rowPageSize}
            pageSizeOptions={[15, 30, 60]}
            itemLabel="catatan"
            onPageChange={setRowPage}
            onPageSizeChange={(nextSize) => {
              setRowPageSize(nextSize);
              setRowPage(1);
            }}
          />
        )}
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
