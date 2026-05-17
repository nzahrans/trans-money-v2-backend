const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Memulai proses pembuatan transaksi penyesuaian...');

  // Ambil user pertama sebagai pengait relasi userId
  const dbUsers = await prisma.user.findMany();
  if (dbUsers.length === 0) {
    console.error('❌ Error: Tidak ada user terdaftar di database.');
    process.exit(1);
  }
  const userId = dbUsers[0].id;

  // Tanggal penyesuaian diatur ke 18 Juni 2025 (1 hari sebelum data terlama di CSV)
  const adjustDate = new Date('2025-06-18T00:00:00.000Z');

  // 1. Buat transaksi penyesuaian Pemasukan (Deposit)
  console.log('➕ Membuat transaksi penyesuaian Pemasukan (Deposit)...');
  await prisma.transaction.create({
    data: {
      type: 'deposit',
      amount: 758371109,
      purpose: 'Other',
      notes: 'Penyesuaian Saldo Awal (Pemasukan Terlewat v1)',
      recorder: 'Sistem (Penyesuaian)',
      transactionDate: adjustDate,
      userId: userId,
      createdAt: adjustDate
    }
  });

  // 2. Buat transaksi penyesuaian Pengeluaran (Withdraw)
  console.log('➖ Membuat transaksi penyesuaian Pengeluaran (Withdraw)...');
  await prisma.transaction.create({
    data: {
      type: 'withdraw',
      amount: 478998585,
      purpose: 'Other',
      notes: 'Penyesuaian Saldo Awal (Pengeluaran Terlewat v1)',
      recorder: 'Sistem (Penyesuaian)',
      transactionDate: adjustDate,
      userId: userId,
      createdAt: adjustDate
    }
  });

  console.log('\n📊 HASIL AKHIR PENYESUAIAN:');
  console.log('   - Ditambahkan Deposit  : Rp 758.371.109');
  console.log('   - Ditambahkan Withdraw : Rp 478.998.585');
  console.log('✅ Penyesuaian berhasil ditambahkan ke database!');
}

main()
  .catch(e => {
    console.error('❌ Terjadi kesalahan fatal:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
