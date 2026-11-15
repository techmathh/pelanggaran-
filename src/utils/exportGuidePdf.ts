import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SCHOOL_IDENTITY, formatIndonesianDateLabel } from '../shared/piketLogic';

export function downloadUsageGuidePdf(options?: {
  serverDate?: string;
  serverHari?: string;
  developerName?: string;
}): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;

  const printedDate = options?.serverDate
    ? formatIndonesianDateLabel(
        options.serverDate,
        (options.serverHari as 'Senin' | 'Selasa' | 'Rabu' | 'Kamis' | 'Jumat' | 'Sabtu' | 'Minggu') || 'Senin'
      )
    : new Date().toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });

  // --- Header Banner ---
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 38, 'F');

  doc.setFillColor(37, 99, 235);
  doc.rect(0, 36.5, pageWidth, 1.5, 'F');

  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(`${SCHOOL_IDENTITY.pemerintah} · ${SCHOOL_IDENTITY.dinas}`, margin, 11);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text('PANDUAN PENGGUNAAN WEBSITE SIPIKET OSIS', margin, 19.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225);
  doc.text(
    `${SCHOOL_IDENTITY.sekolah} · Sistem Pencatatan Pelanggaran & Kedisiplinan (AKPS)`,
    margin,
    26.5
  );
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Dicetak oleh: ${options?.developerName || 'Developer Sistem'}  |  Tanggal: ${printedDate}`,
    margin,
    32.2
  );

  let y = 47;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 18) {
      doc.addPage();
      y = 18;
    }
  };

  const addSectionTitle = (num: string, title: string) => {
    ensureSpace(18);
    doc.setFillColor(239, 246, 255);
    doc.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(30, 58, 138);
    doc.text(`${num}. ${title}`, margin + 3.5, y + 5.5);
    y += 12;
  };

  const addParagraph = (text: string, fontSize = 9) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(51, 65, 85);
    const lines = doc.splitTextToSize(text, contentWidth);
    ensureSpace(lines.length * 4.5 + 4);
    doc.text(lines, margin, y);
    y += lines.length * 4.4 + 2.5;
  };

  // --- Bab 1 ---
  addSectionTitle('1', 'Alur Cepat Bertugas Piket Harian (Untuk Petugas OSIS)');
  addParagraph(
    'Aplikasi SiPiket OSIS dirancang agar petugas baru pun dapat mencatat pelanggaran dengan cepat tanpa kebingungan. Berikut urutan tugas harian dari awal sampai laporan selesai:'
  );

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 3,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: 46, fontStyle: 'bold' },
    },
    head: [['Langkah', 'Tahapan Kegiatan', 'Cara Melakukannya di Website']],
    body: [
      [
        '1',
        'Masuk Akun & Ganti Password Pertama',
        'Masukkan username & password dari Admin/Developer. Jika baru pertama kali masuk dengan password sementara, sistem otomatis mengarahkan ke halaman khusus aktivasi password pribadi (#/ganti-password).',
      ],
      [
        '2',
        'Cari Siswa Secara Otomatis',
        'Pada menu Piket Hari Ini, ketik beberapa huruf nama siswa (mis. "abdi" atau "nurlia") lalu klik dari daftar saran. Kelas dan NIS siswa langsung terisi otomatis.',
      ],
      [
        '3',
        'Pilih Kategori Dulu, Lalu Aturan AKPS',
        'Klik salah satu kartu kategori (A sampai F) atau pilih dari daftar. Setelah kategori dipilih, daftar aturan pelanggaran beserta poin otomatis akan muncul.',
      ],
      [
        '4',
        'Simpan ke Spreadsheet Hari Ini',
        'Tekan tombol biru "Simpan ke Spreadsheet Hari Ini". Data langsung tercatat ke tabel harian dan kartu Ringkasan Produktivitas Piket ikut bertambah.',
      ],
      [
        '5',
        'Tutup Otomatis & Unduh Laporan',
        'Spreadsheet harian dibuat otomatis pada Jam Mulai dan tertutup otomatis pada Jam Selesai yang diatur Admin/Developer. Setelah jam selesai tercapai, file Excel per Kelas (.xlsx) dan PDF Visual langsung terbuka untuk diunduh.',
      ],
    ],
  });

  y = (doc as any).lastAutoTable.finalY + 9;

  // --- Bab 2 ---
  addSectionTitle('2', 'Peran Pengguna & Pembagian Hak Akses');
  addParagraph(
    'Setiap akun memiliki peran sesuai tanggung jawabnya agar data tetap tertib, aman, dan terkendali:'
  );

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 3,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 36, fontStyle: 'bold' },
    },
    head: [['Peran', 'Hak Akses & Fitur Utama']],
    body: [
      [
        'Petugas Piket',
        'Mencatat pelanggaran sesuai minggu, hari, dan jam piketnya saat spreadsheet aktif otomatis; melihat Rekap Siswa & Arsip Piket; mengunduh laporan yang sudah tutup otomatis.',
      ],
      [
        'Admin OSIS',
        'Semua akses Petugas Piket ditambah: mengatur jam buka/tutup otomatis spreadsheet, membuat akun Petugas massal, mereset password Petugas, mengatur rotasi mingguan, Mode Uji Coba Waktu, serta membuka kembali sesi final untuk revisi.',
      ],
      [
        'Developer Sistem',
        'Akses penuh tertinggi: membuat akun Admin OSIS & Petugas, menghapus akun non-developer, mengunduh Panduan Penggunaan PDF ini, mencadangkan ke cloud, serta mereset/menghapus seluruh data sistem kecuali akun dirinya sendiri.',
      ],
    ],
  });

  y = (doc as any).lastAutoTable.finalY + 9;

  // --- Bab 3 ---
  addSectionTitle('3', 'Ketentuan Poin AKPS & Sanksi Pembinaan Otomatis');
  addParagraph(
    'Website menghitung total poin pelanggaran tiap siswa secara kumulatif dari hari ke hari di menu Rekap Siswa, lalu menampilkan tingkat pembinaan sesuai pedoman resmi SMA Negeri 1 Kemangkon:'
  );

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 2.8,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 38, fontStyle: 'bold' },
    },
    head: [['Akumulasi Poin', 'Tingkat Sanksi / Pembinaan Otomatis']],
    body: [
      ['< 15 Poin', 'Pembinaan Awal (pencatatan kedisiplinan harian)'],
      ['15 – 25 Poin', 'Teguran Lisan oleh Petugas / Wali Kelas'],
      ['26 – 50 Poin', 'Surat Pernyataan 1 & Panggilan Orang Tua 1'],
      ['51 – 75 Poin', 'Surat Pernyataan 2 & Panggilan Orang Tua 2'],
      ['76 – 99 Poin', 'Panggilan Orang Tua 3'],
      ['>= 100 Poin', 'Membuat Surat Pernyataan Bermaterai'],
    ],
  });

  y = (doc as any).lastAutoTable.finalY + 9;

  // --- Bab 4 ---
  addSectionTitle('4', 'Pengelolaan Akun, Rotasi Mingguan & Reset Data');
  addParagraph(
    '1. Pembuatan Akun Massal (Kelola Akun): Tempel daftar nama lengkap (1 baris = 1 orang, opsional tambah "| Kelas" mis. "Ahmad Fauzi | 11A"). Sistem otomatis menghasilkan username unik dan password sementara siap salin untuk WhatsApp atau ekspor Excel.'
  );
  addParagraph(
    '2. Sistem Rotasi Mingguan Otomatis (Jadwal & Aturan): Jadwal piket bergilir per minggu (siklus 1–4 minggu) dan berganti otomatis setiap hari Senin. Gunakan tombol "Bagi Rata Petugas per Minggu" untuk membagi petugas secara seimbang.'
  );
  addParagraph(
    '3. Keamanan Sesi & Penghapusan Akun: Jika suatu akun dihapus oleh Developer/Admin atau ikut terhapus saat Reset Data Sistem, sesi login pemilik akun tersebut akan langsung terdeteksi dan otomatis keluar (logout) demi keamanan.'
  );
  addParagraph(
    '4. Reset / Hapus Semua Data Sistem (Khusus Developer): Di menu Kelola Akun -> Panel Kontrol Developer, Developer dapat mereset seluruh catatan pelanggaran, spreadsheet arsip, aturan tambahan, dan seluruh akun lain sambil tetap mempertahankan akun Developer pribadi agar dapat langsung memulai periode/tahun ajaran baru.'
  );

  // --- Bab 5: FAQ ---
  addSectionTitle('5', 'Solusi Cepat Kendala Umum (FAQ)');
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.3,
      cellPadding: 2.8,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 58, fontStyle: 'bold' },
    },
    head: [['Kendala yang Dialami', 'Penyebab & Cara Mengatasi']],
    body: [
      [
        'Formulir pencatatan terkunci dengan pesan di luar jadwal',
        'Saat ini berada di luar minggu, hari, atau jam piket petugas tersebut (default 06:30–08:30 WIB). Admin/Developer dapat membuka akses uji coba di menu Jadwal & Aturan.',
      ],
      [
        'Tombol Unduh Excel & PDF masih terkunci (abu-abu)',
        'Spreadsheet hari ini masih berstatus Aktif karena belum melewati Jam Selesai yang ditetapkan. Setelah jam selesai tiba, spreadsheet tertutup otomatis dan unduhan langsung terbuka.',
      ],
      [
        'Petugas lupa password setelah menggantinya',
        'Hubungi Admin OSIS atau Developer untuk menekan "Buat Ulang Password" di menu Kelola Akun, lalu login kembali dengan password sementara baru.',
      ],
      [
        'Tiba-tiba keluar ke halaman login',
        'Sesi login berakhir (lebih dari 12 jam) atau akun Anda baru saja dihapus oleh pengelola sistem.',
      ],
    ],
  });

  // Page footer numbers
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `SiPiket OSIS — SMA Negeri 1 Kemangkon`,
      margin,
      pageHeight - 8
    );
    doc.text(
      `Halaman ${i} dari ${totalPages}`,
      pageWidth - margin,
      pageHeight - 8,
      { align: 'right' }
    );
  }

  doc.save('Panduan-Penggunaan-SiPiket-OSIS.pdf');
}
