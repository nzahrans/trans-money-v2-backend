// Helper waktu WIB (UTC+7) untuk disimpan ke database
const wibNow = () => new Date(Date.now() + 7 * 60 * 60 * 1000);

// Helper untuk mencatat audit log
async function logAudit(userId, action) {
  try {
    await prisma.auditlog.create({ data: { userId, action, createdAt: wibNow() } });
  } catch (e) {
    console.error('Audit log failed:', e.message);
  }
}
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = express();
const prisma = new PrismaClient();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 10,                   // maks 10 percobaan per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' }
});

// Middleware JWT auth
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Trans Kota Kita Money Management API v2.0' });
});

// Register admin
app.post('/auth/register', async (req, res) => {
  const { username, password, name } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, name: name || null, password: hashed, role: 'admin', createdAt: wibNow(), updatedAt: wibNow() }
    });
    await logAudit(user.id, 'register');
    res.status(201).json({ id: user.id, username: user.username, name: user.name });
  } catch (err) {
    console.error('Registration error details:', err);
    res.status(500).json({ error: 'Registration failed', details: err.message || String(err) });
  }
});

// Login
app.post('/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { userId: user.id, username: user.username, name: user.name || null, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '1d' }
    );
    await logAudit(user.id, 'login');
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Middleware: hanya admin
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Akses ditolak. Hanya admin yang diizinkan.' });
  }
  next();
}

// Daftar user (untuk recorder dropdown)
app.get('/users', authenticateToken, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, name: true }
    });
    res.json(users.map(u => ({ id: u.id, name: u.name || u.username })));
  } catch (err) {
    res.status(500).json({ error: 'Get users failed' });
  }
});

// Admin: daftar semua user dengan role
app.get('/users/manage', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' }
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Get users failed' });
  }
});

// Admin: update user (username, name, password, role)
app.put('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  const { name, username, password, role } = req.body;
  const allowedRoles = ['admin', 'pengurus'];
  try {
    // Cek username unik jika diganti
    if (username) {
      const existing = await prisma.user.findUnique({ where: { username } });
      if (existing && existing.id !== targetId) {
        return res.status(409).json({ error: 'Username sudah digunakan' });
      }
    }
    const data = { updatedAt: wibNow() };
    if (username !== undefined) data.username = username.trim();
    if (name !== undefined) data.name = name ? name.trim() : null;
    if (role !== undefined && allowedRoles.includes(role)) data.role = role;
    if (password) data.password = await bcrypt.hash(password, 10);
    const updated = await prisma.user.update({ where: { id: targetId }, data });
    await logAudit(req.user.userId, `update-user: id ${targetId}`);
    res.json({ id: updated.id, username: updated.username, name: updated.name, role: updated.role });
  } catch (err) {
    res.status(500).json({ error: 'Gagal update user' });
  }
});

// Admin: buat user baru
app.post('/auth/create-user', authenticateToken, requireAdmin, async (req, res) => {
  const { username, password, role, name } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }
  const allowedRoles = ['admin', 'pengurus'];
  const userRole = allowedRoles.includes(role) ? role : 'pengurus';
  try {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return res.status(409).json({ error: 'Username sudah digunakan' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: { username, name: name || null, password: hashed, role: userRole, createdAt: wibNow(), updatedAt: wibNow() }
    });
    await logAudit(req.user.userId, `create-user: ${username} (${userRole})`);
    res.status(201).json({ id: newUser.id, username: newUser.username, name: newUser.name, role: newUser.role });
  } catch (err) {
    res.status(500).json({ error: 'Gagal membuat user' });
  }
});

// Admin: hapus user
app.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.userId) {
    return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
  }
  try {
    await prisma.user.delete({ where: { id: targetId } });
    await logAudit(req.user.userId, `delete-user: id ${targetId}`);
    res.json({ message: 'User berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus user' });
  }
});

module.exports = app;

const DEPOSIT_PURPOSES = ['Deposit Anggota Baru', 'Denda Resign', 'Setoran', 'KTA Trans', 'Other'];
const WITHDRAW_PURPOSES = ['Reimburse', 'Sponsorship', 'Gaji Pegawai', 'Pajak', 'Other'];

