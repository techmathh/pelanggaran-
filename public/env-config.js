// Runtime configuration hook for separated Frontend deployments.
// In separated Railway Frontend deployments (frontend-server.ts),
// GET /env-config.js is served dynamically with API_BASE_URL / VITE_API_BASE_URL.
window.__SIPIKET_CONFIG__ = window.__SIPIKET_CONFIG__ || {};
