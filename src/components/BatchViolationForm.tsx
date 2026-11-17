import { useMemo, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Lock,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import { AKPS_CATEGORIES, searchSimilarStudents } from '../shared/piketLogic';
import {
  MAX_BATCH_VIOLATION_ROWS,
  buildBatchColumnEntries,
  buildBatchViolationInputs,
  createEmptyBatchColumnRow,
  filterStudentsByClassAndQuery,
  getOrderedViolationOptions,
  getSortedStudentClasses,
  type BatchColumnRow,
  type BatchRuleItem,
  type BatchStudentItem,
  type QuickPickPresetItem,
} from '../shared/batchViolationLogic';
import type {
  KategoriPelanggaran,
  PublicAppState,
  StudentRecord,
  ViolationPreset,
} from '../shared/types';

interface BatchViolationFormProps {
  appState: PublicAppState;
  quickPickItems: QuickPickPresetItem[];
  recentPresetIds?: string[];
  canRecordNow: boolean;
  connectionOffline: boolean;
  lockedNoticeText: string;
  onRecordPresetUsed: (presetId: string) => void;
  onSuccessSubmit: (nextState: PublicAppState, createdCount: number, createdIds: string[]) => void;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function BatchViolationForm({
  appState,
  quickPickItems,
  recentPresetIds = [],
  canRecordNow,
  connectionOffline,
  lockedNoticeText,
  onRecordPresetUsed,
  onSuccessSubmit,
  onNotify,
}: BatchViolationFormProps) {
  // Primary Mode: Per-Column / Row-by-Row Entry Table
  const [rows, setRows] = useState<BatchColumnRow[]>(() => [
    createEmptyBatchColumnRow('init-1'),
    createEmptyBatchColumnRow('init-2'),
    createEmptyBatchColumnRow('init-3'),
  ]);
  const [activeStudentRowKey, setActiveStudentRowKey] = useState<string | null>(null);
  const [highlightedStudentIdx, setHighlightedStudentIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Subtle Secondary Feature: "1 Pelanggaran untuk Banyak Siswa"
  const [showSameRuleDrawer, setShowSameRuleDrawer] = useState(false);
  const [massPresetId, setMassPresetId] = useState(''); // '' | preset.id | 'CUSTOM'
  const [massCustomLabel, setMassCustomLabel] = useState('');
  const [massCustomCategory, setMassCustomCategory] = useState<KategoriPelanggaran>(
    'A. Kedisiplinan & Kehadiran'
  );
  const [massCustomPoints, setMassCustomPoints] = useState(5);
  const [massCustomAction, setMassCustomAction] = useState('');
  const [massStudents, setMassStudents] = useState<BatchStudentItem[]>([]);
  const [massNotes, setMassNotes] = useState('');
  const [massPickerTab, setMassPickerTab] = useState<'search' | 'class'>('search');
  const [massSearchText, setMassSearchText] = useState('');
  const [showMassSearchDropdown, setShowMassSearchDropdown] = useState(false);
  const [massHighlightIdx, setMassHighlightIdx] = useState(0);
  const massSearchInputRef = useRef<HTMLInputElement | null>(null);

  const classList = useMemo(
    () => getSortedStudentClasses(appState.students),
    [appState.students]
  );
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>(
    () => classList[0] ?? 'ALL'
  );
  const [classSearchQuery, setClassSearchQuery] = useState('');

  // Ordered Violation Options: "Terbaru & Sering Dipakai" at the very top, then AKPS categories
  const orderedViolationOptions = useMemo(
    () =>
      getOrderedViolationOptions(
        appState.presets,
        appState.spreadsheets,
        recentPresetIds,
        appState.serverDate,
        8
      ),
    [appState.presets, appState.spreadsheets, recentPresetIds, appState.serverDate]
  );

  const presetByIdMap = useMemo(
    () => new Map(appState.presets.map((p) => [p.id, p])),
    [appState.presets]
  );

  // Per-row autocomplete matches for whichever row's student input is focused
  const activeRowMatches = useMemo(() => {
    if (!activeStudentRowKey) return [];
    const targetRow = rows.find((r) => r.rowKey === activeStudentRowKey);
    if (!targetRow) return [];
    return searchSimilarStudents(appState.students, targetRow.studentName, 8);
  }, [activeStudentRowKey, rows, appState.students]);

  // Built entries preview & validation status for primary per-column table
  const builtColumnResult = useMemo(() => buildBatchColumnEntries(rows), [rows]);

  const hasAnyTypedData = useMemo(
    () =>
      rows.some(
        (r) =>
          Boolean(r.studentName.trim()) ||
          Boolean(r.kelas.trim()) ||
          Boolean(r.presetId) ||
          Boolean(r.violationLabel.trim()) ||
          Boolean(r.notes.trim())
      ),
    [rows]
  );

  // Secondary "1 Pelanggaran untuk Banyak Siswa" helpers
  const effectiveClassFilter = useMemo(() => {
    if (selectedClassFilter === 'ALL' || classList.includes(selectedClassFilter)) {
      return selectedClassFilter;
    }
    return classList[0] ?? 'ALL';
  }, [selectedClassFilter, classList]);

  const studentsInSelectedClass = useMemo(
    () => filterStudentsByClassAndQuery(appState.students, effectiveClassFilter, classSearchQuery),
    [appState.students, effectiveClassFilter, classSearchQuery]
  );

  const massSearchMatches = useMemo(
    () => searchSimilarStudents(appState.students, massSearchText, 8),
    [appState.students, massSearchText]
  );

  const massStudentKeySet = useMemo(
    () => new Set(massStudents.map((s) => s.key)),
    [massStudents]
  );

  const selectedMassRuleItem: BatchRuleItem | null = useMemo(() => {
    if (!massPresetId) return null;
    if (massPresetId === 'CUSTOM') {
      const label = massCustomLabel.trim();
      if (!label) return null;
      return {
        key: 'mass-custom',
        violationCode: 'CUSTOM',
        violationLabel: label,
        category: massCustomCategory,
        points: Math.max(1, Math.min(100, Math.round(Number(massCustomPoints || 5)))),
        actionTaken: massCustomAction.trim() || 'Teguran Lisan & Catat',
      };
    }
    const preset = presetByIdMap.get(massPresetId);
    if (!preset) return null;
    return {
      key: `preset:${preset.id}`,
      presetId: preset.id,
      violationCode: preset.code,
      violationLabel: preset.label,
      category: preset.category,
      points: preset.points,
      actionTaken: preset.defaultAction,
    };
  }, [
    massPresetId,
    massCustomLabel,
    massCustomCategory,
    massCustomPoints,
    massCustomAction,
    presetByIdMap,
  ]);

  function makeStudentKey(stu: Pick<StudentRecord, 'id' | 'name' | 'kelas'>): string {
    if (stu.id) return `id:${stu.id}`;
    return `manual:${stu.name.trim().toLowerCase()}::${stu.kelas.trim().toUpperCase()}`;
  }

  function updateRow(rowKey: string, patch: Partial<BatchColumnRow>) {
    setRows((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)));
  }

  function handleSelectRowStudent(rowKey: string, stu: StudentRecord) {
    updateRow(rowKey, {
      studentId: stu.id,
      studentName: stu.name,
      kelas: stu.kelas,
      nis: stu.nis && stu.nis !== '-' ? stu.nis : '',
      saveToStudentDirectory: false,
    });
    setActiveStudentRowKey(null);
    setHighlightedStudentIdx(0);
  }

  function handleClearRowStudent(rowKey: string) {
    updateRow(rowKey, {
      studentId: undefined,
      studentName: '',
      kelas: '',
      nis: '',
      saveToStudentDirectory: false,
    });
  }

  function handleSelectRowViolation(rowKey: string, value: string) {
    if (!value) {
      updateRow(rowKey, {
        presetId: '',
        violationCode: '',
        violationLabel: '',
        category: 'A. Kedisiplinan & Kehadiran',
        points: 5,
        actionTaken: '',
      });
      return;
    }

    if (value === 'CUSTOM') {
      updateRow(rowKey, {
        presetId: 'CUSTOM',
        violationCode: 'CUSTOM',
        violationLabel: '',
        category: 'A. Kedisiplinan & Kehadiran',
        points: 5,
        actionTaken: 'Teguran Lisan & Catat',
      });
      return;
    }

    const preset = presetByIdMap.get(value);
    if (!preset) return;
    onRecordPresetUsed(preset.id);
    updateRow(rowKey, {
      presetId: preset.id,
      violationCode: preset.code,
      violationLabel: preset.label,
      category: preset.category,
      points: preset.points,
      actionTaken: preset.defaultAction,
    });
  }

  function handleAddEmptyRows(count = 1) {
    setRows((prev) => {
      if (prev.length >= MAX_BATCH_VIOLATION_ROWS) {
        onNotify(`Maksimal ${MAX_BATCH_VIOLATION_ROWS} baris dalam satu tabel.`, 'info');
        return prev;
      }
      const next = [...prev];
      for (let i = 0; i < count && next.length < MAX_BATCH_VIOLATION_ROWS; i++) {
        next.push(createEmptyBatchColumnRow(`${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`));
      }
      return next;
    });
  }

  function handleRemoveRow(rowKey: string) {
    setRows((prev) => {
      if (prev.length <= 1) {
        return [createEmptyBatchColumnRow(`${Date.now()}-reset`)];
      }
      return prev.filter((r) => r.rowKey !== rowKey);
    });
  }

  function handleResetAllRows() {
    setRows([
      createEmptyBatchColumnRow(`${Date.now()}-1`),
      createEmptyBatchColumnRow(`${Date.now()}-2`),
      createEmptyBatchColumnRow(`${Date.now()}-3`),
    ]);
  }

  // Secondary "1 Pelanggaran untuk Banyak Siswa" handlers
  function handlePickMassPreset(value: string) {
    setMassPresetId(value);
    if (value && value !== 'CUSTOM') {
      const preset = presetByIdMap.get(value);
      if (preset) onRecordPresetUsed(preset.id);
    }
  }

  function toggleMassStudent(stu: StudentRecord) {
    const key = makeStudentKey(stu);
    setMassStudents((prev) => {
      if (prev.some((s) => s.key === key)) {
        return prev.filter((s) => s.key !== key);
      }
      return [
        ...prev,
        {
          key,
          id: stu.id,
          name: stu.name,
          kelas: stu.kelas,
          nis: stu.nis && stu.nis !== '-' ? stu.nis : '',
          saveToStudentDirectory: false,
        },
      ];
    });
  }

  function addMassStudentFromSearch(stu: StudentRecord) {
    const key = makeStudentKey(stu);
    setMassStudents((prev) => {
      if (prev.some((s) => s.key === key)) return prev;
      return [
        ...prev,
        {
          key,
          id: stu.id,
          name: stu.name,
          kelas: stu.kelas,
          nis: stu.nis && stu.nis !== '-' ? stu.nis : '',
          saveToStudentDirectory: false,
        },
      ];
    });
    setMassSearchText('');
    setMassHighlightIdx(0);
    setShowMassSearchDropdown(false);
    window.requestAnimationFrame(() => {
      massSearchInputRef.current?.focus();
    });
  }

  function handleSelectAllVisibleMassClass() {
    setMassStudents((prev) => {
      const existing = new Set(prev.map((s) => s.key));
      const additions: BatchStudentItem[] = [];
      for (const stu of studentsInSelectedClass) {
        const key = makeStudentKey(stu);
        if (!existing.has(key)) {
          existing.add(key);
          additions.push({
            key,
            id: stu.id,
            name: stu.name,
            kelas: stu.kelas,
            nis: stu.nis && stu.nis !== '-' ? stu.nis : '',
            saveToStudentDirectory: false,
          });
        }
      }
      return [...prev, ...additions];
    });
  }

  function handleDeselectVisibleMassClass() {
    const visibleKeys = new Set(studentsInSelectedClass.map((s) => makeStudentKey(s)));
    setMassStudents((prev) => prev.filter((s) => !visibleKeys.has(s.key)));
  }

  const allVisibleMassClassSelected =
    studentsInSelectedClass.length > 0 &&
    studentsInSelectedClass.every((s) => massStudentKeySet.has(makeStudentKey(s)));

  function handleApplySameRuleToRows() {
    if (!selectedMassRuleItem) {
      onNotify('Pilih jenis pelanggaran terlebih dahulu.', 'error');
      return;
    }
    if (massStudents.length === 0) {
      onNotify('Pilih minimal 1 siswa untuk dimasukkan ke tabel.', 'error');
      return;
    }

    const newRows: BatchColumnRow[] = massStudents.map((stu, idx) => ({
      rowKey: `mass-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
      studentId: stu.id,
      studentName: stu.name,
      kelas: stu.kelas,
      nis: stu.nis,
      saveToStudentDirectory: stu.saveToStudentDirectory,
      presetId: selectedMassRuleItem.presetId ?? 'CUSTOM',
      violationCode: selectedMassRuleItem.violationCode,
      violationLabel: selectedMassRuleItem.violationLabel,
      category: selectedMassRuleItem.category,
      points: selectedMassRuleItem.points,
      actionTaken: selectedMassRuleItem.actionTaken,
      notes: massNotes.trim(),
    }));

    setRows((prev) => {
      const nonEmptyExisting = prev.filter(
        (r) =>
          Boolean(r.studentName.trim()) ||
          Boolean(r.kelas.trim()) ||
          Boolean(r.presetId) ||
          Boolean(r.violationLabel.trim()) ||
          Boolean(r.notes.trim())
      );
      const combined = [...nonEmptyExisting, ...newRows];
      return combined.slice(0, MAX_BATCH_VIOLATION_ROWS);
    });

    if (selectedMassRuleItem.presetId) {
      onRecordPresetUsed(selectedMassRuleItem.presetId);
    }

    onNotify(
      `${newRows.length} siswa dimasukkan ke tabel baris dengan pelanggaran "${selectedMassRuleItem.violationLabel}".`,
      'success'
    );
    setMassStudents([]);
    setMassNotes('');
    setShowSameRuleDrawer(false);
  }

  async function handleSaveSameRuleDirectly() {
    if (!canRecordNow || connectionOffline || submitting) return;
    if (!selectedMassRuleItem) {
      onNotify('Pilih jenis pelanggaran terlebih dahulu.', 'error');
      return;
    }
    const built = buildBatchViolationInputs(massStudents, [selectedMassRuleItem], massNotes);
    if (built.error) {
      onNotify(built.error, 'error');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/violations/bulk', {
        method: 'POST',
        body: JSON.stringify({ entries: built.entries }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal menyimpan catatan massal.', 'error');
        return;
      }
      if (selectedMassRuleItem.presetId) {
        onRecordPresetUsed(selectedMassRuleItem.presetId);
      }
      setMassStudents([]);
      setMassNotes('');
      setShowSameRuleDrawer(false);
      onSuccessSubmit(
        data.state,
        Number(data.createdCount ?? built.entries.length),
        Array.isArray(data.createdIds) ? data.createdIds : []
      );
    } catch {
      onNotify('Tidak dapat menyimpan catatan massal ke server.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitColumnTable(e: FormEvent) {
    e.preventDefault();
    if (!canRecordNow || connectionOffline || submitting) return;

    const built = buildBatchColumnEntries(rows);
    if (built.error) {
      onNotify(built.error, 'error');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/violations/bulk', {
        method: 'POST',
        body: JSON.stringify({ entries: built.entries }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal menyimpan catatan baris.', 'error');
        return;
      }

      handleResetAllRows();
      onSuccessSubmit(
        data.state,
        Number(data.createdCount ?? built.entries.length),
        Array.isArray(data.createdIds) ? data.createdIds : []
      );
    } catch {
      onNotify('Tidak dapat menyimpan catatan baris ke server.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function renderViolationSelectOptions() {
    return (
      <>
        <option value="">-- Pilih pelanggaran --</option>
        {orderedViolationOptions.topFrequentAndRecent.length > 0 && (
          <optgroup label="Terbaru & Sering Dipakai">
            {orderedViolationOptions.topFrequentAndRecent.map((opt) => (
              <option key={`top-${opt.preset.id}`} value={opt.preset.id}>
                [{opt.preset.code}] {opt.preset.label} (+{opt.preset.points}p
                {opt.totalCount > 0 ? ` · ${opt.totalCount}×` : ''})
              </option>
            ))}
          </optgroup>
        )}
        {orderedViolationOptions.byCategory.map((group) => (
          <optgroup key={group.category} label={group.category}>
            {group.items.map((opt) => (
              <option key={opt.preset.id} value={opt.preset.id}>
                [{opt.preset.code}] {opt.preset.label} (+{opt.preset.points}p
                {opt.totalCount > 0 ? ` · ${opt.totalCount}×` : ''})
              </option>
            ))}
          </optgroup>
        ))}
        <option value="CUSTOM">Pelanggaran Lainnya (Isi Manual)</option>
      </>
    );
  }

  return (
    <form onSubmit={handleSubmitColumnTable} className="mt-5 space-y-4">
      {/* Header Baris Per Kolom */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-slate-900">
            Tabel Input Per Kolom (1 Baris = 1 Siswa &amp; Pelanggarannya)
          </p>
          <p className="text-xs text-slate-500">
            Pilih nama siswa lalu pilih pelanggarannya per baris. Pelanggaran yang sering/baru dipakai otomatis muncul paling atas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasAnyTypedData && (
            <button
              type="button"
              disabled={submitting}
              onClick={handleResetAllRows}
              className="text-xs font-medium text-slate-500 underline hover:text-slate-800 whitespace-nowrap"
            >
              Bersihkan
            </button>
          )}
          <motion.button
            type="button"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            disabled={!canRecordNow || submitting || rows.length >= MAX_BATCH_VIOLATION_ROWS}
            onClick={() => handleAddEmptyRows(1)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
            <span>Tambah Baris</span>
          </motion.button>
        </div>
      </div>

      {/* Desktop Column Headers */}
      <div className="hidden md:grid md:grid-cols-[28px_minmax(0,1.15fr)_minmax(0,1.35fr)_152px_32px] md:items-center md:gap-2.5 md:px-3 md:text-[11px] md:font-semibold md:text-slate-500">
        <div className="text-center">#</div>
        <div>Siswa &amp; Kelas</div>
        <div>Jenis Pelanggaran</div>
        <div>Poin &amp; Catatan</div>
        <div className="text-right">Hapus</div>
      </div>

      {/* Row-by-Row Per-Column List (Grid avoids overflow-x-auto clipping autocomplete dropdowns) */}
      <div className="space-y-2.5">
        <AnimatePresence initial={false}>
          {rows.map((row, idx) => {
            const isMatchedStudent = Boolean(row.studentId);
            const showManualFields = !isMatchedStudent && Boolean(row.studentName.trim());
            const isDropdownOpen = activeStudentRowKey === row.rowKey;

            return (
              <motion.div
                key={row.rowKey}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.16 }}
                className="rounded-xl border border-slate-200 bg-slate-50/55 p-3 transition-colors focus-within:border-blue-300 focus-within:bg-white"
              >
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-[28px_minmax(0,1.15fr)_minmax(0,1.35fr)_152px_32px] md:items-start">
                  {/* Nomor Baris */}
                  <div className="flex items-center justify-between md:justify-center md:pt-2">
                    <span className="font-mono-num text-xs font-bold text-slate-500 whitespace-nowrap">
                      <span className="md:hidden">Baris </span>
                      {idx + 1}
                    </span>
                    <button
                      type="button"
                      disabled={submitting}
                      aria-label={`Hapus baris ${idx + 1}`}
                      onClick={() => handleRemoveRow(row.rowKey)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-700 md:hidden"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  {/* Kolom 1: Siswa & Kelas */}
                  <div className="relative space-y-1.5 min-w-0">
                    <label
                      htmlFor={`col-student-${row.rowKey}`}
                      className="block text-[11px] font-medium text-slate-600 md:sr-only"
                    >
                      Siswa Baris {idx + 1}
                    </label>
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400"
                        aria-hidden="true"
                      />
                      <input
                        id={`col-student-${row.rowKey}`}
                        type="text"
                        autoComplete="off"
                        disabled={!canRecordNow || submitting}
                        value={row.studentName}
                        onFocus={() => {
                          setActiveStudentRowKey(row.rowKey);
                          setHighlightedStudentIdx(0);
                        }}
                        onBlur={() =>
                          window.setTimeout(
                            () =>
                              setActiveStudentRowKey((curr) =>
                                curr === row.rowKey ? null : curr
                              ),
                            170
                          )
                        }
                        onChange={(e) => {
                          updateRow(row.rowKey, {
                            studentName: e.target.value,
                            studentId: undefined,
                            saveToStudentDirectory: false,
                          });
                          setActiveStudentRowKey(row.rowKey);
                          setHighlightedStudentIdx(0);
                        }}
                        onKeyDown={(e) => {
                          if (!isDropdownOpen || activeRowMatches.length === 0) return;
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setHighlightedStudentIdx(
                              (prev) => (prev + 1) % activeRowMatches.length
                            );
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setHighlightedStudentIdx((prev) =>
                              prev <= 0 ? activeRowMatches.length - 1 : prev - 1
                            );
                          } else if (e.key === 'Enter') {
                            const picked =
                              activeRowMatches[highlightedStudentIdx] ?? activeRowMatches[0];
                            if (picked) {
                              e.preventDefault();
                              handleSelectRowStudent(row.rowKey, picked.student);
                            }
                          } else if (e.key === 'Escape') {
                            setActiveStudentRowKey(null);
                          }
                        }}
                        placeholder="Ketik nama siswa..."
                        className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-100"
                      />
                      {row.studentName && (
                        <button
                          type="button"
                          aria-label={`Kosongkan siswa baris ${idx + 1}`}
                          onClick={() => handleClearRowStudent(row.rowKey)}
                          className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}

                      {isDropdownOpen && canRecordNow && (
                        <div
                          role="listbox"
                          aria-label={`Saran siswa baris ${idx + 1}`}
                          className="absolute left-0 right-0 z-40 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
                        >
                          {!row.studentName.trim() ? (
                            <p className="px-3 py-2 text-[11px] text-slate-500">
                              Ketik beberapa huruf nama (mis. <strong>abdi</strong> atau{' '}
                              <strong>ahmad 12c</strong>)...
                            </p>
                          ) : activeRowMatches.length === 0 ? (
                            <p className="px-3 py-2 text-[11px] text-slate-500">
                              Tidak ditemukan di direktori. Isi kolom <strong>Kelas</strong> di bawah untuk input manual.
                            </p>
                          ) : (
                            activeRowMatches.map(({ student: stu }, mIdx) => {
                              const isHighlighted = mIdx === highlightedStudentIdx;
                              return (
                                <button
                                  key={stu.id}
                                  type="button"
                                  role="option"
                                  aria-selected={isHighlighted}
                                  onMouseEnter={() => setHighlightedStudentIdx(mIdx)}
                                  onMouseDown={(ev) => {
                                    ev.preventDefault();
                                    handleSelectRowStudent(row.rowKey, stu);
                                  }}
                                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors ${
                                    isHighlighted
                                      ? 'bg-blue-50 text-blue-950'
                                      : 'hover:bg-slate-50'
                                  }`}
                                >
                                  <span className="min-w-0 truncate font-medium text-slate-900">
                                    {stu.name}
                                  </span>
                                  <span className="font-mono-num shrink-0 font-bold text-slate-600">
                                    {stu.kelas}
                                    {stu.nis && stu.nis !== '-' ? ` · ${stu.nis}` : ''}
                                  </span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>

                    {isMatchedStudent && (
                      <div className="flex items-center justify-between gap-2 px-0.5 text-[11px] text-emerald-800">
                        <span className="truncate font-medium">
                          Kelas <strong className="font-mono-num">{row.kelas}</strong>
                          {row.nis ? ` · NIS ${row.nis}` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleClearRowStudent(row.rowKey)}
                          className="shrink-0 font-medium text-slate-500 underline hover:text-slate-800"
                        >
                          Ganti
                        </button>
                      </div>
                    )}

                    {showManualFields && (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          disabled={!canRecordNow || submitting}
                          value={row.kelas}
                          onChange={(e) => updateRow(row.rowKey, { kelas: e.target.value })}
                          placeholder="Kelas (mis. 10A)"
                          aria-label={`Kelas siswa baris ${idx + 1}`}
                          className="w-28 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                        />
                        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
                          <input
                            type="checkbox"
                            checked={Boolean(row.saveToStudentDirectory)}
                            onChange={(e) =>
                              updateRow(row.rowKey, {
                                saveToStudentDirectory: e.target.checked,
                              })
                            }
                            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                          />
                          <span>Simpan ke daftar siswa</span>
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Kolom 2: Jenis Pelanggaran (Terbaru & Sering Dipakai di Atas) */}
                  <div className="space-y-1.5 min-w-0">
                    <label
                      htmlFor={`col-rule-${row.rowKey}`}
                      className="block text-[11px] font-medium text-slate-600 md:sr-only"
                    >
                      Jenis Pelanggaran Baris {idx + 1}
                    </label>
                    <select
                      id={`col-rule-${row.rowKey}`}
                      disabled={!canRecordNow || submitting}
                      value={row.presetId}
                      onChange={(e) => handleSelectRowViolation(row.rowKey, e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-100"
                    >
                      {renderViolationSelectOptions()}
                    </select>

                    {row.presetId === 'CUSTOM' && (
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        <input
                          type="text"
                          disabled={!canRecordNow || submitting}
                          value={row.violationLabel}
                          onChange={(e) =>
                            updateRow(row.rowKey, { violationLabel: e.target.value })
                          }
                          placeholder="Tulis jenis pelanggaran..."
                          aria-label={`Keterangan pelanggaran manual baris ${idx + 1}`}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 sm:col-span-2"
                        />
                        <select
                          disabled={!canRecordNow || submitting}
                          value={row.category}
                          onChange={(e) =>
                            updateRow(row.rowKey, {
                              category: e.target.value as KategoriPelanggaran,
                            })
                          }
                          aria-label={`Kategori manual baris ${idx + 1}`}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-800"
                        >
                          {AKPS_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          disabled={!canRecordNow || submitting}
                          value={row.actionTaken}
                          onChange={(e) => updateRow(row.rowKey, { actionTaken: e.target.value })}
                          placeholder="Tindak lanjut..."
                          aria-label={`Tindak lanjut manual baris ${idx + 1}`}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-900"
                        />
                      </div>
                    )}
                  </div>

                  {/* Kolom 3: Poin & Catatan Opsional */}
                  <div className="flex items-start gap-1.5 min-w-0">
                    <div className="w-14 shrink-0">
                      <label
                        htmlFor={`col-points-${row.rowKey}`}
                        className="block text-[11px] font-medium text-slate-600 md:sr-only"
                      >
                        Poin Baris {idx + 1}
                      </label>
                      <input
                        id={`col-points-${row.rowKey}`}
                        type="number"
                        min={1}
                        max={100}
                        disabled={!canRecordNow || submitting}
                        value={row.points}
                        onChange={(e) => updateRow(row.rowKey, { points: Number(e.target.value) })}
                        title="Poin pelanggaran"
                        aria-label={`Poin baris ${idx + 1}`}
                        className="font-mono-num w-full rounded-lg border border-slate-200 bg-white px-1.5 py-2 text-center text-xs font-semibold text-slate-900 focus:border-blue-600 focus:outline-none disabled:bg-slate-100"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor={`col-notes-${row.rowKey}`}
                        className="block text-[11px] font-medium text-slate-600 md:sr-only"
                      >
                        Catatan Baris {idx + 1}
                      </label>
                      <input
                        id={`col-notes-${row.rowKey}`}
                        type="text"
                        disabled={!canRecordNow || submitting}
                        value={row.notes}
                        onChange={(e) => updateRow(row.rowKey, { notes: e.target.value })}
                        placeholder="Catatan..."
                        aria-label={`Catatan baris ${idx + 1}`}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none disabled:bg-slate-100"
                      />
                    </div>
                  </div>

                  {/* Kolom 4: Hapus Baris (Desktop) */}
                  <div className="hidden justify-end md:flex md:pt-0.5">
                    <button
                      type="button"
                      disabled={submitting}
                      aria-label={`Hapus baris ${idx + 1}`}
                      onClick={() => handleRemoveRow(row.rowKey)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Opsi Tambahan (Tetap Terlihat, Tidak Terlalu Menonjol & Tidak Tersembunyi): 1 Pelanggaran untuk Banyak Siswa */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/75 px-3.5 py-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-700">
              Opsi Tambahan: Pakai 1 Pelanggaran untuk Banyak Siswa
            </p>
            <p className="text-[11px] text-slate-500">
              Gunakan jika beberapa siswa melakukan pelanggaran yang sama sekaligus (mis. razia seragam/terlambat).
            </p>
          </div>
          <button
            type="button"
            disabled={!canRecordNow || submitting}
            aria-expanded={showSameRuleDrawer}
            onClick={() => setShowSameRuleDrawer((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Users className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            <span>{showSameRuleDrawer ? 'Tutup' : 'Pilih Massal'}</span>
            {showSameRuleDrawer ? (
              <ChevronUp className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            )}
          </button>
        </div>

        <AnimatePresence initial={false}>
          {showSameRuleDrawer && (
            <motion.div
              key="same-rule-drawer"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="mt-3 space-y-3 border-t border-slate-200/80 pt-3"
            >
              {/* A. Pilih 1 Jenis Pelanggaran */}
              <div className="space-y-2">
                <label
                  htmlFor="mass-rule-select"
                  className="block text-xs font-semibold text-slate-800"
                >
                  1. Pilih 1 Jenis Pelanggaran
                </label>
                {quickPickItems.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {quickPickItems.slice(0, 5).map(({ preset, todayCount }) => {
                      const active = massPresetId === preset.id;
                      const shortLabel =
                        preset.label.length > 30 ? `${preset.label.slice(0, 28)}…` : preset.label;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handlePickMassPreset(active ? '' : preset.id)}
                          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${
                            active
                              ? 'border-slate-800 bg-slate-800 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {active && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
                          <span>
                            {preset.code} · {shortLabel} (+{preset.points})
                          </span>
                          {todayCount > 0 && (
                            <span className="font-mono-num opacity-75">· {todayCount}×</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                <select
                  id="mass-rule-select"
                  value={massPresetId}
                  onChange={(e) => handlePickMassPreset(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  {renderViolationSelectOptions()}
                </select>

                {massPresetId === 'CUSTOM' && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                    <input
                      type="text"
                      value={massCustomLabel}
                      onChange={(e) => setMassCustomLabel(e.target.value)}
                      placeholder="Keterangan pelanggaran..."
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs sm:col-span-5"
                    />
                    <select
                      value={massCustomCategory}
                      onChange={(e) =>
                        setMassCustomCategory(e.target.value as KategoriPelanggaran)
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs sm:col-span-4"
                    >
                      {AKPS_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={massCustomPoints}
                      onChange={(e) => setMassCustomPoints(Number(e.target.value))}
                      aria-label="Poin pelanggaran massal"
                      className="font-mono-num rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs sm:col-span-3"
                    />
                  </div>
                )}
              </div>

              {/* B. Pilih Banyak Siswa */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800">
                    2. Pilih Siswa ({massStudents.length} dipilih)
                  </span>
                  <div
                    role="tablist"
                    aria-label="Metode pilih siswa untuk satu pelanggaran"
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-200/70 p-0.5"
                  >
                    {(
                      [
                        { id: 'search', label: 'Cari Nama' },
                        { id: 'class', label: 'Centang Kelas' },
                      ] as const
                    ).map((tab) => {
                      const active = massPickerTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setMassPickerTab(tab.id)}
                          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                            active
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {massPickerTab === 'search' ? (
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      ref={massSearchInputRef}
                      type="text"
                      autoComplete="off"
                      value={massSearchText}
                      onFocus={() => setShowMassSearchDropdown(true)}
                      onBlur={() =>
                        window.setTimeout(() => setShowMassSearchDropdown(false), 170)
                      }
                      onChange={(e) => {
                        setMassSearchText(e.target.value);
                        setMassHighlightIdx(0);
                        setShowMassSearchDropdown(true);
                      }}
                      onKeyDown={(e) => {
                        if (!showMassSearchDropdown || massSearchMatches.length === 0) return;
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setMassHighlightIdx((prev) => (prev + 1) % massSearchMatches.length);
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setMassHighlightIdx((prev) =>
                            prev <= 0 ? massSearchMatches.length - 1 : prev - 1
                          );
                        } else if (e.key === 'Enter') {
                          const picked =
                            massSearchMatches[massHighlightIdx] ?? massSearchMatches[0];
                          if (picked) {
                            e.preventDefault();
                            addMassStudentFromSearch(picked.student);
                          }
                        } else if (e.key === 'Escape') {
                          setShowMassSearchDropdown(false);
                        }
                      }}
                      placeholder="Ketik nama siswa lalu klik / Enter untuk menambah..."
                      className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                    />
                    {showMassSearchDropdown && (
                      <div
                        role="listbox"
                        className="absolute left-0 right-0 z-30 mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
                      >
                        {!massSearchText.trim() ? (
                          <p className="px-3 py-2 text-[11px] text-slate-500">
                            Ketik nama siswa untuk menambahkannya ke daftar pilihan massal.
                          </p>
                        ) : massSearchMatches.length === 0 ? (
                          <p className="px-3 py-2 text-[11px] text-slate-500">
                            Tidak ditemukan di direktori. Gunakan tabel baris di atas untuk siswa manual.
                          </p>
                        ) : (
                          massSearchMatches.map(({ student: stu }, idx) => {
                            const added = massStudentKeySet.has(makeStudentKey(stu));
                            return (
                              <button
                                key={stu.id}
                                type="button"
                                role="option"
                                aria-selected={idx === massHighlightIdx}
                                onMouseEnter={() => setMassHighlightIdx(idx)}
                                onMouseDown={(ev) => {
                                  ev.preventDefault();
                                  if (added) toggleMassStudent(stu);
                                  else addMassStudentFromSearch(stu);
                                }}
                                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs ${
                                  idx === massHighlightIdx ? 'bg-blue-50' : 'hover:bg-slate-50'
                                }`}
                              >
                                <span className="truncate font-medium text-slate-900">
                                  {stu.name}
                                </span>
                                <span className="inline-flex items-center gap-1.5 shrink-0">
                                  {added && (
                                    <CheckCircle2
                                      className="h-3.5 w-3.5 text-emerald-600"
                                      aria-hidden="true"
                                    />
                                  )}
                                  <span className="font-mono-num font-bold text-slate-600">
                                    {stu.kelas}
                                  </span>
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-2.5">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                      <select
                        value={effectiveClassFilter}
                        onChange={(e) => setSelectedClassFilter(e.target.value)}
                        aria-label="Filter kelas siswa"
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 sm:col-span-5"
                      >
                        {classList.map((cls) => (
                          <option key={cls} value={cls}>
                            Kelas {cls}
                          </option>
                        ))}
                        <option value="ALL">Semua Kelas ({appState.students.length})</option>
                      </select>
                      <input
                        type="text"
                        value={classSearchQuery}
                        onChange={(e) => setClassSearchQuery(e.target.value)}
                        placeholder="Saring nama di kelas..."
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:col-span-7"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-600">
                      <span>{studentsInSelectedClass.length} siswa ditampilkan</span>
                      {studentsInSelectedClass.length > 0 && (
                        <button
                          type="button"
                          onClick={
                            allVisibleMassClassSelected
                              ? handleDeselectVisibleMassClass
                              : handleSelectAllVisibleMassClass
                          }
                          className="font-semibold text-blue-700 underline"
                        >
                          {allVisibleMassClassSelected
                            ? 'Batal pilih semua'
                            : `Pilih semua (${studentsInSelectedClass.length})`}
                        </button>
                      )}
                    </div>
                    <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-100">
                      {studentsInSelectedClass.map((stu) => {
                        const checked = massStudentKeySet.has(makeStudentKey(stu));
                        return (
                          <label
                            key={stu.id}
                            className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-xs ${
                              checked ? 'bg-blue-50/70 text-blue-950' : 'hover:bg-slate-50'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleMassStudent(stu)}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600"
                              />
                              <span className="truncate font-medium text-slate-900">
                                {stu.name}
                              </span>
                            </span>
                            <span className="font-mono-num shrink-0 font-semibold text-slate-600">
                              {stu.kelas}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {massStudents.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200 bg-white p-2">
                    {massStudents.map((stu) => (
                      <span
                        key={stu.key}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-800"
                      >
                        <span className="font-medium">{stu.name}</span>
                        <span className="font-mono-num text-slate-500">({stu.kelas})</span>
                        <button
                          type="button"
                          aria-label={`Keluarkan ${stu.name}`}
                          onClick={() =>
                            setMassStudents((prev) => prev.filter((item) => item.key !== stu.key))
                          }
                          className="text-slate-400 hover:text-red-700"
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <input
                  type="text"
                  value={massNotes}
                  onChange={(e) => setMassNotes(e.target.value)}
                  placeholder="Catatan bersama (opsional, mis. Razia gerbang pagi)..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400"
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={!selectedMassRuleItem || massStudents.length === 0 || submitting}
                  onClick={handleApplySameRuleToRows}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
                >
                  <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Masukkan ke Tabel Baris ({massStudents.length})</span>
                </button>
                <button
                  type="button"
                  disabled={
                    !canRecordNow ||
                    connectionOffline ||
                    submitting ||
                    !selectedMassRuleItem ||
                    massStudents.length === 0
                  }
                  onClick={handleSaveSameRuleDirectly}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50 whitespace-nowrap"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Simpan Langsung ({massStudents.length})</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Ringkasan & Tombol Simpan Utama Tabel Per Kolom */}
      <div className="space-y-2.5 pt-1">
        {builtColumnResult.startedRowCount > 0 && (
          <div
            className={`rounded-xl border px-3.5 py-2 text-xs ${
              builtColumnResult.error
                ? 'border-amber-200 bg-amber-50/75 text-amber-900'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}
          >
            {builtColumnResult.error
              ? builtColumnResult.error
              : `Siap menyimpan ${builtColumnResult.entries.length} catatan siswa dari tabel baris ke spreadsheet hari ini.`}
          </div>
        )}

        {connectionOffline && canRecordNow && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-900"
          >
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
            <span>
              <strong>Koneksi sedang terputus.</strong> Jangan tekan simpan dulu agar data tidak gagal terkirim. Data di tabel baris tetap aman di layar.
            </span>
          </div>
        )}

        <motion.button
          type="submit"
          whileHover={{ scale: 1.008 }}
          whileTap={{ scale: 0.988 }}
          disabled={
            !canRecordNow ||
            submitting ||
            connectionOffline ||
            Boolean(builtColumnResult.error) ||
            builtColumnResult.entries.length === 0
          }
          className="btn-3d-primary inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {connectionOffline ? (
            <WifiOff className="h-4 w-4" aria-hidden="true" />
          ) : !canRecordNow ? (
            <Lock className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          <span>
            {connectionOffline
              ? 'Koneksi Terputus — Menunggu Tersambung...'
              : submitting
                ? 'Menyimpan Catatan Baris...'
                : !canRecordNow
                  ? lockedNoticeText
                  : builtColumnResult.entries.length > 0
                    ? `Simpan Semua (${builtColumnResult.entries.length} Catatan)`
                    : 'Isi Nama Siswa & Pelanggaran untuk Menyimpan'}
          </span>
        </motion.button>
      </div>
    </form>
  );
}
