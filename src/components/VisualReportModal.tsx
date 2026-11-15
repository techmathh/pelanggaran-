import { useEffect } from 'react';
import { Download, FileText, X } from 'lucide-react';
import {
  SCHOOL_IDENTITY,
  formatIndonesianDateLabel,
  formatIndonesianDateShort,
  getCategoryBreakdown,
  groupViolationsByClass,
} from '../shared/piketLogic';
import type { DailySpreadsheet, PublicOfficer } from '../shared/types';
import { downloadVisualPdfReport } from '../utils/exportVisualPdf';

interface VisualReportModalProps {
  spreadsheet: DailySpreadsheet;
  officers: PublicOfficer[];
  onClose: () => void;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const CAT_BAR_COLORS = [
  'bg-blue-600',
  'bg-red-600',
  'bg-amber-600',
  'bg-violet-600',
  'bg-teal-600',
  'bg-slate-600',
];

export function VisualReportModal({
  spreadsheet,
  officers,
  onClose,
  onNotify,
}: VisualReportModalProps) {
  const officerMap = new Map(officers.map((o) => [o.id, o]));
  const classGroups = groupViolationsByClass(spreadsheet.rows);
  const categories = getCategoryBreakdown(spreadsheet.rows);
  const totalPoints = spreadsheet.rows.reduce((sum, r) => sum + r.points, 0);
  const uniqueStudents = new Set(
    spreadsheet.rows.map((r) => `${r.studentName.toLowerCase()}__${r.kelas}`)
  ).size;
  const maxClassPoints = Math.max(...classGroups.map((g) => g.totalPoints), 1);

  function handleDownloadPdf() {
    try {
      downloadVisualPdfReport(spreadsheet, officers);
      onNotify(`Berhasil mengunduh Laporan-Visual-AKPS-${spreadsheet.date}.pdf`, 'success');
    } catch (err: any) {
      onNotify(err?.message || 'Gagal membuat laporan PDF.', 'error');
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="visual-report-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
    >
      <div className="animate-panel-reveal flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Modal Top Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <FileText className="h-5 w-5 text-blue-600" aria-hidden="true" />
            <div>
              <h2 id="visual-report-title" className="font-display text-base font-bold text-slate-900">
                Pratinjau Laporan Visual (Ekspor PDF)
              </h2>
              <p className="text-xs text-slate-500">
                {formatIndonesianDateLabel(spreadsheet.date, spreadsheet.hari)} · Dipisahkan per Kelas
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="btn-3d-primary inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Unduh PDF Visual (.pdf)</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup pratinjau laporan visual"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Scrollable Report Canvas */}
        <div className="overflow-y-auto bg-slate-100 p-4 sm:p-6">
          <div className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {/* Official Header */}
            <div className="bg-slate-900 px-6 py-5 text-white">
              <p className="text-[11px] font-semibold tracking-wide text-slate-300">
                {SCHOOL_IDENTITY.pemerintah} · {SCHOOL_IDENTITY.dinas}
              </p>
              <h3 className="mt-1 font-display text-lg font-bold tracking-tight sm:text-xl">
                {SCHOOL_IDENTITY.sekolah}
              </h3>
              <p className="mt-1 text-xs text-slate-300">{SCHOOL_IDENTITY.alamat}</p>
              <p className="text-xs text-slate-400">{SCHOOL_IDENTITY.kontak}</p>
            </div>

            <div className="space-y-6 p-6">
              {/* Report Title & Metadata */}
              <div className="border-b border-slate-200 pb-4">
                <h4 className="font-display text-base font-bold text-slate-900">
                  LAPORAN VISUAL ANGKA KREDIT PELANGGARAN SISWA (AKPS)
                </h4>
                <p className="mt-1 text-xs text-slate-600">
                  Tanggal: <strong>{formatIndonesianDateLabel(spreadsheet.date, spreadsheet.hari)}</strong> ·
                  Petugas Piket:{' '}
                  <strong>
                    {spreadsheet.activeOfficers
                      .map((id) => officerMap.get(id)?.name ?? id)
                      .join(', ')}
                  </strong>
                </p>
              </div>

              {/* 4 KPI Cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <p className="text-xs text-slate-500">Total Pelanggaran</p>
                  <p className="font-mono-num mt-1 text-2xl font-bold text-blue-700">
                    {spreadsheet.rows.length}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <p className="text-xs text-slate-500">Total Angka Kredit</p>
                  <p className="font-mono-num mt-1 text-2xl font-bold text-red-700">
                    {totalPoints}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <p className="text-xs text-slate-500">Kelas Terdampak</p>
                  <p className="font-mono-num mt-1 text-2xl font-bold text-teal-700">
                    {classGroups.length}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <p className="text-xs text-slate-500">Siswa Tercatat</p>
                  <p className="font-mono-num mt-1 text-2xl font-bold text-amber-700">
                    {uniqueStudents}
                  </p>
                </div>
              </div>

              {/* Dual Visual Charts */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* Chart 1: Pelanggaran & Poin per Kelas */}
                <div className="rounded-xl border border-slate-200 p-4">
                  <h5 className="font-display text-sm font-bold text-slate-900">
                    Grafik Pelanggaran per Kelas
                  </h5>
                  <p className="text-xs text-slate-500">
                    Perbandingan poin AKPS dan jumlah kasus tiap kelas
                  </p>

                  {classGroups.length === 0 ? (
                    <p className="mt-6 text-center text-xs text-slate-400">
                      Nihil — belum ada pelanggaran tercatat.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-2.5">
                      {classGroups.map((grp) => (
                        <div key={grp.kelas} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-mono-num font-semibold text-slate-800">
                              {grp.kelas}
                            </span>
                            <span className="font-mono-num text-slate-600">
                              {grp.totalIncidents} kasus · {grp.totalPoints} poin
                            </span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-blue-600"
                              style={{
                                width: `${Math.max((grp.totalPoints / maxClassPoints) * 100, 8)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Chart 2: Distribusi Kategori AKPS */}
                <div className="rounded-xl border border-slate-200 p-4">
                  <h5 className="font-display text-sm font-bold text-slate-900">
                    Distribusi Kategori AKPS (A–F)
                  </h5>
                  <p className="text-xs text-slate-500">
                    Proporsi pelanggaran berdasarkan bab aturan AKPS
                  </p>

                  <div className="mt-4 space-y-2.5">
                    {categories.map((cat, idx) => (
                      <div key={cat.category} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate font-medium text-slate-700">
                            {cat.category}
                          </span>
                          <span className="font-mono-num shrink-0 text-slate-600">
                            {cat.count} ({cat.percentage}%)
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${CAT_BAR_COLORS[idx % CAT_BAR_COLORS.length]}`}
                            style={{ width: `${cat.count > 0 ? Math.max(cat.percentage, 6) : 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Per-Class Grouped Tables */}
              <div className="space-y-4">
                <h5 className="font-display text-sm font-bold text-slate-900">
                  Rincian Pelanggaran Dipisahkan Berdasarkan Kelas
                </h5>

                {classGroups.length === 0 ? (
                  <p className="rounded-xl border border-slate-200 p-4 text-center text-xs text-slate-500">
                    Tidak ada pelanggaran yang tercatat pada hari ini.
                  </p>
                ) : (
                  classGroups.map((grp) => (
                    <div key={grp.kelas} className="overflow-hidden rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5 border-b border-slate-200">
                        <span className="font-display text-sm font-bold text-slate-900">
                          Kelas {grp.kelas}
                        </span>
                        <span className="font-mono-num text-xs font-semibold text-slate-600">
                          {grp.totalIncidents} Catatan · Total {grp.totalPoints} Poin
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-white text-slate-500">
                              <th className="px-3 py-2 w-10 text-center">No</th>
                              <th className="px-3 py-2 w-14">Jam</th>
                              <th className="px-3 py-2 w-14">Kode</th>
                              <th className="px-3 py-2">Siswa</th>
                              <th className="px-3 py-2">Pelanggaran</th>
                              <th className="px-3 py-2 text-right w-14">Poin</th>
                              <th className="px-3 py-2">Tindak Lanjut</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {grp.rows.map((r, idx) => (
                              <tr key={r.id}>
                                <td className="font-mono-num px-3 py-2 text-center text-slate-500">
                                  {idx + 1}
                                </td>
                                <td className="font-mono-num px-3 py-2 text-slate-600">
                                  {r.timeLabel}
                                </td>
                                <td className="font-mono-num px-3 py-2 font-semibold text-blue-700">
                                  {r.violationCode || '-'}
                                </td>
                                <td className="px-3 py-2">
                                  <p className="font-medium text-slate-900">{r.studentName}</p>
                                  <p className="font-mono-num text-[11px] text-slate-500">
                                    NIS {r.studentNis}
                                  </p>
                                </td>
                                <td className="px-3 py-2 text-slate-800">{r.violationLabel}</td>
                                <td className="font-mono-num px-3 py-2 text-right font-bold text-red-700">
                                  +{r.points}
                                </td>
                                <td className="px-3 py-2 text-slate-600">{r.actionTaken}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Official AKPS Footer & Signature */}
              <div className="grid grid-cols-1 gap-6 border-t border-slate-200 pt-5 sm:grid-cols-12">
                <div className="text-xs text-slate-600 sm:col-span-7">
                  <p className="font-semibold text-slate-900">
                    Sanksi Akumulasi Angka Kredit Pelanggaran (AKPS):
                  </p>
                  <ul className="mt-1.5 space-y-0.5 text-[11px]">
                    <li>15 – 25 : Teguran lisan</li>
                    <li>26 – 50 : Surat pernyataan 1 dan panggilan orang tua 1</li>
                    <li>51 – 75 : Surat pernyataan 2 dan panggilan orang tua 2</li>
                    <li>76 – 99 : Panggilan orang tua 3</li>
                    <li>100 poin atau lebih : Membuat Surat Pernyataan Bermaterai</li>
                  </ul>
                  <p className="mt-2 text-[11px] text-slate-500">
                    Catatan: E2 penyitaan HP sampai rambut sesuai aturan · E4 penyitaan HP 1 minggu.
                  </p>
                </div>

                <div className="text-xs text-slate-800 sm:col-span-5 sm:text-right">
                  <p>
                    {SCHOOL_IDENTITY.kota}, {formatIndonesianDateShort(spreadsheet.date)}
                  </p>
                  <p className="mt-0.5">Kepala Sekolah,</p>
                  <div className="h-12" />
                  <p className="font-bold text-slate-900">{SCHOOL_IDENTITY.kepalaSekolah}</p>
                  <p className="font-mono-num text-[11px] text-slate-600">
                    {SCHOOL_IDENTITY.nipKepalaSekolah}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
