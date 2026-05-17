// @ts-check
'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Pengguna yang ada: 1=admin1, 2=superadmin, 3=Bejo Harto
const USERS = [
  { id: 1, name: 'admin1' },
  { id: 2, name: 'superadmin' },
  { id: 3, name: 'Bejo Harto' },
];

// Helper: buat Date dari string tanggal WIB (simpan seolah UTC)
function wib(dateStr) {
  return new Date(dateStr + 'T00:00:00.000Z');
}
function wibAt(dateStr, h = 9, m = 0) {
  const d = new Date(dateStr + 'T00:00:00.000Z');
  d.setUTCHours(h, m, 0, 0);
  return d;
}

// Data transaksi dummy: Jan–Mei 2026
// transactionDate = tanggal transaksi sebenarnya
// createdAt = tanggal diinput ke sistem (biasanya 1–3 hari setelah transaksi)
const transactions = [
  // ===== JANUARI 2026 =====
  { type: 'deposit',  purpose: 'Deposit Anggota Baru', amount: 15000000, notes: 'Dana awal kas organisasi 2026', recorder: 'superadmin', transactionDate: wib('2026-01-02'), createdAt: wibAt('2026-01-02', 9, 0) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 850000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-01-03'), createdAt: wibAt('2026-01-04', 8, 30) },
  { type: 'deposit',  purpose: 'KTA Trans',          amount: 600000,  notes: 'KTA bulan Januari (12 anggota)', recorder: 'Bejo Harto',transactionDate: wib('2026-01-05'), createdAt: wibAt('2026-01-05', 10, 0) },
  { type: 'deposit',  purpose: 'Deposit Anggota Baru', amount: 750000, notes: 'Anggota baru: Rudi Santoso',  recorder: 'superadmin',transactionDate: wib('2026-01-07'), createdAt: wibAt('2026-01-08', 9, 0) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 920000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-01-10'), createdAt: wibAt('2026-01-11', 8, 0) },
  { type: 'withdraw', purpose: 'Reimburse',          amount: 150000,  notes: 'Reimburse biaya fotokopi',      recorder: 'admin1',    transactionDate: wib('2026-01-12'), createdAt: wibAt('2026-01-13', 9, 30) },
  { type: 'deposit',  purpose: 'KTA Trans',          amount: 150000,  notes: 'KTA susulan Januari (3 anggota)',recorder: 'Bejo Harto',transactionDate: wib('2026-01-14'), createdAt: wibAt('2026-01-14', 11, 0) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 780000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-01-17'), createdAt: wibAt('2026-01-18', 8, 0) },
  { type: 'deposit',  purpose: 'Denda Resign',       amount: 350000,  notes: 'Denda resign: Wahyu',           recorder: 'superadmin',transactionDate: wib('2026-01-20'), createdAt: wibAt('2026-01-20', 14, 0) },
  { type: 'withdraw', purpose: 'Gaji Pegawai',       amount: 1800000, notes: 'Honor koordinator bulan Januari',recorder: 'superadmin',transactionDate: wib('2026-01-25'), createdAt: wibAt('2026-01-26', 9, 0) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 860000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-01-30'), createdAt: wibAt('2026-01-31', 8, 30) },
  { type: 'withdraw', purpose: 'Pajak',              amount: 500000,  notes: 'Pajak & administrasi Q4 2025',  recorder: 'superadmin',transactionDate: wib('2026-01-31'), createdAt: wibAt('2026-01-31', 13, 0) },

  // ===== FEBRUARI 2026 =====
  { type: 'deposit',  purpose: 'Setoran',           amount: 910000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-02-02'), createdAt: wibAt('2026-02-03', 8, 0) },
  { type: 'deposit',  purpose: 'Deposit Anggota Baru', amount: 500000, notes: 'Anggota baru: Siti Rahayu',  recorder: 'superadmin',transactionDate: wib('2026-02-04'), createdAt: wibAt('2026-02-05', 9, 0) },
  { type: 'deposit',  purpose: 'KTA Trans',          amount: 650000,  notes: 'KTA bulan Februari (13 anggota)',recorder: 'Bejo Harto',transactionDate: wib('2026-02-05'), createdAt: wibAt('2026-02-05', 10, 30) },
  { type: 'withdraw', purpose: 'Reimburse',          amount: 85000,   notes: 'Reimburse bensin operasional',  recorder: 'Bejo Harto',transactionDate: wib('2026-02-08'), createdAt: wibAt('2026-02-09', 9, 0) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 870000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-02-10'), createdAt: wibAt('2026-02-11', 8, 0) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 800000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-02-17'), createdAt: wibAt('2026-02-18', 8, 30) },
  { type: 'withdraw', purpose: 'Sponsorship',        amount: 2000000, notes: 'Sponsor acara HUT Trans Kota Kita', recorder: 'superadmin', transactionDate: wib('2026-02-20'), createdAt: wibAt('2026-02-21', 10, 0) },
  { type: 'withdraw', purpose: 'Gaji Pegawai',       amount: 1800000, notes: 'Honor koordinator bulan Februari', recorder: 'superadmin', transactionDate: wib('2026-02-25'), createdAt: wibAt('2026-02-26', 9, 0) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 890000,  notes: 'Setoran iuran akhir Februari',   recorder: 'admin1',    transactionDate: wib('2026-02-28'), createdAt: wibAt('2026-02-28', 14, 0) },

  // ===== MARET 2026 =====
  { type: 'deposit',  purpose: 'Setoran',           amount: 840000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-03-02'), createdAt: wibAt('2026-03-03', 8, 0) },
  { type: 'deposit',  purpose: 'Deposit Anggota Baru', amount: 1000000, notes: 'Anggota baru: Hendra Wijaya', recorder: 'superadmin', transactionDate: wib('2026-03-04'), createdAt: wibAt('2026-03-05', 9, 0) },
  { type: 'deposit',  purpose: 'KTA Trans',          amount: 700000,  notes: 'KTA bulan Maret (14 anggota)',  recorder: 'Bejo Harto',transactionDate: wib('2026-03-05'), createdAt: wibAt('2026-03-05', 10, 0) },
  { type: 'withdraw', purpose: 'Reimburse',          amount: 200000,  notes: 'Reimburse alat tulis kantor',   recorder: 'admin1',    transactionDate: wib('2026-03-08'), createdAt: wibAt('2026-03-09', 9, 30) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 920000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-03-10'), createdAt: wibAt('2026-03-11', 8, 0) },
  { type: 'deposit',  purpose: 'Denda Resign',       amount: 250000,  notes: 'Denda resign: Bambang S.',      recorder: 'superadmin',transactionDate: wib('2026-03-14'), createdAt: wibAt('2026-03-14', 13, 0) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 860000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-03-17'), createdAt: wibAt('2026-03-18', 8, 0) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 900000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-03-24'), createdAt: wibAt('2026-03-25', 8, 0) },
  { type: 'withdraw', purpose: 'Gaji Pegawai',       amount: 1800000, notes: 'Honor koordinator bulan Maret', recorder: 'superadmin',transactionDate: wib('2026-03-25'), createdAt: wibAt('2026-03-26', 9, 0) },
  { type: 'withdraw', purpose: 'Pajak',              amount: 750000,  notes: 'Pajak & administrasi Q1 2026',  recorder: 'superadmin',transactionDate: wib('2026-03-28'), createdAt: wibAt('2026-03-28', 14, 30) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 850000,  notes: 'Setoran iuran akhir Maret',      recorder: 'admin1',    transactionDate: wib('2026-03-31'), createdAt: wibAt('2026-03-31', 15, 0) },
  { type: 'withdraw', purpose: 'Other',              amount: 120000,  notes: 'Cetak banner rapat bulanan',    recorder: 'admin1',    transactionDate: wib('2026-03-30'), createdAt: wibAt('2026-03-31', 9, 0) },

  // ===== APRIL 2026 =====
  { type: 'deposit',  purpose: 'Setoran',           amount: 880000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-04-01'), createdAt: wibAt('2026-04-02', 8, 0) },
  { type: 'deposit',  purpose: 'KTA Trans',          amount: 700000,  notes: 'KTA bulan April (14 anggota)',  recorder: 'Bejo Harto',transactionDate: wib('2026-04-03'), createdAt: wibAt('2026-04-03', 10, 30) },
  { type: 'deposit',  purpose: 'Deposit Anggota Baru', amount: 750000, notes: 'Anggota baru: Dewi Lestari', recorder: 'superadmin', transactionDate: wib('2026-04-05'), createdAt: wibAt('2026-04-06', 9, 0) },
  { type: 'withdraw', purpose: 'Reimburse',          amount: 350000,  notes: 'Reimburse servis kendaraan operasional', recorder: 'Bejo Harto', transactionDate: wib('2026-04-07'), createdAt: wibAt('2026-04-08', 9, 0) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 910000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-04-08'), createdAt: wibAt('2026-04-09', 8, 0) },
  { type: 'deposit',  purpose: 'Other',             amount: 2500000, notes: 'Dana proyek kemitraan rute baru', recorder: 'superadmin', transactionDate: wib('2026-04-10'), createdAt: wibAt('2026-04-10', 13, 0) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 860000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-04-14'), createdAt: wibAt('2026-04-15', 8, 30) },
  { type: 'withdraw', purpose: 'Sponsorship',        amount: 1500000, notes: 'Sponsor seminar transportasi publik', recorder: 'superadmin', transactionDate: wib('2026-04-16'), createdAt: wibAt('2026-04-17', 10, 0) },
  { type: 'deposit',  purpose: 'Denda Resign',       amount: 400000,  notes: 'Denda resign: Supriyadi W.',    recorder: 'superadmin',transactionDate: wib('2026-04-20'), createdAt: wibAt('2026-04-21', 9, 0) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 870000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-04-22'), createdAt: wibAt('2026-04-23', 8, 0) },
  { type: 'withdraw', purpose: 'Gaji Pegawai',       amount: 1800000, notes: 'Honor koordinator bulan April', recorder: 'superadmin',transactionDate: wib('2026-04-25'), createdAt: wibAt('2026-04-26', 9, 0) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 900000,  notes: 'Setoran iuran akhir April',      recorder: 'admin1',    transactionDate: wib('2026-04-30'), createdAt: wibAt('2026-04-30', 15, 0) },

  // ===== MEI 2026 =====
  { type: 'deposit',  purpose: 'Setoran',           amount: 870000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-05-02'), createdAt: wibAt('2026-05-03', 8, 0) },
  { type: 'deposit',  purpose: 'KTA Trans',          amount: 750000,  notes: 'KTA bulan Mei (15 anggota)',    recorder: 'Bejo Harto',transactionDate: wib('2026-05-04'), createdAt: wibAt('2026-05-04', 10, 0) },
  { type: 'deposit',  purpose: 'Deposit Anggota Baru', amount: 500000, notes: 'Anggota baru: Agus Hermawan', recorder: 'superadmin', transactionDate: wib('2026-05-06'), createdAt: wibAt('2026-05-07', 9, 0) },
  { type: 'withdraw', purpose: 'Reimburse',          amount: 125000,  notes: 'Reimburse print laporan keuangan', recorder: 'admin1', transactionDate: wib('2026-05-08'), createdAt: wibAt('2026-05-09', 9, 30) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 890000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-05-09'), createdAt: wibAt('2026-05-10', 8, 0) },
  { type: 'deposit',  purpose: 'Denda Resign',       amount: 300000,  notes: 'Denda resign: Lutfi A.',        recorder: 'superadmin',transactionDate: wib('2026-05-12'), createdAt: wibAt('2026-05-12', 11, 30) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 850000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-05-13'), createdAt: wibAt('2026-05-14', 8, 0) },
  { type: 'withdraw', purpose: 'Other',              amount: 200000,  notes: 'Perlengkapan rapat bulanan',    recorder: 'Bejo Harto',transactionDate: wib('2026-05-15'), createdAt: wibAt('2026-05-15', 13, 0) },
  { type: 'deposit',  purpose: 'Setoran',           amount: 870000,  notes: 'Setoran iuran mingguan anggota', recorder: 'admin1',    transactionDate: wib('2026-05-17'), createdAt: wibAt('2026-05-17', 8, 30) },
];

async function main() {
  console.log('🧹 Menghapus semua data transaksi dan audit log...');
  await prisma.auditlog.deleteMany({});
  await prisma.transaction.deleteMany({});
  console.log('✅ Data lama berhasil dihapus.');

  console.log(`\n🌱 Menanam ${transactions.length} transaksi demo...`);

  // Cari userId berdasarkan username
  const users = await prisma.user.findMany({ select: { id: true, username: true } });
  const userMap = Object.fromEntries(users.map(u => [u.username, u.id]));

  let inserted = 0;
  for (const trx of transactions) {
    const userId = userMap[trx.recorder] || users[0].id;
    await prisma.transaction.create({
      data: {
        type: trx.type,
        amount: trx.amount,
        purpose: trx.purpose,
        notes: trx.notes || null,
        recorder: trx.recorder || null,
        transactionDate: trx.transactionDate,
        userId,
        createdAt: trx.createdAt,
      },
    });
    inserted++;
  }

  console.log(`✅ ${inserted} transaksi demo berhasil ditambahkan.`);

  // Tampilkan ringkasan
  const totalDeposit = transactions.filter(t => t.type === 'deposit').reduce((s, t) => s + t.amount, 0);
  const totalWithdraw = transactions.filter(t => t.type === 'withdraw').reduce((s, t) => s + t.amount, 0);
  const saldo = totalDeposit - totalWithdraw;

  console.log('\n📊 Ringkasan:');
  console.log(`   Total Deposit : Rp ${totalDeposit.toLocaleString('id-ID')}`);
  console.log(`   Total Withdraw: Rp ${totalWithdraw.toLocaleString('id-ID')}`);
  console.log(`   Saldo Akhir   : Rp ${saldo.toLocaleString('id-ID')}`);
}

main()
  .catch(e => { console.error('❌ Error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
