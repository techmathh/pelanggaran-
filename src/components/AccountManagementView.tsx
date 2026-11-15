import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Cloud,
  Copy,
  Download,
  FileSpreadsheet,
  KeyRound,
  Lock,
  RefreshCw,
  Shield,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { apiFetch } from '../lib/apiClient';
import {
  auth,
  fetchUserCloudBackups,
  signInCloudSyncWithGoogle,
  signOutCloudSync,
  syncSnapshotToFirestore,
  type CloudBackupSummary,
} from '../lib/firebase';
import {
  ALL_ROTATION_WEEKS,
  HARI_LIST,
  canCreateRole,
  canDeleteAccount,
  formatScheduledWeeksLabel,
  getRoleLabel,
  parseBulkAccountEntries,
} from '../shared/piketLogic';
import type {
  GeneratedAccountCredential,
  HariPiket,
  PublicAppState,
  PublicOfficer,
  RolePetugas,
} from '../shared/types';
import {
  downloadAccountsCredentialsCsv,
  downloadAccountsCredentialsXlsx,
  downloadRegisteredAccountsDirectoryXlsx,
} from '../utils/exportSpreadsheet';

interface AccountManagementViewProps {
  officer: PublicOfficer;
  appState: PublicAppState;
  onStateUpdate: (nextState: PublicAppState) => void;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const SEKOLAH_DAYS: HariPiket[] = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export function AccountManagementView({
  officer,
  appState,
  onStateUpdate,
  onNotify,
}: AccountManagementViewProps) {
  const isDeveloper = officer.role === 'developer';

  const cycleWeeks = appState.weeklySchedule?.cycleWeeks ?? 2;

  // Bulk creation state
  const [namesText, setNamesText] = useState('');
  const [targetRole, setTargetRole] = useState<'admin' | 'petugas'>('petugas');
  const [division, setDivision] = useState('Sekbid Kedisiplinan');
  const [defaultKelas, setDefaultKelas] = useState('XI-A');
  const [scheduledDays, setScheduledDays] = useState<HariPiket[]>([
    'Senin',
    'Selasa',
    'Rabu',
    'Kamis',
    'Jumat',
    'Sabtu',
  ]);
  const [rotationMode, setRotationMode] = useState<'auto_split' | 'all' | 'custom'>(
    cycleWeeks > 1 ? 'auto_split' : 'all'
  );
  const [scheduledWeeks, setScheduledWeeks] = useState<number[]>([1]);
  const [shiftStart, setShiftStart] = useState('06:30');
  const [shiftEnd, setShiftEnd] = useState('08:30');
  const [submitting, setSubmitting] = useState(false);

  // Latest generated credentials batch (contains plaintext temporaryPassword shown once for export)
  const [generatedBatch, setGeneratedBatch] = useState<GeneratedAccountCredential[]>([]);

  // Two-step inline delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Firebase Cloud Sync state
  const [firebaseUser, setFirebaseUser] = useState<User | null>(auth.currentUser);
  const [cloudBackups, setCloudBackups] = useState<CloudBackupSummary[]>([]);
  const [syncingCloud, setSyncingCloud] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setFirebaseUser(u);
      if (u && u.emailVerified) {
        try {
          const list = await fetchUserCloudBackups();
          setCloudBackups(list);
        } catch {
          // handled gracefully
        }
      } else {
        setCloudBackups([]);
      }
    });
    return () => unsub();
  }, []);

  const parsedEntries = useMemo(() => parseBulkAccountEntries(namesText), [namesText]);

  function toggleDay(day: HariPiket) {
    setScheduledDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  function toggleWeek(weekNum: number) {
    setScheduledWeeks((prev) => {
      if (prev.includes(weekNum)) {
        const next = prev.filter((w) => w !== weekNum);
        return next.length > 0 ? next : [weekNum];
      }
      return [...prev, weekNum].sort((a, b) => a - b);
    });
  }

  async function handleBulkCreate(e: FormEvent) {
    e.preventDefault();
    if (parsedEntries.length === 0) {
      onNotify('Masukkan minimal satu nama lengkap (satu nama per baris).', 'error');
      return;
    }
    if (!canCreateRole(officer.role, targetRole)) {
      onNotify('Anda tidak memiliki izin untuk membuat role ini.', 'error');
      return;
    }
    if (scheduledDays.length === 0) {
      onNotify('Pilih minimal satu hari jadwal piket.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/accounts/bulk', {
        method: 'POST',
        body: JSON.stringify({
          namesText,
          role: targetRole,
          division,
          defaultKelas,
          scheduledDays,
          scheduledWeeks:
            targetRole === 'admin' || rotationMode === 'all'
              ? ALL_ROTATION_WEEKS
              : scheduledWeeks,
          rotationMode: targetRole === 'admin' ? 'all' : rotationMode,
          shiftStart,
          shiftEnd,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal membuat akun massal.', 'error');
        return;
      }
      onStateUpdate(data.state);
      setGeneratedBatch(data.credentials);
      setNamesText('');
      onNotify(
        `${data.credentials.length} akun ${getRoleLabel(targetRole)} berhasil dibuat! Segera simpan atau unduh daftar username & passwordnya.`,
        'success'
      );
    } catch {
      onNotify('Gagal terhubung ke server saat membuat akun.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(target: PublicOfficer) {
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/accounts/${target.id}/reset-password`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal mereset password akun.', 'error');
        return;
      }
      onStateUpdate(data.state);
      setGeneratedBatch((prev) => [
        data.credential,
        ...prev.filter((item) => item.id !== data.credential.id),
      ]);
      onNotify(
        `Password sementara baru dibuat untuk ${target.name}. User wajib menggantinya saat login berikutnya.`,
        'success'
      );
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteAccount(target: PublicOfficer) {
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/accounts/${target.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal menghapus akun.', 'error');
        return;
      }
      onStateUpdate(data.state);
      setGeneratedBatch((prev) => prev.filter((item) => item.id !== target.id));
      setConfirmDeleteId(null);
      onNotify(`Akun ${target.name} telah dihapus.`, 'info');
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function handleFillSampleNames() {
    if (namesText.trim()) {
      onNotify('Kosongkan dulu kotak daftar nama jika ingin mengisi contoh format.', 'info');
      return;
    }
    setNamesText('Ahmad Fauzi | 11A\nSiti Nurhaliza | 11B\nRizky Pratama | 10C');
  }

  function handleCopyCredentials() {
    if (generatedBatch.length === 0) return;
    const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const lines = generatedBatch.map(
      (c, i) =>
        `${i + 1}. *${c.name}* (${getRoleLabel(c.role)})\n   Username: \`${c.username}\`\n   Password awal: \`${c.temporaryPassword}\`\n   Giliran: ${formatScheduledWeeksLabel(c.scheduledWeeks, cycleWeeks)}`
    );
    const text = [
      '*Akun SiPiket OSIS SMAN 1 Kemangkon*',
      siteUrl ? `Link aplikasi: ${siteUrl}` : '',
      '',
      ...lines,
      '',
      '_Catatan: Setelah berhasil masuk pertama kali, segera buat password baru milik Anda sendiri._',
    ]
      .filter((line) => line !== undefined)
      .join('\n');

    navigator.clipboard?.writeText(text).then(
      () => onNotify('Pesan siap kirim (WhatsApp) berhasil disalin!', 'success'),
      () => onNotify('Gunakan tombol Unduh Excel atau CSV untuk menyimpan daftar akun.', 'info')
    );
  }

  async function handleConnectAndSyncFirebase() {
    setSyncingCloud(true);
    try {
      if (!firebaseUser) {
        await signInCloudSyncWithGoogle();
      }
      const saved = await syncSnapshotToFirestore(officer.role, appState);
      const list = await fetchUserCloudBackups();
      setCloudBackups(list);
      onNotify(
        `Cadangan data berhasil disimpan ke akun Google Anda (${saved.id}).`,
        'success'
      );
    } catch (err: any) {
      onNotify(err?.message || 'Gagal menyimpan cadangan online.', 'error');
    } finally {
      setSyncingCloud(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Summary */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Kelola Akun Pengurus & Petugas
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {isDeveloper
                ? 'Anda bisa membuat akun Admin OSIS maupun Petugas Piket sekaligus, lalu membagikan username & passwordnya.'
                : 'Anda bisa membuat akun Petugas Piket sekaligus, mengunduh daftar login, dan mengatur jadwal petugas.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
            <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono-num">
              Total Akun: <strong className="text-slate-900">{appState.officers.length}</strong>
            </span>
            <span className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-blue-800">
              Jabatan Anda: <strong>{getRoleLabel(officer.role)}</strong>
            </span>
          </div>
        </div>
      </section>

      {/* Bulk Account Creation Form */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-start gap-2.5 border-b border-slate-100 pb-4">
          <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Buat Banyak Akun Sekaligus (Username & Password Otomatis)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Ketik atau tempel daftar nama lengkap (satu nama tiap baris). Jika ingin langsung
              mengisi kelasnya, tambahkan{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5">| Kelas</code>. Username &amp;
              password awal dibuat otomatis, lalu pengguna wajib mengganti password saat masuk pertama kali.
            </p>
          </div>
        </div>

        <form onSubmit={handleBulkCreate} className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-2 lg:col-span-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="bulk-names" className="block text-sm font-medium text-slate-700">
                Daftar Nama Lengkap (1 baris = 1 akun)
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleFillSampleNames}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Isi Contoh Format
                </button>
                <span className="font-mono-num shrink-0 text-xs font-semibold text-blue-700">
                  {parsedEntries.length} nama terdeteksi
                </span>
              </div>
            </div>
            <textarea
              id="bulk-names"
              rows={8}
              required
              value={namesText}
              onChange={(e) => setNamesText(e.target.value)}
              placeholder={`Contoh:\nAhmad Fauzi\nSiti Nurhaliza | 11B\nRizky Pratama | 10C`}
              className="w-full rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          <div className="space-y-4 lg:col-span-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="bulk-role" className="block text-sm font-medium text-slate-700">
                  Jabatan / Peran Akun
                </label>
                <select
                  id="bulk-role"
                  value={targetRole}
                  onChange={(e) => {
                    const next = e.target.value as 'admin' | 'petugas';
                    setTargetRole(next);
                    if (next === 'admin') {
                      setDivision('Admin Pengurus OSIS');
                      setDefaultKelas('OSIS-ADMIN');
                      setScheduledDays(HARI_LIST);
                      setRotationMode('all');
                      setShiftStart('06:00');
                      setShiftEnd('22:00');
                    } else {
                      setDivision('Sekbid Kedisiplinan');
                      setDefaultKelas('XI-A');
                      setScheduledDays(SEKOLAH_DAYS);
                      setRotationMode(cycleWeeks > 1 ? 'auto_split' : 'all');
                      setShiftStart('06:30');
                      setShiftEnd('08:30');
                    }
                  }}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                >
                  <option value="petugas">Petugas Piket</option>
                  {isDeveloper && <option value="admin">Admin OSIS</option>}
                </select>
                {!isDeveloper && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Admin OSIS hanya dapat membuat akun Petugas Piket.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="bulk-kelas" className="block text-sm font-medium text-slate-700">
                  Kelas Default (Jika tidak ditulis)
                </label>
                <input
                  id="bulk-kelas"
                  type="text"
                  value={defaultKelas}
                  onChange={(e) => setDefaultKelas(e.target.value)}
                  placeholder="XI-A"
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="sm:col-span-1">
                <label htmlFor="bulk-div" className="block text-xs font-medium text-slate-700">
                  Divisi / Sekbid
                </label>
                <input
                  id="bulk-div"
                  type="text"
                  value={division}
                  onChange={(e) => setDivision(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                />
              </div>
              <div>
                <label htmlFor="bulk-start" className="block text-xs font-medium text-slate-700">
                  Jam Mulai Piket
                </label>
                <input
                  id="bulk-start"
                  type="time"
                  value={shiftStart}
                  onChange={(e) => setShiftStart(e.target.value)}
                  className="font-mono-num mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label htmlFor="bulk-end" className="block text-xs font-medium text-slate-700">
                  Jam Selesai Piket
                </label>
                <input
                  id="bulk-end"
                  type="time"
                  value={shiftEnd}
                  onChange={(e) => setShiftEnd(e.target.value)}
                  className="font-mono-num mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-700">Hari Piket Default</p>
              <div className="flex flex-wrap gap-1.5">
                {HARI_LIST.map((day) => {
                  const checked = scheduledDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                        checked
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>

            {targetRole === 'petugas' && cycleWeeks > 1 && (
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <label htmlFor="bulk-rotation-mode" className="block text-xs font-medium text-slate-700">
                  Giliran Minggu Piket (Siklus {cycleWeeks} Minggu)
                </label>
                <select
                  id="bulk-rotation-mode"
                  value={rotationMode}
                  onChange={(e) =>
                    setRotationMode(e.target.value as 'auto_split' | 'all' | 'custom')
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  <option value="auto_split">
                    Bagi Otomatis Bergilir (Minggu 1 – {cycleWeeks})
                  </option>
                  <option value="all">Semua Minggu</option>
                  <option value="custom">Pilih Minggu Tertentu</option>
                </select>
                {rotationMode === 'custom' && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {Array.from({ length: cycleWeeks }, (_, i) => i + 1).map((weekNum) => {
                      const checked = scheduledWeeks.includes(weekNum);
                      return (
                        <button
                          key={weekNum}
                          type="button"
                          onClick={() => toggleWeek(weekNum)}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                            checked
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          Minggu {weekNum}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || parsedEntries.length === 0}
              className="btn-3d-primary flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              <span>
                {submitting
                  ? 'Sedang Membuat Akun...'
                  : `Buat ${parsedEntries.length || ''} Akun & Password Otomatis`}
              </span>
            </button>
          </div>
        </form>
      </section>

      {/* Newly Generated Credentials Export Panel */}
      {generatedBatch.length > 0 && (
        <section className="rounded-2xl border border-emerald-200 bg-white p-5 sm:p-6">
          <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Daftar Username & Password Baru ({generatedBatch.length} Akun)
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Simpan atau bagikan daftar ini sekarang. Saat petugas masuk pertama kali memakai
                password sementara, mereka wajib membuat password baru sendiri.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => downloadAccountsCredentialsXlsx(generatedBatch, appState.serverDate)}
                className="btn-3d-primary inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Unduh Excel (.xlsx)</span>
              </button>
              <button
                type="button"
                onClick={() => downloadAccountsCredentialsCsv(generatedBatch, appState.serverDate)}
                className="btn-3d-soft inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={handleCopyCredentials}
                className="btn-3d-soft inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Salin Pesan Siap Kirim (WA)</span>
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="px-3.5 py-2.5 w-10">No</th>
                  <th className="px-3.5 py-2.5">Nama Lengkap</th>
                  <th className="px-3.5 py-2.5">Jabatan</th>
                  <th className="px-3.5 py-2.5">Username</th>
                  <th className="px-3.5 py-2.5">Password Sementara</th>
                  <th className="px-3.5 py-2.5">Jadwal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {generatedBatch.map((cred, idx) => (
                  <tr key={cred.id} className="hover:bg-slate-50/70">
                    <td className="font-mono-num px-3.5 py-2.5 text-xs text-slate-500">
                      {idx + 1}
                    </td>
                    <td className="px-3.5 py-2.5 font-medium text-slate-900">{cred.name}</td>
                    <td className="px-3.5 py-2.5 text-xs font-medium text-slate-700">
                      {getRoleLabel(cred.role)}
                    </td>
                    <td className="font-mono-num px-3.5 py-2.5 text-xs font-semibold text-blue-700">
                      {cred.username}
                    </td>
                    <td className="font-mono-num px-3.5 py-2.5 text-xs font-bold text-emerald-700">
                      {cred.temporaryPassword}
                    </td>
                    <td className="px-3.5 py-2.5 text-xs text-slate-600">
                      <span className="font-semibold text-blue-700">
                        {formatScheduledWeeksLabel(cred.scheduledWeeks, cycleWeeks)}
                      </span>{' '}
                      · {cred.scheduledDays.join(', ')} ({cred.shiftStart}–{cred.shiftEnd})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Registered Accounts Directory */}
      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Daftar Akun Terdaftar
            </h2>
            <p className="text-xs text-slate-500">
              Akun Developer utama dilindungi sistem dan tidak dapat dihapus.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              downloadRegisteredAccountsDirectoryXlsx(appState.officers, appState.serverDate)
            }
            className="btn-3d-soft inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 shrink-0"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Unduh Daftar Akun (.xlsx)</span>
          </button>
        </div>

        {/* Desktop & Tablet Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="px-4 py-3">Nama & Kelas</th>
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Jabatan</th>
                <th className="px-4 py-3">Status Password</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {appState.officers.map((acc) => {
                const deletable = canDeleteAccount(officer.role, acc);
                const resettable =
                  !acc.isProtected &&
                  acc.role !== 'developer' &&
                  (isDeveloper || acc.role === 'petugas');
                const isConfirmingDelete = confirmDeleteId === acc.id;

                return (
                  <tr key={acc.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{acc.name}</p>
                      <p className="text-xs text-slate-500">
                        {acc.division} · {acc.kelas} ·{' '}
                        <span className="font-medium text-blue-700">
                          {formatScheduledWeeksLabel(acc.scheduledWeeks, cycleWeeks)}
                        </span>
                      </p>
                    </td>
                    <td className="font-mono-num px-4 py-3 text-xs font-semibold text-slate-700">
                      @{acc.username}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold">
                      <span
                        className={
                          acc.role === 'developer'
                            ? 'text-slate-900'
                            : acc.role === 'admin'
                              ? 'text-blue-700'
                              : 'text-teal-700'
                        }
                      >
                        {getRoleLabel(acc.role)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {acc.mustChangePassword ? (
                        <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Wajib Ganti Saat Masuk</span>
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-medium">Aktif & Aman</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {acc.isProtected || acc.role === 'developer' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Dilindungi</span>
                        </span>
                      ) : isConfirmingDelete ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleDeleteAccount(acc)}
                            className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700"
                          >
                            Yakin Hapus?
                          </button>
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Batal
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-2">
                          {resettable && (
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => handleResetPassword(acc)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <RefreshCw className="h-3 w-3" aria-hidden="true" />
                              <span>Buat Ulang Password</span>
                            </button>
                          )}
                          {deletable && (
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => setConfirmDeleteId(acc.id)}
                              aria-label={`Hapus akun ${acc.name}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-3 w-3" aria-hidden="true" />
                              <span>Hapus</span>
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile Card List (< md) */}
        <div className="divide-y divide-slate-100 md:hidden">
          {appState.officers.map((acc) => {
            const deletable = canDeleteAccount(officer.role, acc);
            const resettable =
              !acc.isProtected &&
              acc.role !== 'developer' &&
              (isDeveloper || acc.role === 'petugas');
            const isConfirmingDelete = confirmDeleteId === acc.id;

            return (
              <div key={acc.id} className="space-y-2.5 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{acc.name}</p>
                    <p className="font-mono-num text-xs text-slate-500">
                      @{acc.username} · {acc.kelas} ·{' '}
                      <span className="font-sans font-medium text-blue-700">
                        {formatScheduledWeeksLabel(acc.scheduledWeeks, cycleWeeks)}
                      </span>
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-blue-700">
                    {getRoleLabel(acc.role)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className={acc.mustChangePassword ? 'text-amber-700' : 'text-emerald-700'}>
                    {acc.mustChangePassword ? 'Wajib ganti password' : 'Aktif & Aman'}
                  </span>
                  {acc.isProtected || acc.role === 'developer' ? (
                    <span className="inline-flex items-center gap-1 text-slate-500">
                      <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Dilindungi</span>
                    </span>
                  ) : isConfirmingDelete ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleDeleteAccount(acc)}
                        className="rounded-lg bg-red-600 px-2.5 py-1 font-semibold text-white"
                      >
                        Yakin Hapus?
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700"
                      >
                        Batal
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {resettable && (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => handleResetPassword(acc)}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 font-medium text-slate-700"
                        >
                          Buat Ulang Password
                        </button>
                      )}
                      {deletable && (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => setConfirmDeleteId(acc.id)}
                          className="rounded-lg border border-red-200 px-2.5 py-1 font-medium text-red-700"
                        >
                          Hapus
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Optional Firebase Cloud Snapshot Sync (Firestore) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-display text-base font-bold text-slate-900">
              <Cloud className="h-4 w-4 text-blue-600" aria-hidden="true" />
              <span>Simpan Cadangan Data Online (Google / Firestore)</span>
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {firebaseUser
                ? `Terhubung dengan akun Google (${firebaseUser.email}). Klik tombol di kanan jika ingin mencadangkan salinan data ke penyimpanan online Google Anda.`
                : 'Opsional: Hubungkan akun Google Anda jika ingin menyimpan salinan cadangan data secara online.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={syncingCloud}
              onClick={handleConnectAndSyncFirebase}
              className="btn-3d-soft inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            >
              <Cloud className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
              <span>
                {syncingCloud
                  ? 'Sedang Menyimpan...'
                  : firebaseUser
                    ? 'Simpan Cadangan Online'
                    : 'Hubungkan Google & Simpan Cadangan'}
              </span>
            </button>
            {firebaseUser && (
              <button
                type="button"
                onClick={() => signOutCloudSync()}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Putuskan Google
              </button>
            )}
          </div>
        </div>

        {cloudBackups.length > 0 && (
          <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/50 text-xs">
            {cloudBackups.map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
              >
                <span className="font-mono-num font-semibold text-slate-800">{b.id}</span>
                <span className="text-slate-600">
                  {b.spreadsheetCount} spreadsheet · {b.violationCount} pelanggaran
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
