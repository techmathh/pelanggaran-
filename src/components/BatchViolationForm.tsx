import { useMemo, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Lock,
  Pencil,
  Plus,
  Search,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import { AKPS_CATEGORIES, searchSimilarStudents } from '../shared/piketLogic';
import {
  MAX_BATCH_VIOLATION_ROWS,
  buildBatchColumnEntries,
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
} from '../shared/types';

interface BatchViolationFormProps {
  appState: PublicAppState;
  quickPickItems?: QuickPickPresetItem[];
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
  recentPresetIds = [],
  canRecordNow,
  connectionOffline,
  lockedNoticeText,
  onRecordPresetUsed,
  onSuccessSubmit,
  onNotify,
}: BatchViolationFormProps) {
  // Primary Mode: Simple Per-Column Rows (Siswa | Pelanggaran)
  const [rows, setRows] = useState<BatchColumnRow[]>(() => [
    createEmptyBatchColumnRow('init-1'),
    createEmptyBatchColumnRow('init-2'),
    createEmptyBatchColumnRow('init-3'),
  ]);
  const [activeStudentRowKey, setActiveStudentRowKey] = useState<string | null>(null);
  const [highlightedStudentIdx, setHighlightedStudentIdx] = useState(0);
  const [expandedDetailRows, setExpandedDetailRows] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  // Subtle Optional Feature: "1 Pelanggaran untuk Banyak Siswa"
  const [showSameRuleDrawer, setShowSameRuleDrawer] = useState(false);
  const [massPresetId, setMassPresetId] = useState('');
  const [massCustomLabel, setMassCustomLabel] = useState('');
  const [massCustomCategory, setMassCustomCategory] = useState<KategoriPelanggaran>(
    'A. Kedisiplinan & Kehadiran'
  );
  const [massCustomPoints, setMassCustomPoints] = useState(5);
  const [massStudents, setMassStudents] = useState<BatchStudentItem[]>([]);
  const [massClassMode, setMassClassMode] = useState(false);
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
  const [rowClassFilter, setRowClassFilter] = useState<string>('');

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

  const activeRowMatches = useMemo(() => {
    if (!activeStudentRowKey) return [];
    const targetRow = rows.find((r) => r.rowKey === activeStudentRowKey);
    if (!targetRow) return [];
    return searchSimilarStudents(appState.students, targetRow.studentName, 10, rowClassFilter);
  }, [activeStudentRowKey, rows, appState.students, rowClassFilter]);

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

  const effectiveClassFilter = useMemo(() => {
    if (selectedClassFilter === 'ALL' || classList.includes(selectedClassFilter)) {
      return selectedClassFilter;
    }
    return classList[0] ?? 'ALL';
  }, [selectedClassFilter, classList]);

  const studentsInSelectedClass = useMemo(
    () => filterStudentsByClassAndQuery(appState.students, effectiveClassFilter, ''),
    [appState.students, effectiveClassFilter]
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
        actionTaken: 'Teguran Lisan & Catat',
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
  }, [massPresetId, massCustomLabel, massCustomCategory, massCustomPoints, presetByIdMap]);

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

  function handleAddEmptyRow() {
    setRows((prev) => {
      if (prev.length >= MAX_BATCH_VIOLATION_ROWS) {
        onNotify(`Maksimal ${MAX_BATCH_VIOLATION_ROWS} baris dalam satu tabel.`, 'info');
        return prev;
      }
      return [
        ...prev,
        createEmptyBatchColumnRow(`${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
      ];
    });
  }

  function handleRemoveRow(rowKey: string) {
    setRows((prev) => {
      if (prev.length <= 1) {
        return [createEmptyBatchColumnRow(`${Date.now()}-reset`)];
      }
      return prev.filter((r) => r.rowKey !== rowKey);
    });
    setExpandedDetailRows((prev) => {
      if (!prev[rowKey]) return prev;
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
  }

  function handleResetAllRows() {
    setRows([
      createEmptyBatchColumnRow(`${Date.now()}-1`),
      createEmptyBatchColumnRow(`${Date.now()}-2`),
      createEmptyBatchColumnRow(`${Date.now()}-3`),
    ]);
    setExpandedDetailRows({});
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

  function handleToggleSelectAllMassClass() {
    const visibleKeys = new Set(studentsInSelectedClass.map((s) => makeStudentKey(s)));
    const allPicked =
      studentsInSelectedClass.length > 0 &&
      studentsInSelectedClass.every((s) => massStudentKeySet.has(makeStudentKey(s)));

    if (allPicked) {
      setMassStudents((prev) => prev.filter((s) => !visibleKeys.has(s.key)));
      return;
    }

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

  function handleApplySameRuleToRows() {
    if (!selectedMassRuleItem) {
      onNotify('Pilih pelanggaran terlebih dahulu.', 'error');
      return;
    }
    if (massStudents.length === 0) {
      onNotify('Pilih minimal 1 siswa.', 'error');
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
      notes: '',
    }));

    setRows((prev) => {
      const filled = prev.filter(
        (r) =>
          Boolean(r.studentName.trim()) ||
          Boolean(r.kelas.trim()) ||
          Boolean(r.presetId) ||
          Boolean(r.violationLabel.trim()) ||
          Boolean(r.notes.trim())
      );
      return [...filled, ...newRows].slice(0, MAX_BATCH_VIOLATION_ROWS);
    });

    if (selectedMassRuleItem.presetId) {
      onRecordPresetUsed(selectedMassRuleItem.presetId);
    }

    onNotify(`${newRows.length} siswa dimasukkan ke daftar baris.`, 'success');
    setMassStudents([]);
    setShowSameRuleDrawer(false);
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
        onNotify(data.error || 'Gagal menyimpan catatan.', 'error');
        return;
      }

      handleResetAllRows();
      onSuccessSubmit(
        data.state,
        Number(data.createdCount ?? built.entries.length),
        Array.isArray(data.createdIds) ? data.createdIds : []
      );
    } catch {
      onNotify('Tidak dapat terhubung ke server.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function renderViolationSelectOptions() {
    const topIds = new Set(
      orderedViolationOptions.topFrequentAndRecent.map((opt) => opt.preset.id)
    );
    const remainingCategories = orderedViolationOptions.byCategory
      .map((group) => ({
        category: group.category,
        items: group.items.filter((opt) => !topIds.has(opt.preset.id)),
      }))
      .filter((group) => group.items.length > 0);

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
        {remainingCategories.map((group) => (
          <optgroup key={group.category} label={group.category}>
            {group.items.map((opt) => (
              <option key={opt.preset.id} value={opt.preset.id}>
                [{opt.preset.code}] {opt.preset.label} (+{opt.preset.points}p
                {opt.totalCount > 0 ? ` · ${opt.totalCount}×` : ''})
              </option>
            ))}
          </optgroup>
        ))}
        <option value="CUSTOM">Lainnya (Isi Manual)</option>
      </>
    );
  }

  const allVisibleMassClassSelected =
    studentsInSelectedClass.length > 0 &&
    studentsInSelectedClass.every((s) => massStudentKeySet.has(makeStudentKey(s)));

  return (
    <form onSubmit={handleSubmitColumnTable} className="mt-4 space-y-3.5">
      {/* Clean Single Per-Column Table Surface */}
      <div className="rounded-xl border border-slate-200 bg-white">
        {/* Top Filter Strip: Cari Nama dari Kelas */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/75 px-3 py-2">
          <span className="text-[11px] font-medium text-slate-500">
            Ketik nama atau pilih kelas untuk menyaring daftar nama siswa
          </span>
          <div className="flex items-center gap-2">
            <label
              htmlFor="batch-row-class-filter"
              className="text-[11px] font-medium text-slate-600 whitespace-nowrap"
            >
              Cari dari kelas:
            </label>
            <select
              id="batch-row-class-filter"
              disabled={!canRecordNow || submitting}
              value={rowClassFilter}
              onChange={(e) => setRowClassFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-800 focus:border-blue-600 focus:outline-none"
            >
              <option value="">Semua Kelas</option>
              {classList.map((cls) => (
                <option key={cls} value={cls}>
                  Kelas {cls}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Desktop Column Header */}
        <div className="hidden border-b border-slate-100 bg-slate-50/40 px-3 py-1.5 text-[11px] font-semibold text-slate-500 md:grid md:grid-cols-[24px_minmax(0,1fr)_minmax(0,1.2fr)_64px] md:items-center md:gap-2.5">
          <span className="text-center">#</span>
          <span>Nama Siswa</span>
          <span>Pelanggaran</span>
          <span className="text-right">Aksi</span>
        </div>

        <div className="divide-y divide-slate-100">
          <AnimatePresence initial={false}>
            {rows.map((row, idx) => {
              const isMatchedStudent = Boolean(row.studentId);
              const showManualClass = !isMatchedStudent && Boolean(row.studentName.trim());
              const isDropdownOpen = activeStudentRowKey === row.rowKey;
              const isDetailOpen = Boolean(expandedDetailRows[row.rowKey]);

              return (
                <motion.div
                  key={row.rowKey}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.15 }}
                  className="p-2.5 sm:px-3 sm:py-2.5"
                >
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[24px_minmax(0,1fr)_minmax(0,1.2fr)_64px] md:items-center md:gap-2.5">
                    {/* Row Index */}
                    <div className="flex items-center justify-between md:justify-center">
                      <span className="font-mono-num text-xs font-semibold text-slate-400">
                        <span className="md:hidden">Baris </span>
                        {idx + 1}
                      </span>
                      <div className="flex items-center gap-1 md:hidden">
                        <button
                          type="button"
                          disabled={!canRecordNow || submitting}
                          aria-label={`Ubah poin atau catatan baris ${idx + 1}`}
                          onClick={() =>
                            setExpandedDetailRows((prev) => ({
                              ...prev,
                              [row.rowKey]: !prev[row.rowKey],
                            }))
                          }
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                            isDetailOpen || row.notes.trim()
                              ? 'bg-blue-50 text-blue-700'
                              : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                          }`}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          disabled={submitting}
                          aria-label={`Hapus baris ${idx + 1}`}
                          onClick={() => handleRemoveRow(row.rowKey)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-700"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {/* Kolom 1: Nama Siswa */}
                    <div className="relative min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className="relative min-w-0 flex-1">
                          <Search
                            className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400"
                            aria-hidden="true"
                          />
                          <input
                            id={`col-student-${row.rowKey}`}
                            type="text"
                            autoComplete="off"
                            aria-label={`Nama siswa baris ${idx + 1}`}
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
                              const nextName = e.target.value;
                              updateRow(row.rowKey, {
                                studentName: nextName,
                                studentId: undefined,
                                kelas:
                                  nextName.trim() && !row.kelas && rowClassFilter
                                    ? rowClassFilter
                                    : row.kelas,
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
                            placeholder={
                              rowClassFilter
                                ? `Cari nama kelas ${rowClassFilter}...`
                                : 'Cari nama atau kelas (mis. 10A)...'
                            }
                            className={`w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50 ${
                              isMatchedStudent ? 'pr-20' : row.studentName ? 'pr-7' : 'pr-2.5'
                            }`}
                          />

                          {isMatchedStudent && (
                            <span className="font-mono-num pointer-events-none absolute right-7 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-emerald-700">
                              {row.kelas}
                            </span>
                          )}

                          {row.studentName && (
                            <button
                              type="button"
                              aria-label={`Kosongkan siswa baris ${idx + 1}`}
                              onClick={() => handleClearRowStudent(row.rowKey)}
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                          )}
                        </div>

                        {showManualClass && (
                          <input
                            type="text"
                            disabled={!canRecordNow || submitting}
                            value={row.kelas}
                            onChange={(e) => updateRow(row.rowKey, { kelas: e.target.value })}
                            placeholder="Kelas"
                            aria-label={`Kelas siswa baris ${idx + 1}`}
                            className="w-20 shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                          />
                        )}
                      </div>

                      {isDropdownOpen && canRecordNow && (
                        <div
                          role="listbox"
                          aria-label={`Saran siswa baris ${idx + 1}`}
                          className="absolute left-0 right-0 z-40 mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
                        >
                          {!row.studentName.trim() && !rowClassFilter ? (
                            <p className="px-3 py-2 text-[11px] text-slate-500">
                              Ketik nama atau kelas (mis. <strong>10a</strong>), atau pilih kelas di atas.
                            </p>
                          ) : activeRowMatches.length === 0 ? (
                            <p className="px-3 py-2 text-[11px] text-slate-500">
                              Tidak ada di daftar. Isi kolom <strong>Kelas</strong> di sampingnya.
                            </p>
                          ) : (
                            activeRowMatches.map(({ student: stu }, mIdx) => (
                              <button
                                key={stu.id}
                                type="button"
                                role="option"
                                aria-selected={mIdx === highlightedStudentIdx}
                                onMouseEnter={() => setHighlightedStudentIdx(mIdx)}
                                onMouseDown={(ev) => {
                                  ev.preventDefault();
                                  handleSelectRowStudent(row.rowKey, stu);
                                }}
                                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors ${
                                  mIdx === highlightedStudentIdx
                                    ? 'bg-blue-50 text-blue-950'
                                    : 'hover:bg-slate-50'
                                }`}
                              >
                                <span className="min-w-0 truncate font-medium text-slate-900">
                                  {stu.name}
                                </span>
                                <span className="font-mono-num shrink-0 font-bold text-slate-600">
                                  {stu.kelas}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    {/* Kolom 2: Pelanggaran (Terbaru & Sering Dipakai di Atas) */}
                    <div className="min-w-0">
                      <select
                        id={`col-rule-${row.rowKey}`}
                        aria-label={`Jenis pelanggaran baris ${idx + 1}`}
                        disabled={!canRecordNow || submitting}
                        value={row.presetId}
                        onChange={(e) => handleSelectRowViolation(row.rowKey, e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50"
                      >
                        {renderViolationSelectOptions()}
                      </select>
                    </div>

                    {/* Kolom 3: Aksi Minimal (Edit Catatan/Poin Opsional + Hapus) */}
                    <div className="hidden items-center justify-end gap-1 md:flex">
                      <button
                        type="button"
                        disabled={!canRecordNow || submitting}
                        title="Tambah catatan atau ubah poin"
                        aria-label={`Ubah poin atau catatan baris ${idx + 1}`}
                        onClick={() =>
                          setExpandedDetailRows((prev) => ({
                            ...prev,
                            [row.rowKey]: !prev[row.rowKey],
                          }))
                        }
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                          isDetailOpen || row.notes.trim()
                            ? 'bg-blue-50 text-blue-700'
                            : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                        }`}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        aria-label={`Hapus baris ${idx + 1}`}
                        onClick={() => handleRemoveRow(row.rowKey)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-700"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {/* Field Tambahan (Hanya Muncul Jika Pilih Manual atau Klik Edit Catatan) */}
                  {(row.presetId === 'CUSTOM' || isDetailOpen) && (
                    <div className="mt-2 grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-12 md:ml-8">
                      {row.presetId === 'CUSTOM' && (
                        <>
                          <input
                            type="text"
                            disabled={!canRecordNow || submitting}
                            value={row.violationLabel}
                            onChange={(e) =>
                              updateRow(row.rowKey, { violationLabel: e.target.value })
                            }
                            placeholder="Tulis pelanggaran manual..."
                            aria-label={`Keterangan pelanggaran manual baris ${idx + 1}`}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 sm:col-span-6"
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
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 sm:col-span-6"
                          >
                            {AKPS_CATEGORIES.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                      <div className="sm:col-span-3">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          disabled={!canRecordNow || submitting}
                          value={row.points}
                          onChange={(e) => updateRow(row.rowKey, { points: Number(e.target.value) })}
                          aria-label={`Poin baris ${idx + 1}`}
                          placeholder="Poin"
                          className="font-mono-num w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900"
                        />
                      </div>
                      <div className="sm:col-span-9">
                        <input
                          type="text"
                          disabled={!canRecordNow || submitting}
                          value={row.notes}
                          onChange={(e) => updateRow(row.rowKey, { notes: e.target.value })}
                          placeholder="Catatan singkat (opsional)..."
                          aria-label={`Catatan baris ${idx + 1}`}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400"
                        />
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Footer Tabel: Tambah Baris & Bersihkan */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-3 py-2">
          <button
            type="button"
            disabled={!canRecordNow || submitting || rows.length >= MAX_BATCH_VIOLATION_ROWS}
            onClick={handleAddEmptyRow}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Tambah Baris</span>
          </button>

          {hasAnyTypedData && (
            <button
              type="button"
              disabled={submitting}
              onClick={handleResetAllRows}
              className="text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              Bersihkan
            </button>
          )}
        </div>
      </div>

      {/* Opsi Ringan & Tetap Terlihat: 1 Pelanggaran untuk Banyak Siswa */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-600">
            1 pelanggaran sama untuk banyak siswa sekaligus?
          </span>
          <button
            type="button"
            disabled={!canRecordNow || submitting}
            aria-expanded={showSameRuleDrawer}
            onClick={() => setShowSameRuleDrawer((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Users className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            <span>{showSameRuleDrawer ? 'Tutup' : 'Pilih Sekaligus'}</span>
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
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16 }}
              className="mt-2.5 space-y-2.5 border-t border-slate-200/80 pt-2.5"
            >
              <select
                id="mass-rule-select"
                aria-label="Pilih 1 pelanggaran untuk banyak siswa"
                value={massPresetId}
                onChange={(e) => handlePickMassPreset(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                {renderViolationSelectOptions()}
              </select>

              {massPresetId === 'CUSTOM' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                  <input
                    type="text"
                    value={massCustomLabel}
                    onChange={(e) => setMassCustomLabel(e.target.value)}
                    placeholder="Tulis pelanggaran manual..."
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:col-span-6"
                  />
                  <select
                    value={massCustomCategory}
                    onChange={(e) =>
                      setMassCustomCategory(e.target.value as KategoriPelanggaran)
                    }
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs sm:col-span-4"
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
                    className="font-mono-num rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs sm:col-span-2"
                  />
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-slate-700">
                    Pilih Siswa ({massStudents.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setMassClassMode((prev) => !prev)}
                    className="text-[11px] font-semibold text-blue-700 hover:underline"
                  >
                    {massClassMode ? 'Kembali ke cari nama' : 'Atau centang per kelas'}
                  </button>
                </div>

                {!massClassMode ? (
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
                      placeholder="Ketik nama atau kelas (mis. 10a) lalu klik untuk menambah..."
                      className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                    />
                    {showMassSearchDropdown && massSearchText.trim() && (
                      <div
                        role="listbox"
                        className="absolute left-0 right-0 z-30 mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
                      >
                        {massSearchMatches.length === 0 ? (
                          <p className="px-3 py-2 text-[11px] text-slate-500">
                            Siswa tidak ditemukan.
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
                  <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-2">
                    <div className="flex items-center justify-between gap-2">
                      <select
                        value={effectiveClassFilter}
                        onChange={(e) => setSelectedClassFilter(e.target.value)}
                        aria-label="Pilih kelas siswa"
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900"
                      >
                        {classList.map((cls) => (
                          <option key={cls} value={cls}>
                            Kelas {cls}
                          </option>
                        ))}
                        <option value="ALL">Semua Kelas</option>
                      </select>
                      {studentsInSelectedClass.length > 0 && (
                        <button
                          type="button"
                          onClick={handleToggleSelectAllMassClass}
                          className="text-[11px] font-semibold text-blue-700 hover:underline"
                        >
                          {allVisibleMassClassSelected ? 'Batal semua' : 'Centang semua'}
                        </button>
                      )}
                    </div>
                    <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-100">
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
                  <div className="flex flex-wrap gap-1.5">
                    {massStudents.map((stu) => (
                      <span
                        key={stu.key}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-800"
                      >
                        <span>{stu.name}</span>
                        <span className="font-mono-num text-slate-500">{stu.kelas}</span>
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
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={!selectedMassRuleItem || massStudents.length === 0 || submitting}
                  onClick={handleApplySameRuleToRows}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Masukkan ke Tabel ({massStudents.length} Siswa)</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Validasi Baris & Tombol Simpan Tunggal */}
      {builtColumnResult.startedRowCount > 0 && builtColumnResult.error && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/75 px-3 py-2 text-xs text-amber-900">
          {builtColumnResult.error}
        </p>
      )}

      {connectionOffline && canRecordNow && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900"
        >
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
          <span>Koneksi terputus. Data di tabel tetap aman di layar.</span>
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
            ? 'Koneksi Terputus...'
            : submitting
              ? 'Menyimpan...'
              : !canRecordNow
                ? lockedNoticeText
                : builtColumnResult.entries.length > 0
                  ? `Simpan Semua (${builtColumnResult.entries.length} Siswa)`
                  : 'Isi Nama Siswa & Pelanggaran'}
        </span>
      </motion.button>
    </form>
  );
}
