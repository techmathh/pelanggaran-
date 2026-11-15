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

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'OS';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
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
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:gap-8">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('piket')}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 transition-colors hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          SiPiket OSIS
        </button>

        {/* Zone 2: Concise single-line navigation links */}
        <nav
          aria-label="Navigasi utama"
          className="hidden lg:flex items-center gap-6"
        >
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-1.5 text-sm font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                  isActive
                    ? 'font-semibold text-blue-700'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-0 -bottom-3 h-0.5 rounded-full bg-blue-600 transition-transform duration-200 origin-center ${
                    isActive ? 'scale-x-100 opacity-100' : 'scale-x-0 opacity-0'
                  }`}
                />
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Active session identity & logout */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          <div className="hidden sm:flex items-center gap-2.5">
            <div
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-xs"
              style={{ backgroundColor: officer.avatarColor || '#2563EB' }}
            >
              {getInitials(officer.name)}
            </div>
            <div className="flex flex-col items-start leading-tight">
              <span className="text-xs font-semibold text-slate-800 truncate max-w-[150px]">
                {officer.name}
              </span>
              <span className="text-[11px] text-slate-500">
                {getRoleLabel(officer.role)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] whitespace-nowrap shrink-0 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
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
              className={`flex-1 rounded-md px-2.5 py-1.5 text-center text-xs font-medium whitespace-nowrap shrink-0 transition-all ${
                isActive
                  ? 'bg-blue-50 text-blue-700 font-semibold shadow-2xs'
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
