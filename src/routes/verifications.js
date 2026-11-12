const express = require('express');
const { getDb } = require('../db/database');
const { authenticate, requireRole, logActivity } = require('../middleware/auth');

const router = express.Router();

// GET /api/verifications
router.get('/', authenticate, requireRole('KPA', 'Kasubbag'), async (req, res) => {
  const db = getDb();
  const { period_id, employee_id, status } = req.query;

  let query = `
    SELECT v.*, da.nama_kegiatan, da.tanggal, da.employee_id, da.persentase_capaian,
      e.nama as pegawai_nama, u.username as verified_by_name
    FROM verifications v
    JOIN daily_activities da ON v.activity_id = da.id
    JOIN employees e ON da.employee_id = e.id
    LEFT JOIN users u ON v.verified_by = u.id
    WHERE 1=1
  `;
  const params = [];

  if (employee_id) { query += ' AND da.employee_id = ?'; params.push(parseInt(employee_id)); }
  if (period_id) { query += ' AND da.period_id = ?'; params.push(parseInt(period_id)); }
  if (status) { query += ' AND v.status = ?'; params.push(status); }

  query += ' ORDER BY v.verified_at DESC';
  res.json(await db.prepare(query).all(...params));
});

// GET /api/verifications/pending
router.get('/pending', authenticate, requireRole('KPA', 'Kasubbag'), async (req, res) => {
  const db = getDb();
  const { period_id } = req.query;

  let query = `
    SELECT da.id, da.nama_kegiatan, da.tanggal, da.employee_id, da.persentase_capaian, da.status_kegiatan,
      e.nama as pegawai_nama, pp.nama as pk_nama,
      (SELECT COUNT(*) FROM activity_evidence ae WHERE ae.activity_id = da.id) as jumlah_bukti,
      (SELECT COUNT(*) FROM evidence_links el WHERE el.activity_id = da.id) as jumlah_link
    FROM daily_activities da
    JOIN employees e ON da.employee_id = e.id
    LEFT JOIN performance_plans pp ON da.performance_plan_id = pp.id
    WHERE NOT EXISTS (SELECT 1 FROM verifications v WHERE v.activity_id = da.id)
  `;
  const params = [];
  if (period_id) { query += ' AND da.period_id = ?'; params.push(parseInt(period_id)); }
  query += ' ORDER BY da.tanggal DESC';

  res.json(await db.prepare(query).all(...params));
});

// POST /api/verifications/:activityId — Verifikasi oleh KPA telah dihapus
router.post('/:activityId', authenticate, async (req, res) => {
  return res.status(410).json({ error: 'Fitur verifikasi kegiatan oleh KPA telah dihapus.' });
});

// DELETE /api/verifications/:activityId — Verifikasi oleh KPA telah dihapus
router.delete('/:activityId', authenticate, async (req, res) => {
  return res.status(410).json({ error: 'Fitur verifikasi kegiatan oleh KPA telah dihapus.' });
});

module.exports = router;
