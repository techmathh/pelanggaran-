import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, Download, Eye, FileSpreadsheet, FileText } from 'lucide-react';
import { formatIndonesianDateLabel, getConsensusProgress } from '../shared/piketLogic';
import type { PublicAppState } from '../shared/types';
import { downloadSpreadsheetCsv, downloadSpreadsheetXlsx } from '../utils/exportSpreadsheet';
import { downloadVisualPdfReport } from '../utils/exportVisualPdf';
import { VisualReportModal } from './VisualReportModal';

interface ArchiveViewProps {
  appState: PublicAppState;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function ArchiveView({ appState, onNotify }: ArchiveViewProps) {
  const sortedSheets = useMemo(
    () => [...appState.spreadsheets].sort((a, b) => b.date.localeCompare(a.date)),
    [appState.spreadsheets]
  );

  const [selectedId, setSelectedId] = useState<string>(sortedSheets[0]?.id ?? '');
  const [previewVisual, setPreviewVisual] = useState(false);

  const selectedSheet =
    sortedSheets.find((s) => s.id === selectedId) ?? sortedSheets[0] ?? null;

  const officerMap = useMemo(
    () => new Map(appState.officers.map((o) => [o.id, o])),
    [appState.officers]
  );

  function handleExportXlsx(sheetId: string) {
    const sheet = sortedSheets.find((s) => s.id === sheetId);
    if (!sheet) return;
    try {
      downloadSpreadsheetXlsx(sheet, appState.officers);
      onNotify(`Berhasil mengunduh Piket-OSIS-${sheet.date}.xlsx`, 'success');
    } catch (err: any) {
      onNotify(err?.message || 'Spreadsheet belum selesai dikonfirmasi.', 'error');
    }
  }

  function handleExportPdf(sheetId: string) {
    const sheet = sortedSheets.find((s) => s.id === sheetId);
    if (!sheet) return;
    const consensus = getConsensusProgress(sheet);
    if (!consensus.exportUnlocked) {
      onNotify('Ekspor terkunci sampai seluruh petugas aktif menekan Selesai.', 'error');
      return;
    }
    try {
      downloadVisualPdfReport(sheet, appState.officers);
      onNotify(`Berhasil mengunduh Laporan-Visual-AKPS-${sheet.date}.pdf`, 'success');
    } catch (err: any) {
      onNotify(err?.message || 'Gagal membuat laporan PDF.', 'error');
    }
  }

  function handleExportCsv(sheetId: string) {
    const sheet = sortedSheets.find((s) => s.id === sheetId);
    if (!sheet) return;
    const consensus = getConsensusProgress(sheet);
    if (!consensus.exportUnlocked) {
      onNotify('Ekspor terkunci sampai seluruh petugas aktif menekan Selesai.', 'error');
      return;
    }
    downloadSpreadsheetCsv(sheet);
    onNotify(`Berhasil mengunduh Piket-OSIS-${sheet.date}.csv`, 'success');
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <h1 className="font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          Arsip Laporan Piket Harian
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Daftar laporan catatan piket dari hari-hari sebelumnya. Laporan yang sudah selesai bisa
          langsung dilihat dan diunduh dalam bentuk Excel per Kelas maupun PDF Visual.
        </p>
      </section>

      {sortedSheets.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          Belum ada arsip laporan piket.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Sheet List */}
          <div className="space-y-2.5 lg:col-span-4">
            {sortedSheets.map((sheet) => {
              const isSelected = selectedSheet?.id === sheet.id;
              const consensus = getConsensusProgress(sheet);
              const totalPoints = sheet.rows.reduce((sum, r) => sum + r.points, 0);

              return (
                <button
                  key={sheet.id}
                  type="button"
                  onClick={() => setSelectedId(sheet.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50/40'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono-num text-xs font-semibold text-slate-500">
                      {sheet.date}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold ${
                        sheet.status === 'FINALIZED' ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {sheet.status === 'FINALIZED' ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Selesai</span>
                        </>
                      ) : (
                        <>
                          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Aktif ({consensus.finishedCount}/{consensus.activeCount})</span>
                        </>
                      )}
                    </span>
                  </div>
                  <p className="mt-1.5 font-display text-sm font-bold text-slate-900">
                    {formatIndonesianDateLabel(sheet.date, sheet.hari)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    <span className="font-mono-num">{sheet.rows.length}</span> pelanggaran ·{' '}
                    <span className="font-mono-num">{totalPoints}</span> poin · Oleh {sheet.createdByName}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Selected Sheet Preview */}
          {selectedSheet && (
            <div className="rounded-2xl border border-slate-200 bg-white lg:col-span-8">
              <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-bold text-slate-900 break-words">
                    {selectedSheet.title}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Petugas aktif:{' '}
                    {selectedSheet.activeOfficers
                      .map((id) => officerMap.get(id)?.name ?? id)
                      .join(', ')}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={selectedSheet.status !== 'FINALIZED'}
                    onClick={() => handleExportXlsx(selectedSheet.id)}
                    className="btn-3d-soft inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Excel per Kelas (.xlsx)</span>
                  </button>

                  <button
                    type="button"
                    disabled={selectedSheet.status !== 'FINALIZED'}
                    onClick={() => handleExportPdf(selectedSheet.id)}
                    className="btn-3d-soft inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>PDF Visual</span>
                  </button>

                  <button
                    type="button"
                    disabled={selectedSheet.status !== 'FINALIZED'}
                    onClick={() => setPreviewVisual(true)}
                    className="btn-3d-soft inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Pratinjau</span>
                  </button>

                  <button
                    type="button"
                    disabled={selectedSheet.status !== 'FINALIZED'}
                    onClick={() => handleExportCsv(selectedSheet.id)}
                    className="btn-3d-soft inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>CSV</span>
                  </button>
                </div>
              </div>

              {selectedSheet.status !== 'FINALIZED' && (
                <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800 sm:px-5">
                  Laporan ini masih berstatus Aktif. Tombol unduh Excel, PDF, dan pratinjau akan
                  terbuka setelah semua petugas menekan <strong>Tandai Selesai Mencatat</strong> di
                  menu <strong>Piket Hari Ini</strong>.
                </div>
              )}

              <div className="overflow-x-auto">
                {selectedSheet.rows.length === 0 ? (
                  <div className="px-6 py-12 text-center text-sm text-slate-500">
                    Spreadsheet ini belum memiliki catatan pelanggaran.
                  </div>
                ) : (
                  <table className="min-w-[680px] w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="px-4 py-3 w-16">Jam</th>
                        <th className="px-4 py-3 w-16">Kode</th>
                        <th className="px-4 py-3">Siswa</th>
                        <th className="px-4 py-3">Kelas</th>
                        <th className="px-4 py-3">Pelanggaran</th>
                        <th className="px-4 py-3 text-right">Poin</th>
                        <th className="px-4 py-3">Petugas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedSheet.rows.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50/70">
                          <td className="font-mono-num px-4 py-3 text-xs text-slate-600">
                            {row.timeLabel}
                          </td>
                          <td className="font-mono-num px-4 py-3 text-xs font-semibold text-blue-700">
                            {row.violationCode || '-'}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{row.studentName}</p>
                            <p className="font-mono-num text-xs text-slate-500">
                              NIS {row.studentNis}
                            </p>
                          </td>
                          <td className="font-mono-num px-4 py-3 text-xs font-semibold text-slate-700">
                            {row.kelas}
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-slate-900">{row.violationLabel}</p>
                            <p className="text-xs text-slate-500">{row.actionTaken}</p>
                          </td>
                          <td className="font-mono-num px-4 py-3 text-right font-semibold text-red-700">
                            +{row.points}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">
                            {row.recordedByName}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {previewVisual && selectedSheet && (
        <VisualReportModal
          spreadsheet={selectedSheet}
          officers={appState.officers}
          onClose={() => setPreviewVisual(false)}
          onNotify={onNotify}
        />
      )}
    </div>
  );
}