// Endpoint transaksi: deposit
app.post('/transaction/deposit', authenticateToken, async (req, res) => {
  const { amount, purpose, notes, recorder, transactionDate } = req.body;
  const userId = req.user.userId;
  if (!amount || !purpose) {
    return res.status(400).json({ error: 'amount, purpose required' });
  }
  if (!DEPOSIT_PURPOSES.includes(purpose)) {
    return res.status(400).json({ error: `Keperluan tidak valid. Pilihan: ${DEPOSIT_PURPOSES.join(', ')}` });
  }
  try {
    const trx = await prisma.transaction.create({
      data: {
        type: 'deposit',
        amount: Number(amount),
        purpose,
        notes,
        recorder: recorder || null,
        transactionDate: transactionDate ? new Date(transactionDate) : null,
        userId: Number(userId),
        createdAt: wibNow()
      }
    });
    await logAudit(userId, `deposit: ${amount} - ${purpose}`);
    res.status(201).json(trx);
  } catch (err) {
    res.status(500).json({ error: 'Deposit failed' });
  }
});

// Endpoint transaksi: withdraw
app.post('/transaction/withdraw', authenticateToken, async (req, res) => {
  const { amount, purpose, notes, recorder, transactionDate } = req.body;
  const userId = req.user.userId;
  if (!amount || !purpose) {
    return res.status(400).json({ error: 'amount, purpose required' });
  }
  if (!WITHDRAW_PURPOSES.includes(purpose)) {
    return res.status(400).json({ error: `Keperluan tidak valid. Pilihan: ${WITHDRAW_PURPOSES.join(', ')}` });
  }
  try {
    const trx = await prisma.transaction.create({
      data: {
        type: 'withdraw',
        amount: Number(amount),
        purpose,
        notes,
        recorder: recorder || null,
        transactionDate: transactionDate ? new Date(transactionDate) : null,
        userId: Number(userId),
        createdAt: wibNow()
      }
    });
    await logAudit(userId, `withdraw: ${amount} - ${purpose}`);
    res.status(201).json(trx);
  } catch (err) {
    res.status(500).json({ error: 'Withdraw failed' });
  }
});

// Audit log (admin only) dengan pagination
app.get('/auditlog', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      prisma.auditlog.findMany({
        orderBy: { id: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { username: true } } }
      }),
      prisma.auditlog.count()
    ]);
    res.json({ logs, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Get audit log failed' });
  }
});

// History transaksi dengan pagination + filter tanggal
app.get('/transaction/history', authenticateToken, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const { dateFrom, dateTo } = req.query;

    let where = {};
    if (dateFrom || dateTo) {
      const fromDate = dateFrom ? new Date(dateFrom) : null;
      const toDate = dateTo ? new Date(dateTo + 'T23:59:59') : null;
      const dateRange = {};
      if (fromDate) dateRange.gte = fromDate;
      if (toDate) dateRange.lte = toDate;
      where = {
        OR: [
          { transactionDate: { not: null, ...dateRange } },
          { AND: [{ transactionDate: null }, { createdAt: dateRange }] }
        ]
      };
    }

    const [history, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.transaction.count({ where })
    ]);
    res.json({ transactions: history, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Get history failed' });
  }
});

// Edit transaksi
app.put('/transaction/:id', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const trxId = Number(req.params.id);
  const { amount, purpose, notes, recorder, transactionDate } = req.body;
  try {
    const trx = await prisma.transaction.findUnique({ where: { id: trxId } });
    if (!trx) return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    const allPurposes = [...new Set([...DEPOSIT_PURPOSES, ...WITHDRAW_PURPOSES])];
    if (purpose && !allPurposes.includes(purpose)) {
      return res.status(400).json({ error: 'Keperluan tidak valid' });
    }
    const updated = await prisma.transaction.update({
      where: { id: trxId },
      data: {
        amount: amount ? Number(amount) : trx.amount,
        purpose: purpose || trx.purpose,
        notes: notes !== undefined ? notes : trx.notes,
        recorder: recorder !== undefined ? recorder : trx.recorder,
        transactionDate: transactionDate !== undefined
          ? (transactionDate ? new Date(transactionDate) : null)
          : trx.transactionDate,
      }
    });
    await logAudit(userId, `edit-transaction: id ${trxId}`);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengubah transaksi' });
  }
});

