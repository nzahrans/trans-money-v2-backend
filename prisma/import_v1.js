const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const CSV_FILE_PATH = path.join(__dirname, '../v1_transactions.csv');

// Helper to parse CSV lines safely handling double quotes and commas
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Valid purposes in v2
const DEPOSIT_PURPOSES = ['Deposit Anggota Baru', 'Denda Resign', 'Setoran', 'KTA Trans', 'Other'];
const WITHDRAW_PURPOSES = ['Reimburse', 'Sponsorship', 'Gaji Pegawai', 'Pajak', 'Other'];

async function main() {
  console.log('🚀 Memulai proses impor data dari v1...');

  if (!fs.existsSync(CSV_FILE_PATH)) {
    console.error(`❌ Error: File CSV tidak ditemukan di: ${CSV_FILE_PATH}`);
    console.log('\n👉 SILAKAN LAKUKAN INI:');
    console.log('1. Simpan file ekspor v1 Anda di folder backend.');
    console.log('2. Beri nama file tersebut: "v1_transactions.csv"');
    console.log('3. Setelah itu, jalankan kembali script ini dengan perintah:');
    console.log('   node prisma/import_v1.js\n');
    process.exit(1);
  }

  // Ambil semua user di DB v2 untuk dipetakan
  const dbUsers = await prisma.user.findMany();
  if (dbUsers.length === 0) {
    console.error('❌ Error: Tidak ada user terdaftar di database v2. Jalankan seed database terlebih dahulu (npm run seed / node prisma/seed.js).');
    process.exit(1);
  }

  console.log(`👤 Ditemukan ${dbUsers.length} user di database v2.`);

  const fileStream = fs.createReadStream(CSV_FILE_PATH);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  let successCount = 0;
  let errorCount = 0;
  let headers = [];

  for await (const line of rl) {
    lineCount++;
    if (!line.trim()) continue;

    const parsed = parseCSVLine(line);

    if (lineCount === 1) {
      // Header row
      headers = parsed.map(h => h.toLowerCase());
      console.log('📌 Header CSV terdeteksi:', headers.join(', '));
      continue;
    }

    try {
      // Petakan index kolom dinamis berdasarkan nama header
      const dateIdx = headers.indexOf('date');
      const typeIdx = headers.indexOf('type');
      const amountIdx = headers.indexOf('amount');
      const recorderIdx = headers.indexOf('recorder');
      const purposeIdx = headers.indexOf('purpose');
      const notesIdx = headers.indexOf('notes');

      if (dateIdx === -1 || typeIdx === -1 || amountIdx === -1) {
        throw new Error('Kolom Date, Type, atau Amount wajib ada di dalam CSV.');
      }

      const rawDate = parsed[dateIdx];
      const rawType = parsed[typeIdx];
      const rawAmount = parsed[amountIdx];
      const rawRecorder = recorderIdx !== -1 ? parsed[recorderIdx] : '';
      const rawPurpose = purposeIdx !== -1 ? parsed[purposeIdx] : '';
      const rawNotes = notesIdx !== -1 ? parsed[notesIdx] : '';

      // 1. Parsing Date (DD/MM/YYYY)
      const dateParts = rawDate.split('/');
      if (dateParts.length !== 3) {
        throw new Error(`Format tanggal tidak valid: ${rawDate}. Diharapkan DD/MM/YYYY.`);
      }
      const [day, month, year] = dateParts;
      const transactionDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00.000Z`);

      // 2. Parsing Type (Withdrawal / Deposit)
      const type = rawType.toLowerCase().includes('withdraw') ? 'withdraw' : 'deposit';

      // 3. Parsing Amount (Hilangkan Rp, spasi, titik)
      const amount = parseInt(rawAmount.replace(/[^0-9]/g, ''), 10);
      if (isNaN(amount)) {
        throw new Error(`Jumlah nominal tidak valid: ${rawAmount}`);
      }

      // 4. Parsing Recorder & Mapping ke userId
      const recorder = rawRecorder || null;
      let matchedUser = null;
      if (recorder) {
        // Cari user yang username atau namanya cocok
        matchedUser = dbUsers.find(u => 
          u.username.toLowerCase() === recorder.toLowerCase() ||
          (u.name && u.name.toLowerCase() === recorder.toLowerCase()) ||
          recorder.toLowerCase().includes(u.username.toLowerCase())
        );
      }
      const userId = matchedUser ? matchedUser.id : dbUsers[0].id;

      // 5. Mapping Purpose
      let purpose = rawPurpose;
      let notes = rawNotes || null;

      if (type === 'deposit') {
        if (!DEPOSIT_PURPOSES.includes(purpose)) {
          notes = notes ? `[Keperluan V1: ${purpose}] ${notes}` : `[Keperluan V1: ${purpose}]`;
          purpose = 'Other';
        }
      } else {
        if (!WITHDRAW_PURPOSES.includes(purpose)) {
          notes = notes ? `[Keperluan V1: ${purpose}] ${notes}` : `[Keperluan V1: ${purpose}]`;
          purpose = 'Other';
        }
      }

      // 6. Simpan ke database
      await prisma.transaction.create({
        data: {
          type,
          amount,
          purpose,
          notes,
          recorder,
          transactionDate,
          userId,
          createdAt: transactionDate // set createdAt sama dengan transactionDate agar history tersinkronisasi dengan benar sesuai tanggal asli
        }
      });

      successCount++;
    } catch (err) {
      errorCount++;
      console.error(`⚠️ Gagal memproses baris ${lineCount}: "${line}" | Error: ${err.message}`);
    }
  }

  console.log('\n📊 Ringkasan Impor:');
  console.log(`   - Total baris diproses: ${lineCount - 1}`);
  console.log(`   - Berhasil diimpor   : ${successCount}`);
  console.log(`   - Gagal              : ${errorCount}`);
  console.log('✅ Proses selesai!');
}

main()
  .catch(e => {
    console.error('❌ Terjadi kesalahan fatal:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
