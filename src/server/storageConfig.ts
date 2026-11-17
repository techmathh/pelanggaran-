import path from 'node:path';

export type PersistenceMode = 'volume' | 'custom_dir' | 'ephemeral';

export interface DataDirectoryConfig {
  dataDir: string;
  sqlitePath: string;
  persistenceMode: PersistenceMode;
  isPersistent: boolean;
  warning: string | null;
}

function isInsideOrEqualDir(targetDir: string, parentDir: string): boolean {
  const rel = path.relative(parentDir, targetDir);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function resolveDataDirectoryConfig(
  env: Record<string, string | undefined>,
  cwd: string
): DataDirectoryConfig {
  const rawExplicitDir = env.DATA_DIR?.trim();
  const railwayVolumeMount = env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  const explicitSqlitePath = env.SQLITE_PATH?.trim();
  const isRailway = Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID);
  const isHostedProduction = isRailway || env.NODE_ENV === 'production';

  const resolvedVolumeDir = railwayVolumeMount ? path.resolve(cwd, railwayVolumeMount) : null;
  const resolvedExplicitDir = rawExplicitDir ? path.resolve(cwd, rawExplicitDir) : null;
  const defaultLocalDir = path.resolve(cwd, 'data');

  let dataDir: string;
  let persistenceMode: PersistenceMode;
  let isPersistent: boolean;
  let warning: string | null = null;

  if (resolvedVolumeDir) {
    // When Railway Volume is genuinely mounted, only honor DATA_DIR if it sits inside that mounted volume
    // (prevents leftover DATA_DIR="./data" from writing to ephemeral container disk instead of the Volume)
    if (resolvedExplicitDir && isInsideOrEqualDir(resolvedExplicitDir, resolvedVolumeDir)) {
      dataDir = resolvedExplicitDir;
    } else {
      dataDir = resolvedVolumeDir;
      if (resolvedExplicitDir && resolvedExplicitDir !== defaultLocalDir) {
        warning = `DATA_DIR (${rawExplicitDir}) tidak berada di dalam Railway Volume (${railwayVolumeMount}); sistem otomatis mengarahkan SQLite ke Volume ${resolvedVolumeDir} agar data tidak hilang.`;
      }
    }
    persistenceMode = 'volume';
    isPersistent = true;
  } else if (resolvedExplicitDir && resolvedExplicitDir !== defaultLocalDir) {
    dataDir = resolvedExplicitDir;
    if (isRailway) {
      // On Railway, without RAILWAY_VOLUME_MOUNT_PATH no persistent volume is actually attached
      persistenceMode = 'custom_dir';
      isPersistent = false;
      warning = `PERINGATAN: DATA_DIR=${rawExplicitDir} disetel, tetapi Railway Volume belum terpasang (RAILWAY_VOLUME_MOUNT_PATH kosong). Buka tab Volumes di Railway dan pasang Volume ke /data agar data tidak hilang saat redeploy!`;
    } else {
      const outsideCwd = !isInsideOrEqualDir(resolvedExplicitDir, path.resolve(cwd));
      persistenceMode = dataDir === '/data' ? 'volume' : 'custom_dir';
      isPersistent = outsideCwd || dataDir === '/data';
      if (!isPersistent && isHostedProduction) {
        warning = `DATA_DIR mengarah ke folder proyek (${dataDir}) tanpa Volume persisten. Data SQLite dapat hilang saat redeploy.`;
      }
    }
  } else {
    dataDir = resolvedExplicitDir || defaultLocalDir;
    persistenceMode = 'ephemeral';
    isPersistent = false;
    if (isHostedProduction) {
      warning =
        'PERINGATAN: Volume persisten belum terpasang (RAILWAY_VOLUME_MOUNT_PATH kosong). Database SQLite memakai folder lokal sementara dan akan reset setiap redeploy! Pasang Railway Volume di /data agar data aman.';
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
