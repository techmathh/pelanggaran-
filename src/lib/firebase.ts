import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  collection,
  doc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { PublicAppState, RolePetugas, SystemBackupPayload } from '../shared/types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();

export const BACKUP_JSON_DELIMITER = '\n---SIPIKET_BACKUP_JSON---\n';
const GZIP_B64_PREFIX = 'GZIP_B64:';

async function compressTextGzipBase64(text: string): Promise<string | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const buffer = await new Response(stream).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  } catch {
    return null;
  }
}

async function decompressTextGzipBase64(b64: string): Promise<string | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  } catch {
    return null;
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

// Verify Firestore connectivity on application boot
testFirestoreConnection();

export async function signInCloudSyncWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleAuthProvider);
  return result.user;
}

export async function signOutCloudSync(): Promise<void> {
  await signOut(auth);
}

export interface CloudBackupSummary {
  id: string;
  schoolName: string;
  spreadsheetCount: number;
  violationCount: number;
  summaryDigest: string;
  restoreEmbedded?: boolean;
}

export function getDisplaySummaryDigest(summaryDigest: string): string {
  const idx = summaryDigest.indexOf(BACKUP_JSON_DELIMITER);
  return idx >= 0 ? summaryDigest.slice(0, idx).trim() : summaryDigest;
}

export function hasEmbeddedBackupDigest(summaryDigest: string): boolean {
  const idx = summaryDigest.indexOf(BACKUP_JSON_DELIMITER);
  if (idx < 0) return false;
  return summaryDigest.slice(idx + BACKUP_JSON_DELIMITER.length).trim().length > 0;
}

export async function extractBackupPayloadFromDigestAsync(
  summaryDigest: string
): Promise<SystemBackupPayload | null> {
  const idx = summaryDigest.indexOf(BACKUP_JSON_DELIMITER);
  if (idx < 0) return null;
  let rawPayload = summaryDigest.slice(idx + BACKUP_JSON_DELIMITER.length).trim();
  if (!rawPayload) return null;
  if (rawPayload.startsWith(GZIP_B64_PREFIX)) {
    const decompressed = await decompressTextGzipBase64(rawPayload.slice(GZIP_B64_PREFIX.length));
    if (!decompressed) return null;
    rawPayload = decompressed;
  }
  try {
    const parsed = JSON.parse(rawPayload) as SystemBackupPayload;
    if (parsed && Array.isArray(parsed.spreadsheets)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function syncSnapshotToFirestore(
  appRole: RolePetugas,
  appState: PublicAppState,
  backupPayload?: SystemBackupPayload
): Promise<CloudBackupSummary> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Silakan hubungkan akun Google terlebih dahulu untuk sinkronisasi Firebase.');
  }
  if (!user.emailVerified) {
    throw new Error('Email Google Anda belum terverifikasi untuk sinkronisasi Firestore.');
  }

  const cloudRole = appRole === 'developer' ? 'developer' : 'admin';
  const profilePath = `cloud_profiles/${user.uid}`;
  try {
    await setDoc(doc(db, 'cloud_profiles', user.uid), {
      uid: user.uid,
      displayName: (user.displayName || user.email || 'Operator OSIS').slice(0, 120),
      appRole: cloudRole,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, profilePath);
  }

  const totalViolations = appState.spreadsheets.reduce((sum, s) => sum + s.rows.length, 0);
  const digestLines = appState.spreadsheets
    .slice(0, 15)
    .map(
      (s) =>
        `${s.date} (${s.status}): ${s.rows.length} pelanggaran, ${s.rows.reduce((a, r) => a + r.points, 0)} poin`
    );
  const humanSummary = (
    digestLines.join(' | ') || `Sinkronisasi awal pada ${appState.serverDate} ${appState.serverTime} WIB`
  ).slice(0, 1500);

  const fallbackPayload: SystemBackupPayload = backupPayload ?? {
    version: 1,
    createdAt: new Date().toISOString(),
    schoolName: 'SMA NEGERI 1 KEMANGKON',
    officers: appState.officers.filter((o) => !o.isProtected),
    presets: appState.presets,
    customStudents: appState.students.filter((s) => !/^stu-(?:10|11|12)[a-f]-\d+$/i.test(s.id)),
    spreadsheets: appState.spreadsheets,
    weeklySchedule: appState.weeklySchedule,
    dailySession: appState.dailySession,
    simulation: appState.simulation,
  };

  const serializedPayload = JSON.stringify(fallbackPayload);
  const plainDigest = `${humanSummary}${BACKUP_JSON_DELIMITER}${serializedPayload}`;

  let summaryDigest = humanSummary.slice(0, 19500);
  let restoreEmbedded = false;

  if (plainDigest.length <= 19500) {
    summaryDigest = plainDigest;
    restoreEmbedded = true;
  } else {
    const compressed = await compressTextGzipBase64(serializedPayload);
    if (compressed) {
      const compressedDigest = `${humanSummary}${BACKUP_JSON_DELIMITER}${GZIP_B64_PREFIX}${compressed}`;
      if (compressedDigest.length <= 19500) {
        summaryDigest = compressedDigest;
        restoreEmbedded = true;
      }
    }
  }

  const backupId = `backup-${appState.serverDate}-${Date.now()}`;
  const backupPath = `cloud_snapshots/${user.uid}/backups/${backupId}`;

  try {
    await setDoc(doc(db, 'cloud_snapshots', user.uid, 'backups', backupId), {
      ownerId: user.uid,
      schoolName: 'SMA NEGERI 1 KEMANGKON',
      spreadsheetCount: appState.spreadsheets.length,
      violationCount: totalViolations,
      summaryDigest,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, backupPath);
  }

  return {
    id: backupId,
    schoolName: 'SMA NEGERI 1 KEMANGKON',
    spreadsheetCount: appState.spreadsheets.length,
    violationCount: totalViolations,
    summaryDigest,
    restoreEmbedded,
  };
}

export async function fetchUserCloudBackups(): Promise<CloudBackupSummary[]> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return [];
  const backupsPath = `cloud_snapshots/${user.uid}/backups`;
  try {
    const q = query(
      collection(db, 'cloud_snapshots', user.uid, 'backups'),
      orderBy('updatedAt', 'desc'),
      limit(10)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        schoolName: String(data.schoolName ?? 'SMA NEGERI 1 KEMANGKON'),
        spreadsheetCount: Number(data.spreadsheetCount ?? 0),
        violationCount: Number(data.violationCount ?? 0),
        summaryDigest: String(data.summaryDigest ?? ''),
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, backupsPath);
  }
}
