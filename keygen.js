// keygen.js
// Berisi logika inti untuk membuat dan memvalidasi kunci aktivasi.
// File ini digunakan oleh main.js (untuk validasi) dan skrip generator rahasia (untuk pembuatan).

const crypto = require('crypto');

// --- KUNCI RAHASIA ---
// Ini adalah kunci rahasia "master" Anda. JANGAN PERNAH bagikan ini.
// GANTI DENGAN KUNCI HEXADECIMAL 64 KARAKTER YANG BARU DIHASILKAN
// Anda bisa membuatnya sendiri atau menggunakan contoh di bawah ini (tapi sebaiknya buat sendiri).
// CONTOH KUNCI BARU (64 karakter hex):
const SECRET_KEY = '65cad455d8eacf593d363d6eb2df259d6efff9330b5f46b6f0f46f1e566104e0'; // <--- GANTI INI!
// Contoh yang bisa Anda gunakan (tapi lebih baik buat sendiri):
// const SECRET_KEY = 'e8b3e3e4a2d3b1c4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8';

// Pastikan panjang kunci heksadesimal adalah 64 karakter (32 byte)
if (SECRET_KEY.length !== 64 || !/^[0-9a-fA-F]+$/.test(SECRET_KEY)) {
    throw new Error('FATAL: SECRET_KEY in keygen.js harus berupa string heksadesimal 64 karakter.');
}

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // Untuk AES, panjang IV adalah 16 byte
const secretKeyBuffer = Buffer.from(SECRET_KEY, 'hex'); // Buffer kunci dibuat sekali

/**
 * Mengenkripsi data (payload) menjadi kunci aktivasi.
 * @param {string} text - Payload yang akan dienkripsi (string JSON).
 * @returns {string} Kunci aktivasi terenkripsi (format: iv:encryptedData).
 */
function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, secretKeyBuffer, iv); // Gunakan buffer kunci
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Mendekripsi kunci aktivasi kembali menjadi data (payload).
 * @param {string} text - Kunci aktivasi terenkripsi (format: iv:encryptedData).
 * @returns {string | null} Payload asli (string JSON) atau null jika gagal.
 */
function decrypt(text) {
  try {
    const textParts = text.split(':');
    if (textParts.length !== 2) {
      throw new Error('Format kunci tidak valid (kurang dari 2 bagian)');
    }
    const ivString = textParts.shift();
    const encryptedTextString = textParts.join(':');

    // Validasi panjang hex sebelum konversi
    if (ivString.length !== IV_LENGTH * 2) { // 2 karakter hex per byte
        throw new Error('Panjang IV hex tidak valid');
    }
    if (encryptedTextString.length % 2 !== 0) { // Panjang hex harus genap
        throw new Error('Panjang data terenkripsi hex tidak valid');
    }

    const iv = Buffer.from(ivString, 'hex');
    const encryptedText = Buffer.from(encryptedTextString, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, secretKeyBuffer, iv); // Gunakan buffer kunci
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error('Gagal dekripsi:', error.message);
    return null; // Gagal dekripsi (kunci salah, IV salah, dll)
  }
}

/**
 * Menghasilkan hash SHA256 dari string (untuk validasi ID Mesin).
 * @param {string} string - String yang akan di-hash.
 * @returns {string} Hash SHA256.
 */
function createHash(string) {
  // Gunakan kunci rahasia yang sama untuk hashing agar lebih aman
  return crypto.createHmac('sha256', secretKeyBuffer) // Gunakan HMAC
                 .update(string)
                 .digest('hex');
}

/**
 * [ADMIN ONLY] Membuat kunci aktivasi baru.
 * Fungsi ini harus digunakan di skrip generator rahasia Anda.
 * @param {string} username - Nama pengguna yang akan dilisensikan.
 * @param {string} machineId - ID Mesin unik pengguna.
 * @param {number} expiryDays - Jumlah hari masa aktif lisensi.
 * @returns {string} Kunci aktivasi terenkripsi.
 */
