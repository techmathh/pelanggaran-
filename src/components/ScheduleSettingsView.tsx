import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CalendarDays,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Pencil,
  RefreshCw,
  Repeat,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import {
  AKPS_CATEGORIES,
  ALL_ROTATION_WEEKS,
  DEFAULT_DAILY_SESSION_CONFIG,
  HARI_LIST,
  formatScheduledWeeksLabel,
  getActiveRotationWeek,
  getAutoSessionWindowStatus,
  getRoleLabel,
  getScheduleStatus,
  isManagerRole,
} from '../shared/piketLogic';
import type {
  HariPiket,
  KategoriPelanggaran,
  PublicAppState,
  PublicOfficer,
  ViolationPreset,
} from '../shared/types';

interface ScheduleSettingsViewProps {
  officer: PublicOfficer;
  appState: PublicAppState;
  onStateUpdate: (nextState: PublicAppState) => void;
  onPasswordUpdated: (
    newToken: string,
    updatedOfficer: PublicOfficer,
    nextState: PublicAppState
  ) => void;
  onOpenAccounts: () => void;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const SEKOLAH_DAYS: HariPiket[] = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export function ScheduleSettingsView({
  officer,
  appState,
  onStateUpdate,
  onPasswordUpdated,
  onOpenAccounts,
  onNotify,
}: ScheduleSettingsViewProps) {
  const canManage = isManagerRole(officer.role);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTick(Date.now());
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  const now = new Date(nowTick);
  const weekInfo = getActiveRotationWeek(
    appState.serverDate,
    appState.weeklySchedule,
    appState.simulation
  );
  const cycleWeeks = weekInfo.cycleWeeks;

  // Daily automatic spreadsheet schedule form
  const initialDaily = appState.dailySession ?? DEFAULT_DAILY_SESSION_CONFIG;
  const [sessionDays, setSessionDays] = useState<HariPiket[]>(initialDaily.activeDays);
  const [sessionStart, setSessionStart] = useState(initialDaily.startTime);
  const [sessionEnd, setSessionEnd] = useState(initialDaily.endTime);
  const [syncOfficersWithSession, setSyncOfficersWithSession] = useState(true);

  useEffect(() => {
    const nextDaily = appState.dailySession ?? DEFAULT_DAILY_SESSION_CONFIG;
    setSessionDays(nextDaily.activeDays);
    setSessionStart(nextDaily.startTime);
    setSessionEnd(nextDaily.endTime);
  }, [
    appState.dailySession?.startTime,
    appState.dailySession?.endTime,
    appState.dailySession?.activeDays,
  ]);

  const autoWindow = getAutoSessionWindowStatus(
    appState.dailySession ?? DEFAULT_DAILY_SESSION_CONFIG,
    now,
    appState.simulation
  );

  // Simulation form
  const [simEnabled, setSimEnabled] = useState(appState.simulation.enabled);
  const [simTime, setSimTime] = useState(appState.simulation.simulatedTime || '07:15');
  const [simDay, setSimDay] = useState<string>(appState.simulation.simulatedDay ?? '');
  const [simWeek, setSimWeek] = useState<string>(
    appState.simulation.simulatedWeek ? String(appState.simulation.simulatedWeek) : ''
  );

  useEffect(() => {
    setSimEnabled(Boolean(appState.simulation.enabled));
    setSimTime(appState.simulation.simulatedTime || '07:15');
    setSimDay(appState.simulation.simulatedDay ?? '');
    setSimWeek(appState.simulation.simulatedWeek ? String(appState.simulation.simulatedWeek) : '');
  }, [
    appState.simulation.enabled,
    appState.simulation.simulatedTime,
    appState.simulation.simulatedDay,
    appState.simulation.simulatedWeek,
  ]);

  // Editable officer schedules
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDays, setEditDays] = useState<HariPiket[]>([]);
  const [editWeeks, setEditWeeks] = useState<number[]>([...ALL_ROTATION_WEEKS]);
  const [editStart, setEditStart] = useState('06:30');
  const [editEnd, setEditEnd] = useState('08:30');

