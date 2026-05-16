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
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = express();
const prisma = new PrismaClient();

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
  const { username, password } = req.body;
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
      data: { username, password: hashed, createdAt: wibNow(), updatedAt: wibNow() }
    });
    await logAudit(user.id, 'register');
    res.status(201).json({ id: user.id, username: user.username });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/auth/login', async (req, res) => {
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
      { userId: user.id, username: user.username, role: user.role },
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
      select: { id: true, username: true }
    });
    res.json(users.map(u => ({ id: u.id, name: u.username })));
  } catch (err) {
    res.status(500).json({ error: 'Get users failed' });
  }
});

// Admin: daftar semua user dengan role
app.get('/users/manage', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' }
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Get users failed' });
  }
});

// Admin: buat user baru
app.post('/auth/create-user', authenticateToken, requireAdmin, async (req, res) => {
  const { username, password, role } = req.body;
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
      data: { username, password: hashed, role: userRole, createdAt: wibNow(), updatedAt: wibNow() }
    });
    await logAudit(req.user.userId, `create-user: ${username} (${userRole})`);
    res.status(201).json({ id: newUser.id, username: newUser.username, role: newUser.role });
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
  const { amount, purpose, notes, recorder } = req.body;
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
  const { amount, purpose, notes, recorder } = req.body;
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

// History transaksi dengan pagination
app.get('/transaction/history', authenticateToken, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const [history, total] = await Promise.all([
      prisma.transaction.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.transaction.count()
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
  const { amount, purpose, notes, recorder } = req.body;
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
// Endpoint export CSV transaksi
app.get('/transaction/export/csv', authenticateToken, async (req, res) => {
  try {
    const transactions = await prisma.transaction.findMany({
      orderBy: { createdAt: 'desc' }
    });
    if (!transactions.length) {
      return res.status(404).json({ error: 'No transactions found' });
    }
    const fields = ['id', 'type', 'amount', 'purpose', 'notes', 'createdAt'];
    const parser = new Parser({ fields });
    const csv = parser.parse(transactions);
    res.header('Content-Type', 'text/csv');
    res.attachment('transactions.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Export CSV failed' });
  }
});