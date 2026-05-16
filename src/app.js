// Helper untuk mencatat audit log
async function logAudit(userId, action) {
  try {
    await prisma.auditlog.create({ data: { userId, action } });
  } catch (e) {
    // Optional: log error ke console
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
      data: { username, password: hashed }
    });
    await logAudit(user.id, 'register');
    res.status(201).json({ id: user.id, username: user.username });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login admin
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
    const token = jwt.sign({ userId: user.id, username: user.username }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
    await logAudit(user.id, 'login');
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Endpoint daftar semua user (untuk recorder dropdown)
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

module.exports = app;

// Endpoint transaksi: deposit
app.post('/transaction/deposit', authenticateToken, async (req, res) => {
  const { amount, purpose, notes, recorder } = req.body;
  const userId = req.user.userId;
  if (!amount || !purpose) {
    return res.status(400).json({ error: 'amount, purpose required' });
  }
  try {
    const trx = await prisma.transaction.create({
      data: {
        type: 'deposit',
        amount: Number(amount),
        purpose,
        notes,
        recorder: recorder || null,
        userId: Number(userId)
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
  try {
    const trx = await prisma.transaction.create({
      data: {
        type: 'withdraw',
        amount: Number(amount),
        purpose,
        notes,
        recorder: recorder || null,
        userId: Number(userId)
      }
    });
    await logAudit(userId, `withdraw: ${amount} - ${purpose}`);
    res.status(201).json(trx);
  } catch (err) {
    res.status(500).json({ error: 'Withdraw failed' });
  }
});

// Endpoint untuk melihat audit log user
app.get('/auditlog', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const logs = await prisma.auditlog.findMany({
      where: { userId },
      orderBy: { id: 'desc' },
      take: 20
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Get audit log failed' });
  }
});

// Endpoint transaksi: history
app.get('/transaction/history', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const history = await prisma.transaction.findMany({
      where: { userId: Number(userId) },
      orderBy: { createdAt: 'desc' }
    });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Get history failed' });
  }
});

// Endpoint dashboard saldo dan summary
app.get('/dashboard/summary', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    // Hitung total deposit
    const totalDeposit = await prisma.transaction.aggregate({
      where: { userId, type: 'deposit' },
      _sum: { amount: true }
    });
    // Hitung total withdraw
    const totalWithdraw = await prisma.transaction.aggregate({
      where: { userId, type: 'withdraw' },
      _sum: { amount: true }
    });
    // Saldo = total deposit - total withdraw
    const saldo = (totalDeposit._sum.amount || 0) - (totalWithdraw._sum.amount || 0);
    // Ambil 5 transaksi terakhir
    const lastTransactions = await prisma.transaction.findMany({
      where: { userId },
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

const { Parser } = require('json2csv');
// Endpoint export CSV transaksi user
app.get('/transaction/export/csv', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const transactions = await prisma.transaction.findMany({
      where: { userId },
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