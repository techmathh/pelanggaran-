import { LogOut } from 'lucide-react';
import { getRoleLabel, isManagerRole } from '../shared/piketLogic';
import type { PublicOfficer } from '../shared/types';

export type ActiveTab = 'piket' | 'rekap' | 'arsip' | 'jadwal' | 'akun';

interface TopBarProps {
  officer: PublicOfficer;
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onLogout: () => void;
}

export function TopBar({
  officer,
  activeTab,
  onSelectTab,
  onLogout,
}: TopBarProps) {
  const canManageAccounts = isManagerRole(officer.role);

  const navItems: { id: ActiveTab; label: string; mobileLabel: string }[] = [
    { id: 'piket', label: 'Piket Hari Ini', mobileLabel: 'Piket' },
    { id: 'rekap', label: 'Rekap Siswa', mobileLabel: 'Rekap' },
    { id: 'arsip', label: 'Arsip Piket', mobileLabel: 'Arsip' },
    { id: 'jadwal', label: 'Jadwal & Aturan', mobileLabel: 'Jadwal' },
    ...(canManageAccounts
      ? [{ id: 'akun' as ActiveTab, label: 'Kelola Akun', mobileLabel: 'Akun' }]
      : []),
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:gap-8">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('piket')}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          SiPiket OSIS
        </button>

        {/* Zone 2: Concise single-line navigation links */}
        <nav
          aria-label="Navigasi utama"
          className="hidden lg:flex items-center gap-5 xl:gap-6"
        >
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-1 text-sm font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                  isActive
                    ? 'text-blue-600'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
                {isActive && (
                  <span className="absolute inset-x-0 -bottom-3 h-0.5 bg-blue-600" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Active session identity & logout */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-xs font-semibold text-slate-800 truncate max-w-[160px]">
              {officer.name}
            </span>
            <span className="text-[11px] text-slate-500">
              {getRoleLabel(officer.role)}
            </span>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Keluar</span>
          </button>
        </div>
      </div>

      {/* Mobile & tablet compact navigation */}
      <nav
        aria-label="Navigasi seluler"
        className="flex lg:hidden items-center justify-between gap-1 overflow-x-auto border-t border-slate-100 px-3 py-2"
      >
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`flex-1 rounded-md px-2.5 py-1.5 text-center text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {item.mobileLabel}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
