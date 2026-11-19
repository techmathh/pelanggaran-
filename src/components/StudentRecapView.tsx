import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  UserPlus,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import {
  calculateStudentSummaries,
  isManagerRole,
  paginateItems,
} from '../shared/piketLogic';
import {
  parseStudentRosterRows,
  type ParsedStudentRosterResult,
} from '../shared/studentImportLogic';
import type {
  PublicAppState,
  PublicOfficer,
  StudentImportMode,
  TingkatPembinaan,
} from '../shared/types';
import {
  downloadCurrentStudentRosterXlsx,
  downloadStudentRecapXlsx,
  downloadStudentRosterTemplateXlsx,
} from '../utils/exportSpreadsheet';
import { AnimatedNumber } from './AnimatedNumber';
import { PaginationBar } from './PaginationBar';

interface StudentRecapViewProps {
  officer?: PublicOfficer;
  appState: PublicAppState;
  onStateUpdate?: (nextState: PublicAppState) => void;
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const TIERS: ('ALL' | TingkatPembinaan)[] = [
  'ALL',
  'Surat Pernyataan Bermaterai (≥ 100)',
  'Panggilan Orang Tua 3 (76–99)',
  'Surat Pernyataan 2 & Panggilan Orang Tua 2 (51–75)',
  'Surat Pernyataan 1 & Panggilan Orang Tua 1 (26–50)',
  'Teguran Lisan (15–25)',
  'Pembinaan Awal (< 15)',
];

export function StudentRecapView({
  officer,
  appState,
  onStateUpdate,
  onNotify,
}: StudentRecapViewProps) {
  const canManageStudents = Boolean(officer && isManagerRole(officer.role));
  const [query, setQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<'ALL' | TingkatPembinaan>('ALL');
  const [kelasFilter, setKelasFilter] = useState<string>('ALL');
  const [onlyViolators, setOnlyViolators] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number | 'ALL'>(20);

  // Custom student management & bulk Excel/CSV import state (for Admin/Developer)
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [manageMode, setManageMode] = useState<'single' | 'import'>('single');
  const [newStuName, setNewStuName] = useState('');
  const [newStuKelas, setNewStuKelas] = useState('');
  const [savingStudent, setSavingStudent] = useState(false);
  const [confirmDeleteStudentId, setConfirmDeleteStudentId] = useState<string | null>(null);

  // Bulk Excel/CSV import state
  const rosterFileInputRef = useRef<HTMLInputElement | null>(null);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [parsedImport, setParsedImport] = useState<ParsedStudentRosterResult | null>(null);
  const [importMode, setImportMode] = useState<StudentImportMode>('append');
  const [confirmReplaceChecked, setConfirmReplaceChecked] = useState(false);
  const [importingRoster, setImportingRoster] = useState(false);

  const customStudents = useMemo(
    () => appState.students.filter((s) => !/^stu-(?:10|11|12)[a-f]-\d+$/i.test(s.id)),
    [appState.students]
  );

  const summaries = useMemo(
    () => calculateStudentSummaries(appState.spreadsheets, appState.students),
    [appState.spreadsheets, appState.students]
  );

  const availableClasses = useMemo(() => {
    const set = new Set(summaries.map((s) => s.kelas));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
  }, [summaries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return summaries.filter((s) => {
      const matchTier = tierFilter === 'ALL' || s.tier === tierFilter;
      const matchKelas = kelasFilter === 'ALL' || s.kelas === kelasFilter;
      const matchViolator = !onlyViolators || s.incidentCount > 0;
      const matchQuery =
        !q ||
        s.studentName.toLowerCase().includes(q) ||
        s.kelas.toLowerCase().includes(q) ||
        s.studentNis.toLowerCase().includes(q);
      return matchTier && matchKelas && matchViolator && matchQuery;
    });
  }, [summaries, query, tierFilter, kelasFilter, onlyViolators]);

  const paginatedStudents = useMemo(
    () => paginateItems(filtered, page, pageSize),
    [filtered, page, pageSize]
  );

  const needLetterCount = summaries.filter((s) => s.totalPoints >= 26).length;
  const verbalWarningCount = summaries.filter(
    (s) => s.totalPoints >= 15 && s.totalPoints <= 25
  ).length;
  const totalIncidents = summaries.reduce((acc, s) => acc + s.incidentCount, 0);

  function handleExportRecapExcel() {
    downloadStudentRecapXlsx(summaries, appState.serverDate);
    onNotify?.(`Berhasil mengunduh Rekap-AKPS-Siswa-Per-Kelas-${appState.serverDate}.xlsx`, 'success');
  }

  async function handleAddCustomStudent(e: FormEvent) {
    e.preventDefault();
    if (!canManageStudents) return;
    setSavingStudent(true);
    try {
      const res = await apiFetch('/api/students', {
        method: 'POST',
        body: JSON.stringify({
          name: newStuName,
          kelas: newStuKelas,
          nis: '-',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify?.(data.error || 'Gagal menambah siswa baru.', 'error');
        return;
      }
      onStateUpdate?.(data.state);
      setNewStuName('');
      setNewStuKelas('');
      onNotify?.('Siswa baru berhasil ditambahkan ke direktori sekolah.', 'success');
    } catch {
      onNotify?.('Gagal terhubung ke server.', 'error');
    } finally {
      setSavingStudent(false);
    }
  }

  async function handleDeleteCustomStudent(studentId: string, name: string) {
    if (!canManageStudents) return;
    setSavingStudent(true);
    try {
      const res = await apiFetch(`/api/students/${studentId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify?.(data.error || 'Gagal menghapus siswa tambahan.', 'error');
        return;
      }
      onStateUpdate?.(data.state);
      setConfirmDeleteStudentId(null);
      onNotify?.(`Data siswa tambahan ${name} berhasil dihapus.`, 'info');
    } catch {
      onNotify?.('Gagal terhubung ke server.', 'error');
    } finally {
      setSavingStudent(false);
    }
  }

  async function handleRosterFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        onNotify?.('File Excel/CSV tidak memiliki worksheet.', 'error');
        return;
      }
      const worksheet = workbook.Sheets[firstSheetName];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        raw: false,
        defval: '',
      });
      const parsed = parseStudentRosterRows(matrix);
      setImportFileName(file.name);
      setParsedImport(parsed);
      setConfirmReplaceChecked(false);
      if (parsed.entries.length === 0) {
        onNotify?.(
          'Tidak ditemukan baris siswa valid (Nama & Kelas) di file tersebut.',
          'error'
        );
      } else {
        onNotify?.(
          `Berhasil membaca ${parsed.entries.length} data siswa dari ${file.name}.`,
          'info'
        );
      }
    } catch {
      onNotify?.('Gagal membaca file. Pastikan formatnya .xlsx, .xls, atau .csv valid.', 'error');
    } finally {
      if (rosterFileInputRef.current) {
        rosterFileInputRef.current.value = '';
      }
    }
  }

  async function handleExecuteRosterImport() {
    if (!canManageStudents || !parsedImport || parsedImport.entries.length === 0) return;
    if (importMode === 'replace_all' && !confirmReplaceChecked) {
      onNotify?.('Centang kotak konfirmasi penggantian roster tahun ajaran baru terlebih dahulu.', 'error');
      return;
    }

    setImportingRoster(true);
    try {
      const res = await apiFetch('/api/students/import', {
        method: 'POST',
        body: JSON.stringify({
          mode: importMode,
          students: parsedImport.entries,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        importedCount?: number;
        updatedCount?: number;
        skippedCount?: number;
        totalStudents?: number;
        state?: PublicAppState;
      };
      if (!res.ok || !data.state) {
        onNotify?.(data.error || 'Gagal mengimpor roster siswa.', 'error');
        return;
      }

      onStateUpdate?.(data.state);
      setParsedImport(null);
      setImportFileName(null);
      setConfirmReplaceChecked(false);
      onNotify?.(
        importMode === 'replace_all'
          ? `Roster tahun ajaran baru diterapkan: ${data.totalStudents} siswa aktif di direktori.`
          : `Import selesai: ${data.importedCount ?? 0} siswa baru ditambahkan, ${data.updatedCount ?? 0} data diperbarui (total ${data.totalStudents} siswa).`,
        'success'
      );
    } catch {
      onNotify?.('Gagal terhubung ke server saat mengimpor roster siswa.', 'error');
    } finally {
      setImportingRoster(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="surface-3d animate-stagger-1 rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Rekap Akumulasi AKPS Siswa
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Akumulasi Angka Kredit Pelanggaran Siswa (AKPS) SMA Negeri 1 Kemangkon beserta sanksi pembinaan otomatis.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canManageStudents && (
              <button
                type="button"
                onClick={() => setShowAddStudent((prev) => !prev)}
                className="btn-3d-soft inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <UserPlus className="h-4 w-4 text-blue-600" aria-hidden="true" />
                <span>{showAddStudent ? 'Tutup Kelola Siswa' : 'Kelola & Import Siswa'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleExportRecapExcel}
              className="btn-3d-soft inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Ekspor Excel Rekap per Kelas (.xlsx)</span>
            </button>
          </div>
        </div>

        {canManageStudents && showAddStudent && (
          <div className="animate-panel-reveal mt-5 rounded-xl border border-blue-100 bg-blue-50/35 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900">
                  Kelola Direktori Siswa ({appState.students.length} Siswa Terdaftar)
                </h2>
                <p className="mt-0.5 text-xs text-slate-600">
                  Tambah siswa pindahan satu per satu, atau import massal dari Excel/CSV saat kenaikan kelas & tahun ajaran baru.
                </p>
              </div>
              <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setManageMode('single')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    manageMode === 'single'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Tambah 1 Siswa
                </button>
                <button
                  type="button"
                  onClick={() => setManageMode('import')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    manageMode === 'import'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Import Excel / CSV</span>
                </button>
              </div>
            </div>

            {manageMode === 'single' ? (
              <>
                <form
                  onSubmit={handleAddCustomStudent}
                  className="mt-4 grid grid-cols-1 gap-3 border-t border-blue-100 pt-4 sm:grid-cols-12"
                >
                  <div className="sm:col-span-6">
                    <input
                      type="text"
                      required
                      value={newStuName}
                      onChange={(e) => setNewStuName(e.target.value)}
                      placeholder="Nama lengkap siswa baru..."
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <input
                      type="text"
                      required
                      value={newStuKelas}
                      onChange={(e) => setNewStuKelas(e.target.value)}
                      placeholder="Kelas (mis. 10A)"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs uppercase text-slate-900"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <button
                      type="submit"
                      disabled={savingStudent}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Simpan Siswa</span>
                    </button>
                  </div>
                </form>

                {customStudents.length > 0 && (
                  <div className="mt-3 border-t border-blue-100 pt-3">
                    <p className="text-[11px] font-semibold text-slate-600">
                      Siswa Tambahan / Roster Kustom ({customStudents.length}):
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {customStudents.slice(0, 24).map((cs) => {
                        const isConfirming = confirmDeleteStudentId === cs.id;
                        return (
                          <span
                            key={cs.id}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-800"
                          >
                            <span className="font-medium">{cs.name}</span>
                            <span className="font-mono-num text-slate-500">({cs.kelas})</span>
                            {isConfirming ? (
                              <span className="ml-1 inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={savingStudent}
                                  onClick={() => handleDeleteCustomStudent(cs.id, cs.name)}
                                  className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-red-700"
                                >
                                  Yakin Hapus
                                </button>
                                <button
                                  type="button"
                                  disabled={savingStudent}
                                  onClick={() => setConfirmDeleteStudentId(null)}
                                  className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
                                >
                                  Batal
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={savingStudent}
                                onClick={() => setConfirmDeleteStudentId(cs.id)}
                                aria-label={`Hapus siswa tambahan ${cs.name}`}
                                className="ml-0.5 text-slate-400 hover:text-red-600"
                              >
                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                              </button>
                            )}
                          </span>
                        );
                      })}
                      {customStudents.length > 24 && (
                        <span className="inline-flex items-center px-2 py-1 text-xs text-slate-500">
                          +{customStudents.length - 24} siswa lainnya di tabel utama
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="mt-4 space-y-4 border-t border-blue-100 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={rosterFileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleRosterFileSelect}
                      className="sr-only"
                      id="roster-file-upload"
                    />
                    <label
                      htmlFor="roster-file-upload"
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap"
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Pilih File Excel / CSV (.xlsx, .csv)</span>
                    </label>
                    <button
                      type="button"
                      onClick={downloadStudentRosterTemplateXlsx}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                      <span>Unduh Template (.xlsx)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadCurrentStudentRosterXlsx(appState.students, appState.serverDate)
                      }
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                      <span>Unduh Roster Saat Ini ({appState.students.length})</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700">Mode Import:</span>
                    <button
                      type="button"
                      onClick={() => {
                        setImportMode('append');
                        setConfirmReplaceChecked(false);
                      }}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        importMode === 'append'
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      Tambah / Gabung Siswa Baru
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportMode('replace_all')}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        importMode === 'replace_all'
                          ? 'border-amber-600 bg-amber-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      Ganti Total Roster (Tahun Ajaran Baru)
                    </button>
                  </div>
                </div>

                {importMode === 'replace_all' && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900">
                    <p className="font-semibold">
                      Mode Pergantian Tahun Ajaran: seluruh daftar direktori siswa saat ini ({appState.students.length} siswa) akan diganti dengan daftar dari file baru.
                    </p>
                    <p className="mt-1 text-amber-800">
                      Riwayat catatan pelanggaran pada arsip terdahulu tetap aman dan tidak ikut terhapus.
                    </p>
                    <label className="mt-2 inline-flex cursor-pointer items-center gap-2 font-semibold">
                      <input
                        type="checkbox"
                        checked={confirmReplaceChecked}
                        onChange={(e) => setConfirmReplaceChecked(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-amber-400 text-amber-600"
                      />
                      <span>Saya yakin ingin mengganti seluruh roster siswa untuk tahun ajaran baru</span>
                    </label>
                  </div>
                )}

                {parsedImport && (
                  <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-xs text-slate-700">
                        <span className="font-semibold text-slate-900">{importFileName}</span>
                        <span className="mx-1.5 text-slate-300">·</span>
                        <span className="font-mono-num font-semibold text-emerald-700">
                          {parsedImport.entries.length} siswa valid
                        </span>
                        {parsedImport.duplicateCount > 0 && (
                          <>
                            <span className="mx-1.5 text-slate-300">·</span>
                            <span className="font-mono-num text-amber-700">
                              {parsedImport.duplicateCount} duplikat digabung
                            </span>
                          </>
                        )}
                        {parsedImport.skipped.length > 0 && (
                          <>
                            <span className="mx-1.5 text-slate-300">·</span>
                            <span className="font-mono-num text-red-700">
                              {parsedImport.skipped.length} baris dilewati
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setParsedImport(null);
                            setImportFileName(null);
                            setConfirmReplaceChecked(false);
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Batal
                        </button>
                        <button
                          type="button"
                          disabled={
                            importingRoster ||
                            parsedImport.entries.length === 0 ||
                            (importMode === 'replace_all' && !confirmReplaceChecked)
                          }
                          onClick={handleExecuteRosterImport}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>
                            {importingRoster
                              ? 'Mengimpor...'
                              : `Terapkan ${parsedImport.entries.length} Siswa`}
                          </span>
                        </button>
                      </div>
                    </div>

                    {parsedImport.entries.length > 0 && (
                      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                              <th className="px-3 py-2 font-semibold">No</th>
                              <th className="px-3 py-2 font-semibold">Nama Siswa</th>
                              <th className="px-3 py-2 font-semibold">Kelas</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {parsedImport.entries.slice(0, 6).map((item, idx) => (
                              <tr key={`${item.name}-${item.kelas}-${idx}`}>
                                <td className="font-mono-num px-3 py-1.5 text-slate-500">
                                  {idx + 1}
                                </td>
                                <td className="px-3 py-1.5 font-medium text-slate-900">
                                  {item.name}
                                </td>
                                <td className="font-mono-num px-3 py-1.5 font-semibold text-slate-700">
                                  {item.kelas}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {parsedImport.entries.length > 6 && (
                          <div className="border-t border-slate-100 bg-slate-50/70 px-3 py-1.5 text-[11px] text-slate-500">
                            Menampilkan 6 pratinjau pertama dari total {parsedImport.entries.length} siswa siap impor.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-3">
          <div className="card-3d-interactive rounded-xl border border-slate-200/70 bg-slate-50/50 p-3.5">
            <p className="text-xs text-slate-500">Total Pelanggaran Terekam</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              <AnimatedNumber value={totalIncidents} />
            </p>
          </div>
          <div className="card-3d-interactive rounded-xl border border-amber-200/70 bg-amber-50/40 p-3.5">
            <p className="text-xs text-slate-500">Teguran Lisan (15–25 Poin)</p>
            <p className="mt-1 text-2xl font-bold text-amber-700">
              <AnimatedNumber value={verbalWarningCount} />
            </p>
          </div>
          <div className="card-3d-interactive rounded-xl border border-red-200/70 bg-red-50/35 p-3.5">
            <p className="text-xs text-slate-500">Surat Pernyataan / Panggilan Ortu (≥ 26 Poin)</p>
            <p className="mt-1 text-2xl font-bold text-red-700">
              <AnimatedNumber value={needLetterCount} />
            </p>
          </div>
        </div>
      </section>

      <section className="surface-3d animate-stagger-2 rounded-2xl border border-slate-200/90 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between sm:p-5">
          <div className="relative w-full lg:w-72">
            <Search
              className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Cari nama atau kelas siswa"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Cari siswa atau kelas..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="Filter kelas siswa"
              value={kelasFilter}
              onChange={(e) => {
                setKelasFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none"
            >
              <option value="ALL">Semua Kelas ({availableClasses.length})</option>
              {availableClasses.map((k) => (
                <option key={k} value={k}>
                  Kelas {k}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter status sanksi AKPS"
              value={tierFilter}
              onChange={(e) => {
                setTierFilter(e.target.value as 'ALL' | TingkatPembinaan);
                setPage(1);
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none"
            >
              {TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier === 'ALL' ? 'Semua Tingkat Sanksi AKPS' : tier}
                </option>
              ))}
            </select>

            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={onlyViolators}
                onChange={(e) => {
                  setOnlyViolators(e.target.checked);
                  setPage(1);
                }}
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>Hanya yang memiliki poin</span>
            </label>

            {(query || kelasFilter !== 'ALL' || tierFilter !== 'ALL' || onlyViolators) && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setKelasFilter('ALL');
                  setTierFilter('ALL');
                  setOnlyViolators(false);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
              >
                Reset Filter
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          {filtered.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              Belum ada siswa yang sesuai dengan filter.
            </div>
          ) : (
            <table className="min-w-[680px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3">Siswa</th>
                  <th className="px-4 py-3">Kelas</th>
                  <th className="px-4 py-3 text-right">Total Pelanggaran</th>
                  <th className="px-4 py-3 text-right">Akumulasi Poin</th>
                  <th className="px-4 py-3">Catatan Terakhir</th>
                  <th className="px-4 py-3">Sanksi AKPS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedStudents.items.map((stu) => (
                  <tr key={stu.key} className="transition-colors hover:bg-slate-50/80">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{stu.studentName}</p>
                    </td>
                    <td className="font-mono-num px-4 py-2.5 text-xs font-semibold text-slate-700">
                      {stu.kelas}
                    </td>
                    <td className="font-mono-num px-4 py-2.5 text-right text-slate-700">
                      {stu.incidentCount}x
                    </td>
                    <td className="font-mono-num px-4 py-2.5 text-right font-bold text-slate-900">
                      {stu.totalPoints}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      <p className="text-slate-800">{stu.lastViolationLabel}</p>
                      <p className="font-mono-num text-slate-400">{stu.lastViolationDate}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-semibold">
                      {stu.totalPoints >= 51 ? (
                        <span className="inline-flex items-center gap-1.5 text-red-700">
                          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>{stu.tier}</span>
                        </span>
                      ) : stu.totalPoints >= 15 ? (
                        <span className="inline-flex items-center gap-1.5 text-amber-700">
                          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>{stu.tier}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700">
                          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>{stu.tier}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <PaginationBar
          page={paginatedStudents.page}
          totalPages={paginatedStudents.totalPages}
          totalItems={paginatedStudents.totalItems}
          startIndex={paginatedStudents.startIndex}
          endIndex={paginatedStudents.endIndex}
          pageSize={pageSize}
          pageSizeOptions={[20, 50, 100]}
          itemLabel="siswa"
          onPageChange={setPage}
          onPageSizeChange={(nextSize) => {
            setPageSize(nextSize);
            setPage(1);
          }}
        />
      </section>
    </div>
  );
}
