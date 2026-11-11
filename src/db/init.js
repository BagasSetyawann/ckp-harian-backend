// Jalankan: npm run db:init
// Membuat semua tabel + data awal di Supabase, dan memastikan bucket Storage tersedia.
require('dotenv').config();
const { initDatabase, closeDb } = require('./database');
const { ensureBucket } = require('../utils/storage');

(async () => {
  try {
    await initDatabase();
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      await ensureBucket();
    } else {
      console.log('ℹ️  Skip pembuatan bucket Storage (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diisi)');
    }
    console.log('🎉 Inisialisasi Supabase selesai.');
  } catch (err) {
    console.error('❌ Gagal inisialisasi:', err.message);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
})();
