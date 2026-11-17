import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import * as XLSX from 'xlsx';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cloud,
  Copy,
  Download,
  FileSpreadsheet,
  KeyRound,
  Lock,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Shield,
  Trash2,
  Upload,
  UserPlus,
  Wrench,
  X,
} from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { apiFetch } from '../lib/apiClient';
import {
  auth,
  extractBackupPayloadFromDigestAsync,
  fetchUserCloudBackups,
  getDisplaySummaryDigest,
  hasEmbeddedBackupDigest,
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
  canEditAccountProfile,
  formatScheduledWeeksLabel,
  getRoleLabel,
  paginateItems,
  parseBulkAccountEntries,
} from '../shared/piketLogic';
import {
  parseAccountImportRows,
  type ParsedAccountImportResult,
} from '../shared/accountImportLogic';
import { PaginationBar } from './PaginationBar';
import type {
  GeneratedAccountCredential,
  HariPiket,
  PublicAppState,
  PublicOfficer,
  RolePetugas,
  SystemBackupPayload,
} from '../shared/types';
import {
  downloadAccountImportTemplateXlsx,
  downloadAccountsCredentialsCsv,
  downloadAccountsCredentialsXlsx,
  downloadRegisteredAccountsDirectoryXlsx,
} from '../utils/exportSpreadsheet';
import { downloadUsageGuidePdf } from '../utils/exportGuidePdf';
import { AnimatedNumber } from './AnimatedNumber';
import { Tilt3DCard } from './Tilt3DCard';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'OS';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

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

  // Bulk & Excel account creation state
  const [createMode, setCreateMode] = useState<'manual' | 'excel'>('manual');
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

  // Excel account import state
  const [excelRawRows, setExcelRawRows] = useState<unknown[][] | null>(null);
  const [excelFileName, setExcelFileName] = useState('');
  const [isDraggingExcel, setIsDraggingExcel] = useState(false);
  const [forceChangeExplicit, setForceChangeExplicit] = useState(false);
  const [showSkippedExcelRows, setShowSkippedExcelRows] = useState(false);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  // Latest generated credentials batch (contains plaintext temporaryPassword shown once for export)
  const [generatedBatch, setGeneratedBatch] = useState<GeneratedAccountCredential[]>([]);

  // Two-step inline delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Inline account profile edit state
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editAccName, setEditAccName] = useState('');
  const [editAccKelas, setEditAccKelas] = useState('');
  const [editAccDivision, setEditAccDivision] = useState('');
  const [editAccRole, setEditAccRole] = useState<'admin' | 'petugas'>('petugas');

  // Collapsible secondary sections to keep directory accessible without excessive scrolling
  const [showBulkForm, setShowBulkForm] = useState(true);
  const [showDevTools, setShowDevTools] = useState(false);

  // Account directory search, role filter & pagination
  const [accountSearch, setAccountSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | RolePetugas>('ALL');
  const [accountPage, setAccountPage] = useState(1);
  const [accountPageSize, setAccountPageSize] = useState<number | 'ALL'>(10);

  // Developer system reset state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resettingAll, setResettingAll] = useState(false);

  // Firebase Cloud Sync & Local JSON Backup/Restore state
  const [firebaseUser, setFirebaseUser] = useState<User | null>(auth.currentUser);
  const [cloudBackups, setCloudBackups] = useState<CloudBackupSummary[]>([]);
  const [syncingCloud, setSyncingCloud] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [confirmRestoreBackupId, setConfirmRestoreBackupId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const parsedExcelResult: ParsedAccountImportResult | null = useMemo(() => {
    if (!excelRawRows) return null;
    return parseAccountImportRows(excelRawRows, {
      defaultRole: targetRole,
      defaultDivision: division,
      defaultKelas,
      defaultDays: scheduledDays,
      defaultWeeks:
        targetRole === 'admin' || rotationMode === 'all'
          ? ALL_ROTATION_WEEKS
          : scheduledWeeks,
      defaultShiftStart: shiftStart,
      defaultShiftEnd: shiftEnd,
      cycleWeeks,
      allowAdminRole: isDeveloper,
    });
  }, [
    excelRawRows,
    targetRole,
    division,
    defaultKelas,
    scheduledDays,
    rotationMode,
    scheduledWeeks,
    shiftStart,
    shiftEnd,
    cycleWeeks,
    isDeveloper,
  ]);

  const existingUsernameSet = useMemo(
    () => new Set(appState.officers.map((o) => o.username.toLowerCase())),
    [appState.officers]
  );

  const filteredOfficers = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    return appState.officers.filter((acc) => {
      if (roleFilter !== 'ALL' && acc.role !== roleFilter) return false;
      if (!q) return true;
      return (
        acc.name.toLowerCase().includes(q) ||
        acc.username.toLowerCase().includes(q) ||
        acc.kelas.toLowerCase().includes(q) ||
        acc.division.toLowerCase().includes(q) ||
        getRoleLabel(acc.role).toLowerCase().includes(q)
      );
    });
  }, [appState.officers, accountSearch, roleFilter]);

  const paginatedOfficers = useMemo(
    () => paginateItems(filteredOfficers, accountPage, accountPageSize),
    [filteredOfficers, accountPage, accountPageSize]
  );

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

  async function processExcelAccountFile(file: File) {
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = wb.SheetNames[0];
      if (!firstSheetName) {
        onNotify('File Excel tidak memiliki sheet yang bisa dibaca.', 'error');
        return;
      }
      const ws = wb.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        raw: false,
        defval: '',
      });
      setExcelRawRows(rows);
      setExcelFileName(file.name);
      setShowSkippedExcelRows(false);

      const preview = parseAccountImportRows(rows, {
        defaultRole: targetRole,
        defaultDivision: division,
        defaultKelas,
        defaultDays: scheduledDays,
        defaultWeeks:
          targetRole === 'admin' || rotationMode === 'all'
            ? ALL_ROTATION_WEEKS
            : scheduledWeeks,
        defaultShiftStart: shiftStart,
        defaultShiftEnd: shiftEnd,
        cycleWeeks,
        allowAdminRole: isDeveloper,
      });

      if (preview.entries.length === 0) {
        onNotify(
          'Tidak ditemukan baris akun valid di file Excel. Pastikan ada kolom Nama Lengkap.',
          'error'
        );
      } else {
        onNotify(
          `${preview.entries.length} akun siap diimpor dari "${file.name}"${
            preview.skipped.length > 0 ? ` (${preview.skipped.length} baris dilewati)` : ''
          }.`,
          'success'
        );
      }
    } catch {
      onNotify('Gagal membaca file Excel/CSV. Pastikan formatnya .xlsx, .xls, atau .csv.', 'error');
    }
  }

  function handleExcelFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void processExcelAccountFile(file);
  }

  function handleExcelDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDraggingExcel(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    void processExcelAccountFile(file);
  }

  function handleClearExcelPreview() {
    setExcelRawRows(null);
    setExcelFileName('');
    setShowSkippedExcelRows(false);
  }

  async function handleImportExcelAccounts() {
    if (!parsedExcelResult || parsedExcelResult.entries.length === 0 || submitting) return;

    const entriesToImport = parsedExcelResult.entries.slice(0, 200);
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/accounts/import', {
        method: 'POST',
        body: JSON.stringify({
          entries: entriesToImport.map((item) => ({
            name: item.name,
            username: item.username,
            password: item.password,
            role: item.role,
            division: item.division,
            kelas: item.kelas,
            scheduledDays: item.scheduledDays,
            scheduledWeeks: item.scheduledWeeks,
            shiftStart: item.shiftStart,
            shiftEnd: item.shiftEnd,
          })),
          forcePasswordChangeForExplicit: forceChangeExplicit,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal mengimpor akun dari Excel.', 'error');
        return;
      }

      onStateUpdate(data.state);
      const createdCreds = Array.isArray(data.credentials)
        ? (data.credentials as GeneratedAccountCredential[])
        : [];
      if (createdCreds.length > 0) {
        setGeneratedBatch(createdCreds);
      }
      handleClearExcelPreview();
      const skippedServer = Array.isArray(data.skipped) ? data.skipped.length : 0;
      onNotify(
        `${createdCreds.length} akun dari Excel berhasil dibuat${
          skippedServer > 0 ? ` (${skippedServer} dilewati karena bentrok username)` : ''
        }! Daftar kredensial siap disalin/unduh di bawah.`,
        'success'
      );
    } catch {
      onNotify('Gagal terhubung ke server saat mengimpor Excel.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function startEditAccount(target: PublicOfficer) {
    setConfirmDeleteId(null);
    setEditingAccountId(target.id);
    setEditAccName(target.name);
    setEditAccKelas(target.kelas);
    setEditAccDivision(target.division);
    setEditAccRole(target.role === 'admin' ? 'admin' : 'petugas');
  }

  async function handleSaveAccountProfile(targetId: string) {
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/accounts/${targetId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editAccName,
          kelas: editAccKelas,
          division: editAccDivision,
          role: isDeveloper ? editAccRole : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal memperbarui profil akun.', 'error');
        return;
      }
      onStateUpdate(data.state);
      setEditingAccountId(null);
      onNotify('Profil akun berhasil diperbarui.', 'success');
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
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
      let exportedBackup: SystemBackupPayload | undefined;
      try {
        const expRes = await apiFetch('/api/backup/export');
        if (expRes.ok) {
          const expData = await expRes.json();
          exportedBackup = expData.backup;
        }
      } catch {
        // fallback to public state snapshot
      }
      const saved = await syncSnapshotToFirestore(officer.role, appState, exportedBackup);
      const list = await fetchUserCloudBackups();
      setCloudBackups(list);
      if (saved.restoreEmbedded === false) {
        onNotify(
          `Ringkasan disimpan ke Google (${saved.id}), tetapi data penuh melebihi batas ukuran Cloud — unduh juga file Cadangan (.json) lokal.`,
          'info'
        );
      } else {
        onNotify(
          `Cadangan data berhasil disimpan ke akun Google Anda (${saved.id}).`,
          'success'
        );
      }
    } catch (err: any) {
      onNotify(err?.message || 'Gagal menyimpan cadangan online.', 'error');
    } finally {
      setSyncingCloud(false);
    }
  }

  async function handleDownloadLocalBackupJson() {
    setSyncingCloud(true);
    try {
      const res = await apiFetch('/api/backup/export');
      const data = await res.json();
      if (!res.ok || !data.backup) {
        onNotify(data.error || 'Gagal mengunduh cadangan sistem.', 'error');
        return;
      }
      const blob = new Blob([JSON.stringify(data.backup, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Cadangan-SiPiket-OSIS-${appState.serverDate}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onNotify(`File Cadangan-SiPiket-OSIS-${appState.serverDate}.json berhasil diunduh.`, 'success');
    } catch {
      onNotify('Gagal mengunduh file cadangan.', 'error');
    } finally {
      setSyncingCloud(false);
    }
  }

  async function handleRestoreBackupPayload(payload: SystemBackupPayload, sourceLabel: string) {
    setRestoringBackup(true);
    try {
      const res = await apiFetch('/api/backup/restore', {
        method: 'POST',
        body: JSON.stringify({ backup: payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal memulihkan cadangan data.', 'error');
        return;
      }
      onStateUpdate(data.state);
      setConfirmRestoreBackupId(null);
      const restoredCreds = Array.isArray(data.restoredCredentials)
        ? (data.restoredCredentials as GeneratedAccountCredential[])
        : [];
      if (restoredCreds.length > 0) {
        setGeneratedBatch(restoredCreds);
      }
      onNotify(
        restoredCreds.length > 0
          ? `Berhasil memulihkan ${data.restoredSpreadsheets} spreadsheet, ${data.restoredViolations} pelanggaran, & ${data.restoredAccounts} akun. Password sementara akun baru ditampilkan di bawah.`
          : `Berhasil memulihkan ${data.restoredSpreadsheets} spreadsheet, ${data.restoredViolations} catatan pelanggaran, & ${data.restoredAccounts} akun dari ${sourceLabel}.`,
        'success'
      );
    } catch {
      onNotify('Gagal terhubung ke server saat memulihkan cadangan.', 'error');
    } finally {
      setRestoringBackup(false);
    }
  }

  async function handleRestoreCloudBackup(backup: CloudBackupSummary) {
    setRestoringBackup(true);
    try {
      const parsed = await extractBackupPayloadFromDigestAsync(backup.summaryDigest);
      if (!parsed) {
        onNotify(
          'Cadangan Cloud ini hanya menyimpan ringkasan atau gagal didekompresi. Gunakan file Cadangan (.json) lokal.',
          'error'
        );
        return;
      }
      await handleRestoreBackupPayload(parsed, `Cloud ${backup.id}`);
    } finally {
      setRestoringBackup(false);
    }
  }

  function handleImportBackupFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? '')) as SystemBackupPayload;
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.spreadsheets)) {
          onNotify('File JSON tidak valid sebagai cadangan SiPiket OSIS.', 'error');
          return;
        }
        void handleRestoreBackupPayload(parsed, `file ${file.name}`);
      } catch {
        onNotify('Gagal membaca file JSON cadangan.', 'error');
      }
    };
    reader.readAsText(file);
  }

  function handleDownloadGuidePdf() {
    try {
      downloadUsageGuidePdf({
        serverDate: appState.serverDate,
        serverHari: appState.serverHari,
        developerName: officer.name,
      });
      onNotify('Berhasil mengunduh Panduan-Penggunaan-SiPiket-OSIS.pdf', 'success');
    } catch (err: any) {
      onNotify(err?.message || 'Gagal membuat PDF panduan.', 'error');
    }
  }

  async function handleResetAllSystemData(e: FormEvent) {
    e.preventDefault();
    if (!isDeveloper) return;
    if (resetConfirmText.trim().toUpperCase() !== 'RESET DATA') {
      onNotify('Ketik RESET DATA dengan benar untuk mengonfirmasi reset seluruh sistem.', 'error');
      return;
    }

    setResettingAll(true);
    try {
      const res = await apiFetch('/api/developer/reset-all', {
        method: 'POST',
        body: JSON.stringify({ confirmText: resetConfirmText }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Gagal mereset data sistem.', 'error');
        return;
      }
      onStateUpdate(data.state);
      setGeneratedBatch([]);
      setEditingAccountId(null);
      setConfirmDeleteId(null);
      setConfirmRestoreBackupId(null);
      setShowResetConfirm(false);
      setResetConfirmText('');
      onNotify(
        `Reset selesai! ${data.deletedAccounts} akun lain, ${data.deletedSpreadsheets} spreadsheet, dan ${data.deletedViolations} pelanggaran dihapus. Akun Developer Anda tetap aman.`,
        'success'
      );
    } catch {
      onNotify('Gagal terhubung ke server saat mereset sistem.', 'error');
    } finally {
      setResettingAll(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Summary & Compact Tool Toggles */}
      <section className="surface-3d animate-stagger-1 rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Kelola Akun Pengurus & Petugas
            </h1>
            <p className="mt-0.5 text-xs text-slate-600 sm:text-sm">
              Total{' '}
              <strong className="font-mono-num text-slate-900">
                <AnimatedNumber value={appState.officers.length} />
              </strong>{' '}
              akun terdaftar · Jabatan Anda:{' '}
              <strong className="text-blue-700">{getRoleLabel(officer.role)}</strong>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              aria-expanded={showBulkForm}
              onClick={() => setShowBulkForm((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                showBulkForm
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
              }`}
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{showBulkForm ? 'Tutup Form Buat Akun' : 'Tambah / Upload Akun Excel'}</span>
              {showBulkForm ? (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </motion.button>

            {isDeveloper && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                aria-expanded={showDevTools}
                onClick={() => setShowDevTools((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                  showDevTools
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{showDevTools ? 'Tutup Alat Developer' : 'Alat & Cadangan Developer'}</span>
              </motion.button>
            )}
          </div>
        </div>
      </section>

      {/* Developer Control Panel (Collapsible for Developer role) */}
      <AnimatePresence initial={false}>
      {isDeveloper && showDevTools && (
        <motion.section
          key="dev-tools-panel"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.22 }}
          aria-label="Panel Khusus Developer"
          className="surface-3d rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6"
        >
          <div className="flex flex-col gap-1 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Panel Khusus Developer
              </h2>
              <p className="text-xs text-slate-500">
                Alat khusus Developer untuk membagikan panduan penggunaan website serta membersihkan seluruh data operasional tanpa menghapus akun Anda sendiri.
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-700 shrink-0">
              Akses Penuh Developer
            </span>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Card 1: PDF Usage Guide */}
            <Tilt3DCard
              maxTiltDeg={4}
              scaleOnHover={1.008}
              className="flex flex-col justify-between rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50/70 via-white to-slate-50/60 p-4 sm:p-5"
            >
              <div>
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-blue-600" aria-hidden="true" />
                  <h3 className="font-display text-base font-bold text-slate-900">
                    Panduan Penggunaan Website (PDF)
                  </h3>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                  Unduh buku panduan lengkap siap cetak/bagikan via WhatsApp berisi alur piket harian,
                  aktivasi password baru, tabel sanksi poin AKPS, rotasi mingguan, dan FAQ petugas.
                </p>
              </div>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={handleDownloadGuidePdf}
                  className="btn-3d-primary inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>Unduh Panduan Penggunaan (.pdf)</span>
                </button>
              </div>
            </Tilt3DCard>

            {/* Card 2: Reset / Delete All System Data Except Self */}
            <Tilt3DCard
              maxTiltDeg={4}
              scaleOnHover={1.008}
              className="flex flex-col justify-between rounded-xl border border-red-200/80 bg-red-50/35 p-4 sm:p-5"
            >
              <div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden="true" />
                  <h3 className="font-display text-base font-bold text-red-950">
                    Reset / Hapus Semua Data Sistem
                  </h3>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-red-900/90">
                  Menghapus <strong>seluruh akun Admin &amp; Petugas lain</strong>, semua catatan
                  pelanggaran, arsip spreadsheet, serta mereset aturan tambahan &amp; simulasi waktu.{' '}
                  <strong>Akun Developer Anda (@{officer.username}) tetap aman</strong> dan akun lain
                  yang sedang aktif akan otomatis keluar (logout).
                </p>
              </div>

              {!showResetConfirm ? (
                <div className="mt-4">
                  <button
                    type="button"
                    disabled={resettingAll}
                    onClick={() => {
                      setShowResetConfirm(true);
                      setResetConfirmText('');
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    <span>Reset Semua Data (Kecuali Akun Saya)</span>
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={handleResetAllSystemData}
                  className="animate-panel-reveal mt-4 space-y-2.5 rounded-xl border border-red-200 bg-white p-3.5"
                >
                  <label
                    htmlFor="confirm-reset-all-input"
                    className="block text-xs font-semibold text-red-900"
                  >
                    Ketik <span className="font-mono-num">RESET DATA</span> untuk konfirmasi:
                  </label>
                  <input
                    id="confirm-reset-all-input"
                    type="text"
                    required
                    disabled={resettingAll}
                    value={resetConfirmText}
                    onChange={(e) => setResetConfirmText(e.target.value)}
                    placeholder="RESET DATA"
                    className="font-mono-num w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold uppercase text-slate-900 focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-600/15"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="submit"
                      disabled={resettingAll || resetConfirmText.trim().toUpperCase() !== 'RESET DATA'}
                      className="btn-3d-danger inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{resettingAll ? 'Mereset Sistem...' : 'Ya, Hapus & Reset Semua'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={resettingAll}
                      onClick={() => {
                        setShowResetConfirm(false);
                        setResetConfirmText('');
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Batal
                    </button>
                  </div>
                </form>
              )}
            </Tilt3DCard>
          </div>
        </motion.section>
      )}
      </AnimatePresence>

      {/* Account Creation Form: Ketik Cepat OR Upload Excel */}
      <AnimatePresence initial={false}>
      {showBulkForm && (
      <motion.section
        key="account-creation-panel"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.22 }}
        className="surface-3d rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6"
      >
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            {createMode === 'excel' ? (
              <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
            ) : (
              <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
            )}
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                {createMode === 'excel'
                  ? 'Upload Data Akun dari Excel (.xlsx / .csv)'
                  : 'Buat Banyak Akun Sekaligus (Ketik Cepat)'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {createMode === 'excel'
                  ? 'Unggah file Excel berisi kolom Nama Lengkap, Username, Password, dan Jadwal Piket. Kolom yang dikosongkan otomatis mengikuti pengaturan default.'
                  : 'Ketik atau tempel daftar nama lengkap (satu nama tiap baris, opsional | Kelas). Username & password awal dibuat otomatis.'}
              </p>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Metode tambah akun"
            className="inline-flex self-start items-center gap-1 rounded-xl bg-slate-100 p-1 shrink-0"
          >
            {(
              [
                { id: 'manual', label: 'Ketik Nama Cepat' },
                { id: 'excel', label: 'Upload Data Excel' },
              ] as const
            ).map((tab) => {
              const active = createMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCreateMode(tab.id)}
                  className={`relative rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    active ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="account-create-mode"
                      transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                      className="absolute inset-0 rounded-lg bg-white shadow-sm"
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
        {createMode === 'excel' ? (
          <motion.div
            key="excel-import-tab"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="mt-5 space-y-5"
          >
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-900">
                  Format Kolom Excel yang Didukung Otomatis:
                </p>
                <p className="text-xs leading-relaxed text-slate-600">
                  <strong>Wajib:</strong> <code className="rounded bg-white px-1 py-0.5">Nama Lengkap</code>.{' '}
                  <strong>Opsional:</strong>{' '}
                  <code className="rounded bg-white px-1 py-0.5">Username</code>,{' '}
                  <code className="rounded bg-white px-1 py-0.5">Password</code>,{' '}
                  <code className="rounded bg-white px-1 py-0.5">Jadwal Piket</code> (mis. Senin, Rabu),{' '}
                  <code className="rounded bg-white px-1 py-0.5">Minggu Piket</code>,{' '}
                  <code className="rounded bg-white px-1 py-0.5">Jam Shift</code>,{' '}
                  <code className="rounded bg-white px-1 py-0.5">Role</code>,{' '}
                  <code className="rounded bg-white px-1 py-0.5">Kelas</code>,{' '}
                  <code className="rounded bg-white px-1 py-0.5">Divisi</code>.
                </p>
              </div>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => downloadAccountImportTemplateXlsx(cycleWeeks)}
                className="btn-3d-soft inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                <span>Unduh Template Excel (.xlsx)</span>
              </motion.button>
            </div>

            <input
              ref={excelInputRef}
              id="account-excel-file-input"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleExcelFileChange}
              className="hidden"
            />

            <motion.div
              animate={{
                scale: isDraggingExcel ? 1.01 : 1,
                borderColor: isDraggingExcel ? '#2563EB' : undefined,
              }}
              transition={{ type: 'spring', stiffness: 360, damping: 24 }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingExcel(true);
              }}
              onDragLeave={() => setIsDraggingExcel(false)}
              onDrop={handleExcelDrop}
              onClick={() => excelInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  excelInputRef.current?.click();
                }
              }}
              className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
                isDraggingExcel
                  ? 'border-blue-600 bg-blue-50/70'
                  : 'border-slate-300 bg-slate-50/40 hover:border-blue-400 hover:bg-blue-50/30'
              }`}
            >
              <Upload
                className={`mx-auto h-7 w-7 ${
                  isDraggingExcel ? 'text-blue-600' : 'text-slate-400'
                }`}
                aria-hidden="true"
              />
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {excelFileName
                  ? `File terpasang: ${excelFileName}`
                  : 'Klik di sini atau seret file Excel akun (.xlsx / .xls / .csv)'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {excelFileName
                  ? 'Klik ulang untuk mengganti file lain, atau periksa pratinjau di bawah sebelum menyimpan.'
                  : 'Maksimal 200 akun per unggahan. Baris dengan Username/Password kosong akan dibuatkan otomatis.'}
              </p>
            </motion.div>

            {/* Fallback Default Settings & Options for Excel Import */}
            <details className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-700 select-none">
                Pengaturan Default Jika Kolom di Excel Kosong ({getRoleLabel(targetRole)} · {defaultKelas} · {shiftStart}–{shiftEnd})
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-4">
                <div>
                  <label htmlFor="excel-def-role" className="block text-[11px] font-medium text-slate-600">
                    Role Default
                  </label>
                  <select
                    id="excel-def-role"
                    value={targetRole}
                    onChange={(e) => setTargetRole(e.target.value as 'admin' | 'petugas')}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                  >
                    <option value="petugas">Petugas Piket</option>
                    {isDeveloper && <option value="admin">Admin OSIS</option>}
                  </select>
                </div>
                <div>
                  <label htmlFor="excel-def-kelas" className="block text-[11px] font-medium text-slate-600">
                    Kelas Default
                  </label>
                  <input
                    id="excel-def-kelas"
                    type="text"
                    value={defaultKelas}
                    onChange={(e) => setDefaultKelas(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label htmlFor="excel-def-start" className="block text-[11px] font-medium text-slate-600">
                    Jam Mulai Default
                  </label>
                  <input
                    id="excel-def-start"
                    type="time"
                    value={shiftStart}
                    onChange={(e) => setShiftStart(e.target.value)}
                    className="font-mono-num mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="excel-def-end" className="block text-[11px] font-medium text-slate-600">
                    Jam Selesai Default
                  </label>
                  <input
                    id="excel-def-end"
                    type="time"
                    value={shiftEnd}
                    onChange={(e) => setShiftEnd(e.target.value)}
                    className="font-mono-num mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>
            </details>

            <AnimatePresence>
              {parsedExcelResult && (
                <motion.div
                  key="excel-preview-box"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex flex-col gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm font-bold text-slate-900">
                        Pratinjau Data Excel ({parsedExcelResult.entries.length} Akun Siap Diimpor)
                      </p>
                      <p className="text-xs text-slate-500">
                        {parsedExcelResult.headerRowNumber
                          ? `Header terdeteksi pada baris ${parsedExcelResult.headerRowNumber}. `
                          : ''}
                        {parsedExcelResult.skipped.length > 0 && (
                          <span className="font-semibold text-amber-700">
                            {parsedExcelResult.skipped.length} baris dilewati.
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {parsedExcelResult.skipped.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowSkippedExcelRows((prev) => !prev)}
                          className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                        >
                          {showSkippedExcelRows
                            ? 'Tutup Baris Dilewati'
                            : `Lihat ${parsedExcelResult.skipped.length} Baris Dilewati`}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleClearExcelPreview}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Batal</span>
                      </button>
                    </div>
                  </div>

                  <AnimatePresence>
                    {showSkippedExcelRows && parsedExcelResult.skipped.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <ul className="max-h-36 overflow-y-auto divide-y divide-amber-100 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
                          {parsedExcelResult.skipped.map((sk) => (
                            <li key={`${sk.rowNumber}-${sk.reason}`} className="py-1">
                              <strong className="font-mono-num">Baris {sk.rowNumber}</strong>
                              {sk.name ? ` (${sk.name})` : ''}: {sk.reason}
                            </li>
                          ))}
                        </ul>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {parsedExcelResult.entries.length > 0 && (
                    <>
                      <div className="max-h-64 overflow-auto rounded-xl border border-slate-200">
                        <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                          <thead className="sticky top-0 bg-slate-50 text-slate-600">
                            <tr className="border-b border-slate-200 font-semibold">
                              <th className="px-3 py-2 w-10">No</th>
                              <th className="px-3 py-2">Nama Lengkap</th>
                              <th className="px-3 py-2">Username</th>
                              <th className="px-3 py-2">Password</th>
                              <th className="px-3 py-2">Role &amp; Kelas</th>
                              <th className="px-3 py-2">Jadwal Piket</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {parsedExcelResult.entries.slice(0, 200).map((row, idx) => {
                              const alreadyExists =
                                Boolean(row.username) &&
                                existingUsernameSet.has(row.username!.toLowerCase());
                              return (
                                <tr
                                  key={`${row.rowNumber}-${row.name}`}
                                  className={alreadyExists ? 'bg-amber-50/60' : 'hover:bg-slate-50/70'}
                                >
                                  <td className="font-mono-num px-3 py-2 text-slate-500">{idx + 1}</td>
                                  <td className="px-3 py-2 font-medium text-slate-900">{row.name}</td>
                                  <td className="font-mono-num px-3 py-2">
                                    {row.username ? (
                                      <span className={alreadyExists ? 'font-bold text-amber-700' : 'font-semibold text-blue-700'}>
                                        @{row.username}
                                        {alreadyExists ? ' (sudah ada)' : ''}
                                      </span>
                                    ) : (
                                      <span className="italic text-slate-400">Otomatis</span>
                                    )}
                                  </td>
                                  <td className="font-mono-num px-3 py-2 text-slate-700">
                                    {row.password ? '•••••• (dari Excel)' : (
                                      <span className="italic text-slate-400">Otomatis</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-slate-700">
                                    {getRoleLabel(row.role)} · <span className="font-mono-num">{row.kelas}</span>
                                  </td>
                                  <td className="px-3 py-2 text-slate-600">
                                    <span className="font-semibold text-blue-700">
                                      {formatScheduledWeeksLabel(row.scheduledWeeks, cycleWeeks)}
                                    </span>{' '}
                                    · {row.scheduledDays.join(', ')} ({row.shiftStart}–{row.shiftEnd})
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={forceChangeExplicit}
                          onChange={(e) => setForceChangeExplicit(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
                        />
                        <span>
                          Wajibkan akun yang sudah diberi password di Excel untuk mengganti password saat login pertama
                          <span className="text-slate-500">
                            {' '}(akun dengan password otomatis selalu wajib ganti saat login pertama).
                          </span>
                        </span>
                      </label>

                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.985 }}
                        disabled={submitting}
                        onClick={handleImportExcelAccounts}
                        className="btn-3d-primary flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        <span>
                          {submitting
                            ? 'Mengimpor Akun ke Sistem...'
                            : `Simpan ${Math.min(200, parsedExcelResult.entries.length)} Akun dari Excel`}
                        </span>
                      </motion.button>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
        <motion.form
          key="manual-bulk-form"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          onSubmit={handleBulkCreate}
          className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12"
        >
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

            <motion.button
              type="submit"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.985 }}
              disabled={submitting || parsedEntries.length === 0}
              className="btn-3d-primary flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              <span>
                {submitting
                  ? 'Sedang Membuat Akun...'
                  : `Buat ${parsedEntries.length || ''} Akun & Password Otomatis`}
              </span>
            </motion.button>
          </div>
        </motion.form>
        )}
        </AnimatePresence>
      </motion.section>
      )}
      </AnimatePresence>

      {/* Newly Generated Credentials Export Panel */}
      <AnimatePresence>
      {generatedBatch.length > 0 && (
        <motion.section
          key="generated-creds-panel"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.22 }}
          className="rounded-2xl border border-emerald-200 bg-white p-5 sm:p-6"
        >
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
        </motion.section>
      )}
      </AnimatePresence>

      {/* Registered Accounts Directory */}
      <section className="surface-3d animate-stagger-4 rounded-2xl border border-slate-200/90 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Daftar Akun Terdaftar
            </h2>
            <p className="text-xs text-slate-500">
              Menampilkan <strong className="font-mono-num text-slate-700">{filteredOfficers.length}</strong> dari{' '}
              <strong className="font-mono-num text-slate-700">{appState.officers.length}</strong> akun · Akun
              Developer utama dilindungi sistem.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex items-center gap-1 self-start rounded-lg bg-slate-100 p-1">
              {(
                [
                  { id: 'ALL', label: 'Semua' },
                  { id: 'petugas', label: 'Petugas' },
                  { id: 'admin', label: 'Admin' },
                  { id: 'developer', label: 'Dev' },
                ] as const
              ).map((item) => {
                const active = roleFilter === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setRoleFilter(item.id);
                      setAccountPage(1);
                    }}
                    className={`relative rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      active ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="account-role-filter"
                        transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                        className="absolute inset-0 rounded-md bg-white shadow-sm"
                        aria-hidden="true"
                      />
                    )}
                    <span className="relative z-10">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="relative w-full sm:w-52">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Cari akun pengurus atau petugas"
                value={accountSearch}
                onChange={(e) => {
                  setAccountSearch(e.target.value);
                  setAccountPage(1);
                }}
                placeholder="Cari nama / username..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>
            <button
              type="button"
              onClick={() =>
                downloadRegisteredAccountsDirectoryXlsx(appState.officers, appState.serverDate)
              }
              className="btn-3d-soft inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Unduh (.xlsx)</span>
            </button>
          </div>
        </div>

        {/* Desktop & Tablet Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="px-4 py-2.5">Nama & Kelas</th>
                <th className="px-4 py-2.5">Username</th>
                <th className="px-4 py-2.5">Jabatan</th>
                <th className="px-4 py-2.5">Status Password</th>
                <th className="px-4 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedOfficers.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-500">
                    Tidak ada akun yang cocok dengan filter atau pencarian tersebut.
                  </td>
                </tr>
              ) : (
                paginatedOfficers.items.map((acc) => {
                  const deletable = canDeleteAccount(officer.role, acc);
                  const editable = canEditAccountProfile(officer.role, officer.id, acc);
                  const resettable =
                    !acc.isProtected &&
                    acc.role !== 'developer' &&
                    (isDeveloper || acc.role === 'petugas');
                  const isConfirmingDelete = confirmDeleteId === acc.id;
                  const isEditingThis = editingAccountId === acc.id;

                  return (
                    <tr key={acc.id} className="transition-colors hover:bg-slate-50/80">
                      <td className="px-4 py-2.5">
                        {isEditingThis ? (
                          <div className="space-y-1.5">
                            <input
                              type="text"
                              value={editAccName}
                              onChange={(e) => setEditAccName(e.target.value)}
                              placeholder="Nama lengkap"
                              className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-900"
                            />
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                value={editAccKelas}
                                onChange={(e) => setEditAccKelas(e.target.value)}
                                placeholder="Kelas"
                                className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-xs uppercase"
                              />
                              <input
                                type="text"
                                value={editAccDivision}
                                onChange={(e) => setEditAccDivision(e.target.value)}
                                placeholder="Divisi / Sekbid"
                                className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <div
                              aria-hidden="true"
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                              style={{ backgroundColor: acc.avatarColor || '#2563EB' }}
                            >
                              {getInitials(acc.name)}
                            </div>
                            <div>
                              <p className="font-medium text-slate-900">{acc.name}</p>
                              <p className="text-xs text-slate-500">
                                {acc.division} · {acc.kelas} ·{' '}
                                <span className="font-medium text-blue-700">
                                  {formatScheduledWeeksLabel(acc.scheduledWeeks, cycleWeeks)}
                                </span>
                              </p>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="font-mono-num px-4 py-2.5 text-xs font-semibold text-slate-700">
                        @{acc.username}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-semibold">
                        {isEditingThis && isDeveloper && !acc.isProtected && acc.role !== 'developer' ? (
                          <select
                            value={editAccRole}
                            onChange={(e) =>
                              setEditAccRole(e.target.value as 'admin' | 'petugas')
                            }
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800"
                          >
                            <option value="petugas">Petugas Piket</option>
                            <option value="admin">Admin OSIS</option>
                          </select>
                        ) : (
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
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {acc.mustChangePassword ? (
                          <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Wajib Ganti</span>
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-medium">Aktif</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {isEditingThis ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => handleSaveAccountProfile(acc.id)}
                              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                            >
                              <Save className="h-3 w-3" aria-hidden="true" />
                              <span>Simpan</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingAccountId(null)}
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Batal
                            </button>
                          </div>
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
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            {editable && (
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => startEditAccount(acc)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                <Pencil className="h-3 w-3" aria-hidden="true" />
                                <span>Edit</span>
                              </button>
                            )}
                            {acc.isProtected || acc.role === 'developer' ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Dilindungi</span>
                              </span>
                            ) : (
                              <>
                                {resettable && (
                                  <button
                                    type="button"
                                    disabled={submitting}
                                    onClick={() => handleResetPassword(acc)}
                                    aria-label={`Reset password ${acc.name}`}
                                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                                  >
                                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                                    <span>Reset PW</span>
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
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Card List (< md) */}
        <div className="divide-y divide-slate-100 md:hidden">
          {paginatedOfficers.items.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500">
              Tidak ada akun yang cocok dengan filter atau pencarian tersebut.
            </div>
          ) : (
          paginatedOfficers.items.map((acc) => {
            const deletable = canDeleteAccount(officer.role, acc);
            const editable = canEditAccountProfile(officer.role, officer.id, acc);
            const resettable =
              !acc.isProtected &&
              acc.role !== 'developer' &&
              (isDeveloper || acc.role === 'petugas');
            const isConfirmingDelete = confirmDeleteId === acc.id;
            const isEditingThis = editingAccountId === acc.id;

            return (
              <div key={acc.id} className="space-y-2 p-3.5">
                {isEditingThis ? (
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <input
                      type="text"
                      value={editAccName}
                      onChange={(e) => setEditAccName(e.target.value)}
                      placeholder="Nama lengkap"
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={editAccKelas}
                        onChange={(e) => setEditAccKelas(e.target.value)}
                        placeholder="Kelas"
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs uppercase"
                      />
                      <input
                        type="text"
                        value={editAccDivision}
                        onChange={(e) => setEditAccDivision(e.target.value)}
                        placeholder="Divisi / Sekbid"
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                      />
                    </div>
                    {isDeveloper && !acc.isProtected && acc.role !== 'developer' && (
                      <select
                        value={editAccRole}
                        onChange={(e) => setEditAccRole(e.target.value as 'admin' | 'petugas')}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
                      >
                        <option value="petugas">Petugas Piket</option>
                        <option value="admin">Admin OSIS</option>
                      </select>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleSaveAccountProfile(acc.id)}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Simpan Profil
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingAccountId(null)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
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
                      <span
                        className={acc.mustChangePassword ? 'text-amber-700' : 'text-emerald-700'}
                      >
                        {acc.mustChangePassword ? 'Wajib ganti password' : 'Aktif & Aman'}
                      </span>
                      {isConfirmingDelete ? (
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
                        <div className="flex flex-wrap items-center gap-1.5">
                          {editable && (
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => startEditAccount(acc)}
                              className="rounded-lg border border-slate-200 px-2.5 py-1 font-medium text-slate-700"
                            >
                              Edit
                            </button>
                          )}
                          {acc.isProtected || acc.role === 'developer' ? (
                            <span className="inline-flex items-center gap-1 text-slate-500">
                              <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Dilindungi</span>
                            </span>
                          ) : (
                            <>
                              {resettable && (
                                <button
                                  type="button"
                                  disabled={submitting}
                                  onClick={() => handleResetPassword(acc)}
                                  className="rounded-lg border border-slate-200 px-2.5 py-1 font-medium text-slate-700"
                                >
                                  Reset PW
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
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })
          )}
        </div>

        <PaginationBar
          page={paginatedOfficers.page}
          totalPages={paginatedOfficers.totalPages}
          totalItems={paginatedOfficers.totalItems}
          startIndex={paginatedOfficers.startIndex}
          endIndex={paginatedOfficers.endIndex}
          pageSize={accountPageSize}
          pageSizeOptions={[10, 20, 50]}
          itemLabel="akun"
          onPageChange={setAccountPage}
          onPageSizeChange={(size) => {
            setAccountPageSize(size);
            setAccountPage(1);
          }}
        />
      </section>

      {/* Full Backup & Restore (Developer-only: Local JSON + Cloud Firestore Snapshot, shown with Alat Developer) */}
      {isDeveloper && showDevTools && (
        <section className="animate-panel-reveal rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-display text-base font-bold text-slate-900">
                <Cloud className="h-4 w-4 text-blue-600" aria-hidden="true" />
                <span>Cadangkan & Pulihkan Data Sistem (Cloud Google & File JSON)</span>
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {firebaseUser
                  ? `Terhubung dengan akun Google (${firebaseUser.email}). Anda dapat mencadangkan atau memulihkan seluruh data dari penyimpanan Cloud maupun file JSON lokal.`
                  : 'Simpan cadangan lengkap (spreadsheet, pelanggaran, akun, jadwal) ke file JSON lokal atau hubungkan akun Google untuk cadangan Cloud.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportBackupFileChange}
                className="hidden"
              />
              <button
                type="button"
                disabled={syncingCloud || restoringBackup}
                onClick={handleDownloadLocalBackupJson}
                className="btn-3d-soft inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                <Download className="h-3.5 w-3.5 text-slate-700" aria-hidden="true" />
                <span>Unduh Cadangan (.json)</span>
              </button>
              <button
                type="button"
                disabled={syncingCloud || restoringBackup}
                onClick={() => fileInputRef.current?.click()}
                className="btn-3d-soft inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                <Upload className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                <span>{restoringBackup ? 'Memulihkan...' : 'Pulihkan dari File (.json)'}</span>
              </button>
              <button
                type="button"
                disabled={syncingCloud || restoringBackup}
                onClick={handleConnectAndSyncFirebase}
                className="btn-3d-soft inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                <Cloud className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                <span>
                  {syncingCloud
                    ? 'Sedang Menyimpan...'
                    : firebaseUser
                      ? 'Simpan Cadangan Cloud'
                      : 'Hubungkan Google & Simpan'}
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
              {cloudBackups.map((b) => {
                const hasEmbedded = hasEmbeddedBackupDigest(b.summaryDigest);
                const displayDigest = getDisplaySummaryDigest(b.summaryDigest);
                const isConfirmingRestore = confirmRestoreBackupId === b.id;
                return (
                  <div
                    key={b.id}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono-num font-semibold text-slate-800">{b.id}</span>
                        <span className="text-slate-600">
                          · {b.spreadsheetCount} spreadsheet · {b.violationCount} pelanggaran
                        </span>
                      </div>
                      {displayDigest && (
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{displayDigest}</p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {!hasEmbedded ? (
                        <span className="text-[11px] font-medium text-amber-700">
                          Hanya ringkasan (gunakan file .json untuk pulihkan)
                        </span>
                      ) : isConfirmingRestore ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={restoringBackup}
                            onClick={() => handleRestoreCloudBackup(b)}
                            className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                          >
                            Ya, Pulihkan Sekarang
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRestoreBackupId(null)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Batal
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={restoringBackup}
                          onClick={() => setConfirmRestoreBackupId(b.id)}
                          className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                        >
                          Pulihkan Data
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
