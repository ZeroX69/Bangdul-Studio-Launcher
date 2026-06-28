// firebase-config.js
// Konfigurasi ini diperoleh dari Firebase Console.
// Digunakan untuk menghubungkan aplikasi ke layanan Firebase (Realtime Database, dll).

const firebaseConfig = {
    apiKey: "AIzaSyDW3DSLg3t34lduuXmSZuQJLnthJakEPc4",
    authDomain: "focus-electron-466315-k9.firebaseapp.com",
    projectId: "focus-electron-466315-k9",
    storageBucket: "focus-electron-466315-k9.firebasestorage.app",
    messagingSenderId: "127787333175",
    appId: "1:127787333175:web:e47b0e9c2483ec87ec31b2",
    measurementId: "G-88MXV9FK9Q",
    // PENTING: URL Database harus ditambahkan di sini agar fitur Online User berfungsi
    databaseURL: "https://focus-electron-466315-k9-default-rtdb.firebaseio.com" // Matches exact URL from console
};

module.exports = firebaseConfig;
