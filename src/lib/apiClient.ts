import { isReachableApiResponse } from '../shared/connectionLogic';

const AUTH_TOKEN_KEY = 'sipiket_osis_auth_token';
const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

export const SESSION_INVALIDATED_EVENT = 'sipiket:session-invalidated';
export const NETWORK_STATUS_EVENT = 'sipiket:network-status';

export interface SessionInvalidatedDetail {
  message: string;
  accountDeleted?: boolean;
}

export interface NetworkStatusDetail {
  reachable: boolean;
  browserOnline: boolean;
  backendMismatch?: boolean;
}

export function reportNetworkStatus(detail: NetworkStatusDetail): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<NetworkStatusDetail>(NETWORK_STATUS_EVENT, { detail }));
  }
}

export function buildApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return RAW_API_BASE ? `${RAW_API_BASE}${normalizedPath}` : normalizedPath;
}

export function hasExternalApiBase(): boolean {
  return Boolean(RAW_API_BASE);
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // ignore storage quota errors
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function notifySessionInvalidated(detail: SessionInvalidatedDetail): void {
  clearAuthToken();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<SessionInvalidatedDetail>(SESSION_INVALIDATED_EVENT, { detail }));
  }
}

export async function checkServerHealth(timeoutMs = 5000): Promise<{
  reachable: boolean;
  backendMismatch: boolean;
}> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    reportNetworkStatus({ reachable: false, browserOnline: false });
    return { reachable: false, backendMismatch: false };
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(buildApiUrl('/api/health'), {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    const contentType = res.headers.get('content-type');
    const backendMismatch =
      res.status === 404 || Boolean(contentType && contentType.toLowerCase().includes('text/html'));
    const reachable = res.ok && isReachableApiResponse(res.status, contentType);
    reportNetworkStatus({
      reachable,
      browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
      backendMismatch,
    });
    return { reachable, backendMismatch };
  } catch {
    reportNetworkStatus({
      reachable: false,
      browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
    });
    return { reachable: false, backendMismatch: false };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const hasAuthHeader = headers.has('Authorization') || Boolean(token);
  if (!headers.has('Authorization') && token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(buildApiUrl(input), {
      ...init,
      headers,
    });
  } catch (err) {
    reportNetworkStatus({
      reachable: false,
      browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
    });
    throw err;
  }

  const contentType = response.headers.get('content-type');
  const reachable = isReachableApiResponse(response.status, contentType);
  reportNetworkStatus({
    reachable,
    browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
    backendMismatch: Boolean(contentType && contentType.toLowerCase().includes('text/html')),
  });

  if (response.status === 401 && hasAuthHeader) {
    let message = 'Sesi Anda telah berakhir. Silakan masuk kembali.';
    let accountDeleted = false;
    try {
      const cloned = response.clone();
      const payload = (await cloned.json()) as { error?: string; accountDeleted?: boolean };
      if (payload?.error) message = payload.error;
      if (payload?.accountDeleted) accountDeleted = true;
    } catch {
      // ignore non-JSON 401 body
    }
    notifySessionInvalidated({ message, accountDeleted });
  } else if (response.status === 403 && hasAuthHeader) {
    try {
      const cloned = response.clone();
      const payload = (await cloned.json()) as {
        error?: string;
        requiresPasswordChange?: boolean;
      };
      if (payload?.requiresPasswordChange) {
        notifySessionInvalidated({
          message:
            payload.error ||
            'Password akun Anda telah direset oleh pengelola. Silakan masuk kembali dengan password sementara baru.',
        });
      }
    } catch {
      // ignore non-JSON 403 body
    }
  }

  return response;
}
