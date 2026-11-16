import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import {
  SESSION_INVALIDATED_EVENT,
  apiFetch,
  buildApiUrl,
  clearAuthToken,
  getAuthToken,
  notifySessionInvalidated,
  reportNetworkStatus,
  setAuthToken,
  type SessionInvalidatedDetail,
} from './lib/apiClient';
import { useConnectionStatus } from './hooks/useConnectionStatus';
import { isReachableApiResponse } from './shared/connectionLogic';
import { isManagerRole } from './shared/piketLogic';
import { applyClockPatchToAppState } from './shared/studentImportLogic';
import type { HariPiket, PublicAppState, PublicMetaState, PublicOfficer } from './shared/types';
import { AccountManagementView } from './components/AccountManagementView';
import { ArchiveView } from './components/ArchiveView';
import { ConnectionStatusBar } from './components/ConnectionStatusBar';
import { LoginView } from './components/LoginView';
import {
  MandatoryPasswordChangeView,
  type PendingPasswordChange,
} from './components/MandatoryPasswordChangeView';
import { ScheduleSettingsView } from './components/ScheduleSettingsView';
import { SpreadsheetWorkspace } from './components/SpreadsheetWorkspace';
import { StudentRecapView } from './components/StudentRecapView';
import { TopBar, type ActiveTab } from './components/TopBar';

interface ToastMessage {
  id: number;
  text: string;
  type: 'success' | 'error' | 'info';
}

