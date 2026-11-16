import path from 'node:path';

export type PersistenceMode = 'volume' | 'custom_dir' | 'ephemeral';

export interface DataDirectoryConfig {
  dataDir: string;
  sqlitePath: string;
  persistenceMode: PersistenceMode;
  isPersistent: boolean;
  warning: string | null;
}

export function resolveDataDirectoryConfig(
  env: Record<string, string | undefined>,
  cwd: string
): DataDirectoryConfig {
  const explicitDir = env.DATA_DIR?.trim();
  const railwayVolumeMount = env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  const explicitSqlitePath = env.SQLITE_PATH?.trim();
  const isHostedProduction = Boolean(
    env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.NODE_ENV === 'production'
  );

  let dataDir: string;
  let persistenceMode: PersistenceMode;
  let isPersistent: boolean;
  let warning: string | null = null;

  if (explicitDir) {
    dataDir = path.resolve(cwd, explicitDir);
    const matchesVolume =
      Boolean(railwayVolumeMount) &&
      path.resolve(cwd, railwayVolumeMount!) === dataDir;
    persistenceMode = matchesVolume || dataDir === '/data' ? 'volume' : 'custom_dir';
    isPersistent = matchesVolume || dataDir.startsWith('/data') || !dataDir.startsWith(path.resolve(cwd));
    if (!isPersistent && isHostedProduction) {
      warning =
        `DATA_DIR mengarah ke folder proyek (${dataDir}) tanpa Railway Volume. Data SQLite dapat hilang saat redeploy jika tidak menggunakan Volume persisten (mis. /data).`;
    }
  } else if (railwayVolumeMount) {
    dataDir = path.resolve(cwd, railwayVolumeMount);
    persistenceMode = 'volume';
    isPersistent = true;
  } else {
    dataDir = path.resolve(cwd, 'data');
    persistenceMode = 'ephemeral';
    isPersistent = false;
    if (isHostedProduction) {
      warning =
        'PERINGATAN: Volume persisten belum terpasang (RAILWAY_VOLUME_MOUNT_PATH / DATA_DIR kosong). Database SQLite memakai ./data lokal dan akan reset setiap redeploy! Pasang Railway Volume di /data agar data aman.';
    }
  }

  const sqlitePath = explicitSqlitePath
    ? path.resolve(cwd, explicitSqlitePath)
    : path.join(dataDir, 'sipiket.db');

  return {
    dataDir: explicitSqlitePath ? path.dirname(sqlitePath) : dataDir,
    sqlitePath,
    persistenceMode,
    isPersistent,
    warning,
  };
}
