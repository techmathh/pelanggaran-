import { useMemo, useRef, useState, type FormEvent } from 'react';
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
import {
  AKPS_CATEGORIES,
  searchSimilarStudents,
} from '../shared/piketLogic';
import {
  MAX_BATCH_VIOLATION_ROWS,
  buildBatchViolationInputs,
  filterStudentsByClassAndQuery,
  getSortedStudentClasses,
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
  canRecordNow,
  connectionOffline,
  lockedNoticeText,
  onRecordPresetUsed,
  onSuccessSubmit,
  onNotify,
}: BatchViolationFormProps) {
  const [selectedRules, setSelectedRules] = useState<BatchRuleItem[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<BatchStudentItem[]>([]);
  const [sharedNotes, setSharedNotes] = useState('');
  const [keepRulesAfterSave, setKeepRulesAfterSave] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Rule picker helpers
  const [showFullRulePicker, setShowFullRulePicker] = useState(false);
  const [pickerCategory, setPickerCategory] = useState<KategoriPelanggaran | 'CUSTOM' | ''>('');
  const [pickerPresetId, setPickerPresetId] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [customCategory, setCustomCategory] = useState<KategoriPelanggaran>('A. Kedisiplinan & Kehadiran');
  const [customPoints, setCustomPoints] = useState(5);
  const [customAction, setCustomAction] = useState('');

  // Student picker mode: search vs class checklist
  const [studentPickerTab, setStudentPickerTab] = useState<'search' | 'class'>('search');
  const [searchText, setSearchText] = useState('');
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Manual student inline fallback
  const [showManualStudentBox, setShowManualStudentBox] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualKelas, setManualKelas] = useState('');
  const [manualNis, setManualNis] = useState('');
  const [manualSaveDir, setManualSaveDir] = useState(false);

  // Class checklist filter
  const classList = useMemo(
    () => getSortedStudentClasses(appState.students),
    [appState.students]
  );
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>(() => classList[0] ?? 'ALL');
  const [classSearchQuery, setClassSearchQuery] = useState('');

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

  const searchMatches = useMemo(
    () => searchSimilarStudents(appState.students, searchText, 10),
    [appState.students, searchText]
  );

  const selectedStudentKeySet = useMemo(
    () => new Set(selectedStudents.map((s) => s.key)),
    [selectedStudents]
  );

  const selectedRulePresetIdSet = useMemo(
    () => new Set(selectedRules.map((r) => r.presetId).filter((id): id is string => Boolean(id))),
    [selectedRules]
  );

  const presetsForPickerCategory = useMemo(() => {
    if (!pickerCategory || pickerCategory === 'CUSTOM') return [];
    return appState.presets.filter((p) => p.category === pickerCategory);
  }, [appState.presets, pickerCategory]);

  const totalPointsPerStudent = useMemo(
    () => selectedRules.reduce((acc, r) => acc + Math.max(0, Math.round(r.points)), 0),
    [selectedRules]
  );

  const totalPlannedRows = selectedStudents.length * selectedRules.length;

  function makeStudentKey(stu: Pick<StudentRecord, 'id' | 'name' | 'kelas'>): string {
    if (stu.id) return `id:${stu.id}`;
    return `manual:${stu.name.trim().toLowerCase()}::${stu.kelas.trim().toUpperCase()}`;
  }

  function toggleQuickPreset(preset: ViolationPreset) {
    const existing = selectedRules.find((r) => r.presetId === preset.id);
    if (existing) {
      setSelectedRules((prev) => prev.filter((r) => r.key !== existing.key));
      return;
    }
    onRecordPresetUsed(preset.id);
    setSelectedRules((prev) => [
      ...prev,
      {
        key: `preset:${preset.id}`,
        presetId: preset.id,
        violationCode: preset.code,
        violationLabel: preset.label,
        category: preset.category,
        points: preset.points,
        actionTaken: preset.defaultAction,
      },
    ]);
  }

  function handleSelectPresetFromDropdown(presetId: string) {
    setPickerPresetId(presetId);
    if (!presetId) return;
    const preset = appState.presets.find((p) => p.id === presetId);
    if (!preset) return;
    onRecordPresetUsed(preset.id);
    setSelectedRules((prev) => {
      if (prev.some((r) => r.presetId === preset.id)) return prev;
      return [
        ...prev,
        {
          key: `preset:${preset.id}`,
          presetId: preset.id,
          violationCode: preset.code,
          violationLabel: preset.label,
          category: preset.category,
          points: preset.points,
          actionTaken: preset.defaultAction,
        },
      ];
    });
    setPickerPresetId('');
  }

  function handleAddCustomRule() {
    const label = customLabel.trim();
    if (!label) {
      onNotify('Isi keterangan pelanggaran manual terlebih dahulu.', 'error');
      return;
    }
    const pts = Math.max(1, Math.min(100, Math.round(Number(customPoints || 5))));
    const key = `custom:${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setSelectedRules((prev) => [
      ...prev,
      {
        key,
        violationCode: 'CUSTOM',
        violationLabel: label,
        category: customCategory,
        points: pts,
        actionTaken: customAction.trim() || 'Teguran Lisan & Catat',
      },
    ]);
    setCustomLabel('');
    setCustomAction('');
    setCustomPoints(5);
  }

  function toggleDirectoryStudent(stu: StudentRecord) {
    const key = makeStudentKey(stu);
    setSelectedStudents((prev) => {
      if (prev.some((item) => item.key === key)) {
        return prev.filter((item) => item.key !== key);
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

  function addDirectoryStudentFromSearch(stu: StudentRecord) {
    const key = makeStudentKey(stu);
    setSelectedStudents((prev) => {
      if (prev.some((item) => item.key === key)) return prev;
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
    setSearchText('');
    setHighlightedIndex(0);
    setShowSearchDropdown(false);
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }

  function handleSelectAllVisibleClassStudents() {
    setSelectedStudents((prev) => {
      const existingKeys = new Set(prev.map((s) => s.key));
      const additions: BatchStudentItem[] = [];
      for (const stu of studentsInSelectedClass) {
        const key = makeStudentKey(stu);
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
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

  function handleDeselectVisibleClassStudents() {
    const visibleKeys = new Set(studentsInSelectedClass.map((s) => makeStudentKey(s)));
    setSelectedStudents((prev) => prev.filter((s) => !visibleKeys.has(s.key)));
  }

  function handleAddManualStudent() {
    const cleanName = manualName.trim();
    const cleanKelas = manualKelas.trim().toUpperCase();
    if (!cleanName || !cleanKelas) {
      onNotify('Nama dan kelas siswa manual wajib diisi.', 'error');
      return;
    }
    const key = `manual:${cleanName.toLowerCase()}::${cleanKelas}`;
    setSelectedStudents((prev) => {
      if (prev.some((s) => s.key === key)) return prev;
      return [
        ...prev,
        {
          key,
          name: cleanName,
          kelas: cleanKelas,
          nis: manualNis.trim(),
          saveToStudentDirectory: manualSaveDir,
        },
      ];
    });
    setManualName('');
    setManualKelas('');
    setManualNis('');
    setManualSaveDir(false);
    setShowManualStudentBox(false);
  }

  const allVisibleClassSelected =
    studentsInSelectedClass.length > 0 &&
    studentsInSelectedClass.every((s) => selectedStudentKeySet.has(makeStudentKey(s)));

  async function handleSubmitBatch(e: FormEvent) {
    e.preventDefault();
    if (!canRecordNow || connectionOffline || submitting) return;

    const built = buildBatchViolationInputs(selectedStudents, selectedRules, sharedNotes);
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

      setSelectedStudents([]);
      setSharedNotes('');
      if (!keepRulesAfterSave) {
        setSelectedRules([]);
      }
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

  return (
    <form onSubmit={handleSubmitBatch} className="mt-5 space-y-5">
      {/* Langkah 1: Pilih Pelanggaran */}
      <div className="space-y-3 border-b border-slate-100 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-slate-900">
              Langkah 1 · Pilih Jenis Pelanggaran
            </p>
            <p className="text-xs text-slate-500">
              Klik tombol di bawah (bisa pilih lebih dari 1 pelanggaran jika melanggar beberapa aturan sekaligus).
            </p>
          </div>
          {selectedRules.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedRules([])}
              className="text-xs font-medium text-slate-500 underline hover:text-slate-800 whitespace-nowrap shrink-0"
            >
              Reset pelanggaran
            </button>
          )}
        </div>

        {/* Quick-Pick Buttons with Recent & Today Count */}
        <div>
          <p className="text-xs font-medium text-slate-600">
            Pilihan Cepat (Terakhir &amp; Sering Dipakai Hari Ini):
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {quickPickItems.map(({ preset, todayCount }) => {
              const isPicked = selectedRulePresetIdSet.has(preset.id);
              const shortLabel =
                preset.label.length > 34 ? `${preset.label.slice(0, 32)}…` : preset.label;
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={!canRecordNow || submitting}
                  onClick={() => toggleQuickPreset(preset)}
                  className={`card-3d-interactive inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap disabled:opacity-50 ${
                    isPicked
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {isPicked && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                  <span>
                    {preset.code} · {shortLabel} (+{preset.points})
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
                </button>
              );
            })}
          </div>
        </div>

        {/* Toggle Full AKPS Category A-F or Custom */}
        <div>
          <button
            type="button"
            disabled={!canRecordNow || submitting}
            onClick={() => setShowFullRulePicker((prev) => !prev)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-800 disabled:opacity-50"
          >
            {showFullRulePicker ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>
              {showFullRulePicker
                ? 'Tutup daftar kategori A–F'
                : 'Atau cari aturan lain dari Kategori A–F / isi manual'}
            </span>
          </button>

          {showFullRulePicker && (
            <div className="mt-2.5 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 sm:grid-cols-12">
              <div className="sm:col-span-5">
                <label
                  htmlFor="batch-category-select"
                  className="block text-xs font-medium text-slate-700"
                >
                  Kategori AKPS
                </label>
                <select
                  id="batch-category-select"
                  disabled={!canRecordNow || submitting}
                  value={pickerCategory}
                  onChange={(e) => {
                    setPickerCategory(e.target.value as KategoriPelanggaran | 'CUSTOM' | '');
                    setPickerPresetId('');
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                >
                  <option value="">-- Pilih Kategori (A–F) --</option>
                  {AKPS_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                  <option value="CUSTOM">Pelanggaran Lainnya (Isi Manual)</option>
                </select>
              </div>

              {pickerCategory && pickerCategory !== 'CUSTOM' && (
                <div className="sm:col-span-7">
                  <label
                    htmlFor="batch-preset-select"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Pilih Aturan (langsung ditambahkan saat dipilih)
                  </label>
                  <select
                    id="batch-preset-select"
                    disabled={!canRecordNow || submitting}
                    value={pickerPresetId}
                    onChange={(e) => handleSelectPresetFromDropdown(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                  >
                    <option value="">-- Klik aturan untuk menambahkan --</option>
                    {presetsForPickerCategory.map((p) => {
                      const already = selectedRulePresetIdSet.has(p.id);
                      return (
                        <option key={p.id} value={p.id}>
                          {already ? '✓ ' : ''}[{p.code}] {p.label} (+{p.points} poin)
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {pickerCategory === 'CUSTOM' && (
                <div className="grid grid-cols-1 gap-2.5 sm:col-span-12 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <input
                      type="text"
                      value={customLabel}
                      onChange={(e) => setCustomLabel(e.target.value)}
                      placeholder="Keterangan pelanggaran manual..."
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <select
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value as KategoriPelanggaran)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800"
                    >
                      {AKPS_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={customPoints}
                      onChange={(e) => setCustomPoints(Number(e.target.value))}
                      aria-label="Poin manual"
                      className="font-mono-num w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <button
                      type="button"
                      onClick={handleAddCustomRule}
                      className="inline-flex w-full items-center justify-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Tambah</span>
                    </button>
                  </div>
                  <div className="sm:col-span-12">
                    <input
                      type="text"
                      value={customAction}
                      onChange={(e) => setCustomAction(e.target.value)}
                      placeholder="Tindak lanjut / sanksi (opsional)..."
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Selected Violations Summary List */}
        {selectedRules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-500">
            Belum ada pelanggaran dipilih. Klik minimal 1 tombol pelanggaran cepat di atas.
          </p>
        ) : (
          <div className="rounded-xl border border-blue-200 bg-blue-50/45 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-blue-950">
                Pelanggaran dipilih ({selectedRules.length} aturan ·{' '}
                <span className="font-mono-num">+{totalPointsPerStudent} poin</span> per siswa)
              </span>
            </div>
            <ul className="mt-2 divide-y divide-blue-100">
              {selectedRules.map((rule) => (
                <li
                  key={rule.key}
                  className="flex items-center justify-between gap-2 py-1.5 text-xs text-slate-800"
                >
                  <div className="min-w-0">
                    <span className="font-mono-num font-bold text-blue-800">
                      [{rule.violationCode}]
                    </span>{' '}
                    <span className="font-medium">{rule.violationLabel}</span>
                    <span className="text-slate-500"> · +{rule.points} poin</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Hapus aturan ${rule.violationLabel}`}
                    onClick={() =>
                      setSelectedRules((prev) => prev.filter((item) => item.key !== rule.key))
                    }
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-blue-100 hover:text-red-700"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Langkah 2: Pilih Banyak Siswa Sekaligus */}
      <div className="space-y-3 border-b border-slate-100 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-slate-900">
              Langkah 2 · Pilih Banyak Siswa Sekaligus
            </p>
            <p className="text-xs text-slate-500">
              Bisa mencari nama beruntun atau mencentang banyak siswa langsung dari daftar kelas.
            </p>
          </div>
          <div
            role="tablist"
            aria-label="Cara memilih siswa massal"
            className="inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={studentPickerTab === 'search'}
              onClick={() => setStudentPickerTab('search')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                studentPickerTab === 'search'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Cari &amp; Ketik Nama
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={studentPickerTab === 'class'}
              onClick={() => setStudentPickerTab('class')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                studentPickerTab === 'class'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Centang per Kelas
            </button>
          </div>
        </div>

        {studentPickerTab === 'search' ? (
          <div className="space-y-2.5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400"
                aria-hidden="true"
              />
              <input
                ref={searchInputRef}
                id="batch-student-search"
                type="text"
                autoComplete="off"
                disabled={!canRecordNow || submitting}
                value={searchText}
                onFocus={() => setShowSearchDropdown(true)}
                onBlur={() => window.setTimeout(() => setShowSearchDropdown(false), 180)}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  setHighlightedIndex(0);
                  setShowSearchDropdown(true);
                }}
                onKeyDown={(e) => {
                  if (!showSearchDropdown || searchMatches.length === 0) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHighlightedIndex((prev) => (prev + 1) % searchMatches.length);
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHighlightedIndex((prev) =>
                      prev <= 0 ? searchMatches.length - 1 : prev - 1
                    );
                  } else if (e.key === 'Enter') {
                    const picked = searchMatches[highlightedIndex] ?? searchMatches[0];
                    if (picked) {
                      e.preventDefault();
                      addDirectoryStudentFromSearch(picked.student);
                    }
                  } else if (e.key === 'Escape') {
                    setShowSearchDropdown(false);
                  }
                }}
                placeholder="Ketik nama siswa lalu klik / tekan Enter untuk masuk daftar..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50"
              />

              {showSearchDropdown && canRecordNow && (
                <div
                  role="listbox"
                  className="absolute left-0 right-0 z-30 mt-1.5 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
                >
                  {!searchText.trim() ? (
                    <div className="px-3.5 py-2.5 text-xs text-slate-500">
                      Ketik beberapa huruf nama (mis. <strong>abdi</strong> atau <strong>ahmad 12c</strong>), lalu tekan <strong>Enter</strong>. Kolom langsung siap untuk siswa berikutnya.
                    </div>
                  ) : searchMatches.length === 0 ? (
                    <div className="px-3.5 py-2.5 text-xs text-slate-500">
                      Nama &ldquo;{searchText.trim()}&rdquo; tidak ditemukan di direktori. Anda bisa menambahkannya sebagai siswa manual di bawah.
                    </div>
                  ) : (
                    searchMatches.map(({ student: stu }, idx) => {
                      const isAdded = selectedStudentKeySet.has(makeStudentKey(stu));
                      const isHighlighted = idx === highlightedIndex;
                      return (
                        <button
                          key={stu.id}
                          type="button"
                          role="option"
                          aria-selected={isHighlighted}
                          onMouseEnter={() => setHighlightedIndex(idx)}
                          onMouseDown={(ev) => {
                            ev.preventDefault();
                            if (isAdded) {
                              toggleDirectoryStudent(stu);
                            } else {
                              addDirectoryStudentFromSearch(stu);
                            }
                          }}
                          className={`flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-sm transition-colors ${
                            isHighlighted ? 'bg-blue-50 text-blue-950' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">{stu.name}</p>
                            <p className="text-[11px] text-slate-500">
                              {stu.nis && stu.nis !== '-' ? `NIS ${stu.nis}` : 'Siswa terdaftar'}
                              {isAdded ? ' · Sudah dipilih (klik untuk batal)' : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isAdded && (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                            )}
                            <span className="font-mono-num text-xs font-bold text-slate-700">
                              {stu.kelas}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 text-xs">
              <button
                type="button"
                disabled={!canRecordNow || submitting}
                onClick={() => {
                  setShowManualStudentBox((prev) => !prev);
                  if (!manualName && searchText.trim()) {
                    setManualName(searchText.trim());
                  }
                }}
                className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900 underline disabled:opacity-50"
              >
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {showManualStudentBox
                    ? 'Tutup input siswa manual'
                    : 'Siswa belum ada di daftar? Tambah manual'}
                </span>
              </button>
            </div>

            {showManualStudentBox && (
              <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-12">
                <div className="sm:col-span-5">
                  <input
                    type="text"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="Nama lengkap siswa..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                  />
                </div>
                <div className="sm:col-span-3">
                  <input
                    type="text"
                    value={manualKelas}
                    onChange={(e) => setManualKelas(e.target.value)}
                    placeholder="Kelas (mis. 10A)"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                  />
                </div>
                <div className="sm:col-span-2">
                  <input
                    type="text"
                    value={manualNis}
                    onChange={(e) => setManualNis(e.target.value)}
                    placeholder="NIS (opsional)"
                    className="font-mono-num w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                  />
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="button"
                    onClick={handleAddManualStudent}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Tambah</span>
                  </button>
                </div>
                <label className="flex items-center gap-2 text-[11px] text-slate-600 sm:col-span-12 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={manualSaveDir}
                    onChange={(e) => setManualSaveDir(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                  />
                  <span>Simpan juga ke direktori siswa sekolah</span>
                </label>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
              <div className="sm:col-span-5">
                <label
                  htmlFor="batch-class-select"
                  className="block text-xs font-medium text-slate-700"
                >
                  Pilih Kelas
                </label>
                <select
                  id="batch-class-select"
                  disabled={!canRecordNow || submitting}
                  value={effectiveClassFilter}
                  onChange={(e) => setSelectedClassFilter(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  {classList.map((cls) => (
                    <option key={cls} value={cls}>
                      Kelas {cls}
                    </option>
                  ))}
                  <option value="ALL">Semua Kelas ({appState.students.length} siswa)</option>
                </select>
              </div>

              <div className="sm:col-span-7">
                <label
                  htmlFor="batch-class-filter-text"
                  className="block text-xs font-medium text-slate-700"
                >
                  Saring Nama di Kelas Ini
                </label>
                <input
                  id="batch-class-filter-text"
                  type="text"
                  disabled={!canRecordNow || submitting}
                  value={classSearchQuery}
                  onChange={(e) => setClassSearchQuery(e.target.value)}
                  placeholder="Ketik sebagian nama untuk menyaring..."
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-slate-600">
                Menampilkan <strong className="font-mono-num">{studentsInSelectedClass.length}</strong> siswa
              </span>
              {studentsInSelectedClass.length > 0 && (
                <button
                  type="button"
                  disabled={!canRecordNow || submitting}
                  onClick={
                    allVisibleClassSelected
                      ? handleDeselectVisibleClassStudents
                      : handleSelectAllVisibleClassStudents
                  }
                  className="font-semibold text-blue-700 hover:text-blue-800 underline whitespace-nowrap disabled:opacity-50"
                >
                  {allVisibleClassSelected
                    ? `Batal Pilih Semua (${studentsInSelectedClass.length})`
                    : `Pilih Semua di Daftar Ini (${studentsInSelectedClass.length})`}
                </button>
              )}
            </div>

            <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              {studentsInSelectedClass.length === 0 ? (
                <p className="px-3.5 py-4 text-center text-xs text-slate-500">
                  Tidak ada siswa yang cocok dengan saringan tersebut.
                </p>
              ) : (
                studentsInSelectedClass.map((stu) => {
                  const isChecked = selectedStudentKeySet.has(makeStudentKey(stu));
                  return (
                    <label
                      key={stu.id}
                      className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-3 px-3.5 py-2 text-xs transition-colors ${
                        isChecked ? 'bg-blue-50/80 text-blue-950' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <input
                          type="checkbox"
                          disabled={!canRecordNow || submitting}
                          checked={isChecked}
                          onChange={() => toggleDirectoryStudent(stu)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600"
                        />
                        <span className="truncate font-medium text-slate-900">{stu.name}</span>
                      </span>
                      <span className="font-mono-num shrink-0 font-semibold text-slate-600">
                        {stu.kelas}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Daftar Siswa Terpilih */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
              <Users className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
              <span>
                Daftar Siswa Terpilih (<span className="font-mono-num">{selectedStudents.length}</span> siswa)
              </span>
            </span>
            {selectedStudents.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedStudents([])}
                className="inline-flex items-center gap-1 font-medium text-red-700 hover:text-red-800 whitespace-nowrap"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Kosongkan Daftar</span>
              </button>
            )}
          </div>

          {selectedStudents.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">
              Belum ada siswa ditambahkan. Cari nama di atas atau centang dari tab &ldquo;Centang per Kelas&rdquo;.
            </p>
          ) : (
            <div className="mt-2 max-h-40 overflow-y-auto grid grid-cols-1 gap-1.5 rounded-lg border border-slate-200 bg-white p-1.5 sm:grid-cols-2">
              {selectedStudents.map((stu, idx) => (
                <div
                  key={stu.key}
                  className="flex items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50/60 px-2.5 py-1 text-xs"
                >
                  <span className="min-w-0 truncate text-slate-800">
                    <span className="font-mono-num text-slate-400">{idx + 1}.</span>{' '}
                    <strong className="font-semibold text-slate-900">{stu.name}</strong>{' '}
                    <span className="font-mono-num text-slate-500">· {stu.kelas}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Hapus ${stu.name} dari daftar`}
                    onClick={() =>
                      setSelectedStudents((prev) => prev.filter((item) => item.key !== stu.key))
                    }
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-700"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Langkah 3: Catatan & Simpan Massal */}
      <div className="space-y-3">
        <div>
          <label htmlFor="batch-notes" className="block text-sm font-medium text-slate-700">
            Langkah 3 · Catatan Tambahan untuk Semua (Opsional)
          </label>
          <input
            id="batch-notes"
            type="text"
            disabled={!canRecordNow || submitting}
            value={sharedNotes}
            onChange={(e) => setSharedNotes(e.target.value)}
            placeholder="Mis. Terjaring razia gerbang pagi pukul 07:10..."
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 disabled:bg-slate-50"
          />
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={keepRulesAfterSave}
            onChange={(e) => setKeepRulesAfterSave(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
          />
          <span>
            <strong className="text-slate-900">Kunci pilihan pelanggaran</strong> setelah disimpan (daftar siswa akan dikosongkan otomatis, tapi pelanggaran tetap siap untuk gelombang berikutnya).
          </span>
        </label>

        {totalPlannedRows > 0 && (
          <div
            className={`rounded-xl border px-3.5 py-2.5 text-xs ${
              totalPlannedRows > MAX_BATCH_VIOLATION_ROWS
                ? 'border-red-200 bg-red-50 text-red-900'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}
          >
            Siap menyimpan{' '}
            <strong className="font-mono-num">{totalPlannedRows} catatan</strong> ke spreadsheet hari
            ini (<span className="font-mono-num">{selectedStudents.length} siswa</span> ×{' '}
            <span className="font-mono-num">{selectedRules.length} pelanggaran</span>).
            {totalPlannedRows > MAX_BATCH_VIOLATION_ROWS &&
              ` Melebihi batas maksimal ${MAX_BATCH_VIOLATION_ROWS} catatan per simpan.`}
          </div>
        )}

        {connectionOffline && canRecordNow && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-900"
          >
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
            <span>
              <strong>Koneksi sedang terputus.</strong> Jangan tekan simpan dulu agar data tidak gagal terkirim. Daftar siswa yang sudah dipilih tetap aman di layar.
            </span>
          </div>
        )}

        <button
          type="submit"
          disabled={
            !canRecordNow ||
            submitting ||
            connectionOffline ||
            selectedStudents.length === 0 ||
            selectedRules.length === 0 ||
            totalPlannedRows > MAX_BATCH_VIOLATION_ROWS
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
                ? 'Menyimpan Catatan Massal...'
                : !canRecordNow
                  ? lockedNoticeText
                  : totalPlannedRows > 0
                    ? `Simpan Semua (${totalPlannedRows} Catatan)`
                    : 'Pilih Pelanggaran & Siswa untuk Menyimpan'}
          </span>
        </button>
      </div>
    </form>
  );
}