function generateKey(username, machineId, expiryDays) {
  if (!username || typeof username !== 'string' || username.trim().length === 0) {
      throw new Error("Nama pengguna tidak boleh kosong.");
  }
  if (!machineId || typeof machineId !== 'string' || machineId.trim().length === 0) {
      throw new Error("ID Mesin tidak boleh kosong.");
  }
  if (typeof expiryDays !== 'number' || !Number.isInteger(expiryDays) || expiryDays <= 0) {
      throw new Error("Masa aktif harus berupa angka integer positif.");
  }

  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + expiryDays);

  const payload = {
    username: username.trim(), // Trim spasi
    machineIdHash: createHash(machineId.trim()), // Hash ID mesin yang sudah di-trim
    expiryTimestamp: expiryDate.getTime()
  };

  const payloadString = JSON.stringify(payload);
  const activationKey = encrypt(payloadString);

  return activationKey;
}

/**
 * [APP-SIDE] Memvalidasi kunci aktivasi yang dimasukkan pengguna.
 * Fungsi ini dipanggil oleh main.js.
 * @param {string} activationKey - Kunci aktivasi yang dimasukkan pengguna.
 * @param {string} currentMachineId - ID Mesin dari komputer pengguna saat ini.
 * @returns {object} Objek hasil validasi.
 */
function validateKey(activationKey, currentMachineId) {
  if (!currentMachineId) {
      return { success: false, message: 'ID Mesin saat ini tidak tersedia.' };
  }

  const payloadString = decrypt(activationKey);

  if (!payloadString) {
    return { success: false, message: 'Kunci aktivasi tidak valid atau rusak.' };
  }

  let payload;
  try {
    payload = JSON.parse(payloadString);
  } catch (e) {
    return { success: false, message: 'Format data kunci rusak.' };
  }

  // 1. Validasi struktur payload dasar
  if (typeof payload !== 'object' || payload === null ||
      !payload.machineIdHash || typeof payload.machineIdHash !== 'string' ||
      !payload.expiryTimestamp || typeof payload.expiryTimestamp !== 'number' ||
      !payload.username || typeof payload.username !== 'string') {
      return { success: false, message: 'Struktur data kunci tidak valid.' };
  }


  // 2. Validasi ID Mesin
  const currentMachineIdHash = createHash(currentMachineId);
  if (payload.machineIdHash !== currentMachineIdHash) {
    console.warn(`Hash ID Mesin tidak cocok. Diharapkan: ${payload.machineIdHash}, Didapat: ${currentMachineIdHash} (dari ID: ${currentMachineId})`);
    return { success: false, message: 'Kunci ini tidak valid untuk ID Mesin ini.' };
  }

  // 3. Validasi Tanggal Kedaluwarsa
  const expiryDate = new Date(payload.expiryTimestamp);
  if (isNaN(expiryDate.getTime()) || expiryDate.getTime() <= Date.now()) {
    const expiryString = !isNaN(expiryDate.getTime()) ? expiryDate.toLocaleDateString('id-ID') : 'Tidak Valid';
    return { success: false, message: `Lisensi telah kedaluwarsa atau tanggal tidak valid (${expiryString})` };
  }

  // 4. Validasi Nama Pengguna (tidak boleh kosong setelah di-trim)
  if (payload.username.trim().length === 0) {
    return { success: false, message: 'Kunci tidak mengandung nama pengguna yang valid.' };
  }

  // Jika semua validasi lolos
  return {
    success: true,
    message: 'Aktivasi berhasil!',
    username: payload.username.trim(), // Kembalikan username yang sudah di-trim
    expiryDate: expiryDate.toISOString() // Kirim kembali tanggal kedaluwarsa dalam format standar
  };
}

// Ekspor fungsi agar bisa digunakan oleh main.js atau skrip generator
module.exports = {
  generateKey,
  validateKey
};
