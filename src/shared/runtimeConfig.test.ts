import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  isOriginAllowed,
  normalizeApiBaseUrl,
  normalizeOrigin,
  parseAllowedOrigins,
  resolveFrontendApiBaseUrl,
  resolveServerExecutionMode,
} from './runtimeConfig';
import { resolveDataDirectoryConfig } from '../server/storageConfig';

test('CORS origin parsing and matching handles trailing slashes and wildcard subdomains safely', () => {
  assert.equal(normalizeOrigin('https://SiPiket-FE.up.railway.app/'), 'https://sipiket-fe.up.railway.app');

  const parsed = parseAllowedOrigins(
    ' https://sipiket-fe.up.railway.app/ , https://*.up.railway.app , https://sipiket-fe.up.railway.app '
  );
  assert.deepEqual(parsed, [
    'https://sipiket-fe.up.railway.app',
    'https://*.up.railway.app',
  ]);

  // Empty list allows any origin (local/dev default)
  assert.equal(isOriginAllowed('https://example.com', []), true);

  // Exact + wildcard matches
  assert.equal(isOriginAllowed('https://sipiket-fe.up.railway.app', parsed), true);
  assert.equal(isOriginAllowed('https://preview-123.up.railway.app/', parsed), true);

  // Reject wrong protocol, spoofed suffix, or missing origin when restricted
  assert.equal(isOriginAllowed('http://preview-123.up.railway.app', parsed), false);
  assert.equal(isOriginAllowed('https://fakeup.railway.app', parsed), false);
  assert.equal(isOriginAllowed('https://evil.com', parsed), false);
  assert.equal(isOriginAllowed(undefined, parsed), false);
});

test('Frontend API base URL prefers runtime config over compile-time VITE_API_BASE_URL', () => {
  assert.equal(normalizeApiBaseUrl('https://api.example.com///'), 'https://api.example.com');
  assert.equal(normalizeApiBaseUrl('undefined'), '');

  assert.equal(
    resolveFrontendApiBaseUrl('https://build-api.up.railway.app/', 'https://runtime-api.up.railway.app/'),
    'https://runtime-api.up.railway.app'
  );
  assert.equal(
    resolveFrontendApiBaseUrl('https://build-api.up.railway.app/', ''),
    'https://build-api.up.railway.app'
  );
  assert.equal(resolveFrontendApiBaseUrl('', ''), '');
});

test('Server execution mode decouples backend-only cleanly and falls back safely when dist is missing', () => {
  assert.equal(resolveServerExecutionMode({ NODE_ENV: 'development' }, ['tsx', 'server.ts', '--backend-only'], true), 'backend-only');
  assert.equal(resolveServerExecutionMode({ NODE_ENV: 'production', BACKEND_ONLY: 'true' }, [], true), 'backend-only');
  assert.equal(resolveServerExecutionMode({ NODE_ENV: 'production', SERVE_FRONTEND: 'false' }, [], true), 'backend-only');
  assert.equal(resolveServerExecutionMode({ NODE_ENV: 'development' }, [], false), 'fullstack-dev');
  assert.equal(resolveServerExecutionMode({ NODE_ENV: 'production' }, [], true), 'fullstack-prod');
  // Production without dist/index.html gracefully becomes backend-only instead of crashing
  assert.equal(resolveServerExecutionMode({ NODE_ENV: 'production' }, [], false), 'backend-only');
});

test('Data directory config auto-detects Railway Volume mount and prevents unmounted data loss', () => {
  const cwd = '/app/applet';

  // Auto-detects RAILWAY_VOLUME_MOUNT_PATH even if DATA_DIR was not manually configured
  const railwayAuto = resolveDataDirectoryConfig(
    { NODE_ENV: 'production', RAILWAY_ENVIRONMENT: 'production', RAILWAY_VOLUME_MOUNT_PATH: '/data' },
    cwd
  );
  assert.equal(railwayAuto.dataDir, '/data');
  assert.equal(railwayAuto.sqlitePath, path.join('/data', 'sipiket.db'));
  assert.equal(railwayAuto.persistenceMode, 'volume');
  assert.equal(railwayAuto.isPersistent, true);
  assert.equal(railwayAuto.warning, null);

  // Even if leftover DATA_DIR=./data exists, mounted Railway Volume /data takes precedence so data is NOT lost
  const railwayOverridePlaceholder = resolveDataDirectoryConfig(
    {
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT: 'production',
      RAILWAY_VOLUME_MOUNT_PATH: '/data',
      DATA_DIR: './data',
    },
    cwd
  );
  assert.equal(railwayOverridePlaceholder.dataDir, '/data');
  assert.equal(railwayOverridePlaceholder.persistenceMode, 'volume');
  assert.equal(railwayOverridePlaceholder.isPersistent, true);

  // On Railway, setting DATA_DIR=/data WITHOUT actually attaching a Volume must still report volumeMounted=false
  const railwayMissingVolume = resolveDataDirectoryConfig(
    { NODE_ENV: 'production', RAILWAY_ENVIRONMENT: 'production', DATA_DIR: '/data' },
    cwd
  );
  assert.equal(railwayMissingVolume.isPersistent, false);
  assert.ok(railwayMissingVolume.warning && railwayMissingVolume.warning.includes('Volumes'));

  // Non-Railway host with explicit /data volume path
  const explicitExternalVol = resolveDataDirectoryConfig(
    { NODE_ENV: 'production', DATA_DIR: '/data' },
    cwd
  );
  assert.equal(explicitExternalVol.persistenceMode, 'volume');
  assert.equal(explicitExternalVol.isPersistent, true);
  assert.equal(explicitExternalVol.warning, null);

  // Production on Railway with neither Volume nor external DATA_DIR triggers clear warning
  const ephemeralProd = resolveDataDirectoryConfig(
    { NODE_ENV: 'production', RAILWAY_ENVIRONMENT: 'production' },
    cwd
  );
  assert.equal(ephemeralProd.persistenceMode, 'ephemeral');
  assert.equal(ephemeralProd.isPersistent, false);
  assert.ok(ephemeralProd.warning && ephemeralProd.warning.includes('Railway Volume'));

  // Local dev default does not warn
  const localDev = resolveDataDirectoryConfig({ NODE_ENV: 'development' }, cwd);
  assert.equal(localDev.persistenceMode, 'ephemeral');
  assert.equal(localDev.warning, null);
});