export default function App() {
  const [meta, setMeta] = useState<PublicMetaState | null>(null);
  const [appState, setAppState] = useState<PublicAppState | null>(null);
  const [currentOfficer, setCurrentOfficer] = useState<PublicOfficer | null>(null);
  const [pendingPasswordChange, setPendingPasswordChange] =
    useState<PendingPasswordChange | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('piket');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const latestStateVersionRef = useRef<string | undefined>(undefined);
  const connection = useConnectionStatus();

  useEffect(() => {
    latestStateVersionRef.current = appState?.stateVersion;
  }, [appState?.stateVersion]);

  const notify = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    setToast({ id, text, type });
    window.setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
    }, 4500);
  }, []);

  const refreshPublicMeta = useCallback(async () => {
    try {
      const res = await fetch(buildApiUrl('/api/public-meta'));
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const metaData = (await res.json()) as PublicMetaState;
        setMeta(metaData);
      }
    } catch {
      // handled in main boot flow if needed
    }
  }, []);

  const bootstrapSession = useCallback(async () => {
    setLoading(true);
    try {
      const metaRes = await fetch(buildApiUrl('/api/public-meta'));
      const contentType = metaRes.headers.get('content-type') || '';
      if (!metaRes.ok || !contentType.includes('application/json')) {
        throw new Error(
          metaRes.status === 404 || !contentType.includes('application/json')
            ? 'BACKEND_UNAVAILABLE'
            : 'Gagal memuat metadata server'
        );
      }
      const metaData = (await metaRes.json()) as PublicMetaState;
      setMeta(metaData);

      const token = getAuthToken();
      if (token) {
        const stateRes = await apiFetch('/api/state');
        if (stateRes.ok) {
          const payload = (await stateRes.json()) as {
            officer: PublicOfficer;
            state: PublicAppState;
          };
          setCurrentOfficer(payload.officer);
          setAppState(payload.state);
        } else {
          clearAuthToken();
          setCurrentOfficer(null);
          setAppState(null);
        }
      } else {
        setCurrentOfficer(null);
        setAppState(null);
      }
      setLoadError(null);
    } catch (err) {
      if (err instanceof Error && err.message === 'BACKEND_UNAVAILABLE') {
        setLoadError(
          'Server API Backend (/api) tidak ditemukan dari layanan Frontend ini. Pastikan layanan Backend sudah aktif dan variabel API_BASE_URL / VITE_API_BASE_URL pada Frontend mengarah ke URL Backend (serta ALLOWED_ORIGINS pada Backend mengizinkan domain Frontend ini).'
        );
      } else {
        setLoadError('Tidak dapat terhubung ke server Backend SiPiket OSIS.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    bootstrapSession();
  }, [bootstrapSession]);

  useEffect(() => {
    if (window.location.hash === '#/ganti-password') {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    }
    const onHashChange = () => {
      if (window.location.hash !== '#/ganti-password') {
        setPendingPasswordChange(null);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const performForcedLogout = useCallback(
    (message?: string) => {
      clearAuthToken();
      setPendingPasswordChange(null);
      setCurrentOfficer(null);
      setAppState(null);
      setActiveTab('piket');
      if (window.location.hash === '#/ganti-password') {
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search
        );
      }
      void refreshPublicMeta();
      notify(
        message || 'Akun Anda telah dihapus atau sesi berakhir. Anda otomatis keluar.',
        'error'
      );
    },
    [notify, refreshPublicMeta]
  );

  // Instant auto-logout whenever any API call detects 401 (e.g. account deleted by Developer/Admin)
  useEffect(() => {
    const onInvalidated = (ev: Event) => {
      const detail = (ev as CustomEvent<SessionInvalidatedDetail>).detail;
      performForcedLogout(detail?.message);
    };
    window.addEventListener(SESSION_INVALIDATED_EVENT, onInvalidated);
    return () => window.removeEventListener(SESSION_INVALIDATED_EVENT, onInvalidated);
  }, [performForcedLogout]);

  // Background heartbeat & tab-focus sync: detects deleted account, forced password reset, and live multi-device state updates
  useEffect(() => {
    if (!currentOfficer && !pendingPasswordChange) return;

    let cancelled = false;
    const checkSession = async () => {
      if (cancelled) return;
      const activeToken = pendingPasswordChange?.token ?? getAuthToken();
      if (!activeToken) return;
      try {
        const currentVer = latestStateVersionRef.current;
        const sessionUrl = currentVer
          ? `/api/auth/session?v=${encodeURIComponent(currentVer)}`
          : '/api/auth/session';
        const res = await fetch(buildApiUrl(sessionUrl), {
          headers: { Authorization: `Bearer ${activeToken}` },
        });
        const contentType = res.headers.get('content-type');
        reportNetworkStatus({
          reachable: isReachableApiResponse(res.status, contentType),
          browserOnline: navigator.onLine,
          backendMismatch: Boolean(contentType && contentType.toLowerCase().includes('text/html')),
        });
        if (res.status === 401 && !cancelled) {
          let message = 'Akun Anda telah dihapus oleh pengelola sistem. Sesi otomatis keluar.';
          try {
            const body = (await res.json()) as { error?: string };
            if (body?.error) message = body.error;
          } catch {
            // ignore
          }
          notifySessionInvalidated({ message, accountDeleted: true });
          return;
        }
        if (res.ok && !cancelled) {
          const body = (await res.json()) as {
            officer?: PublicOfficer;
            requiresPasswordChange?: boolean;
            unchanged?: boolean;
            stateVersion?: string;
            serverDate?: string;
            serverTime?: string;
            serverHari?: HariPiket;
            state?: PublicAppState;
          };
          if (body.requiresPasswordChange && currentOfficer && !pendingPasswordChange) {
            notifySessionInvalidated({
              message:
                'Password akun Anda telah direset oleh Admin/Developer. Silakan masuk kembali dengan password sementara baru.',
            });
            return;
          }
          if (body.officer && currentOfficer) {
            setCurrentOfficer(body.officer);
          }
          if (body.state && currentOfficer) {
            setAppState(body.state);
          } else if (body.unchanged && currentOfficer) {
            setAppState((prev) =>
              applyClockPatchToAppState(prev, {
                serverDate: body.serverDate,
                serverTime: body.serverTime,
                serverHari: body.serverHari,
              })
            );
          }
        }
      } catch {
        reportNetworkStatus({
          reachable: false,
          browserOnline: navigator.onLine,
        });
      }
    };

    const intervalId = window.setInterval(checkSession, 6000);
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        void checkSession();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [currentOfficer, pendingPasswordChange]);

  function handleLoginSuccess(
    token: string,
    officer: PublicOfficer,
    nextState: PublicAppState
  ) {
    setPendingPasswordChange(null);
    if (window.location.hash === '#/ganti-password') {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    }
    setAuthToken(token);
    setAppState(nextState);
    setCurrentOfficer(officer);
    setActiveTab('piket');
    void refreshPublicMeta();
    notify(`Selamat bertugas, ${officer.name}!`, 'success');
  }

  function handleRequiresPasswordChange(pending: PendingPasswordChange) {
    setPendingPasswordChange(pending);
    if (window.location.hash !== '#/ganti-password') {
      window.location.hash = '#/ganti-password';
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }

  function handleMandatoryPasswordUpdated(
    newToken: string,
    updatedOfficer: PublicOfficer,
    nextState: PublicAppState
  ) {
    setPendingPasswordChange(null);
    if (window.location.hash === '#/ganti-password') {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    }
    setAuthToken(newToken);
    setAppState(nextState);
    setCurrentOfficer(updatedOfficer);
    setActiveTab('piket');
    void refreshPublicMeta();
    notify(`Password baru tersimpan. Selamat bertugas, ${updatedOfficer.name}!`, 'success');
  }

  function handleCancelMandatoryChange() {
    setPendingPasswordChange(null);
    if (window.location.hash === '#/ganti-password') {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }

  function handleLogout() {
    clearAuthToken();
    setPendingPasswordChange(null);
    setCurrentOfficer(null);
    setAppState(null);
    setActiveTab('piket');
    void refreshPublicMeta();
  }

  function handleStateUpdate(nextState: PublicAppState) {
    setAppState(nextState);
    if (currentOfficer) {
      const refreshed = nextState.officers.find((o) => o.id === currentOfficer.id);
      if (refreshed) {
        setCurrentOfficer(refreshed);
      }
    }
  }

  function handlePasswordUpdated(
    newToken: string,
    updatedOfficer: PublicOfficer,
    nextState: PublicAppState
  ) {
    setAuthToken(newToken);
    setCurrentOfficer(updatedOfficer);
    setAppState(nextState);
    void refreshPublicMeta();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent px-4">
        <div className="surface-3d animate-panel-reveal flex flex-col items-center rounded-2xl border border-slate-200/90 bg-white px-8 py-6 text-center">
          <div
            aria-hidden="true"
            className="mb-3 h-9 w-9 animate-spin rounded-full border-[3px] border-blue-100 border-t-blue-600"
          />
          <p className="font-display text-lg font-bold text-slate-900">SiPiket OSIS</p>
          <p className="mt-1 text-xs text-slate-500">Memuat data sesi piket...</p>
        </div>
      </div>
    );
  }

  if (loadError || !meta) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent px-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <p className="font-display text-lg font-bold text-slate-900">Koneksi Terputus</p>
          <p className="mt-2 text-sm text-slate-600">{loadError}</p>
          <button
            type="button"
            onClick={() => bootstrapSession()}
            className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Muat Ulang
          </button>
        </div>
      </div>
    );
  }

  const effectiveTab: ActiveTab =
    activeTab === 'akun' && currentOfficer && !isManagerRole(currentOfficer.role)
      ? 'piket'
      : activeTab;

  return (
    <div className="min-h-screen bg-transparent text-slate-900">
      {pendingPasswordChange ? (
        <>
          <div className="sticky top-0 z-40">
            <ConnectionStatusBar
              banner={connection.banner}
              isChecking={connection.isChecking}
              onRetry={() => void connection.checkNow()}
              onDismiss={connection.dismissReconnected}
            />
          </div>
          <MandatoryPasswordChangeView
            meta={meta}
            pending={pendingPasswordChange}
            onSuccess={handleMandatoryPasswordUpdated}
            onCancel={handleCancelMandatoryChange}
          />
        </>
      ) : !currentOfficer || !appState ? (
        <>
          <div className="sticky top-0 z-40">
            <ConnectionStatusBar
              banner={connection.banner}
              isChecking={connection.isChecking}
              onRetry={() => void connection.checkNow()}
              onDismiss={connection.dismissReconnected}
            />
          </div>
          <LoginView
            meta={meta}
            onLoginSuccess={handleLoginSuccess}
            onRequiresPasswordChange={handleRequiresPasswordChange}
          />
        </>
      ) : (
        <>
          <div className="sticky top-0 z-40">
            <ConnectionStatusBar
              banner={connection.banner}
              isChecking={connection.isChecking}
              onRetry={() => void connection.checkNow()}
              onDismiss={connection.dismissReconnected}
            />
            <TopBar
              officer={currentOfficer}
              activeTab={effectiveTab}
              onSelectTab={setActiveTab}
              onLogout={handleLogout}
            />
          </div>
          <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-6 lg:py-8">
            <div key={effectiveTab} className="animate-panel-reveal">
              {effectiveTab === 'piket' && (
                <SpreadsheetWorkspace
                  officer={currentOfficer}
                  appState={appState}
                  connectionOffline={connection.isDisconnected}
                  onStateUpdate={handleStateUpdate}
                  onNotify={notify}
                />
              )}
              {effectiveTab === 'rekap' && (
                <StudentRecapView
                  officer={currentOfficer}
                  appState={appState}
                  onStateUpdate={handleStateUpdate}
                  onNotify={notify}
                />
              )}
              {effectiveTab === 'arsip' && (
                <ArchiveView appState={appState} onNotify={notify} />
              )}
              {effectiveTab === 'jadwal' && (
                <ScheduleSettingsView
                  officer={currentOfficer}
                  appState={appState}
                  onStateUpdate={handleStateUpdate}
                  onPasswordUpdated={handlePasswordUpdated}
                  onOpenAccounts={() => setActiveTab('akun')}
                  onNotify={notify}
                />
              )}
              {effectiveTab === 'akun' && isManagerRole(currentOfficer.role) && (
                <AccountManagementView
                  officer={currentOfficer}
                  appState={appState}
                  onStateUpdate={handleStateUpdate}
                  onNotify={notify}
                />
              )}
            </div>
          </main>
        </>
      )}

      {/* Clean non-blocking toast notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          onClick={() => setToast(null)}
          className={`animate-toast-in fixed bottom-4 left-3 right-3 z-[60] flex cursor-pointer items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg sm:bottom-5 sm:left-5 sm:right-auto sm:max-w-sm ${
            toast.type === 'success'
              ? 'border-emerald-200 bg-white text-emerald-900'
              : toast.type === 'error'
                ? 'border-red-200 bg-white text-red-900'
                : 'border-slate-200 bg-white text-slate-900'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          ) : toast.type === 'error' ? (
            <XCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
          ) : (
            <Info className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
          )}
          <span className="min-w-0 break-words">{toast.text}</span>
        </div>
      )}
    </div>
  );
}
