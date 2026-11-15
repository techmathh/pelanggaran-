export type ConnectionStatus =
  | 'online'
  | 'reconnecting'
  | 'offline'
  | 'server-unreachable';

export interface ConnectionBannerInfo {
  visible: boolean;
  tone: 'emerald' | 'amber' | 'red';
  role: 'status' | 'alert';
  title: string;
  detail: string;
  actionLabel: string | null;
}

export function isReachableApiResponse(status: number, contentType: string | null): boolean {
  // 502, 503, 504 indicate upstream server/proxy unavailability
  if (status === 502 || status === 503 || status === 504) {
    return false;
  }
  // HTML returned on an /api/* route means static SPA fallback / missing backend
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('text/html')) {
    return false;
  }
  return true;
}

export function deriveConnectionStatus(params: {
  browserOnline: boolean;
  serverReachable: boolean;
  isChecking: boolean;
}): ConnectionStatus {
  if (params.isChecking && (!params.browserOnline || !params.serverReachable)) {
    return 'reconnecting';
  }
  if (!params.browserOnline) {
    return 'offline';
  }
  if (!params.serverReachable) {
    return 'server-unreachable';
  }
  return 'online';
}

export function getConnectionBannerInfo(params: {
  status: ConnectionStatus;
  justReconnected: boolean;
  hasBackendUrlMismatch?: boolean;
}): ConnectionBannerInfo {
  if (params.status === 'offline') {
    return {
      visible: true,
      tone: 'red',
      role: 'alert',
      title: 'Koneksi Internet Terputus (Offline)',
      detail:
        'Jangan kirim catatan dulu — data tidak dapat tersimpan ke server sebelum perangkat terhubung kembali.',
      actionLabel: 'Cek Koneksi',
    };
  }

  if (params.status === 'server-unreachable') {
    return {
      visible: true,
      tone: 'red',
      role: 'alert',
      title: 'Terputus dari Server SiPiket OSIS',
      detail: params.hasBackendUrlMismatch
        ? 'Server API tidak merespons di alamat ini. Hindari menginput data sampai server kembali aktif.'
        : 'Perangkat terhubung ke jaringan, namun server piket belum merespons. Tunggu tersambung sebelum menyimpan data.',
      actionLabel: 'Coba Sambungkan',
    };
  }

  if (params.status === 'reconnecting') {
    return {
      visible: true,
      tone: 'amber',
      role: 'status',
      title: 'Memeriksa Koneksi Server...',
      detail: 'Sedang mencoba menyambungkan ulang ke server SiPiket OSIS.',
      actionLabel: null,
    };
  }

  if (params.justReconnected) {
    return {
      visible: true,
      tone: 'emerald',
      role: 'status',
      title: 'Koneksi Tersambung Kembali',
      detail: 'Server SiPiket OSIS siap menerima data. Anda dapat melanjutkan mencatat pelanggaran.',
      actionLabel: null,
    };
  }

  return {
    visible: false,
    tone: 'emerald',
    role: 'status',
    title: '',
    detail: '',
    actionLabel: null,
  };
}
