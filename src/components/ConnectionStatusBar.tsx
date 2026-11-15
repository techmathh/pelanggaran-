import { CheckCircle2, RefreshCw, WifiOff, X } from 'lucide-react';
import type { ConnectionBannerInfo } from '../shared/connectionLogic';

interface ConnectionStatusBarProps {
  banner: ConnectionBannerInfo;
  isChecking: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}

export function ConnectionStatusBar({
  banner,
  isChecking,
  onRetry,
  onDismiss,
}: ConnectionStatusBarProps) {
  if (!banner.visible) {
    return null;
  }

  const toneClasses =
    banner.tone === 'red'
      ? 'border-b border-red-700/20 bg-red-600 text-white'
      : banner.tone === 'amber'
        ? 'border-b border-amber-500/30 bg-amber-500 text-slate-950'
        : 'border-b border-emerald-700/20 bg-emerald-600 text-white';

  const buttonClasses =
    banner.tone === 'amber'
      ? 'border-slate-900/20 bg-slate-950/10 text-slate-950 hover:bg-slate-950/15'
      : 'border-white/25 bg-white/15 text-white hover:bg-white/25';

  return (
    <div
      role={banner.role}
      aria-live={banner.role === 'alert' ? 'assertive' : 'polite'}
      data-testid="connection-status-bar"
      className={`animate-panel-reveal w-full px-3 py-1.5 text-xs transition-colors sm:px-6 ${toneClasses}`}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {banner.tone === 'emerald' ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : banner.tone === 'amber' ? (
            <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <p className="min-w-0 leading-snug">
            <span className="font-semibold">{banner.title}</span>
            <span className="mx-1.5 hidden opacity-70 sm:inline" aria-hidden="true">
              —
            </span>
            <span className="block opacity-95 sm:inline">{banner.detail}</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {banner.actionLabel && (
            <button
              type="button"
              disabled={isChecking}
              onClick={onRetry}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-60 ${buttonClasses}`}
            >
              <RefreshCw
                className={`h-3 w-3 ${isChecking ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{isChecking ? 'Memeriksa...' : banner.actionLabel}</span>
            </button>
          )}
          {banner.tone === 'emerald' && (
            <button
              type="button"
              aria-label="Tutup pemberitahuan koneksi"
              onClick={onDismiss}
              className="rounded-md p-1 text-white/90 transition-colors hover:bg-white/15 hover:text-white"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
