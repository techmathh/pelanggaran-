export type ServerExecutionMode = 'backend-only' | 'fullstack-dev' | 'fullstack-prod';

export function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

export function parseAllowedOrigins(raw?: string): string[] {
  if (!raw || !raw.trim()) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of raw.split(/[\n,;]+/)) {
    const trimmed = part.trim().replace(/\/+$/, '');
    if (!trimmed) continue;
    if (trimmed === '*') {
      if (!seen.has('*')) {
        seen.add('*');
        result.push('*');
      }
      continue;
    }
    const normalized = trimmed.includes('*') ? trimmed.toLowerCase() : normalizeOrigin(trimmed);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

export function isOriginAllowed(
  requestOrigin: string | undefined,
  allowedOrigins: string[]
): boolean {
  if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
    return true;
  }
  if (!requestOrigin) return false;
  const normalizedRequest = normalizeOrigin(requestOrigin);
  if (!normalizedRequest) return false;

  for (const pattern of allowedOrigins) {
    if (pattern === normalizedRequest) return true;

    // Support wildcard subdomain pattern such as https://*.up.railway.app or https://*.vercel.app
    if (pattern.includes('*.')) {
      const wildcardMatch = pattern.match(/^(https?:)\/\/\*\.([a-z0-9.-]+(?::\d+)?)$/i);
      if (wildcardMatch) {
        const [, proto, suffix] = wildcardMatch;
        try {
          const reqUrl = new URL(normalizedRequest);
          const reqHost = reqUrl.host.toLowerCase();
          if (
            reqUrl.protocol.toLowerCase() === proto.toLowerCase() &&
            reqHost.endsWith(`.${suffix.toLowerCase()}`) &&
            reqHost.length > suffix.length + 1
          ) {
            return true;
          }
        } catch {
          // ignore invalid request origin URL
        }
      }
    }
  }

  return false;
}

export function normalizeApiBaseUrl(raw?: string): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') {
    return '';
  }
  return trimmed;
}

export function resolveFrontendApiBaseUrl(
  compileTimeBase?: string,
  runtimeBase?: string
): string {
  const fromRuntime = normalizeApiBaseUrl(runtimeBase);
  if (fromRuntime) return fromRuntime;
  return normalizeApiBaseUrl(compileTimeBase);
}

export function resolveServerExecutionMode(
  env: Record<string, string | undefined>,
  argv: string[],
  hasDistIndex: boolean
): ServerExecutionMode {
  const backendOnlyFlag =
    argv.includes('--backend-only') ||
    env.BACKEND_ONLY?.trim().toLowerCase() === 'true' ||
    env.SERVE_FRONTEND?.trim().toLowerCase() === 'false';

  if (backendOnlyFlag) {
    return 'backend-only';
  }
  if (env.NODE_ENV !== 'production') {
    return 'fullstack-dev';
  }
  return hasDistIndex ? 'fullstack-prod' : 'backend-only';
}
