import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeApiBaseUrl } from './src/shared/runtimeConfig';

const PORT = Number(process.env.PORT) || 3000;
const distDir = path.resolve(process.cwd(), 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');

function resolveConfiguredBackendUrl(): string {
  return normalizeApiBaseUrl(
    process.env.API_BASE_URL || process.env.VITE_API_BASE_URL || ''
  );
}

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    service: 'sipiket-osis-frontend',
    hasDistBuild: fs.existsSync(indexHtmlPath),
    apiConfigured: Boolean(resolveConfiguredBackendUrl()),
  });
});

// Runtime API base injection so Frontend container can point to Backend without rebuilding
app.get('/env-config.js', (_req, res) => {
  const apiBaseUrl = resolveConfiguredBackendUrl();
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(`window.__SIPIKET_CONFIG__ = ${JSON.stringify({ apiBaseUrl })};\n`);
});

if (fs.existsSync(distDir)) {
  app.use(
    '/assets',
    express.static(path.join(distDir, 'assets'), {
      maxAge: '30d',
      immutable: true,
    })
  );
  app.use(
    express.static(distDir, {
      index: false,
      maxAge: '1h',
    })
  );
}

app.get('*', (_req, res) => {
  if (!fs.existsSync(indexHtmlPath)) {
    res.status(503).json({
      ok: false,
      error: 'Build frontend (dist/index.html) belum tersedia. Jalankan npm run build:frontend terlebih dahulu.',
    });
    return;
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(indexHtmlPath);
});

const server = app.listen(PORT, '0.0.0.0', () => {
  const backendUrl = resolveConfiguredBackendUrl();
  console.log(
    `SiPiket OSIS Frontend service running on http://localhost:${PORT} (API target: ${backendUrl || 'same-origin / belum disetel'})`
  );
});

function shutdown(signal: string) {
  console.log(`Frontend service received ${signal}, shutting down...`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
