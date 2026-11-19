import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  SCHOOL_IDENTITY,
  formatIndonesianDateLabel,
  formatIndonesianDateShort,
  getCategoryBreakdown,
  getConsensusProgress,
  groupViolationsByClass,
} from '../shared/piketLogic';
import type { DailySpreadsheet, PublicOfficer } from '../shared/types';

export function downloadVisualPdfReport(
  spreadsheet: DailySpreadsheet,
  officers: PublicOfficer[]
): void {
  const progress = getConsensusProgress(spreadsheet);
  if (!progress.exportUnlocked) {
    throw new Error('Laporan PDF hanya dapat diekspor setelah jam selesai piket (status Final).');
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  const officerMap = new Map(officers.map((o) => [o.id, o]));
  const classGroups = groupViolationsByClass(spreadsheet.rows);
  const categories = getCategoryBreakdown(spreadsheet.rows);
  const totalPoints = spreadsheet.rows.reduce((sum, r) => sum + r.points, 0);
  const uniqueStudents = new Set(
    spreadsheet.rows.map((r) => `${r.studentName.toLowerCase()}__${r.kelas}`)
  ).size;

  // --- Official School Header Banner ---
  doc.setFillColor(15, 23, 42); // Deep slate #0F172A
  doc.rect(0, 0, pageWidth, 34, 'F');

  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(`${SCHOOL_IDENTITY.pemerintah} · ${SCHOOL_IDENTITY.dinas}`, margin, 10);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.text(SCHOOL_IDENTITY.sekolah, margin, 16.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  doc.text(SCHOOL_IDENTITY.alamat, margin, 22);
  doc.text(SCHOOL_IDENTITY.kontak, margin, 26.8);

  // Title Bar
  let cursorY = 42;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('LAPORAN VISUAL ANGKA KREDIT PELANGGARAN SISWA (AKPS)', margin, cursorY);

  cursorY += 5.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const officerNames = spreadsheet.activeOfficers
    .map((id) => officerMap.get(id)?.name ?? id)
    .join(', ');
  doc.text(
    `Hari/Tanggal: ${formatIndonesianDateLabel(spreadsheet.date, spreadsheet.hari)}  |  Petugas Piket: ${officerNames}`,
    margin,
    cursorY
  );

  // --- 4 KPI Cards (Vector Visual Blocks) ---
  cursorY += 6;
  const kpiGap = 4;
  const kpiWidth = (contentWidth - kpiGap * 3) / 4;
  const kpiHeight = 19;
  const kpis = [
    { label: 'Total Pelanggaran', value: `${spreadsheet.rows.length}`, accent: [37, 99, 235] as const },
    { label: 'Total Angka Kredit', value: `${totalPoints} Poin`, accent: [220, 38, 38] as const },
    { label: 'Kelas Terdampak', value: `${classGroups.length} Kelas`, accent: [13, 148, 136] as const },
    { label: 'Siswa Tercatat', value: `${uniqueStudents} Siswa`, accent: [217, 119, 6] as const },
  ];

  kpis.forEach((item, idx) => {
    const x = margin + idx * (kpiWidth + kpiGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, cursorY, kpiWidth, kpiHeight, 2, 2, 'FD');

    // Subtle top color bar on KPI card
    doc.setFillColor(item.accent[0], item.accent[1], item.accent[2]);
    doc.rect(x, cursorY, kpiWidth, 1.5, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(item.label, x + 3, cursorY + 6.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(item.value, x + 3, cursorY + 14.5);
  });

  cursorY += kpiHeight + 8;

  // --- Visual Section: Two Side-by-Side Vector Charts ---
  const chartBoxW = (contentWidth - 6) / 2;
  const maxChartRows = Math.max(Math.min(classGroups.length, 8), 6);
  const chartBoxH = Math.max(46, 14 + maxChartRows * 6.5);

  // Left Chart: Pelanggaran & Poin per Kelas
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, cursorY, chartBoxW, chartBoxH, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('Grafik Pelanggaran per Kelas', margin + 4, cursorY + 6.5);

  if (classGroups.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Tidak ada pelanggaran tercatat.', margin + 4, cursorY + 16);
  } else {
    const maxClassPoints = Math.max(...classGroups.map((g) => g.totalPoints), 1);
    const barMaxW = chartBoxW - 42;
    classGroups.slice(0, 8).forEach((grp, idx) => {
      const y = cursorY + 13 + idx * 6.2;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(51, 65, 85);
      doc.text(grp.kelas, margin + 4, y + 3);

      // Track
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(margin + 24, y, barMaxW, 3.6, 1, 1, 'F');

      // Fill bar
      const fillW = Math.max((grp.totalPoints / maxClassPoints) * barMaxW, 3);
      doc.setFillColor(37, 99, 235);
      doc.roundedRect(margin + 24, y, fillW, 3.6, 1, 1, 'F');

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      doc.text(`${grp.totalIncidents}x (${grp.totalPoints}p)`, margin + 25.5 + barMaxW, y + 2.8);
    });
  }

  // Right Chart: Distribusi Kategori AKPS (A - F)
  const rightChartX = margin + chartBoxW + 6;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(rightChartX, cursorY, chartBoxW, chartBoxH, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('Distribusi Kategori AKPS (A–F)', rightChartX + 4, cursorY + 6.5);

  const catColors: [number, number, number][] = [
    [37, 99, 235],
    [220, 38, 38],
    [217, 119, 6],
    [124, 58, 237],
    [13, 148, 136],
    [71, 85, 105],
  ];

  categories.forEach((cat, idx) => {
    const y = cursorY + 13 + idx * 6.2;
    const shortCat = cat.category.length > 22 ? cat.category.slice(0, 21) + '...' : cat.category;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(51, 65, 85);
    doc.text(shortCat, rightChartX + 4, y + 3);

    const trackX = rightChartX + 38;
    const trackW = chartBoxW - 56;
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(trackX, y, trackW, 3.6, 1, 1, 'F');

    if (cat.count > 0) {
      const col = catColors[idx % catColors.length];
      const fillW = Math.max((cat.percentage / 100) * trackW, 2.5);
      doc.setFillColor(col[0], col[1], col[2]);
      doc.roundedRect(trackX, y, fillW, 3.6, 1, 1, 'F');
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text(`${cat.count} (${cat.percentage}%)`, trackX + trackW + 2, y + 2.8);
  });

  cursorY += chartBoxH + 8;

  // --- Tables Separated by Class ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Rincian Pelanggaran Dipisahkan per Kelas', margin, cursorY);
  cursorY += 4;

  if (classGroups.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('Nihil — Tidak ada pelanggaran siswa tercatat pada sesi ini.', margin, cursorY + 5);
    cursorY += 12;
  } else {
    for (const grp of classGroups) {
      if (cursorY > pageHeight - 45) {
        doc.addPage();
        cursorY = 18;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(30, 58, 138);
      doc.text(
        `Kelas ${grp.kelas}  —  ${grp.totalIncidents} Catatan  ·  Total ${grp.totalPoints} Poin`,
        margin,
        cursorY + 4
      );

      autoTable(doc, {
        startY: cursorY + 6,
        margin: { left: margin, right: margin },
        theme: 'grid',
        styles: {
          font: 'helvetica',
          fontSize: 7.5,
          cellPadding: 2.2,
          textColor: [30, 41, 59],
          lineColor: [226, 232, 240],
          lineWidth: 0.2,
        },
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontStyle: 'bold',
        },
        columnStyles: {
          0: { halign: 'center', cellWidth: 8 },
          1: { halign: 'center', cellWidth: 12 },
          2: { halign: 'center', cellWidth: 13 },
          3: { cellWidth: 34 },
          4: { cellWidth: 52 },
          5: { halign: 'right', cellWidth: 13, fontStyle: 'bold', textColor: [185, 28, 28] },
          6: { cellWidth: 34 },
          7: { cellWidth: 16 },
        },
        head: [['No', 'Jam', 'Kode', 'Nama Siswa', 'Jenis Pelanggaran', 'Poin', 'Tindak Lanjut', 'Petugas']],
        body: grp.rows.map((r, idx) => [
          idx + 1,
          r.timeLabel,
          r.violationCode || '-',
          r.studentName,
          `${r.violationLabel}${r.notes ? `\n(${r.notes})` : ''}`,
          `+${r.points}`,
          r.actionTaken,
          r.recordedByName.split(' ')[0],
        ]),
      });

      cursorY = ((doc as any).lastAutoTable?.finalY ?? cursorY + 20) + 6;
    }
  }

  // --- Footer: AKPS Legend & Official Signature Block ---
  if (cursorY > pageHeight - 52) {
    doc.addPage();
    cursorY = 20;
  }

  doc.setDrawColor(226, 232, 240);
  doc.line(margin, cursorY, pageWidth - margin, cursorY);
  cursorY += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('Ketentuan Sanksi Akumulasi AKPS:', margin, cursorY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(71, 85, 105);
  const rules = [
    '- 15 - 25  : Teguran lisan',
    '- 26 - 50  : Surat pernyataan 1 dan panggilan orang tua 1',
    '- 51 - 75  : Surat pernyataan 2 dan panggilan orang tua 2',
    '- 76 - 99  : Panggilan orang tua 3',
    '- >= 100   : Membuat Surat Pernyataan Bermaterai',
    '- Catatan E2: Penyitaan HP sampai rambut sesuai aturan · E4: Penyitaan HP 1 minggu',
  ];
  rules.forEach((line, i) => {
    doc.text(line, margin, cursorY + 4.5 + i * 3.8);
  });

  // Signature block on right
  const sigX = pageWidth - margin - 62;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `${SCHOOL_IDENTITY.kota}, ${formatIndonesianDateShort(spreadsheet.date)}`,
    sigX,
    cursorY
  );
  doc.text('Kepala Sekolah,', sigX, cursorY + 4.5);
  doc.setFont('helvetica', 'bold');
  doc.text(SCHOOL_IDENTITY.kepalaSekolah, sigX, cursorY + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(SCHOOL_IDENTITY.nipKepalaSekolah, sigX, cursorY + 26);

  doc.save(`Laporan-Visual-AKPS-${spreadsheet.date}.pdf`);
}
