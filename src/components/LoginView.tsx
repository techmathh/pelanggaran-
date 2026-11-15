import { useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import { formatIndonesianDateLabel } from '../shared/piketLogic';
import type { PublicAppState, PublicMetaState, PublicOfficer } from '../shared/types';
import { CuteMascot3D } from './CuteMascot3D';

interface LoginViewProps {
  meta: PublicMetaState;
  onLoginSuccess: (
    token: string,
    officer: PublicOfficer,
    nextState: PublicAppState
  ) => void;
}

interface PendingPasswordChange {
  token: string;
  officer: PublicOfficer;
  currentPassword: string;
}

export function LoginView({ meta, onLoginSuccess }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // First-login mandatory password change state
  const [pendingChange, setPendingChange] = useState<PendingPasswordChange | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLoginSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal masuk. Periksa kembali username dan password.');
        return;
      }

      if (data.requiresPasswordChange) {
        setPendingChange({
          token: data.token,
          officer: data.officer,
          currentPassword: password,
        });
        setNewPassword('');
        setConfirmPassword('');
        setError(null);
        return;
      }

      onLoginSuccess(data.token, data.officer, data.state);
    } catch {
      setError('Tidak dapat terhubung ke server SiPiket OSIS.');
    } finally {
      setLoading(false);
    }
  }

  async function handleMandatoryPasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pendingChange) return;
    setError(null);

    if (newPassword.trim().length < 6) {
      setError('Password baru minimal terdiri dari 6 karakter.');
      return;
    }
    if (newPassword.trim() !== confirmPassword.trim()) {
      setError('Konfirmasi password tidak cocok dengan password baru.');
      return;
    }
    if (newPassword.trim() === pendingChange.currentPassword.trim()) {
      setError('Password baru wajib berbeda dari password sementara yang dibuat sistem.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pendingChange.token}`,
        },
        body: JSON.stringify({
          currentPassword: pendingChange.currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal memperbarui password.');
        return;
      }
      onLoginSuccess(data.token, data.officer, data.state);
    } catch {
      setError('Tidak dapat terhubung ke server saat memperbarui password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 sm:py-8 lg:py-12">
      <div className="mx-auto max-w-6xl">
        {/* Minimal top context line */}
        <header className="mb-6 flex flex-col gap-2 border-b border-slate-200/80 pb-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
              SiPiket OSIS
            </span>
            <span className="hidden text-slate-300 sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="text-xs text-slate-600 sm:text-sm">
              Sistem AKPS SMA Negeri 1 Kemangkon
            </span>
          </div>
          <div className="font-mono-num text-xs text-slate-500">
            {formatIndonesianDateLabel(meta.serverDate, meta.serverHari)} · {meta.serverTime} WIB
            {meta.simulation.enabled ? ' (Mode Uji Coba)' : ''}
          </div>
        </header>

        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12 lg:gap-8">
          {/* Left Hero & Interactive 3D Mascot */}
          <section className="order-2 flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] sm:p-8 lg:order-1 lg:col-span-6">
            <div>
              <p className="text-xs font-semibold tracking-wide text-blue-700">
                Portal Piket Kedisiplinan OSIS
              </p>
              <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl lg:text-[2rem] lg:leading-tight text-balance">
                Piket OSIS lebih mudah, rapi, dan langsung jadi laporan kelas.
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                Cukup cari nama siswa lalu pilih kategori pelanggaran. Setelah selesai piket,
                tekan tombol <strong className="font-semibold text-slate-900">Selesai</strong>{' '}
                agar laporan Excel per kelas dan PDF langsung siap diunduh.
              </p>
            </div>

            <div className="my-5 rounded-xl border border-sky-100/90 bg-gradient-to-b from-sky-50/75 via-white to-slate-50/60 p-3 sm:p-4">
              <CuteMascot3D mood={pendingChange ? 'recording' : 'idle'} />
            </div>

            <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-3">
              <div>
                <p className="text-xs font-semibold text-slate-900">01. Masuk Akun Piket</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                  Login sesuai akun petugas OSIS yang sudah dibagikan pengurus.
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-900">02. Catat Siswa Cepat</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                  Ketik beberapa huruf nama siswa — kelas dan poin AKPS terisi otomatis.
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-900">03. Klik Selesai &amp; Unduh</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                  Setelah semua petugas klik Selesai, file Excel &amp; PDF siap diunduh.
                </p>
              </div>
            </div>
          </section>

          {/* Right Card: Login OR Mandatory First-Login Password Change */}
          <section className="order-1 flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] sm:p-8 lg:order-2 lg:col-span-6">
            {!pendingChange ? (
              <div className="flex flex-1 flex-col justify-center">
                <div>
                  <p className="text-xs font-semibold text-blue-700">Akses Petugas Piket</p>
                  <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">
                    Masuk ke SiPiket OSIS
                  </h2>
                  <p className="mt-1.5 text-sm text-slate-600">
                    Masukkan username dan password akun piket Anda untuk mulai bertugas.
                  </p>
                </div>

                <form onSubmit={handleLoginSubmit} className="mt-7 space-y-5">
                  <div>
                    <label
                      htmlFor="login-username"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Username
                    </label>
                    <input
                      id="login-username"
                      type="text"
                      required
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Masukkan username Anda"
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="login-password"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Password
                    </label>
                    <div className="relative mt-1.5">
                      <input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Masukkan password"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={showPassword ? 'Sembunyikan password' : 'Lihat password'}
                        className="absolute right-2.5 top-2 rounded-lg p-1 text-slate-400 hover:text-slate-700"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div
                      role="alert"
                      className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700"
                    >
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-3d-primary flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    <span>{loading ? 'Memverifikasi...' : 'Masuk ke Ruang Piket'}</span>
                  </button>
                </form>
              </div>
            ) : (
              <div>
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <AlertTriangle
                    className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
                    aria-hidden="true"
                  />
                  <div>
                    <h2 className="font-display text-base font-bold text-amber-950">
                      Wajib Ganti Password Login Pertama
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-amber-900">
                      Halo <strong>{pendingChange.officer.name}</strong> (
                      <span className="font-mono-num">@{pendingChange.officer.username}</span>), Anda
                      login menggunakan password sementara dari sistem. Buat password baru pribadi
                      untuk melanjutkan. Password lama akan otomatis hangus dan tidak dapat
                      digunakan lagi.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleMandatoryPasswordSubmit} className="mt-6 space-y-4">
                  <div>
                    <label
                      htmlFor="new-password"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Password Baru (Minimal 6 karakter)
                    </label>
                    <div className="relative mt-1.5">
                      <input
                        id="new-password"
                        type={showNewPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Masukkan password baru Anda"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((prev) => !prev)}
                        aria-label={showNewPassword ? 'Sembunyikan password' : 'Lihat password'}
                        className="absolute right-2.5 top-2 rounded-lg p-1 text-slate-400 hover:text-slate-700"
                      >
                        {showNewPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="confirm-new-password"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Konfirmasi Password Baru
                    </label>
                    <div className="relative mt-1.5">
                      <input
                        id="confirm-new-password"
                        type={showNewPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Ulangi password baru"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                      />
                      <KeyRound
                        className="pointer-events-none absolute right-3.5 top-3 h-4 w-4 text-slate-400"
                        aria-hidden="true"
                      />
                    </div>
                  </div>

                  {error && (
                    <div
                      role="alert"
                      className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700"
                    >
                      {error}
                    </div>
                  )}

                  <div className="flex flex-col gap-2.5 sm:flex-row">
                    <button
                      type="submit"
                      disabled={loading}
                      className="btn-3d-primary flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                      <span>{loading ? 'Menyimpan...' : 'Simpan Password Baru & Masuk'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        setPendingChange(null);
                        setPassword('');
                        setError(null);
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Batal
                    </button>
                  </div>
                </form>
              </div>
            )}

            <p className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500">
              Belum punya akun atau lupa password? Hubungi Admin OSIS untuk dibuatkan akun baru atau
              reset password. Petugas di luar jam piket tetap dapat masuk untuk melihat rekap & arsip.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
