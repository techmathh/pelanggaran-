import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import {
  apiFetch,
  buildApiUrl,
  clearAuthToken,
  getAuthToken,
  setAuthToken,
} from './lib/apiClient';
import { isManagerRole } from './shared/piketLogic';
import type { PublicAppState, PublicMetaState, PublicOfficer } from './shared/types';
import { AccountManagementView } from './components/AccountManagementView';
import { ArchiveView } from './components/ArchiveView';
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
          'Server API SiPiket OSIS (/api) tidak ditemukan di hosting ini. Vercel hanya menjalankan tampilan depan; jalankan server Node.js (server.ts) di Railway/Render/VPS lalu sambungkan melalui VITE_API_BASE_URL, atau deploy full-stack langsung di hosting Node.js.'
        );
      } else {
        setLoadError('Tidak dapat terhubung ke server SiPiket OSIS.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    bootstrapSession();
  }, [bootstrapSession]);

  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash !== '#/ganti-password') {
        setPendingPasswordChange(null);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

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
        <div className="text-center">
          <p className="font-display text-lg font-bold text-slate-900">SiPiket OSIS</p>
          <p className="mt-1 text-sm text-slate-500">Memuat data sesi piket...</p>
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
        <MandatoryPasswordChangeView
          meta={meta}
          pending={pendingPasswordChange}
          onSuccess={handleMandatoryPasswordUpdated}
          onCancel={handleCancelMandatoryChange}
        />
      ) : !currentOfficer || !appState ? (
        <LoginView
          meta={meta}
          onLoginSuccess={handleLoginSuccess}
          onRequiresPasswordChange={handleRequiresPasswordChange}
        />
      ) : (
        <>
          <TopBar
            officer={currentOfficer}
            activeTab={effectiveTab}
            onSelectTab={setActiveTab}
            onLogout={handleLogout}
          />
          <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-6 lg:py-8">
            <div key={effectiveTab} className="animate-panel-reveal">
              {effectiveTab === 'piket' && (
                <SpreadsheetWorkspace
                  officer={currentOfficer}
                  appState={appState}
                  onStateUpdate={handleStateUpdate}
                  onNotify={notify}
                />
              )}
              {effectiveTab === 'rekap' && (
                <StudentRecapView appState={appState} onNotify={notify} />
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
          className={`fixed top-3 left-3 right-3 z-[60] flex cursor-pointer items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg sm:top-auto sm:bottom-5 sm:left-5 sm:right-auto sm:max-w-sm ${
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
