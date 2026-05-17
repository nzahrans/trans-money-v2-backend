const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Memulai pembersihan data dummy...');

  // Hapus semua data transaksi & auditlog
  const delTransactions = await prisma.transaction.deleteMany({});
  const delAuditLogs = await prisma.auditlog.deleteMany({});

  console.log(`✅ Berhasil menghapus ${delTransactions.count} data transaksi dummy.`);
  console.log(`✅ Berhasil menghapus ${delAuditLogs.count} data audit log dummy.`);
  console.log('✨ Database sekarang bersih dari data dummy!');
}

main()
  .catch(e => {
    console.error('❌ Gagal membersihkan database:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
