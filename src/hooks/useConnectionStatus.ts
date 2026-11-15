import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NETWORK_STATUS_EVENT,
  checkServerHealth,
  type NetworkStatusDetail,
} from '../lib/apiClient';
import {
  deriveConnectionStatus,
  getConnectionBannerInfo,
  type ConnectionBannerInfo,
  type ConnectionStatus,
} from '../shared/connectionLogic';

export interface UseConnectionStatusResult {
  status: ConnectionStatus;
  banner: ConnectionBannerInfo;
  isDisconnected: boolean;
  isChecking: boolean;
  checkNow: () => Promise<void>;
  dismissReconnected: () => void;
}

export function useConnectionStatus(): UseConnectionStatusResult {
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [serverReachable, setServerReachable] = useState<boolean>(true);
  const [backendMismatch, setBackendMismatch] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [justReconnected, setJustReconnected] = useState<boolean>(false);

  const wasDisconnectedRef = useRef<boolean>(false);
  const reconnectTimerRef = useRef<number | null>(null);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const applyReachability = useCallback(
    (detail: NetworkStatusDetail) => {
      const nextOnline = detail.browserOnline;
      const nextReachable = nextOnline && detail.reachable;

      setBrowserOnline(nextOnline);
      setServerReachable(nextReachable);
      setBackendMismatch(Boolean(detail.backendMismatch));

      if (!nextOnline || !nextReachable) {
        wasDisconnectedRef.current = true;
        clearReconnectTimer();
        setJustReconnected(false);
      } else if (wasDisconnectedRef.current) {
        wasDisconnectedRef.current = false;
        setJustReconnected(true);
        clearReconnectTimer();
        reconnectTimerRef.current = window.setTimeout(() => {
          setJustReconnected(false);
          reconnectTimerRef.current = null;
        }, 4000);
      }
    },
    [clearReconnectTimer]
  );

  const checkNow = useCallback(async () => {
    setIsChecking(true);
    try {
      await checkServerHealth(5000);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setBrowserOnline(true);
      void checkNow();
    };

    const handleOffline = () => {
      applyReachability({ reachable: false, browserOnline: false });
    };

    const handleNetworkEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<NetworkStatusDetail>).detail;
      if (detail) {
        applyReachability(detail);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener(NETWORK_STATUS_EVENT, handleNetworkEvent);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(NETWORK_STATUS_EVENT, handleNetworkEvent);
      clearReconnectTimer();
    };
  }, [applyReachability, checkNow, clearReconnectTimer]);

  const status = deriveConnectionStatus({
    browserOnline,
    serverReachable,
    isChecking,
  });
  const isDisconnected = status === 'offline' || status === 'server-unreachable';

  // Automatic health probe: faster (5s) when disconnected so recovery is instant, gentle (20s) when healthy
  useEffect(() => {
    const intervalMs = isDisconnected ? 5000 : 20000;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void checkServerHealth(4500);
      }
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [isDisconnected]);

  const banner = getConnectionBannerInfo({
    status,
    justReconnected,
    hasBackendUrlMismatch: backendMismatch,
  });

  const dismissReconnected = useCallback(() => {
    clearReconnectTimer();
    setJustReconnected(false);
  }, [clearReconnectTimer]);

  return {
    status,
    banner,
    isDisconnected,
    isChecking,
    checkNow,
    dismissReconnected,
  };
}
