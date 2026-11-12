const express = require('express');
const { getDb } = require('../db/database');
const { authenticate } = require('../middleware/auth');
const XLSX = require('xlsx');

const router = express.Router();

async function getEmployeeData(db, empId, periodId) {
  const employee = await db.prepare('SELECT e.*, u.username FROM employees e JOIN users u ON e.user_id = u.id WHERE e.id = ?').get(empId);
  const period = await db.prepare('SELECT * FROM periods WHERE id = ?').get(periodId);
  const activities = await db.prepare(`
    SELECT da.*, v.status as verif_status,
      (SELECT COUNT(*) FROM activity_evidence ae WHERE ae.activity_id = da.id) as jumlah_bukti,
      (SELECT COUNT(*) FROM evidence_links el WHERE el.activity_id = da.id) as jumlah_link,
      (SELECT STRING_AGG(COALESCE(ae.keterangan, ae.nama_file), '; ') FROM activity_evidence ae WHERE ae.activity_id = da.id) as info_bukti
    FROM daily_activities da
    LEFT JOIN verifications v ON v.activity_id = da.id
    WHERE da.employee_id = ? AND da.period_id = ?
    ORDER BY da.tanggal ASC, da.created_at ASC
  `).all(empId, periodId);
  const behavior = await db.prepare('SELECT * FROM behavior_assessments WHERE employee_id = ? AND period_id = ?').get(empId, periodId);
  const ckp = await db.prepare('SELECT * FROM monthly_ckp_scores WHERE employee_id = ? AND period_id = ?').get(empId, periodId);
  return { employee, period, activities, behavior, ckp };
}

// GET /api/export/excel — Download Hasil Kerja per Periode (.xlsx)
router.get('/excel', authenticate, async (req, res) => {
  const db = getDb();
  const { period_id, employee_id } = req.query;
  if (!period_id) return res.status(400).json({ error: 'period_id wajib diisi' });

  const period = await db.prepare('SELECT * FROM periods WHERE id = ?').get(period_id);
  const empId = req.user.role === 'Anggota' ? req.user.employeeId : (employee_id ? parseInt(employee_id) : null);

  const wb = XLSX.utils.book_new();

  let employeeList = [];
  if (empId) {
    const emp = await db.prepare('SELECT id FROM employees WHERE id = ?').get(empId);
    if (emp) employeeList = [emp];
  } else {
    employeeList = await db.prepare(`
      SELECT e.id FROM employees e
      JOIN users u ON e.user_id = u.id
      JOIN roles r ON u.role_id = r.id
      WHERE r.name = 'Anggota' AND u.is_active = 1
      ORDER BY e.nama
    `).all();
  }

  const allEmployeeData = [];
  for (const { id } of employeeList) {
    const data = await getEmployeeData(db, id, period_id);
    if (data.employee) allEmployeeData.push(data);
  }

  for (const { employee, activities } of allEmployeeData) {
    const actRows = activities.map((a, idx) => ({
      No: idx + 1,
      Tanggal: a.tanggal,
      'Nama Pegawai': employee.nama,
      NIP: employee.nip || '-',
      'Nama Kegiatan': a.nama_kegiatan,
      Deskripsi: a.deskripsi || '-',
      Target: a.target ?? '-',
      Satuan: a.satuan || '-',
      Realisasi: a.realisasi ?? '-',
      'Capaian (%)': a.persentase_capaian || 0,
      'Status Kegiatan': a.status_kegiatan,
      'Jumlah Bukti': (a.jumlah_bukti || 0) + (a.jumlah_link || 0),
      'Info Bukti / Geotag': a.info_bukti || '-',
      Catatan: a.catatan || '-',
    }));

    const ws1 = XLSX.utils.json_to_sheet(
      actRows.length > 0
        ? actRows
        : [{ Keterangan: `Belum ada kegiatan tercatat untuk ${employee.nama} pada periode ${period?.nama || period_id}` }]
    );
    const safeSheetName = `HasilKerja_${employee.nama.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 18)}`;
    XLSX.utils.book_append_sheet(wb, ws1, safeSheetName);
  }

  // Sheet: Rekap CKP Semua Pegawai
  if (!empId || req.user.role !== 'Anggota') {
    const rekapRows = allEmployeeData.map(({ employee, activities, ckp, behavior }) => {
      const avgCapaian = activities.length > 0
        ? Math.round(activities.reduce((s, a) => s + (a.persentase_capaian || 0), 0) / activities.length)
        : 0;
      return {
        NIP: employee?.nip || '-',
        Nama: employee?.nama,
        Jabatan: employee?.jabatan,
        'Unit Kerja': employee?.unit_kerja,
        'Total Kegiatan': activities.length,
        'Rata-rata Capaian Harian (%)': avgCapaian,
        'Nilai Capaian (PK)': ckp?.nilai_pk ?? '-',
        'Nilai Perilaku': behavior?.nilai_akhir ?? '-',
        'Nilai CKP': ckp?.nilai_ckp ?? '-',
        'Status CKP': ckp?.status || 'draft',
      };
    });
    const wsRekap = XLSX.utils.json_to_sheet(rekapRows);
    XLSX.utils.book_append_sheet(wb, wsRekap, 'Rekap_Hasil_Kerja');
  }

  if (wb.SheetNames.length === 0) {
    const wsEmpty = XLSX.utils.json_to_sheet([{ Keterangan: 'Tidak ada data pada periode ini' }]);
    XLSX.utils.book_append_sheet(wb, wsEmpty, 'Hasil_Kerja');
  }

  const periodSlug = (period?.nama || `Periode_${period_id}`).replace(/\s+/g, '_');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="Hasil_Kerja_${periodSlug}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// GET /api/export/pdf-data — Data untuk cetak / simpan PDF Hasil Kerja per Periode
router.get('/pdf-data', authenticate, async (req, res) => {
  const db = getDb();
  const { period_id, employee_id } = req.query;
  if (!period_id) return res.status(400).json({ error: 'period_id wajib diisi' });

  const empId = req.user.role === 'Anggota' ? req.user.employeeId : (employee_id ? parseInt(employee_id) : null);

  let employeeList = [];
  if (empId) {
    employeeList = [{ id: empId }];
  } else {
    employeeList = await db.prepare(`
      SELECT e.id FROM employees e
      JOIN users u ON e.user_id = u.id
      JOIN roles r ON u.role_id = r.id
      WHERE r.name = 'Anggota' AND u.is_active = 1
      ORDER BY e.nama
    `).all();
  }

  const data = [];
  for (const { id } of employeeList) {
    const item = await getEmployeeData(db, id, period_id);
    if (item.employee) data.push(item);
  }
  res.json(data);
});

module.exports = router;
