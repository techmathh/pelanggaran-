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
import type { PublicAppState, RolePetugas } from '../shared/types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();

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
}

export async function syncSnapshotToFirestore(
  appRole: RolePetugas,
  appState: PublicAppState
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
  const summaryDigest = (
    digestLines.join(' | ') || `Sinkronisasi awal pada ${appState.serverDate} ${appState.serverTime} WIB`
  ).slice(0, 19500);

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
