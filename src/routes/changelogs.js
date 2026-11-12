const express = require('express');
const { getDb } = require('../db/database');
const { authenticate, requireRole, logActivity } = require('../middleware/auth');

const router = express.Router();

const DEFAULT_CHANGELOGS = [
  {
    versi: 'v1.3.0',
    judul: 'Fitur Changelog Publik & Penghapusan Verifikasi KPA',
    tanggal: '2026-11-12',
    tipe: 'major',
    perubahan: [
      {
        kategori: 'Fitur Baru',
        platform: 'Web & Mobile',
        deskripsi: 'Menambahkan menu dan halaman Changelog (Riwayat Pembaruan Sistem) yang dapat dilihat oleh seluruh pengguna (KPA, Kasubbag, dan Pegawai/Anggota).'
      },
      {
        kategori: 'Perubahan',
        platform: 'Web, Mobile & Backend',
        deskripsi: 'Menghapus alur dan status verifikasi kegiatan harian oleh KPA di seluruh halaman (Dashboard, Kegiatan Harian, Kalender, Laporan Cetak/Excel, dan Aplikasi Mobile) sehingga pencatatan kegiatan langsung tercatat tanpa menunggu verifikasi KPA.'
      },
      {
        kategori: 'Fitur Baru',
        platform: 'Web',
        deskripsi: 'Admin/KPA kini dapat menambahkan catatan rilis (changelog) baru secara langsung dari halaman Changelog.'
      }
    ]
  },
  {
    versi: 'v1.2.0',
    judul: 'Kamera Geotag GPS & Timestamp, Input Web & Mobile, Export Periode & Hold RK',
    tanggal: '2026-11-12',
    tipe: 'major',
    perubahan: [
      {
        kategori: 'Fitur Baru',
        platform: 'Mobile',
        deskripsi: 'Kamera bukti dukung pada SI-CKP Mobile otomatis menangkap titik koordinat GPS (Latitude, Longitude, Akurasi) dan Timestamp, lalu mencetak watermark langsung pada foto serta menyimpan metadatanya.'
      },
      {
        kategori: 'Fitur Baru',
        platform: 'Web & Mobile',
        deskripsi: 'Fitur Download Hasil Kerja per Periode dalam format Excel (.xlsx) dan Cetak/PDF tersedia langsung di Dashboard, Kegiatan Harian, Nilai CKP, serta Aplikasi Mobile.'
      },
      {
        kategori: 'Perubahan',
        platform: 'Web',
        deskripsi: 'Mengaktifkan kembali fitur tambah, edit, dan hapus kegiatan harian serta unggah bukti dukung pada Website sehingga pegawai dapat menginput dari Web maupun Mobile.'
      },
      {
        kategori: 'Perubahan',
        platform: 'Web, Mobile & Backend',
        deskripsi: 'Menonaktifkan sementara (hold) fitur Rencana Kinerja (RK) pada menu, form, tabel, dan laporan; perhitungan nilai capaian mengacu pada rata-rata capaian kegiatan harian.'
      }
    ]
  },
  {
    versi: 'v1.1.0',
    judul: 'Peluncuran Aplikasi SI-CKP Mobile (Android) & Integrasi Cloud',
    tanggal: '2026-11-12',
    tipe: 'major',
    perubahan: [
      {
        kategori: 'Fitur Baru',
        platform: 'Mobile',
        deskripsi: 'Rilis aplikasi SI-CKP Mobile untuk Android (APK) dengan fitur Beranda, Input Kegiatan Harian, Upload Bukti Dukung, Riwayat Kegiatan, dan Monitoring Nilai CKP.'
      },
      {
        kategori: 'Perbaikan',
        platform: 'Backend',
        deskripsi: 'Migrasi database ke PostgreSQL (Supabase) dan penyimpanan bukti dukung ke Supabase Storage untuk sinkronisasi real-time antara Web dan Mobile.'
      }
    ]
  },
  {
    versi: 'v1.0.0',
    judul: 'Rilis Awal Sistem Informasi CKP Harian (SI-CKP)',
    tanggal: '2026-11-02',
    tipe: 'major',
    perubahan: [
      {
        kategori: 'Fitur Baru',
        platform: 'Web & Backend',
        deskripsi: 'Peluncuran perdana SI-CKP Harian meliputi pencatatan kegiatan harian pegawai, manajemen bukti dukung (file & link), kalender pengisian harian, penilaian perilaku kerja (BerAKHLAK), dan perhitungan nilai CKP bulanan.'
      }
    ]
  }
];

