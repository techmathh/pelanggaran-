import { useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import { buildApiUrl } from '../lib/apiClient';
import { formatIndonesianDateLabel, getRoleLabel } from '../shared/piketLogic';
import type { PublicAppState, PublicMetaState, PublicOfficer } from '../shared/types';
import { CuteMascot3D } from './CuteMascot3D';

export interface PendingPasswordChange {
  token: string;
  officer: PublicOfficer;
  currentPassword: string;
}

interface MandatoryPasswordChangeViewProps {
  meta: PublicMetaState;
  pending: PendingPasswordChange;
  onSuccess: (
    token: string,
    officer: PublicOfficer,
    nextState: PublicAppState
  ) => void;
  onCancel: () => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'OS';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function MandatoryPasswordChangeView({
  meta,
  pending,
  onSuccess,
  onCancel,
}: MandatoryPasswordChangeViewProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedNew = newPassword.trim();
  const trimmedConfirm = confirmPassword.trim();
  const hasMinLength = trimmedNew.length >= 6;
  const isDifferentFromTemp =
    trimmedNew.length > 0 && trimmedNew !== pending.currentPassword.trim();
  const passwordsMatch =
    trimmedNew.length > 0 && trimmedNew === trimmedConfirm;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!hasMinLength) {
      setError('Password baru minimal terdiri dari 6 karakter.');
      return;
    }
    if (!passwordsMatch) {
      setError('Konfirmasi password tidak cocok dengan password baru.');
      return;
    }
    if (!isDifferentFromTemp) {
      setError('Password baru wajib berbeda dari password sementara yang dibuat sistem.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(buildApiUrl('/api/auth/change-password'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pending.token}`,
        },
        body: JSON.stringify({
          currentPassword: pending.currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal memperbarui password.');
        return;
      }
      onSuccess(data.token, data.officer, data.state);
    } catch {
      setError('Tidak dapat terhubung ke server saat memperbarui password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 sm:py-8 lg:py-10 animate-panel-reveal">
      <div className="mx-auto max-w-2xl">
        {/* Dedicated top bar with back-to-login exit */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4 sm:mb-8">
          <div className="flex items-center gap-2.5">
            <span className="font-display text-lg font-bold tracking-tight text-slate-900">
              SiPiket OSIS
            </span>
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <span className="text-xs font-medium text-blue-700 sm:text-sm">
              Aktivasi Password Akun
            </span>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Kembali ke Halaman Login</span>
          </button>
        </header>

        {/* Focused single-task card */}
        <main className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] sm:p-8">
          <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-amber-700">
                Langkah Wajib Login Pertama
              </p>
              <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">
                Buat Password Baru Anda
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                Anda baru pertama kali masuk dengan password sementara. Buat password pribadi Anda
                sekarang agar akun aman dan langsung masuk ke ruang piket.
              </p>
            </div>

            <div className="hidden w-44 shrink-0 rounded-xl border border-sky-100 bg-gradient-to-b from-sky-50/75 to-white p-2 sm:block">
              <CuteMascot3D
                mood="recording"
                compact
                caption="Buat password baru dulu ya!"
              />
            </div>
          </div>

          {/* Logged-in officer summary */}
          <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <div
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-xs"
                style={{ backgroundColor: pending.officer.avatarColor || '#2563EB' }}
              >
                {getInitials(pending.officer.name)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">
                  {pending.officer.name}
                </p>
                <p className="truncate text-xs text-slate-500">
                  <span className="font-mono-num">@{pending.officer.username}</span> ·{' '}
                  {getRoleLabel(pending.officer.role)} · {pending.officer.division}
                </p>
              </div>
            </div>
            <span className="font-mono-num hidden text-[11px] text-slate-400 sm:inline shrink-0">
              {formatIndonesianDateLabel(meta.serverDate, meta.serverHari)}
            </span>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label
                htmlFor="mandatory-new-password"
                className="block text-sm font-medium text-slate-700"
              >
                Password Baru
              </label>
              <div className="relative mt-1.5">
                <input
                  id="mandatory-new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoFocus
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimal 6 karakter yang mudah Anda ingat"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
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
                htmlFor="mandatory-confirm-password"
                className="block text-sm font-medium text-slate-700"
              >
                Ulangi Password Baru
              </label>
              <div className="relative mt-1.5">
                <input
                  id="mandatory-confirm-password"
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Ketik ulang password baru yang sama"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                />
                <KeyRound
                  className="pointer-events-none absolute right-3.5 top-3 h-4 w-4 text-slate-400"
                  aria-hidden="true"
                />
              </div>
            </div>

            {/* Live password checklist */}
            <ul className="space-y-1.5 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 text-xs">
              <li
                className={`flex items-center gap-2 ${
                  hasMinLength ? 'font-medium text-emerald-700' : 'text-slate-500'
                }`}
              >
                <CheckCircle2
                  className={`h-3.5 w-3.5 shrink-0 ${
                    hasMinLength ? 'text-emerald-600' : 'text-slate-300'
                  }`}
                  aria-hidden="true"
                />
                <span>Minimal 6 karakter</span>
              </li>
              <li
                className={`flex items-center gap-2 ${
                  isDifferentFromTemp ? 'font-medium text-emerald-700' : 'text-slate-500'
                }`}
              >
                <CheckCircle2
                  className={`h-3.5 w-3.5 shrink-0 ${
                    isDifferentFromTemp ? 'text-emerald-600' : 'text-slate-300'
                  }`}
                  aria-hidden="true"
                />
                <span>Berbeda dari password sementara sebelumnya</span>
              </li>
              <li
                className={`flex items-center gap-2 ${
                  passwordsMatch ? 'font-medium text-emerald-700' : 'text-slate-500'
                }`}
              >
                <CheckCircle2
                  className={`h-3.5 w-3.5 shrink-0 ${
                    passwordsMatch ? 'text-emerald-600' : 'text-slate-300'
                  }`}
                  aria-hidden="true"
                />
                <span>Password baru dan konfirmasi sama persis</span>
              </li>
            </ul>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700"
              >
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2.5 pt-1 sm:flex-row">
              <button
                type="submit"
                disabled={loading}
                className="btn-3d-primary flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                <span>{loading ? 'Menyimpan...' : 'Simpan Password & Masuk Ruang Piket'}</span>
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={onCancel}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Batal
              </button>
            </div>
          </form>

          <p className="mt-6 flex items-center gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
            <ShieldCheck className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
            <span>
              Setelah disimpan, password sementara langsung hangus dan Anda dapat masuk memakai
              password baru ini seterusnya.
            </span>
          </p>
        </main>
      </div>
    </div>
  );
}
