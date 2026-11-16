import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationBarProps {
  page: number;
  totalPages: number;
  totalItems: number;
  startIndex: number;
  endIndex: number;
  pageSize: number | 'ALL';
  pageSizeOptions: number[];
  itemLabel: string;
  onPageChange: (nextPage: number) => void;
  onPageSizeChange: (nextSize: number | 'ALL') => void;
}

export function PaginationBar({
  page,
  totalPages,
  totalItems,
  startIndex,
  endIndex,
  pageSize,
  pageSizeOptions,
  itemLabel,
  onPageChange,
  onPageSizeChange,
}: PaginationBarProps) {
  if (totalItems === 0) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/40 px-4 py-3 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span>
          Menampilkan{' '}
          <strong className="font-mono-num text-slate-900">
            {startIndex}–{endIndex}
          </strong>{' '}
          dari <strong className="font-mono-num text-slate-900">{totalItems}</strong> {itemLabel}
        </span>

        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
          {pageSizeOptions.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onPageSizeChange(opt)}
              className={`font-mono-num rounded-md px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                pageSize === opt
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {opt}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onPageSizeChange('ALL')}
            className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
              pageSize === 'ALL'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            Semua
          </button>
        </div>
      </div>

      {pageSize !== 'ALL' && totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <button
            type="button"
            aria-label="Halaman sebelumnya"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sebelumnya</span>
          </button>

          <span className="font-mono-num px-1.5 text-xs font-semibold text-slate-700 whitespace-nowrap">
            Hal {page} / {totalPages}
          </span>

          <button
            type="button"
            aria-label="Halaman berikutnya"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
          >
            <span>Berikutnya</span>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