async function ensureChangelogTableAndSeed(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS changelogs (
      id SERIAL PRIMARY KEY,
      versi TEXT NOT NULL UNIQUE,
      judul TEXT NOT NULL,
      tanggal TEXT NOT NULL,
      tipe TEXT DEFAULT 'major',
      perubahan TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO changelogs (versi, judul, tanggal, tipe, perubahan)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const item of DEFAULT_CHANGELOGS) {
    await insertStmt.run(
      item.versi,
      item.judul,
      item.tanggal,
      item.tipe,
      JSON.stringify(item.perubahan)
    );
  }
}

function parseChangelogRow(row) {
  let perubahan = [];
  try {
    perubahan = typeof row.perubahan === 'string' ? JSON.parse(row.perubahan) : row.perubahan;
  } catch {
    perubahan = [{ kategori: 'Info', platform: 'Sistem', deskripsi: String(row.perubahan || '') }];
  }
  return {
    ...row,
    perubahan
  };
}

// GET /api/changelogs — Dapat dilihat oleh SEMUA user (termasuk publik di halaman login)
router.get('/', async (req, res) => {
  const db = getDb();
  await ensureChangelogTableAndSeed(db);

  const rows = await db.prepare(`
    SELECT c.*, u.username as author_name
    FROM changelogs c
    LEFT JOIN users u ON c.created_by = u.id
    ORDER BY c.tanggal DESC, c.id ASC
  `).all();

  // Urutkan versi terbaru di atas (v1.3.0 -> v1.2.0 -> v1.1.0 -> v1.0.0)
  const parsed = rows.map(parseChangelogRow).sort((a, b) => {
    return b.versi.localeCompare(a.versi, undefined, { numeric: true, sensitivity: 'base' });
  });

  res.json(parsed);
});

// POST /api/changelogs — Tambah changelog baru (KPA / Admin)
router.post('/', authenticate, requireRole('KPA'), async (req, res) => {
  const db = getDb();
  await ensureChangelogTableAndSeed(db);

  const { versi, judul, tanggal, tipe, perubahan } = req.body;
  if (!versi || !judul || !perubahan) {
    return res.status(400).json({ error: 'Versi, judul, dan daftar perubahan wajib diisi' });
  }

  const tanggalStr = tanggal || new Date().toISOString().split('T')[0];
  const perubahanJson = typeof perubahan === 'string' ? perubahan : JSON.stringify(perubahan);

  const existing = await db.prepare('SELECT id FROM changelogs WHERE versi = ?').get(versi);
  if (existing) {
    return res.status(400).json({ error: `Versi ${versi} sudah terdaftar di changelog` });
  }

  const result = await db.prepare(`
    INSERT INTO changelogs (versi, judul, tanggal, tipe, perubahan, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(versi, judul, tanggalStr, tipe || 'minor', perubahanJson, req.user.id);

  const created = await db.prepare('SELECT * FROM changelogs WHERE id = ?').get(result.lastInsertRowid);
  await logActivity(req.user.id, 'CREATE_CHANGELOG', 'changelogs', created.id, null, created);
  res.status(201).json(parseChangelogRow(created));
});

// DELETE /api/changelogs/:id — Hapus changelog (KPA / Admin)
router.delete('/:id', authenticate, requireRole('KPA'), async (req, res) => {
  const db = getDb();
  const old = await db.prepare('SELECT * FROM changelogs WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Changelog tidak ditemukan' });

  await db.prepare('DELETE FROM changelogs WHERE id = ?').run(req.params.id);
  await logActivity(req.user.id, 'DELETE_CHANGELOG', 'changelogs', parseInt(req.params.id), old, null);
  res.json({ message: 'Changelog berhasil dihapus' });
});

module.exports = router;