  // Self password change form (available to all roles)
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSelfPasswords, setShowSelfPasswords] = useState(false);

  // Interactive week filter in schedule list
  const [selectedWeekFilter, setSelectedWeekFilter] = useState<number | null>(null);

  // New preset form
  const [presetCode, setPresetCode] = useState('');
  const [presetLabel, setPresetLabel] = useState('');
  const [presetCategory, setPresetCategory] = useState<KategoriPelanggaran>(
    'A. Kedisiplinan & Kehadiran'
  );
  const [presetPoints, setPresetPoints] = useState(10);
  const [presetAction, setPresetAction] = useState('');

  // Rule search filter & inline edit/delete state
  const [ruleSearch, setRuleSearch] = useState('');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editPresetCode, setEditPresetCode] = useState('');
  const [editPresetLabel, setEditPresetLabel] = useState('');
  const [editPresetCategory, setEditPresetCategory] = useState<KategoriPelanggaran>(
    'A. Kedisiplinan & Kehadiran'
  );
  const [editPresetPoints, setEditPresetPoints] = useState(10);
  const [editPresetAction, setEditPresetAction] = useState('');
  const [confirmDeletePresetId, setConfirmDeletePresetId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  const visibleOfficers = useMemo(() => {
    if (!selectedWeekFilter || cycleWeeks <= 1) return appState.officers;
    return appState.officers.filter(
      (o) => !o.scheduledWeeks || o.scheduledWeeks.includes(selectedWeekFilter)
    );
  }, [appState.officers, selectedWeekFilter, cycleWeeks]);

  const filteredPresets = useMemo(() => {
    const q = ruleSearch.trim().toLowerCase();
    if (!q) return appState.presets;
    return appState.presets.filter(
      (p) =>
        p.code.toLowerCase().includes(q) ||
        p.label.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.defaultAction.toLowerCase().includes(q) ||
        String(p.points).includes(q)
    );
  }, [appState.presets, ruleSearch]);

  function startEditPreset(preset: ViolationPreset) {
    setConfirmDeletePresetId(null);
    setEditingPresetId(preset.id);
    setEditPresetCode(preset.code);
    setEditPresetLabel(preset.label);
    setEditPresetCategory(preset.category);
    setEditPresetPoints(preset.points);
    setEditPresetAction(preset.defaultAction);
  }

  async function handleSaveEditPreset(presetId: string) {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/presets/${presetId}`, {
        method: 'PUT',
        body: JSON.stringify({
          code: editPresetCode,
          label: editPresetLabel,
          category: editPresetCategory,
          points: editPresetPoints,
          defaultAction: editPresetAction,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal memperbarui aturan pelanggaran.', 'error');
        return;
      }
      onStateUpdate(data.state);
      setEditingPresetId(null);
      onNotify('Aturan pelanggaran AKPS berhasil diperbarui.', 'success');
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePreset(presetId: string, code: string) {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/presets/${presetId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal menghapus aturan pelanggaran.', 'error');
        return;
      }
      onStateUpdate(data.state);
      setConfirmDeletePresetId(null);
      onNotify(`Aturan pelanggaran ${code} berhasil dihapus.`, 'info');
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
    } finally {
      setSaving(false);
    }
  }

  function startEditOfficer(target: PublicOfficer) {
    setEditingId(target.id);
    setEditDays(target.scheduledDays);
    setEditWeeks(
      target.scheduledWeeks && target.scheduledWeeks.length > 0
        ? target.scheduledWeeks
        : [...ALL_ROTATION_WEEKS]
    );
    setEditStart(target.shiftStart);
    setEditEnd(target.shiftEnd);
  }

  function toggleDay(day: HariPiket, list: HariPiket[], setList: (next: HariPiket[]) => void) {
    if (list.includes(day)) {
      setList(list.filter((d) => d !== day));
    } else {
      setList([...list, day]);
    }
  }

  function toggleEditWeek(weekNum: number) {
    setEditWeeks((prev) => {
      const normalized = prev.filter((w) => w >= 1 && w <= cycleWeeks);
      if (normalized.includes(weekNum)) {
        const next = normalized.filter((w) => w !== weekNum);
        return next.length > 0 ? next : [weekNum];
      }
      return [...normalized, weekNum].sort((a, b) => a - b);
    });
  }

  async function saveOfficerSchedule(targetId: string) {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/officers/${targetId}/schedule`, {
        method: 'PUT',
        body: JSON.stringify({
          scheduledDays: editDays,
          scheduledWeeks: editWeeks,
          shiftStart: editStart,
          shiftEnd: editEnd,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal menyimpan jadwal.', 'error');
        return;
      }
      onStateUpdate(data.state);
      setEditingId(null);
      onNotify('Jadwal mingguan petugas berhasil diperbarui.', 'success');
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateWeeklyCycle(nextCycleWeeks: number, targetActiveWeek?: number) {
    setSaving(true);
    try {
      const res = await apiFetch('/api/settings/weekly-schedule', {
        method: 'POST',
        body: JSON.stringify({
          cycleWeeks: nextCycleWeeks,
          activeWeek: targetActiveWeek,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal memperbarui rotasi mingguan.', 'error');
        return;
      }
      onStateUpdate(data.state);
      onNotify(
        targetActiveWeek
          ? `Jadwal minggu aktif sekarang dipindahkan ke Minggu ke-${targetActiveWeek}.`
          : nextCycleWeeks === 1
            ? 'Jadwal diatur tetap sama setiap minggu.'
            : `Siklus rotasi diatur menjadi ${nextCycleWeeks} minggu bergantian.`,
        'success'
      );
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleAutoDistributeWeeks() {
    setSaving(true);
    try {
      const res = await apiFetch('/api/settings/weekly-schedule/auto-distribute', {
        method: 'POST',
        body: JSON.stringify({ cycleWeeks }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal membagi jadwal petugas otomatis.', 'error');
        return;
      }
      onStateUpdate(data.state);
      onNotify(
        `Semua Petugas Piket berhasil dibagi rata ke ${cycleWeeks} kelompok minggu!`,
        'success'
      );
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDailySession(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch('/api/settings/daily-session', {
        method: 'PUT',
        body: JSON.stringify({
          activeDays: sessionDays,
          startTime: sessionStart,
          endTime: sessionEnd,
          syncOfficers: syncOfficersWithSession,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal menyimpan jadwal otomatis spreadsheet.', 'error');
        return;
      }
      onStateUpdate(data.state);
      onNotify(
        `Jadwal otomatis spreadsheet diperbarui: buka ${sessionStart} WIB, tutup ${sessionEnd} WIB.`,
        'success'
      );
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSimulation(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch('/api/settings/simulation', {
        method: 'POST',
        body: JSON.stringify({
          enabled: simEnabled,
          simulatedTime: simTime,
          simulatedDay: simDay ? (simDay as HariPiket) : null,
          simulatedWeek: simWeek ? Number(simWeek) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal memperbarui simulasi waktu.', 'error');
        return;
      }
      onStateUpdate(data.state);
      onNotify(
        simEnabled
          ? `Mode uji coba waktu diaktifkan (${simWeek ? `Minggu ${simWeek} · ` : ''}${simDay || 'Hari ini'} · ${simTime}).`
          : 'Mode uji coba waktu dimatikan (kembali ke jam normal).',
        'success'
      );
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleChangeOwnPassword(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal memperbarui password.', 'error');
        return;
      }
      onPasswordUpdated(data.token, data.officer, data.state);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onNotify('Password akun Anda berhasil diperbarui. Password lama tidak berlaku lagi.', 'success');
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddPreset(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch('/api/presets', {
        method: 'POST',
        body: JSON.stringify({
          code: presetCode.trim() || undefined,
          label: presetLabel,
          category: presetCategory,
          points: presetPoints,
          defaultAction: presetAction,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal menambah aturan pelanggaran.', 'error');
        return;
      }
      onStateUpdate(data.state);
      setPresetCode('');
      setPresetLabel('');
      setPresetAction('');
      onNotify('Aturan pelanggaran AKPS baru ditambahkan.', 'success');
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="surface-3d animate-stagger-1 rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Jadwal Piket & Aturan Pelanggaran
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Petugas hanya dapat mencatat pelanggaran sesuai hari dan jam piket yang tercantum di bawah.
            </p>
          </div>
          {!canManage && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <Lock className="h-4 w-4" aria-hidden="true" />
              <span>Hanya Developer atau Admin OSIS yang bisa mengubah jadwal dan aturan</span>
            </span>
          )}
        </div>
      </section>

      {/* Automatic Daily Spreadsheet Open/Close Schedule */}
      <section className="surface-3d animate-stagger-2 rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-6">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-600" aria-hidden="true" />
              <h2 className="font-display text-lg font-bold text-slate-900">
                Jadwal Otomatis Buka &amp; Tutup Spreadsheet Harian
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Spreadsheet harian dibuat otomatis sesuai Jam Mulai dan tertutup/final otomatis sesuai Jam Selesai tanpa tombol manual.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded-xl border px-3 py-1.5 font-semibold ${
                autoWindow.phase === 'OPEN'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : autoWindow.phase === 'BEFORE_START'
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : autoWindow.phase === 'CLOSED'
                      ? 'border-slate-200 bg-slate-100 text-slate-700'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              {autoWindow.phase === 'OPEN'
                ? `Sedang Terbuka Otomatis (${autoWindow.startTime}–${autoWindow.endTime} WIB)`
                : autoWindow.phase === 'BEFORE_START'
                  ? `Menunggu Jam Mulai (${autoWindow.startTime} WIB)`
                  : autoWindow.phase === 'CLOSED'
                    ? `Sudah Ditutup Otomatis (${autoWindow.endTime} WIB)`
                    : `Hari ${autoWindow.hari} Tidak Aktif`}
            </span>
          </div>
        </div>

        {canManage ? (
          <form onSubmit={handleSaveDailySession} className="mt-4 space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-700">
                Hari Aktif Pembuatan Spreadsheet Otomatis
              </p>
              <div className="flex flex-wrap gap-2">
                {HARI_LIST.map((day) => {
                  const checked = sessionDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day, sessionDays, setSessionDays)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        checked
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:max-w-lg">
              <div>
                <label
                  htmlFor="daily-session-start"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Jam Mulai (Buka Otomatis)
                </label>
                <input
                  id="daily-session-start"
                  type="time"
                  required
                  value={sessionStart}
                  onChange={(e) => setSessionStart(e.target.value)}
                  className="font-mono-num mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="daily-session-end"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Jam Selesai (Tutup Otomatis)
                </label>
                <input
                  id="daily-session-end"
                  type="time"
                  required
                  value={sessionEnd}
                  onChange={(e) => setSessionEnd(e.target.value)}
                  className="font-mono-num mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={syncOfficersWithSession}
                onChange={(e) => setSyncOfficersWithSession(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <span>Selaraskan jam tugas seluruh petugas &amp; admin dengan jam ini</span>
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="btn-3d-primary inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Simpan Jadwal Otomatis Spreadsheet</span>
              </button>
              <span className="text-xs text-slate-500">
                Saat jam selesai tercapai, file Excel &amp; PDF otomatis terbuka untuk diunduh.
              </span>
            </div>
          </form>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-slate-500">Hari Aktif Otomatis</p>
              <p className="mt-1 font-semibold text-slate-900">
                {(appState.dailySession?.activeDays ?? DEFAULT_DAILY_SESSION_CONFIG.activeDays).join(', ')}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-slate-500">Jam Buka Otomatis</p>
              <p className="font-mono-num mt-1 text-sm font-bold text-slate-900">
                {autoWindow.startTime} WIB
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-slate-500">Jam Tutup Otomatis</p>
              <p className="font-mono-num mt-1 text-sm font-bold text-slate-900">
                {autoWindow.endTime} WIB
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Weekly Rotation Overview & Controls */}
      <section className="surface-3d animate-stagger-3 rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-6">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Repeat className="h-5 w-5 text-blue-600" aria-hidden="true" />
              <h2 className="font-display text-lg font-bold text-slate-900">
                Rotasi Jadwal Piket Per Minggu
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Jadwal petugas berganti otomatis setiap hari Senin pagi sesuai siklus mingguan di bawah.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="rounded-xl border border-blue-200 bg-blue-50/70 px-3.5 py-2">
              <span className="text-slate-600">Aktif Minggu Ini: </span>
              <strong className="text-blue-800">
                Minggu ke-{weekInfo.currentWeek}
              </strong>{' '}
              <span className="font-mono-num text-slate-600">({weekInfo.weekRangeText})</span>
            </div>
            {cycleWeeks > 1 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2">
                <span className="text-slate-600">Minggu Depan: </span>
                <strong className="text-slate-900">Minggu ke-{weekInfo.nextWeek}</strong>{' '}
                <span className="font-mono-num text-slate-500">({weekInfo.nextWeekRangeText})</span>
              </div>
            )}
          </div>
        </div>

        {canManage && (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <div className="w-full sm:w-72">
              <label htmlFor="weekly-cycle-select" className="block text-xs font-medium text-slate-700">
                Panjang Siklus Pergantian
              </label>
              <select
                id="weekly-cycle-select"
                disabled={saving}
                value={cycleWeeks}
                onChange={(e) => handleUpdateWeeklyCycle(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                <option value={2}>2 Minggu (Bergantian Minggu 1 & 2)</option>
                <option value={3}>3 Minggu (Minggu 1, 2, 3)</option>
                <option value={4}>4 Minggu (Minggu 1, 2, 3, 4)</option>
                <option value={1}>1 Minggu (Jadwal Tetap Tiap Minggu)</option>
              </select>
            </div>

            {cycleWeeks > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleUpdateWeeklyCycle(cycleWeeks, weekInfo.nextWeek)}
                  className="btn-3d-soft inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                  <span>Putar ke Minggu ke-{weekInfo.nextWeek} Sekarang</span>
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleAutoDistributeWeeks}
                  className="btn-3d-primary inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Bagi Rata Petugas per Minggu</span>
                </button>
              </div>
            )}
          </div>
        )}

        {cycleWeeks > 1 && (
          <div
            className={`mt-4 grid grid-cols-1 gap-3 ${
              cycleWeeks === 2
                ? 'sm:grid-cols-2'
                : cycleWeeks === 3
                  ? 'sm:grid-cols-3'
                  : 'sm:grid-cols-2 lg:grid-cols-4'
            }`}
          >
            {Array.from({ length: cycleWeeks }, (_, i) => i + 1).map((weekNum) => {
              const isActive = weekNum === weekInfo.currentWeek;
              const isFiltered = selectedWeekFilter === weekNum;
              const weekPetugas = appState.officers.filter(
                (o) =>
                  o.role === 'petugas' &&
                  (!o.scheduledWeeks || o.scheduledWeeks.includes(weekNum))
              );
              return (
                <button
                  key={weekNum}
                  type="button"
                  onClick={() =>
                    setSelectedWeekFilter((prev) => (prev === weekNum ? null : weekNum))
                  }
                  className={`card-3d-interactive rounded-xl border p-3.5 text-left ${
                    isFiltered
                      ? 'border-blue-600 bg-blue-50/75 ring-2 ring-blue-600/15'
                      : isActive
                        ? 'border-blue-300 bg-blue-50/35 hover:border-blue-400'
                        : 'border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-display text-sm font-bold text-slate-900">
                      Minggu ke-{weekNum}
                    </p>
                    <span className="text-[11px] font-semibold text-blue-700">
                      {isFiltered ? 'Difilter' : isActive ? 'Aktif Sekarang' : `${weekPetugas.length} petugas`}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-600">
                    {weekPetugas.length > 0
                      ? weekPetugas.map((p) => p.name).join(', ')
                      : 'Belum ada Petugas Piket di minggu ini'}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Officer Schedule Table */}
      <section className="surface-3d animate-stagger-4 rounded-2xl border border-slate-200/90 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <CalendarDays className="h-5 w-5 text-blue-600" aria-hidden="true" />
            <h2 className="font-display text-lg font-bold text-slate-900">
              Daftar Jadwal Petugas & Pengurus OSIS
            </h2>
            {selectedWeekFilter && (
              <button
                type="button"
                onClick={() => setSelectedWeekFilter(null)}
                className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
              >
                Minggu ke-{selectedWeekFilter} · Tampilkan Semua
              </button>
            )}
          </div>

          {canManage && (
            <button
              type="button"
              onClick={onOpenAccounts}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
            >
              <Users className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
              <span>Tambah / Kelola Akun di Menu Kelola Akun</span>
            </button>
          )}
        </div>

        <div className="divide-y divide-slate-100">
          {visibleOfficers.map((off) => {
            const status = getScheduleStatus(
              off,
              now,
              appState.simulation,
              appState.weeklySchedule
            );
            const isEditing = editingId === off.id;
            const canEditThisSchedule =
              officer.role === 'developer' ||
              (officer.role === 'admin' && off.role === 'petugas');
            const weeksLabel = formatScheduledWeeksLabel(off.scheduledWeeks, cycleWeeks);

            return (
              <div key={off.id} className="p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="font-display text-base font-bold text-slate-900">
                        {off.name}
                      </p>
                      <span className="font-mono-num text-xs text-slate-500">
                        @{off.username}
                      </span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                          off.role === 'developer'
                            ? 'bg-slate-900 text-white'
                            : off.role === 'admin'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {getRoleLabel(off.role)}
                      </span>
                      {(off.division || off.kelas) && (
                        <span className="text-xs text-slate-600">
                          {off.division}
                          {off.kelas ? ` (${off.kelas})` : ''}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      Giliran:{' '}
                      <strong className="text-blue-700">{weeksLabel}</strong> · Hari Piket:{' '}
                      <strong className="text-slate-800">{off.scheduledDays.join(', ')}</strong> ·
                      Shift:{' '}
                      <span className="font-mono-num font-semibold text-slate-800">
                        {off.shiftStart} – {off.shiftEnd}
                      </span>
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-3 sm:justify-end shrink-0">
                    <span
                      className={`text-xs font-semibold ${
                        status.allowed ? 'text-emerald-700' : 'text-slate-500'
                      }`}
                    >
                      {status.allowed ? 'Sedang Bertugas' : 'Di Luar Jadwal'}
                    </span>

                    {canEditThisSchedule && !isEditing && (
                      <button
                        type="button"
                        onClick={() => startEditOfficer(off)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Ubah Jadwal
                      </button>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div className="animate-panel-reveal mt-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    {cycleWeeks > 1 && (
                      <div>
                        <p className="mb-2 text-xs font-semibold text-slate-700">
                          Pilih Minggu Piket
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setEditWeeks([...ALL_ROTATION_WEEKS])}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                              Array.from({ length: cycleWeeks }, (_, i) => i + 1).every((w) =>
                                editWeeks.includes(w)
                              )
                                ? 'border-slate-900 bg-slate-900 text-white'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            Semua Minggu
                          </button>
                          {Array.from({ length: cycleWeeks }, (_, i) => i + 1).map((weekNum) => {
                            const checked = editWeeks.includes(weekNum);
                            return (
                              <button
                                key={weekNum}
                                type="button"
                                onClick={() => toggleEditWeek(weekNum)}
                                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                  checked
                                    ? 'border-blue-600 bg-blue-600 text-white'
                                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                Minggu {weekNum}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div>
                      <p className="mb-2 text-xs font-semibold text-slate-700">Pilih Hari Piket</p>
                      <div className="flex flex-wrap gap-2">
                        {HARI_LIST.map((day) => {
                          const checked = editDays.includes(day);
                          return (
                            <button
                              key={day}
                              type="button"
                              onClick={() => toggleDay(day, editDays, setEditDays)}
                              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                checked
                                  ? 'border-blue-600 bg-blue-600 text-white'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 sm:max-w-xs">
                      <div>
                        <label className="block text-xs font-medium text-slate-700">
                          Jam Mulai
                        </label>
                        <input
                          type="time"
                          value={editStart}
                          onChange={(e) => setEditStart(e.target.value)}
                          className="font-mono-num mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700">
                          Jam Selesai
                        </label>
                        <input
                          type="time"
                          value={editEnd}
                          onChange={(e) => setEditEnd(e.target.value)}
                          className="font-mono-num mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => saveOfficerSchedule(off.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        <Save className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Simpan Jadwal</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Account Password Change (All Users) + Simulation Controls (Managers) */}
      <div className={`grid grid-cols-1 gap-6 ${canManage ? 'lg:grid-cols-2' : ''}`}>
        {/* Change Own Password */}
        <section className="surface-3d rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-blue-600" aria-hidden="true" />
              <h2 className="font-display text-lg font-bold text-slate-900">
                Ubah Password Akun Saya
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setShowSelfPasswords((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              {showSelfPasswords ? (
                <>
                  <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Sembunyikan</span>
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Lihat</span>
                </>
              )}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Ganti password akun Anda (@{officer.username}) agar lebih aman dan mudah diingat. Password lama otomatis tidak berlaku lagi.
          </p>

          <form onSubmit={handleChangeOwnPassword} className="mt-4 space-y-3">
            <div>
              <label htmlFor="self-cur-pw" className="block text-xs font-medium text-slate-700">
                Password Saat Ini
              </label>
              <input
                id="self-cur-pw"
                type={showSelfPasswords ? 'text' : 'password'}
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Masukkan password saat ini"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="self-new-pw" className="block text-xs font-medium text-slate-700">
                  Password Baru (min. 6 karakter)
                </label>
                <input
                  id="self-new-pw"
                  type={showSelfPasswords ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Password baru"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="self-cfm-pw" className="block text-xs font-medium text-slate-700">
                  Konfirmasi Password Baru
                </label>
                <input
                  id="self-cfm-pw"
                  type={showSelfPasswords ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Ulangi password baru"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="btn-3d-soft inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Simpan Password Baru</span>
            </button>
          </form>
        </section>

        {/* Morning Session Simulation (Developer / Admin) */}
        {canManage && (
          <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)] sm:p-6">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-600" aria-hidden="true" />
              <h2 className="font-display text-lg font-bold text-slate-900">
                Buka Akses Uji Coba di Luar Jam Piket
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Aktifkan jika ingin mencoba membuka, mencatat, atau menguji penutupan otomatis di luar jam piket ({autoWindow.startTime}–{autoWindow.endTime} WIB).
            </p>

            <form onSubmit={handleSaveSimulation} className="mt-4 space-y-4">
              <label className="flex items-center gap-2.5 text-sm font-medium text-slate-800">
                <input
                  type="checkbox"
                  checked={simEnabled}
                  onChange={(e) => setSimEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span>Aktifkan Mode Uji Coba Waktu</span>
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="sim-week" className="block text-xs font-medium text-slate-700">
                    Pilih Minggu Uji Coba
                  </label>
                  <select
                    id="sim-week"
                    value={simWeek}
                    onChange={(e) => setSimWeek(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value="">Ikuti Minggu Asli</option>
                    {Array.from({ length: cycleWeeks }, (_, i) => i + 1).map((w) => (
                      <option key={w} value={String(w)}>
                        Minggu ke-{w}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="sim-day" className="block text-xs font-medium text-slate-700">
                    Pilih Hari Uji Coba
                  </label>
                  <select
                    id="sim-day"
                    value={simDay}
                    onChange={(e) => setSimDay(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value="">Ikuti Hari Ini ({appState.serverHari})</option>
                    {SEKOLAH_DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="sim-time" className="block text-xs font-medium text-slate-700">
                    Pilih Jam Uji Coba
                  </label>
                  <input
                    id="sim-time"
                    type="time"
                    value={simTime}
                    onChange={(e) => setSimTime(e.target.value)}
                    className="font-mono-num mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="btn-3d-primary inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <span>Simpan Pengaturan Waktu</span>
              </button>
            </form>
          </section>
        )}
      </div>

      {/* Violation Presets Table + Add Preset */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)] sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Daftar Poin & Aturan Pelanggaran (AKPS)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Daftar resmi bobot poin pelanggaran SMAN 1 Kemangkon (kategori A–F) beserta sanksinya.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="search-akps-rules"
                type="text"
                value={ruleSearch}
                onChange={(e) => setRuleSearch(e.target.value)}
                placeholder="Cari pelanggaran, kode, atau poin..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>
            {ruleSearch && (
              <button
                type="button"
                onClick={() => setRuleSearch('')}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Reset
              </button>
            )}
            <span className="font-mono-num shrink-0 text-xs font-semibold text-slate-500">
              {filteredPresets.length === appState.presets.length
                ? `${appState.presets.length} Aturan`
                : `${filteredPresets.length} dari ${appState.presets.length} Aturan`}
            </span>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[740px] w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="w-20 px-4 py-2.5">Kode</th>
                <th className="px-4 py-2.5">Jenis Pelanggaran</th>
                <th className="px-4 py-2.5">Kategori AKPS</th>
                <th className="px-4 py-2.5 text-right">Angka Kredit</th>
                <th className="px-4 py-2.5">Tindak Lanjut & Catatan</th>
                {canManage && <th className="w-28 px-4 py-2.5 text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPresets.length === 0 ? (
                <tr>
                  <td
                    colSpan={canManage ? 6 : 5}
                    className="px-4 py-8 text-center text-xs text-slate-500"
                  >
                    Tidak ada aturan yang cocok dengan kata kunci &ldquo;{ruleSearch}&rdquo;.
                  </td>
                </tr>
              ) : (
                filteredPresets.map((p) => {
                  const isEditingThis = editingPresetId === p.id;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/60">
                      <td className="font-mono-num px-4 py-2.5 text-xs font-bold text-blue-700">
                        {isEditingThis ? (
                          <input
                            type="text"
                            value={editPresetCode}
                            onChange={(e) => setEditPresetCode(e.target.value)}
                            className="font-mono-num w-16 rounded-lg border border-slate-200 px-2 py-1 text-xs uppercase"
                          />
                        ) : (
                          p.code
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {isEditingThis ? (
                          <input
                            type="text"
                            value={editPresetLabel}
                            onChange={(e) => setEditPresetLabel(e.target.value)}
                            className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs"
                          />
                        ) : (
                          p.label
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">
                        {isEditingThis ? (
                          <select
                            value={editPresetCategory}
                            onChange={(e) =>
                              setEditPresetCategory(e.target.value as KategoriPelanggaran)
                            }
                            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                          >
                            {AKPS_CATEGORIES.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        ) : (
                          p.category
                        )}
                      </td>
                      <td className="font-mono-num px-4 py-2.5 text-right font-semibold text-red-700">
                        {isEditingThis ? (
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={editPresetPoints}
                            onChange={(e) => setEditPresetPoints(Number(e.target.value))}
                            className="font-mono-num w-16 rounded-lg border border-slate-200 px-2 py-1 text-right text-xs"
                          />
                        ) : (
                          `+${p.points}`
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">
                        {isEditingThis ? (
                          <input
                            type="text"
                            value={editPresetAction}
                            onChange={(e) => setEditPresetAction(e.target.value)}
                            className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs"
                          />
                        ) : (
                          p.defaultAction
                        )}
                      </td>
                      {canManage && (
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {isEditingThis ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => handleSaveEditPreset(p.id)}
                                className="rounded-md bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700"
                              >
                                Simpan
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingPresetId(null)}
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                              >
                                Batal
                              </button>
                            </div>
                          ) : confirmDeletePresetId === p.id ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => handleDeletePreset(p.id, p.code)}
                                className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700"
                              >
                                Hapus
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeletePresetId(null)}
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                              >
                                Batal
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center justify-end gap-1">
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => startEditPreset(p)}
                                aria-label={`Edit aturan ${p.code}`}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => setConfirmDeletePresetId(p.id)}
                                aria-label={`Hapus aturan ${p.code}`}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {canManage && (
          <form
            onSubmit={handleAddPreset}
            className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-100 pt-5 sm:grid-cols-12"
          >
            <div className="sm:col-span-2 lg:col-span-1">
              <label htmlFor="pre-code" className="block text-xs font-medium text-slate-700">
                Kode
              </label>
              <input
                id="pre-code"
                type="text"
                value={presetCode}
                onChange={(e) => setPresetCode(e.target.value)}
                placeholder="F5"
                className="font-mono-num mt-1 w-full rounded-xl border border-slate-200 px-2.5 py-2 text-xs uppercase"
              />
            </div>
            <div className="sm:col-span-4 lg:col-span-3">
              <label htmlFor="pre-label" className="block text-xs font-medium text-slate-700">
                Nama Pelanggaran Baru
              </label>
              <input
                id="pre-label"
                type="text"
                required
                value={presetLabel}
                onChange={(e) => setPresetLabel(e.target.value)}
                placeholder="Contoh: Membawa makanan ke lab"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
              />
            </div>
            <div className="sm:col-span-6 lg:col-span-3">
              <label htmlFor="pre-cat" className="block text-xs font-medium text-slate-700">
                Kategori
              </label>
              <select
                id="pre-cat"
                value={presetCategory}
                onChange={(e) => setPresetCategory(e.target.value as KategoriPelanggaran)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                {AKPS_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-3 lg:col-span-1">
              <label htmlFor="pre-pts" className="block text-xs font-medium text-slate-700">
                Poin
              </label>
              <input
                id="pre-pts"
                type="number"
                min={1}
                max={100}
                required
                value={presetPoints}
                onChange={(e) => setPresetPoints(Number(e.target.value))}
                className="font-mono-num mt-1 w-full rounded-xl border border-slate-200 px-2.5 py-2 text-xs"
              />
            </div>
            <div className="sm:col-span-5 lg:col-span-2">
              <label htmlFor="pre-act" className="block text-xs font-medium text-slate-700">
                Tindak Lanjut
              </label>
              <input
                id="pre-act"
                type="text"
                value={presetAction}
                onChange={(e) => setPresetAction(e.target.value)}
                placeholder="Teguran & catat"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
              />
            </div>
            <div className="flex items-end sm:col-span-4 lg:col-span-2">
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Tambah Aturan
              </button>
            </div>
          </form>
        )}

        {/* Official AKPS Sanction Thresholds & Special Confiscation Notes */}
        <div className="mt-6 grid grid-cols-1 gap-6 border-t border-slate-200 pt-5 md:grid-cols-2">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900">
              Sanksi Berdasarkan Akumulasi Angka Kredit
            </h3>
            <div className="mt-2.5 overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                    <th className="w-28 px-3.5 py-2">Akumulasi Poin</th>
                    <th className="px-3.5 py-2">Sanksi Pembinaan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  <tr>
                    <td className="font-mono-num px-3.5 py-2 font-semibold text-slate-900">
                      15 – 25
                    </td>
                    <td className="px-3.5 py-2">Teguran lisan</td>
                  </tr>
                  <tr>
                    <td className="font-mono-num px-3.5 py-2 font-semibold text-amber-700">
                      26 – 50
                    </td>
                    <td className="px-3.5 py-2">Surat pernyataan 1 dan panggilan orang tua 1</td>
                  </tr>
                  <tr>
                    <td className="font-mono-num px-3.5 py-2 font-semibold text-orange-700">
                      51 – 75
                    </td>
                    <td className="px-3.5 py-2">Surat pernyataan 2 dan panggilan orang tua 2</td>
                  </tr>
                  <tr>
                    <td className="font-mono-num px-3.5 py-2 font-semibold text-red-700">
                      76 – 99
                    </td>
                    <td className="px-3.5 py-2">Panggilan orang tua 3</td>
                  </tr>
                  <tr>
                    <td className="font-mono-num px-3.5 py-2 font-bold text-red-800">≥ 100</td>
                    <td className="px-3.5 py-2 font-medium">
                      Membuat Surat Pernyataan Bermaterai
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="font-display text-sm font-bold text-slate-900">
              Catatan Khusus Penyitaan & Kebijakan AKPS
            </h3>
            <ul className="mt-2.5 space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
              <li>
                <strong className="font-mono-num text-blue-700">Pelanggaran E2:</strong> Dilakukan
                penyitaan HP sampai rambut siswa putra sesuai aturan sekolah (tidak gondrong, tidak
                berkucir, dan tidak disemir).
              </li>
              <li>
                <strong className="font-mono-num text-blue-700">Pelanggaran E4:</strong> Dilakukan
                penyitaan HP selama 1 minggu untuk siswa putri yang memakai lipstik, pensil alis,
                eyeshadow, blush on, kerudung model marsha, atau aksesoris kuku.
              </li>
              <li className="text-slate-600">
                Poin-poin pelanggaran dapat disesuaikan dengan kebijakan sekolah dan tingkat
                pelanggaran yang terjadi. Sistem AKPS bertujuan untuk pembinaan, mendidik, dan
                mendorong siswa agar selalu berperilaku baik, disiplin, dan mematuhi aturan sekolah.
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