// Hapus transaksi
app.delete('/transaction/:id', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const trxId = Number(req.params.id);
  try {
    const trx = await prisma.transaction.findUnique({ where: { id: trxId } });
    if (!trx) return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    await prisma.transaction.delete({ where: { id: trxId } });
    await logAudit(userId, `delete-transaction: id ${trxId}`);
    res.json({ message: 'Transaksi berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus transaksi' });
  }
});

// Endpoint dashboard saldo dan summary
app.get('/dashboard/summary', authenticateToken, async (req, res) => {
  try {
    // Hitung total deposit
    const totalDeposit = await prisma.transaction.aggregate({
      where: { type: 'deposit' },
      _sum: { amount: true }
    });
    // Hitung total withdraw
    const totalWithdraw = await prisma.transaction.aggregate({
      where: { type: 'withdraw' },
      _sum: { amount: true }
    });
    // Saldo = total deposit - total withdraw
    const saldo = (totalDeposit._sum.amount || 0) - (totalWithdraw._sum.amount || 0);
    // Ambil 5 transaksi terakhir
    const lastTransactions = await prisma.transaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    res.json({
      saldo,
      totalDeposit: totalDeposit._sum.amount || 0,
      totalWithdraw: totalWithdraw._sum.amount || 0,
      lastTransactions
    });
  } catch (err) {
    res.status(500).json({ error: 'Get dashboard summary failed' });
  }
});

// Endpoint data grafik bulanan dan distribusi keperluan
app.get('/dashboard/graphic', authenticateToken, async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate + 'T23:59:59') : null;

    // Data bulanan: difilter berdasarkan tahun
    const monthlyTransactions = await prisma.transaction.findMany({
      where: {
        createdAt: {
          gte: new Date(`${year}-01-01`),
          lt: new Date(`${year + 1}-01-01`),
        },
      },
    });

    // Data pie: difilter berdasarkan startDate/endDate (jika tidak diisi, fallback ke tahun)
    const pieWhere = { createdAt: {} };
    if (startDate || endDate) {
      if (startDate) pieWhere.createdAt.gte = startDate;
      if (endDate) pieWhere.createdAt.lte = endDate;
    } else {
      pieWhere.createdAt = {
        gte: new Date(`${year}-01-01`),
        lt: new Date(`${year + 1}-01-01`),
      };
    }
    const pieTransactions = await prisma.transaction.findMany({ where: pieWhere });

    // Hitung data bulanan
    const monthlyDeposit = Array(12).fill(0);
    const monthlyWithdraw = Array(12).fill(0);
    for (const trx of monthlyTransactions) {
      const month = new Date(trx.createdAt).getMonth();
      if (trx.type === 'deposit') monthlyDeposit[month] += Number(trx.amount);
      else if (trx.type === 'withdraw') monthlyWithdraw[month] += Number(trx.amount);
    }

    // Hitung distribusi keperluan
    const depositPurposeMap = {};
    const withdrawPurposeMap = {};
    for (const p of DEPOSIT_PURPOSES) depositPurposeMap[p] = 0;
    for (const p of WITHDRAW_PURPOSES) withdrawPurposeMap[p] = 0;

    for (const trx of pieTransactions) {
      if (trx.type === 'deposit' && DEPOSIT_PURPOSES.includes(trx.purpose)) {
        depositPurposeMap[trx.purpose] += Number(trx.amount);
      } else if (trx.type === 'withdraw' && WITHDRAW_PURPOSES.includes(trx.purpose)) {
        withdrawPurposeMap[trx.purpose] += Number(trx.amount);
      }
    }

    res.json({
      monthlyDeposit,
      monthlyWithdraw,
      depositPurposeLabels: DEPOSIT_PURPOSES,
      depositPurposeValues: DEPOSIT_PURPOSES.map(p => depositPurposeMap[p]),
      withdrawPurposeLabels: WITHDRAW_PURPOSES,
      withdrawPurposeValues: WITHDRAW_PURPOSES.map(p => withdrawPurposeMap[p]),
    });
  } catch (err) {
    res.status(500).json({ error: 'Get graphic data failed' });
  }
});

