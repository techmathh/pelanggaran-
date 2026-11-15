import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import { calculateStudentSummaries, isManagerRole } from '../shared/piketLogic';
import type { PublicAppState, PublicOfficer, TingkatPembinaan } from '../shared/types';
import { downloadStudentRecapXlsx } from '../utils/exportSpreadsheet';
import { AnimatedNumber } from './AnimatedNumber';

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
  const [visibleLimit, setVisibleLimit] = useState<number>(30);

  // Custom student management state (for Admin/Developer)
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [newStuName, setNewStuName] = useState('');
  const [newStuKelas, setNewStuKelas] = useState('');
  const [newStuNis, setNewStuNis] = useState('');
  const [savingStudent, setSavingStudent] = useState(false);
  const [confirmDeleteStudentId, setConfirmDeleteStudentId] = useState<string | null>(null);

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

  const visibleRows = useMemo(
    () => filtered.slice(0, visibleLimit),
    [filtered, visibleLimit]
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
          nis: newStuNis,
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
      setNewStuNis('');
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
                className="btn-3d-soft inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                <UserPlus className="h-4 w-4 text-blue-600" aria-hidden="true" />
                <span>{showAddStudent ? 'Tutup Form Siswa' : 'Kelola Siswa Baru / Pindahan'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleExportRecapExcel}
              className="btn-3d-soft inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Ekspor Excel Rekap per Kelas (.xlsx)</span>
            </button>
          </div>
        </div>

        {canManageStudents && showAddStudent && (
          <div className="animate-panel-reveal mt-5 rounded-xl border border-blue-100 bg-blue-50/35 p-4">
            <h2 className="font-display text-sm font-bold text-slate-900">
              Tambah Siswa Baru / Pindahan ke Direktori Sekolah ({appState.students.length} Siswa)
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              610 data siswa resmi dilindungi sistem. Siswa tambahan yang Anda input di sini akan muncul di pencarian otomatis saat petugas piket bertugas.
            </p>
            <form
              onSubmit={handleAddCustomStudent}
              className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-12"
            >
              <div className="sm:col-span-5">
                <input
                  type="text"
                  required
                  value={newStuName}
                  onChange={(e) => setNewStuName(e.target.value)}
                  placeholder="Nama lengkap siswa baru..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                />
              </div>
              <div className="sm:col-span-2">
                <input
                  type="text"
                  required
                  value={newStuKelas}
                  onChange={(e) => setNewStuKelas(e.target.value)}
                  placeholder="Kelas (mis. 10A)"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs uppercase text-slate-900"
                />
              </div>
              <div className="sm:col-span-2">
                <input
                  type="text"
                  value={newStuNis}
                  onChange={(e) => setNewStuNis(e.target.value)}
                  placeholder="NIS (Opsional)"
                  className="font-mono-num w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
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
                  Siswa Tambahan di Luar 610 Data Pokok ({customStudents.length}):
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {customStudents.map((cs) => {
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
                </div>
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
              aria-label="Cari nama atau NIS siswa"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setVisibleLimit(30);
              }}
              placeholder="Cari siswa, kelas, atau NIS..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="Filter kelas siswa"
              value={kelasFilter}
              onChange={(e) => {
                setKelasFilter(e.target.value);
                setVisibleLimit(50);
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
                setVisibleLimit(30);
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
                  setVisibleLimit(30);
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
                  setVisibleLimit(30);
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
                  <th className="px-4 py-3">Siswa & NIS</th>
                  <th className="px-4 py-3">Kelas</th>
                  <th className="px-4 py-3 text-right">Total Pelanggaran</th>
                  <th className="px-4 py-3 text-right">Akumulasi Poin</th>
                  <th className="px-4 py-3">Catatan Terakhir</th>
                  <th className="px-4 py-3">Sanksi AKPS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map((stu) => (
                  <tr key={stu.key} className="transition-colors hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{stu.studentName}</p>
                      <p className="font-mono-num text-xs text-slate-500">NIS {stu.studentNis}</p>
                    </td>
                    <td className="font-mono-num px-4 py-3 text-xs font-semibold text-slate-700">
                      {stu.kelas}
                    </td>
                    <td className="font-mono-num px-4 py-3 text-right text-slate-700">
                      {stu.incidentCount}x
                    </td>
                    <td className="font-mono-num px-4 py-3 text-right font-bold text-slate-900">
                      {stu.totalPoints}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <p className="text-slate-800">{stu.lastViolationLabel}</p>
                      <p className="font-mono-num text-slate-400">{stu.lastViolationDate}</p>
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold">
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

        {filtered.length > 0 && (
          <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:px-5">
            <span>
              Menampilkan <strong className="text-slate-700">{visibleRows.length}</strong> dari{' '}
              <strong className="text-slate-700">{filtered.length}</strong> siswa
            </span>
            {visibleRows.length < filtered.length && (
              <button
                type="button"
                onClick={() => setVisibleLimit((prev) => prev + 50)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Tampilkan 50 Siswa Berikutnya
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
