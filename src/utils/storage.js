const { createClient } = require('@supabase/supabase-js');

const BUCKET = process.env.SUPABASE_BUCKET || 'bukti-dukung';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

let _client = null;
let _bucketReady = false;

function getStorage() {
  if (!_client) {
    let url = (process.env.SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

    // Auto-derive SUPABASE_URL from DATABASE_URL if missing or invalid
    if (!/^https?:\/\//i.test(url) && process.env.DATABASE_URL) {
      const match = process.env.DATABASE_URL.match(/postgres\.([a-z0-9]+)[:@]|db\.([a-z0-9]+)\.supabase\.co/i);
      const ref = match?.[1] || match?.[2];
      if (ref) url = `https://${ref}.supabase.co`;
    } else if (url && !/^https?:\/\//i.test(url) && /^[a-z0-9]{15,30}$/i.test(url)) {
      url = `https://${url}.supabase.co`;
    }

    if (!url || !/^https?:\/\//i.test(url)) {
      throw new Error('SUPABASE_URL tidak valid. Harus berupa URL HTTPS seperti: https://losubjmyaivyyuhrndts.supabase.co');
    }
    if (!key) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY belum diset di Environment Variables Vercel');
    }
    _client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _client.storage;
}

// Buat bucket publik jika belum ada (best-effort)
async function ensureBucket() {
  if (_bucketReady) return;
  const storage = getStorage();
  const { data } = await storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_FILE_SIZE });
    if (error && !/already exists/i.test(error.message)) throw error;
    console.log(`🪣 Bucket "${BUCKET}" dibuat`);
  }
  _bucketReady = true;
}

module.exports = { getStorage, ensureBucket, BUCKET, MAX_FILE_SIZE };