const { Parser } = require('json2csv');
const PDFDocument = require('pdfkit');

// Endpoint export CSV transaksi
app.get('/transaction/export/csv', authenticateToken, async (req, res) => {
  try {
    const where = {};
    if (req.query.startDate) where.createdAt = { ...where.createdAt, gte: new Date(req.query.startDate) };
    if (req.query.endDate) where.createdAt = { ...where.createdAt, lte: new Date(req.query.endDate + 'T23:59:59') };
    const transactions = await prisma.transaction.findMany({ where, orderBy: { createdAt: 'desc' } });
    if (!transactions.length) {
      return res.status(404).json({ error: 'No transactions found' });
    }
    const BULAN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agt','Sep','Okt','Nov','Des'];
    const rows = transactions.map((t, i) => {
      const d = new Date(t.createdAt);
      const tanggal = `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
      return {
        'No': i + 1,
        'Tipe': t.type === 'deposit' ? 'Deposit' : 'Withdraw',
        'Jumlah (Rp)': Number(t.amount),
        'Keperluan': t.purpose || '',
        'Catatan': t.notes || '',
        'Pencatat': t.recorder || '',
        'Tanggal': tanggal,
      };
    });
    const fields = ['No', 'Tipe', 'Jumlah (Rp)', 'Keperluan', 'Catatan', 'Pencatat', 'Tanggal'];
    const parser = new Parser({ fields, delimiter: ';' });
    const csv = '\uFEFF' + parser.parse(rows);
    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.attachment('transactions.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Export CSV failed' });
  }
});

// Endpoint export PDF transaksi
app.get('/transaction/export/pdf', authenticateToken, async (req, res) => {
  try {
    const where = {};
    if (req.query.startDate) where.createdAt = { ...where.createdAt, gte: new Date(req.query.startDate) };
    if (req.query.endDate) where.createdAt = { ...where.createdAt, lte: new Date(req.query.endDate + 'T23:59:59') };
    const transactions = await prisma.transaction.findMany({ where, orderBy: { createdAt: 'asc' } });
    if (!transactions.length) return res.status(404).json({ error: 'No transactions found' });

    // Saldo awal (semua transaksi sebelum periode)
    let saldoAwal = 0;
    if (req.query.startDate) {
      const before = await prisma.transaction.findMany({ where: { createdAt: { lt: new Date(req.query.startDate) } } });
      saldoAwal = before.reduce((s, t) => s + (t.type === 'deposit' ? Number(t.amount) : -Number(t.amount)), 0);
    }

    // Agregasi per keperluan
    const depMap = Object.fromEntries(DEPOSIT_PURPOSES.map(p => [p, 0]));
    const wdMap  = Object.fromEntries(WITHDRAW_PURPOSES.map(p => [p, 0]));
    for (const t of transactions) {
      if (t.type === 'deposit')  depMap[t.purpose] = (depMap[t.purpose]  || 0) + Number(t.amount);
      else                        wdMap[t.purpose]  = (wdMap[t.purpose]   || 0) + Number(t.amount);
    }
    const totalDep  = Object.values(depMap).reduce((a, b) => a + b, 0);
    const totalWd   = Object.values(wdMap).reduce((a, b) => a + b, 0);
    const labaRugi  = totalDep - totalWd;
    const saldoAkhir = saldoAwal + labaRugi;

    // Helpers
    const BULAN  = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agt','Sep','Okt','Nov','Des'];
    const fmtDate = (d) => { const x = new Date(d); return `${x.getDate()} ${BULAN[x.getMonth()]} ${x.getFullYear()}`; };
    const fmtRp   = (n) => Number(n).toLocaleString('id-ID');
    const periodLabel = [req.query.startDate, req.query.endDate].filter(Boolean).join(' s/d ') || 'Semua Data';

    // ── PDF Setup ────────────────────────────────────────────────────────────
    const chunks = [];
    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const buf = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/json');
      res.json({ data: buf.toString('base64'), filename: 'laporan-keuangan.pdf' });
    });
    doc.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: 'PDF generation failed' });
    });

    const ML = 50; const MR = 545;

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 1 – Daftar Transaksi
    // ════════════════════════════════════════════════════════════════════════
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1e3a5f').text('Trans Kota Kita', { align: 'center' });
    doc.fontSize(11).font('Helvetica').fillColor('#475569').text('Laporan Keuangan', { align: 'center' });
    doc.fontSize(9).text(`Periode: ${periodLabel}   |   Dicetak: ${fmtDate(new Date())}`, { align: 'center' });
    doc.moveDown(0.8);

    doc.fontSize(11).font('Helvetica-Bold').fillColor('#1e3a5f').text('Daftar Transaksi');
    doc.moveDown(0.3);

    const TCOL = [ML, ML+22, ML+80, ML+170, ML+280, ML+390, MR];
    const TH   = ['No', 'Tipe', 'Jumlah (Rp)', 'Keperluan', 'Catatan', 'Tanggal'];
    const ROW_H    = 15; // header & minimum row height
    const ROW_PAD  = 8;  // vertical padding inside a data row

    const drawTrxHeader = (yp) => {
      doc.rect(ML, yp, MR - ML, ROW_H).fill('#1e3a5f');
      TH.forEach((h, i) => {
        doc.fillColor('white').font('Helvetica-Bold').fontSize(8)
           .text(h, TCOL[i]+2, yp+4, { width: TCOL[i+1]-TCOL[i]-4, lineBreak: false });
      });
      return yp + ROW_H;
    };

    let ty = drawTrxHeader(doc.y);
    transactions.forEach((trx, idx) => {
      const isDep = trx.type === 'deposit';
      const cells = [
        String(idx + 1),
        isDep ? 'Deposit' : 'Withdraw',
        fmtRp(trx.amount),
        trx.purpose || '-',
        trx.notes   || '-',
        fmtDate(trx.createdAt),
      ];
      // Hitung tinggi baris berdasarkan sel yang paling tinggi kontennya
      doc.font('Helvetica').fontSize(8);
      const rowH = Math.max(ROW_H, ...cells.map((val, i) =>
        doc.heightOfString(String(val), { width: TCOL[i+1] - TCOL[i] - 4 }) + ROW_PAD
      ));
      if (ty + rowH > 785) { doc.addPage(); ty = drawTrxHeader(50); }
      doc.rect(ML, ty, MR-ML, rowH).fill(idx % 2 === 0 ? '#f0f7ff' : '#ffffff');
      cells.forEach((val, i) => {
        doc.fillColor(i === 1 ? (isDep ? '#0369a1' : '#b91c1c') : '#1e293b')
           .font('Helvetica').fontSize(8)
           .text(String(val), TCOL[i]+2, ty+4, { width: TCOL[i+1]-TCOL[i]-4, lineBreak: true });
      });
      ty += rowH;
    });

    // Ringkasan transaksi
    ty += 8;
    if (ty + 60 > 785) { doc.addPage(); ty = 50; }
    doc.rect(ML, ty, MR-ML, 56).fill('#f8fafc').stroke('#e2e8f0');
    doc.fillColor('#475569').font('Helvetica').fontSize(9).text('Ringkasan:', ML+8, ty+8);
    doc.fillColor('#0369a1').font('Helvetica-Bold').fontSize(9).text(`Total Deposit  : Rp ${fmtRp(totalDep)}`, ML+8, ty+22);
    doc.fillColor('#b91c1c').text(`Total Beban    : Rp ${fmtRp(totalWd)}`, ML+8, ty+34);
    doc.fillColor(labaRugi>=0?'#166534':'#991b1b').text(`Saldo Bersih   : Rp ${fmtRp(labaRugi)}`, ML+8, ty+46);
    doc.fillColor('#475569').font('Helvetica').text(`Saldo Awal: Rp ${fmtRp(saldoAwal)}`, ML+300, ty+22);
    doc.fillColor(saldoAkhir>=0?'#166534':'#991b1b').font('Helvetica-Bold').text(`Saldo Akhir: Rp ${fmtRp(saldoAkhir)}`, ML+300, ty+34);

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 2 – Laporan Keuangan Formal
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage();

    // Header halaman
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1e3a5f').text('Trans Kota Kita', { align: 'center' });
    doc.fontSize(10).font('Helvetica').fillColor('#475569').text('Laporan Keuangan', { align: 'center' });
    doc.fontSize(9).text(`Periode: ${periodLabel}`, { align: 'center' });
    doc.moveDown(0.8);

    // Helper: gambar tabel keuangan 2 kolom
    const FCOL_L = ML;        // kolom label mulai
    const FCOL_V = ML + 330;  // kolom nilai mulai
    const FCOL_VW = MR - (ML+330); // lebar kolom nilai
    const FR_H = 17;

    const drawFinRow = (yp, label, value, opts = {}) => {
      if (yp + FR_H > 785) { doc.addPage(); yp = 50; }
      const bg = opts.bg || null;
      if (bg) doc.rect(ML, yp, MR-ML, FR_H).fill(bg);
      const lx     = FCOL_L + (opts.indent ? 18 : 0);
      const lw     = FCOL_V - FCOL_L - (opts.indent ? 18 : 0) - 4;
      const font   = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
      const tc     = opts.color || '#1e293b';
      doc.fillColor(tc).font(font).fontSize(9).text(label, lx, yp+5, { width: lw, lineBreak: false });
      if (value !== undefined && value !== null) {
        const vs   = typeof value === 'string' ? value : fmtRp(value);
        const vc   = opts.valColor || (typeof value==='number' && value<0 ? '#b91c1c' : tc);
        doc.fillColor(vc).font(font).fontSize(9).text(vs, FCOL_V, yp+5, { width: FCOL_VW, align: 'right', lineBreak: false });
      }
      return yp + FR_H;
    };

    const drawFinHeader = (yp, title, subtitle) => {
      if (yp + 40 > 785) { doc.addPage(); yp = 50; }
      doc.fillColor('#1e3a5f').font('Helvetica-Bold').fontSize(12).text(title, ML, yp);
      yp += 16;
      doc.fillColor('#64748b').font('Helvetica').fontSize(9).text(subtitle, ML, yp);
      yp += 14;
      return yp;
    };

    const drawFinTableHeader = (yp) => {
      if (yp + FR_H > 785) { doc.addPage(); yp = 50; }
      doc.rect(ML, yp, MR-ML, FR_H).fill('#1e3a5f');
      doc.fillColor('white').font('Helvetica-Bold').fontSize(9).text('Keterangan', FCOL_L+4, yp+5, { lineBreak: false });
      doc.text('Jumlah (Rp)', FCOL_V, yp+5, { width: FCOL_VW, align: 'right', lineBreak: false });
      return yp + FR_H;
    };

    let fy = doc.y;

    // ── 1. Laporan Laba Rugi ─────────────────────────────────────────────────
    const neracaDate = req.query.endDate ? fmtDate(new Date(req.query.endDate)) : fmtDate(new Date());
    fy = drawFinHeader(fy, '1.1  Laporan Laba Rugi', `Periode: ${periodLabel}`);
    fy = drawFinTableHeader(fy);

    fy = drawFinRow(fy, 'Pendapatan', null, { bold: true, bg: '#f1f5f9' });
    for (const p of DEPOSIT_PURPOSES) {
      fy = drawFinRow(fy, p, depMap[p], { indent: true });
    }
    fy = drawFinRow(fy, 'Total Pendapatan', totalDep, { bold: true, bg: '#dbeafe', color: '#1d4ed8', valColor: '#1d4ed8' });
    fy += 4;

    fy = drawFinRow(fy, 'Beban', null, { bold: true, bg: '#f1f5f9' });
    for (const p of WITHDRAW_PURPOSES) {
      fy = drawFinRow(fy, p, wdMap[p], { indent: true });
    }
    fy = drawFinRow(fy, 'Total Beban', totalWd, { bold: true, bg: '#fee2e2', color: '#991b1b', valColor: '#991b1b' });
    fy += 4;

    const lrBg = labaRugi >= 0 ? '#dcfce7' : '#fee2e2';
    const lrC  = labaRugi >= 0 ? '#166534' : '#991b1b';
    fy = drawFinRow(fy, 'Laba / Rugi Bersih', labaRugi, { bold: true, bg: lrBg, color: lrC, valColor: lrC });
    fy += 20;

    // ── 2. Neraca ────────────────────────────────────────────────────────────
    if (fy + 120 > 785) { doc.addPage(); fy = 50; }
    fy = drawFinHeader(fy, '1.2  Neraca', `Per ${neracaDate}`);
    fy = drawFinTableHeader(fy);

    fy = drawFinRow(fy, 'Aset', null, { bold: true, bg: '#f1f5f9' });
    fy = drawFinRow(fy, 'Kas', saldoAkhir, { indent: true });
    fy = drawFinRow(fy, 'Piutang Usaha', 0, { indent: true });
    fy = drawFinRow(fy, 'Total Aset', saldoAkhir, { bold: true, bg: '#dbeafe', color: '#1d4ed8', valColor: '#1d4ed8' });
    fy += 20;

    // ── 3. Laporan Arus Kas ──────────────────────────────────────────────────
    if (fy + 200 > 785) { doc.addPage(); fy = 50; }
    fy = drawFinHeader(fy, '1.3  Laporan Arus Kas', `Periode: ${periodLabel}`);
    fy = drawFinTableHeader(fy);

    fy = drawFinRow(fy, 'Arus Kas dari Operasional', null, { bold: true, bg: '#f1f5f9' });
    for (const p of DEPOSIT_PURPOSES) {
      fy = drawFinRow(fy, `Penerimaan dari ${p}`, depMap[p], { indent: true });
    }
    for (const p of WITHDRAW_PURPOSES) {
      const val = wdMap[p];
      fy = drawFinRow(fy, `Pembayaran ${p}`, val > 0 ? `(${fmtRp(val)})` : '0', { indent: true, valColor: val>0?'#b91c1c':'#1e293b' });
    }
    const akBersih = totalDep - totalWd;
    fy = drawFinRow(fy, 'Arus Kas Bersih Operasional', akBersih, { bold: true, bg: '#dbeafe', color: '#1d4ed8', valColor: akBersih>=0?'#1d4ed8':'#991b1b' });
    fy += 6;

    fy = drawFinRow(fy, 'Kenaikan (Penurunan) Bersih Kas', labaRugi, { bold: true, valColor: labaRugi>=0?'#166534':'#991b1b' });
    fy = drawFinRow(fy, 'Saldo Awal Kas', saldoAwal);
    fy = drawFinRow(fy, 'Saldo Akhir Kas', saldoAkhir, { bold: true, bg: saldoAkhir>=0?'#dcfce7':'#fee2e2', color: saldoAkhir>=0?'#166534':'#991b1b', valColor: saldoAkhir>=0?'#166534':'#991b1b' });

    doc.end();
  } catch (err) {
    console.error('PDF export error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Export PDF failed' });
  }
});

// Endpoint export CSV data chart bulanan
app.get('/transaction/export/chart-csv', authenticateToken, async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const transactions = await prisma.transaction.findMany({
      where: { createdAt: { gte: new Date(`${year}-01-01`), lt: new Date(`${year + 1}-01-01`) } },
      orderBy: { createdAt: 'asc' },
    });

    const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const monthlyDeposit = Array(12).fill(0);
    const monthlyWithdraw = Array(12).fill(0);
    for (const trx of transactions) {
      const m = new Date(trx.createdAt).getMonth();
      if (trx.type === 'deposit') monthlyDeposit[m] += Number(trx.amount);
      else if (trx.type === 'withdraw') monthlyWithdraw[m] += Number(trx.amount);
    }

    const rows = MONTHS.map((name, i) => ({
      Bulan: name,
      Tahun: year,
      'Total Deposit (Rp)': monthlyDeposit[i],
      'Total Withdraw (Rp)': monthlyWithdraw[i],
      'Selisih (Rp)': monthlyDeposit[i] - monthlyWithdraw[i],
    }));

    const parser = new Parser({ fields: ['Bulan', 'Tahun', 'Total Deposit (Rp)', 'Total Withdraw (Rp)', 'Selisih (Rp)'], delimiter: ';' });
    const csv = '\uFEFF' + parser.parse(rows);
    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.attachment(`chart-data-${year}.csv`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Export chart CSV failed' });
  }
});