
// --- BangDull Launcher Main Process ---
const { app, BrowserWindow, ipcMain, shell, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const { autoUpdater } = require('electron-updater');
const { execFile } = require('child_process');
const { machineId } = require('node-machine-id');
const Store = require('electron-store');
const keygen = require('./keygen');

const store = new Store();

// Logger sederhana
const log = require('electron-log');
log.transports.file.level = 'info';

// --- FIREBASE SETUP (v12 Compat) ---
const firebaseConfig = require('./firebase-config');
const firebase = require("firebase/compat/app").default;
require("firebase/compat/database");

// Initialize Firebase only if config is valid
let db = null;
try {
  if (firebaseConfig && firebaseConfig.apiKey) {
    if (!firebase.apps.length) {
      const firebaseApp = firebase.initializeApp(firebaseConfig);
      db = firebaseApp.database();
    } else {
      db = firebase.app().database();
    }
    // Test connection
    log.info('[FIREBASE] Initialized successfully (v8)');
  } else {
    log.warn('[FIREBASE] Skipped initialization: Missing config');
  }
} catch (error) {
  log.error('[FIREBASE] Init failed:', error.message);
}

// Flag untuk mendeteksi apakah user benar-benar ingin keluar (via Tray) atau hanya close window
app.isQuitting = false;

// Logger moved to top

let mainWindow;
let tray = null;
let autoLogoutTimer = null;
let currentMachineId = null; // Global machine ID scope
const appIconPath = path.join(__dirname, 'assets', 'icon.ico');

// --- AUTO-UPDATE & VERSION INFO (Registered immediately to avoid v... bug) ---
let currentUpdateStatus = { status: 'idle', message: 'Siap.' };

ipcMain.handle('launcher:get-update-status', () => {
  return currentUpdateStatus;
});

ipcMain.handle('launcher:get-app-version', () => {
  return app.getVersion();
});

// === SAFE SEND HELPER (Prevent 'Object has been destroyed' crash) ===
let lastOnlineCount = 0; // Cache status terakhir
function safeSend(channel, data) {
  if (channel === 'online-user-count') lastOnlineCount = data;
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send(channel, data);
    }
  } catch (e) {
    // Window sudah ditutup, abaikan
  }
}

// === GLOBAL ERROR HANDLER (Suppress crash dialog on force-close) ===
process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error.message);
  // Jangan tampilkan dialog error jika window sudah ditutup
  if (error.message.includes('Object has been destroyed')) {
    return; // Abaikan, ini normal saat force-close
  }
});

// Lokasi penyimpanan aplikasi (Default: %AppData%/BangDullLauncher/MyApps)
const APPS_DIR = path.join(app.getPath('userData'), 'MyApps');

if (!fs.existsSync(APPS_DIR)) {
  fs.mkdirSync(APPS_DIR, { recursive: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 1000,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false // Izinkan memuat gambar dari lokal/remote
    },
    frame: true, // Gunakan frame bawaan atau false jika ingin custom header
    resizable: true,
    backgroundColor: '#111111'
  });

  // --- SYNC CHECK: Force Logout sekali untuk user versi lama (agar data terekam di Firebase) ---
  const isFirebaseSynced = store.get('isFirebaseSynced', false);
  let isActivated = store.get('isActivated', false);

  if (isActivated && !isFirebaseSynced) {
    log.info('[SYNC] User lama terdeteksi (belum sinkron Firebase). Force logout 1x untuk registrasi ulang.');
    store.delete('isActivated');
    store.delete('activationData');
    store.set('isFirebaseSynced', true);
    isActivated = false;
  }
  // --- END SYNC CHECK ---

  const activationData = store.get('activationData');

  // --- BARU: AUTO LOGOUT JIKA TRIAL/LISENSI HABIS ---
  if (isActivated && activationData && activationData.expiryDate) {
    const expiryTimestamp = new Date(activationData.expiryDate).getTime();
    if (Date.now() >= expiryTimestamp) {
      // Expired! Auto logout
      store.delete('isActivated');
      store.delete('activationData');
      isActivated = false;
      log.info('[ACTIVATION] License expired. User logged out automatically.');
    } else {
      // Not expired, set timer to auto logout if it expires while app is open
      const timeRemaining = expiryTimestamp - Date.now();
      // setTimeout limit is 2147483647 ms (~24 days)
      const delay = Math.min(timeRemaining, 2147483647);
      if (autoLogoutTimer) clearTimeout(autoLogoutTimer);
      autoLogoutTimer = setTimeout(() => {
        log.info('[ACTIVATION] License expired during session. Auto logging out...');
        store.delete('isActivated');
        store.delete('activationData');
        app.relaunch();
        app.exit(0);
      }, delay);
    }
  }
  // --- AKHIR BARU ---

  if (isActivated) {
    mainWindow.loadFile('main.html');
    mainWindow.setMenuBarVisibility(true);
    mainWindow.setMenu(null); // Sembunyikan panel menu bawaan Electron
    // Event saat window ditutup -> Minimize to Tray
    // Event saat window ditutup -> Minimize to Tray (SUDAH DINONAKTIFKAN ATAS PERMINTAAN USER)
    // mainWindow.on('close', (event) => {
    //   // Jika app tidak sedang mau quit, sembunyikan saja window-nya
    //   if (!app.isQuitting) {
    //     event.preventDefault();
    //     mainWindow.hide();
    //     return false;
    //   }
    // });

    // === TRAY SETUP ===
    // Buat tray hanya jika belum ada
    if (!tray) {
      tray = new Tray(appIconPath);
      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Buka BangDull Studio',
          click: () => mainWindow.show()
        },
        {
          label: 'Keluar',
          click: () => {
            app.isQuitting = true;
            app.quit();
          }
        }
      ]);
      tray.setToolTip('BangDull Studio Launcher');
      tray.setContextMenu(contextMenu);

      tray.on('click', () => {
        mainWindow.setVisibleOnAllWorkspaces(true); // Memastikan muncul
        mainWindow.show();
        mainWindow.focus();
      });
    }

    } else {
        mainWindow.loadFile('activation.html');
        mainWindow.setMenuBarVisibility(false);
    }
}

app.whenReady().then(async () => {
  // Get machine ID first
  try {
    currentMachineId = await machineId();
    if (!currentMachineId) throw new Error('Empty machine ID');
    log.info('[SYSTEM] Machine ID detected:', currentMachineId);
  } catch (e) {
    log.error('Failed to get machine identification:', e);
    // Fallback: Generate a persistent random ID if hardware ID fail
    currentMachineId = store.get('fallback_machineId');
    if (!currentMachineId) {
      currentMachineId = 'dev_' + Math.random().toString(36).substr(2, 9);
      store.set('fallback_machineId', currentMachineId);
    }
    log.warn('[SYSTEM] Using fallback Machine ID:', currentMachineId);
  }

  // --- CEK BLOKIR PERMANEN SEBELUM LOAD WINDOW ---
  if (db && currentMachineId) {
    const safeId = currentMachineId.replace(/[.#$/\[\]]/g, '_').trim();
    const banSnapshot = await db.ref(`registrations/${safeId}/isRevoked`).once('value');
    if (banSnapshot && banSnapshot.val() === true) {
      log.warn('[SECURITY] Permanent Ban detected on startup. Clearing local license.');
      // Jika diblokir, paksa hapus lisensi lokal biar balik ke menu aktivasi
      store.delete('isActivated');
      store.delete('activationData');
    }
  }

  createWindow();

  // --- ONLINE PRESENCE & BAN LOGIC ---
  if (db && currentMachineId) {
    const setupPresenceAndBanCheck = () => {
      const activationData = store.get('activationData');
      let username = 'Guest';

      // Gunakan Machine ID sebagai kunci utama (Sanitasi agar tidak nested jika ada titik)
      const userId = currentMachineId.replace(/[.#$/\[\]]/g, '_').trim();
      if (!userId) return;

      if (activationData && activationData.username) {
        username = activationData.username;
      }

      const userStatusRef = db.ref(`status/launcher/${userId}`);

      // --- Fungsi helper untuk menulis/memperbarui status Online ---
      function writePresence() {
        userStatusRef.onDisconnect().remove().then(() => {
          userStatusRef.set({
            username: username,
            state: 'online',
            machineId: currentMachineId,
            licenseKey: activationData ? activationData.licenseKey : null,
            last_changed: Date.now()
          }).catch(err => {
            log.error('[FIREBASE] Set presence failed:', err);
          });
        }).catch(err => {
          log.error('[FIREBASE] onDisconnect setup failed:', err);
        });
      }

      // --- AUTO-RECONNECT PRESENCE (Fix: user hilang setelah koneksi putus-nyambung) ---
      const connectedRef = db.ref('.info/connected');
      connectedRef.on('value', (snap) => {
        if (snap.val() === true) {
          log.info('[FIREBASE] Connected/Reconnected. Re-registering presence...');
          writePresence();
        } else {
          log.warn('[FIREBASE] Connection lost. Waiting for reconnect...');
        }
      });

      // --- HEARTBEAT: Cegah silent drop oleh router/firewall & jaga status tetap segar ---
      // Menulis ulang status setiap 4 menit agar koneksi WebSocket tidak dianggap idle.
      const HEARTBEAT_INTERVAL = 4 * 60 * 1000; // 4 menit
      setInterval(() => {
        log.info('[HEARTBEAT] Refreshing presence...');
        writePresence();
      }, HEARTBEAT_INTERVAL);
      // --- END PRESENCE SYSTEM ---

      // --- REMOTE KICK LISTENER ---
      const forceLogoutRef = db.ref(`status/launcher/${userId}/forceLogout`);
      forceLogoutRef.on('value', (snapshot) => {
        if (snapshot.val() === true) {
          log.warn(`[FIREBASE] Admin triggered Remote Logout for user: ${userId}`);
          forceLogoutRef.remove().catch(e => console.error(e));
          store.delete('isActivated');
          store.delete('activationData');
          app.relaunch();
          app.exit(0);
        }
      });

      // --- PERMANENT BAN LISTENER (BERDASARKAN HARDWARE ID) ---
      const revokeRef = db.ref(`registrations/${userId}/isRevoked`);
      revokeRef.on('value', (snap) => {
        if (snap.val() === true) {
          log.warn(`[FIREBASE] ACCESS DENIED: Device is Hard-Banned: ${currentMachineId}`);

          // HANYA Relaunch jika sedang aktif (Kalo sudah di menu aktivasi, diamkan saja biar tidak looping)
          if (store.get('isActivated')) {
            store.delete('isActivated');
            store.delete('activationData');
            app.relaunch();
            app.exit(0);
          }
        }
      });
    };

    setupPresenceAndBanCheck();

    // 2. LISTEN TOTAL ONLINE
    const allUsersRef = db.ref('status/launcher');
    allUsersRef.on('value', (snapshot) => {
      try {
        const count = snapshot.numChildren();
        safeSend('online-user-count', count);
      } catch (e) {
        log.error('[FIREBASE] Count error:', e);
      }
    });
  }

  // === AUTO CLEAR UPDATER CACHE ===
  // Hapus folder cache updater (bangdull-studio-updater) setiap kali app start
  // untuk menghemat ruang disk setelah update selesai diinstall.
  try {
    const updaterCacheDir = path.join(process.env.LOCALAPPDATA || '', 'bangdull-studio-updater');
    if (fs.existsSync(updaterCacheDir)) {
      fs.rmSync(updaterCacheDir, { recursive: true, force: true });
      log.info(`[CACHE] Updater cache cleared: ${updaterCacheDir}`);
    }
  } catch (e) {
    log.warn('[CACHE] Failed to clear updater cache:', e.message);
  }


  // KONFIGURASI AUTO-UPDATE (WORKING IN DEV & PROD)
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true; // FORCE check di mode dev
    log.info('Running in DEV mode: Force update check enabled.');
  }

  autoUpdater.autoDownload = false; // MANUAL DOWNLOAD
  autoUpdater.autoInstallOnAppQuit = true;

  // Event Listeners
  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for updates...');
    currentUpdateStatus = { status: 'checking', message: 'Memeriksa pembaruan...' };
    safeSend('launcher-update-status', currentUpdateStatus);
  });

  autoUpdater.on('update-available', (info) => {
    log.info(`Update available: v${info.version}`);
    // Jangan download dulu! Tunggu user.
    currentUpdateStatus = {
      status: 'available',
      message: `Update v${info.version} tersedia.`,
      version: info.version
    };
    safeSend('launcher-update-status', currentUpdateStatus);
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('Launcher is up to date.');
    currentUpdateStatus = {
      status: 'uptodate',
      message: 'Launcher sudah versi terbaru.'
    };
    safeSend('launcher-update-status', currentUpdateStatus);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    let log_message = "Download speed: " + progressObj.bytesPerSecond;
    log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
    log.info(log_message);

    currentUpdateStatus = {
      status: 'downloading',
      message: `Mengunduh update... (${Math.round(progressObj.percent)}%)`
    };
    safeSend('launcher-update-status', currentUpdateStatus);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`Update downloaded: v${info.version}`);
    currentUpdateStatus = {
      status: 'ready',
      message: `Update v${info.version} siap! Restart untuk update.`
    };
    safeSend('launcher-update-status', currentUpdateStatus);
  });

  autoUpdater.on('error', (err) => {
    log.error('Auto-updater error:', err.message);
    currentUpdateStatus = {
      status: 'error',
      message: `Gagal update: ${err.message}`
    };
    safeSend('launcher-update-status', currentUpdateStatus);
  });

  // Check Immediately
  autoUpdater.checkForUpdates();

  // IPC for Starting Download (Manual Trigger)
  ipcMain.handle('launcher:start-update-download', () => {
    log.info('User requested start update download...');
    autoUpdater.downloadUpdate();
    return { success: true };
  });

  // IPC for Quitting and Installing Update
  ipcMain.handle('launcher:install-update', () => {
    log.info('User requested install update. Quitting...');
    autoUpdater.quitAndInstall();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // JANGAN QUIT! Launcher harus tetap hidup di Tray (DIUBAH: SEKARANG QUIT TOTAL)
  // Kecuali user eksplisit pilih 'Keluar' di Tray
  app.quit();
});

// --- IPC HANDLERS (LOGIKA LAUNCHER & ACTIVATION) ---

// 0. Activation System
ipcMain.handle('get-machine-id', async () => {
  try {
    const id = await machineId();
    return id;
  } catch (error) {
    log.error('Failed to get machine ID:', error);
    return null;
  }
});

ipcMain.handle('submit-activation-key', async (event, key) => {
  try {
    const currentMachineId = await machineId();

    // --- KEAMANAN: SISTEM PENGUNCI KUNCI (SILENT BLACKLIST) ---
    if (db) {
      // 1. Cek Kunci yang dimasukkan apakah ada di Daftar Hitam Global
      // (Tetap ada walau riwayat riwa-riwi monitoring dihapus)
      const keySafe = Buffer.from(key).toString('base64').replace(/=/g, '');
      const blacklistSnap = await db.ref(`blacklistedKeys/${keySafe}`).once('value');

      if (blacklistSnap.exists()) {
        return {
          success: false,
          message: 'LISENSI DIBLOKIR: Kunci ini telah dinonaktifkan oleh Admin karena suatu alasan. Silakan gunakan Kunci lain.'
        };
      }

      // 2. Cek apakah perangkat ini sedang di-ban KUNCI LAMA-nya
      const snapshot = await db.ref(`registrations/${currentMachineId}`).once('value');
      const regData = snapshot.val();

      // JIKA sedang di-ban DAN dia mencoba memasukkan Kunci yang SAMA dengan yang di-ban
      if (regData && regData.isRevoked === true && regData.licenseKey === key) {
        return {
          success: false,
          message: 'KUNCI HANGUS: Lisensi ini sudah tidak berlaku. Silakan gunakan Kunci baru.'
        };
      }
    }

    const validation = keygen.validateKey(key, currentMachineId);
    if (validation.success) {
      validation.licenseKey = key; // SIMPAN KUNCI DALAM DATA AKTIVASI UNTUK PRESENCE
      store.set('isActivated', true);
      store.set('activationData', validation);

      // --- REGISTRATION LOGGING & AUTO-UNBAN ---
      if (db) {
        const safeId = currentMachineId.replace(/[.#$/\[\]]/g, '_');
        db.ref(`registrations/${safeId}`).set({
          username: validation.username,
          machineId: currentMachineId, // Tetap simpan ID asli di dalam data
          licenseKey: key,
          expiryDate: validation.expiryDate,
          isRevoked: false,
          activationTime: Date.now(),
          lastSeen: Date.now()
        }).catch(err => log.error('[FIREBASE] Failed recording new activation:', err.message));
      }

      store.set('isFirebaseSynced', true);
      return { success: true };
    } else {
      return { success: false, message: validation.message };
    }
  } catch (error) {
    log.error('Activation error:', error);
    return { success: false, message: 'Terjadi kesalahan sistem.' };
  }
});

// --- BARU: START TRIAL IPC ---
ipcMain.handle('start-trial', async () => {
  try {
    const currentMachineId = await machineId();
    if (!currentMachineId) return { success: false, message: 'Gagal mendeteksi ID Mesin' };

    // 0. Cek Blokir Permanen
    if (db) {
      const safeId = currentMachineId.replace(/[.#$/\[\]]/g, '_');
      const banCheck = await db.ref(`registrations/${safeId}/isRevoked`).once('value');
      if (banCheck.val() === true) {
        return { success: false, message: 'DITOLAK: Perangkat ini telah diblokir secara permanen.' };
      }
    }

    // 1. Cek Firebase (Keamanan Utama - Anti Reset Lokal)
    if (db) {
      try {
        const safeId = currentMachineId.replace(/[.#$/\[\]]/g, '_');
        const snapshot = await db.ref(`trials/${safeId}`).once('value');
        if (snapshot.exists()) {
          // Di record cloud sudah pernah trial
          store.set('hasUsedTrial_' + currentMachineId, true); // Sinkronkan ke lokal agar konsisten
          return { success: false, message: 'Akses Trial Ditolak: Perangkat Anda sudah terdaftar pernah 1 kali trial di Server kami.' };
        }
      } catch (fbError) {
        log.warn('[FIREBASE] Gagal mengecek status trial di server:', fbError.message);
        // Jika kita gagal terhubung ke Firebase karena error struktur/koneksi, tolak saja untuk keamanan.
        // Kecuali jika memang error offline murni. Tapi amannya tolak jika db aktif tapi error.
        return { success: false, message: 'Gagal terhubung ke Server Keamanan. Cek koneksi internet Anda.' };
      }
    } else {
      log.warn('[FIREBASE] DB is null during trial check.');
    }

    // 2. Cek Lokal (Fallback)
    const hasUsedTrial = store.get('hasUsedTrial_' + currentMachineId, false);
    if (hasUsedTrial) {
      return { success: false, message: 'Anda sudah menggunakan kuota Trial 3 Hari di PC ini.' };
    }

    // Generate trial key (1 time use) selama 3 hari
    const trialKey = keygen.generateKey("Trial User", currentMachineId, 3);

    // Validasi & Simpan lisensi
    const validation = keygen.validateKey(trialKey, currentMachineId);
    if (validation.success) {
      validation.licenseKey = trialKey; // SIMPAN KUNCI DALAM DATA AKTIVASI UNTUK PRESENCE
      store.set('isActivated', true);
      store.set('activationData', validation);
      store.set('hasUsedTrial_' + currentMachineId, true); // Lock trial feature UI lokal

      // Simpan ke Firebase agar ter-lock permanen selamanya (Anti-Uninstall)
      if (db) {
        try {
          // Menyimpan data logging ke server
          await db.ref(`trials/${currentMachineId}`).set({
            timestamp: Date.now(), // Pakai Date.now JavaScript normal sebagai alternatif ServerValue yang kadang error import
            username: "Trial User",
            licenseKey: trialKey,
            expiryDate: validation.expiryDate
          });
          log.info(`[FIREBASE] Trial lock recorded for ${currentMachineId}`);
        } catch (fbSetErr) {
          log.warn('[FIREBASE] Gagal menyimpan lock trial:', fbSetErr.message);
          // KEMBALIKAN ERROR AGAR TRIAL BATAL JIKA GAGAL SIMPAN KE CLOUD
          store.delete('isActivated');
          store.delete('activationData');
          store.delete('hasUsedTrial_' + currentMachineId);
          return { success: false, message: 'Gagal meregistrasikan ID Mesin ke Server Keamanan. Menolak Trial.' };
        }
      } else {
        log.warn('[FIREBASE] DB is null during trial lock save.');
      }

      store.set('isFirebaseSynced', true);
      return { success: true };
    } else {
      return { success: false, message: 'Gagal menghasilkan lisensi trial.' };
    }
  } catch (error) {
    log.error('Trial error:', error);
    return { success: false, message: 'Terjadi kesalahan sistem: ' + error.message };
  }
});
// --- AKHIR BARU ---

ipcMain.handle('reload-app', () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('get-account-info', () => {
  const activationData = store.get('activationData');
  return activationData || null;
});

ipcMain.handle('logout', () => {
  store.delete('isActivated');
  store.delete('activationData');
  app.relaunch();
  app.exit(0);
});

// 1. Get Apps List (Remote & Local Sync)
// Menggunakan GitHub API untuk data Real-Time (Tanpa Cache Delay)
// Raw GitHub URL + Cache Buster (tanpa rate limit, real-time)
const REMOTE_RAW_BASE = 'https://raw.githubusercontent.com/ZeroX69/Bangdul-Studio-Launcher/main/apps.json';

ipcMain.handle('launcher:get-apps', async () => {
  // FILE CACHE QUERY
  const CACHED_MANIFEST_PATH = path.join(app.getPath('userData'), 'cached-apps.json');
  let manifest = null;

  try {
    // 1. Coba fetch manifest remote via API (Real-Time)
    try {
      // Cache Buster: tambahkan timestamp agar CDN selalu kirim data terbaru
      const REMOTE_API_URL = `${REMOTE_RAW_BASE}?t=${Date.now()}`;
      const response = await axios.get(REMOTE_API_URL, {
        timeout: 5000,
        headers: {
          'User-Agent': 'BangDull-Launcher-App',
          'Cache-Control': 'no-cache'
        }
      });

      // Pastikan response berupa objek JSON, jika string lakukan parsing
      let remoteManifest = response.data;
      if (typeof remoteManifest === 'string') {
        try {
          remoteManifest = JSON.parse(remoteManifest);
        } catch (parseErr) {
          log.warn('Failed to parse remote manifest string:', parseErr.message);
          remoteManifest = null;
        }
      }

      if (remoteManifest && remoteManifest.apps && remoteManifest.apps.length > 0) {
        log.info(`[RAW] Remote Fetch Success! App[0]: ${remoteManifest.apps[0].name}`);
        // SUKSES: Update Cache
        fs.writeFileSync(CACHED_MANIFEST_PATH, JSON.stringify(remoteManifest, null, 2));
        manifest = remoteManifest;
      }
    } catch (netError) {
      log.warn('Gagal fetch manifest (Switching to cache):', netError.message);
    }

    // 2. Jika Remote Gagal, Coba Baca Cache
    if (!manifest && fs.existsSync(CACHED_MANIFEST_PATH)) {
      try {
        manifest = JSON.parse(fs.readFileSync(CACHED_MANIFEST_PATH, 'utf-8'));
        log.info('Using cached manifest from userData.');
      } catch (e) {
        log.error('Corrupt cached manifest.', e);
      }
    }

    // 3. Jika Cache Juga Kosong/Rusak -> Coba baca apps.json bundled
      if (!manifest) {
        // Coba baca file apps.json yang dibundel dengan aplikasi
        const bundledPath = path.join(__dirname, 'apps.json');
        if (fs.existsSync(bundledPath)) {
          try {
            manifest = JSON.parse(fs.readFileSync(bundledPath, 'utf-8'));
            log.info('Using bundled apps.json as fallback.');
          } catch (e) {
            log.error('Failed to parse bundled apps.json.', e);
          }
        }
      }
      if (!manifest) {
        log.warn('No manifest found (Remote failed, Cache empty, no bundled apps). Returning empty list.');
        return [];
      }

    if (!manifest || !manifest.apps) return [];

    // 3. Cek Status Aplikasi (Installed? Update Available?)
    const appsWithStatus = manifest.apps.map(appConfig => {
      const appFolder = path.join(APPS_DIR, appConfig.id);
      let exePath = path.join(appFolder, appConfig.executablePath);
      let isInstalled = fs.existsSync(exePath);

      // KHUSUS Hapus_BG block removed per user request

      let updateAvailable = false;
      const latestVersion = appConfig.version; // Versi TERBARU dari apps.json (GitHub)

      // Cek versi yang terinstall via file .installed-version (SIMPLE & RELIABLE)
      let installedVersion = null;
      const versionFile = path.join(appFolder, '.installed-version');
      if (isInstalled && fs.existsSync(versionFile)) {
        try {
          installedVersion = fs.readFileSync(versionFile, 'utf-8').trim();
        } catch (e) {
          log.warn(`Gagal baca .installed-version ${appConfig.id}:`, e);
        }
      }

      // Update tersedia jika:
      // 1. Terinstall + versi tercatat + berbeda dari GitHub, ATAU
      // 2. Terinstall tapi TIDAK ADA file .installed-version (versi lama/manual)
      if (isInstalled && installedVersion && installedVersion !== latestVersion) {
        log.info(`[VERSION CHECK] ${appConfig.id} - Installed: ${installedVersion} | Latest: ${latestVersion} => UPDATE AVAILABLE`);
        updateAvailable = true;
      } else if (isInstalled && !installedVersion) {
        // App terinstall tapi tidak ada file versi → anggap perlu update
        installedVersion = 'Unknown';
        updateAvailable = true;
        log.warn(`[VERSION CHECK] ${appConfig.id} - No .installed-version file! Marking as update needed. Latest: ${latestVersion}`);
      } else {
        log.info(`[VERSION CHECK] ${appConfig.id} - Installed: ${installedVersion} | Latest: ${latestVersion} => OK`);
      }

      return {
        ...appConfig,
        version: installedVersion || latestVersion, // Tampilkan versi tercatat, atau versi GitHub
        latestVersion: latestVersion,
        isInstalled,
        updateAvailable
      };
    });

    return appsWithStatus;

  } catch (error) {
    log.error('Fatal error in get-apps:', error);
    return [];
  }
});

// === DOWNLOAD MANAGER (Pause / Resume / Persist) ===
const DOWNLOADS_STATE_FILE = path.join(app.getPath('userData'), 'downloads.json');
const activeDownloads = new Map(); // id -> { controller, stream, writer }

// Simpan state download ke disk
function saveDownloadState() {
  const state = {};
  activeDownloads.forEach((dl, id) => {
    state[id] = {
      downloadedBytes: dl.downloadedBytes,
      totalBytes: dl.totalBytes,
      tempFile: dl.tempFile,
      appConfig: dl.appConfig,
      paused: dl.paused || false
    };
  });
  // Juga simpan paused downloads yang tidak aktif tapi masih pending
  const existingState = loadDownloadState();
  Object.keys(existingState).forEach(id => {
    if (!state[id] && existingState[id].paused) {
      state[id] = existingState[id];
    }
  });
  try {
    fs.writeFileSync(DOWNLOADS_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    log.warn('[DL] Failed to save download state:', e.message);
  }
}

// Load state dari disk
function loadDownloadState() {
  try {
    if (fs.existsSync(DOWNLOADS_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(DOWNLOADS_STATE_FILE, 'utf-8'));
    }
  } catch (e) {
    log.warn('[DL] Failed to load download state:', e.message);
  }
  return {};
}

// Hapus state untuk ID tertentu
function clearDownloadState(id) {
  const state = loadDownloadState();
  delete state[id];
  try {
    fs.writeFileSync(DOWNLOADS_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) { /* ignore */ }
}

// Simpan state saat app akan ditutup
app.on('before-quit', () => {
  // Abort semua download aktif dan simpan state
  activeDownloads.forEach((dl, id) => {
    if (dl.controller) dl.controller.abort();
    dl.paused = true;
  });
  saveDownloadState();
  log.info('[DL] Download state saved on quit');
});

// === CORE DOWNLOAD FUNCTION (supports Range resume) ===
async function startDownload(appConfig, resumeFromBytes = 0) {
  try {
    const { id, downloadUrl } = appConfig;
    log.info(`[DL] startDownload called for ${id}, url: ${downloadUrl}, resumeFrom: ${resumeFromBytes}`);
    const isExe = downloadUrl.toLowerCase().endsWith('.exe');
    const targetDir = path.join(APPS_DIR, id);
    const tempFile = path.join(app.getPath('temp'), isExe ? `${id}-setup.exe` : `${id}.zip`);

    const controller = new AbortController();

    // Register download
    const dlState = {
      controller,
      downloadedBytes: resumeFromBytes,
      totalBytes: 0,
      tempFile,
      appConfig,
      paused: false,
      stream: null,
      writer: null
    };
    activeDownloads.set(id, dlState);
    saveDownloadState();

    safeSend('download-progress', { id, progress: 0, status: 'Connecting...' });
    log.info(`[DL] Connecting to download URL...`);

    const headers = {};
    if (resumeFromBytes > 0) {
      headers['Range'] = `bytes=${resumeFromBytes}-`;
      log.info(`[DL] Resuming ${id} from byte ${resumeFromBytes}`);
    }

    const response = await axios({
      url: downloadUrl,
      method: 'GET',
      responseType: 'stream',
      signal: controller.signal,
      headers
    });

    log.info(`[DL] Connected! Content-Length: ${response.headers['content-length']}`);

    // Total size
    const contentLength = parseInt(response.headers['content-length'] || '0');
    const totalLength = resumeFromBytes + contentLength;
    dlState.totalBytes = totalLength;

    // Append mode jika resume, otherwise overwrite
    const writeFlags = resumeFromBytes > 0 ? 'a' : 'w';
    const writer = fs.createWriteStream(tempFile, { flags: writeFlags });
    dlState.writer = writer;
    dlState.stream = response.data;

    response.data.on('data', (chunk) => {
      dlState.downloadedBytes += chunk.length;
      if (totalLength > 0) {
        const progress = Math.round((dlState.downloadedBytes / totalLength) * 100);
        safeSend('download-progress', { id, progress, status: 'Downloading...' });
      }
    });

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      // Handle abort
      controller.signal.addEventListener('abort', () => {
        response.data.destroy();
        writer.end();
        reject(new Error('Download paused'));
      });
    });

    // === DOWNLOAD SELESAI - Lanjut ke install ===
    safeSend('download-progress', { id, progress: 100, status: 'Installing...' });

    if (isExe) {
      if (appConfig.portable) {
        // MODE PORTABLE
        if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
        fs.mkdirSync(targetDir, { recursive: true });

        const destPath = path.join(APPS_DIR, id, appConfig.executablePath);
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

        fs.copyFileSync(tempFile, destPath);
        fs.unlinkSync(tempFile);

        safeSend('download-progress', { id, progress: 100, status: 'Installed (Portable)' });
        log.info(`Portable app installed to: ${destPath}`);

        fs.writeFileSync(path.join(APPS_DIR, id, '.installed-version'), appConfig.version);
        activeDownloads.delete(id);
        clearDownloadState(id);
        return { success: true, type: 'portable' };

      } else {
        // MODE INSTALLER
        safeSend('download-progress', { id, progress: 100, status: 'Menjalankan Installer...' });
        log.info(`Launching installer: ${tempFile}`);
        const child = require('child_process').spawn(tempFile, [], { detached: true, stdio: 'ignore' });
        child.unref();
        activeDownloads.delete(id);
        clearDownloadState(id);
        return { success: true, type: 'installer' };
      }

    } else {
      // MODE ZIP REFINED: Rename - Extract - Delete Old
      const backupDir = path.join(APPS_DIR, `${id}_backup_${Date.now()}`);

      try {
        if (fs.existsSync(targetDir)) {
          fs.renameSync(targetDir, backupDir);
          log.info(`[ZIP] Renamed existing app to backup: ${backupDir}`);
        }
      } catch (err) {
        throw new Error('Gagal update aplikasi. Pastikan APLIKASI SUDAH DITUTUP sebelum update.');
      }

      fs.mkdirSync(targetDir, { recursive: true });

      safeSend('download-progress', { id, progress: 100, status: 'Extracting...' });
      log.info(`[ZIP] Starting extraction for ${id} to ${targetDir}`);
      log.info(`[ZIP] Spawning PowerShell for fast extraction...`);

      const psCommand = `powershell -Command "Expand-Archive -Path '${tempFile}' -DestinationPath '${targetDir}' -Force"`;

      await new Promise((resolve, reject) => {
        require('child_process').exec(psCommand, (error, stdout, stderr) => {
          if (error) {
            log.error('[ZIP] PowerShell Error:', stderr);
            // Restore backup if extraction fails
            try {
              if (fs.existsSync(backupDir)) {
                fs.rmSync(targetDir, { recursive: true, force: true });
                fs.renameSync(backupDir, targetDir);
                log.info(`[ZIP] Restored backup due to extraction failure.`);
              }
            } catch (e) { log.error('Failed to restore backup:', e); }

            reject(error);
          } else {
            resolve();
          }
        });
      });

      log.info(`[ZIP] Extraction complete for ${id}`);

      try { fs.unlinkSync(tempFile); log.info(`[ZIP] Temp file deleted`); } catch (err) { /* ignore */ }

      // Write .installed-version
      const versionToWrite = appConfig.latestVersion || appConfig.version;
      fs.writeFileSync(path.join(targetDir, '.installed-version'), versionToWrite);
      log.info(`[INSTALL] Wrote .installed-version for ${id}: ${versionToWrite}`);

      // Try Delete Backup (Ignore if fails, e.g., locked)
      try {
        if (fs.existsSync(backupDir)) {
          fs.rmSync(backupDir, { recursive: true, force: true });
          log.info(`[ZIP] Deleted backup successfully.`);
        }
      } catch (e) {
        log.warn(`[ZIP] Could not delete backup (locked?):`, e.message);
      }

      activeDownloads.delete(id);
      clearDownloadState(id);
      return { success: true, type: 'zip' };
    }

  } catch (error) {
    // Jika dipaused (abort), jangan hapus state
    if (error.message === 'Download paused' || axios.isCancel(error)) {
      const id = appConfig?.id;
      const dl = id ? activeDownloads.get(id) : null;
      if (dl) {
        dl.paused = true;
        saveDownloadState();
        log.info(`[DL] Download paused for ${id} at ${dl.downloadedBytes} bytes`);
      }
      return { success: false, paused: true, error: 'Download di-pause' };
    }

    const id = appConfig?.id;
    log.error(`[DL] Download failed for ${id || 'unknown'}:`, error);
    if (id) {
      activeDownloads.delete(id);
      clearDownloadState(id);
    }
    return { success: false, error: error.message || 'Download error' };
  }
}

// 2. Download & Install App
ipcMain.handle('launcher:download-app', async (event, appConfig) => {
  return await startDownload(appConfig, 0);
});

// 2b. Pause Download
ipcMain.handle('launcher:pause-download', async (event, appId) => {
  const dl = activeDownloads.get(appId);
  if (dl && dl.controller) {
    dl.controller.abort();
    log.info(`[DL] Pause requested for ${appId}`);
    return { success: true };
  }
  return { success: false, error: 'Download tidak ditemukan' };
});

// 2c. Resume Download
ipcMain.handle('launcher:resume-download', async (event, appId) => {
  // Cek state yang tersimpan
  const state = loadDownloadState();
  const dlState = state[appId];
  if (!dlState) return { success: false, error: 'Tidak ada download yang bisa dilanjutkan' };

  // Cek apakah temp file masih ada
  const tempExists = fs.existsSync(dlState.tempFile);
  const resumeBytes = tempExists ? dlState.downloadedBytes : 0;

  if (!tempExists) {
    log.info(`[DL] Temp file hilang untuk ${appId}, download ulang dari awal`);
  }

  return await startDownload(dlState.appConfig, resumeBytes);
});

// 2d. Get pending downloads (untuk UI saat startup)
ipcMain.handle('launcher:get-pending-downloads', async () => {
  const state = loadDownloadState();
  const pending = [];
  let updated = false;

  Object.keys(state).forEach(id => {
    // Cek apakah aplikasinya SEBENARNYA sudah terinstall?
    // Jika YA -> Hapus status "Pending", anggap selesai.
    const dl = state[id];
    const appFolder = path.join(APPS_DIR, id);
    let isReallyInstalled = false;

    if (dl.appConfig && dl.appConfig.executablePath) {
      const exePath = path.join(appFolder, dl.appConfig.executablePath);
      if (fs.existsSync(exePath)) {
        isReallyInstalled = true;
      }
    }

    if (isReallyInstalled) {
      log.info(`[DL] Found stale pending download for installed app ${id}. Clearing state.`);
      delete state[id];
      updated = true;
    } else if (dl.paused || dl.downloadedBytes > 0) {
      pending.push({
        id,
        name: dl.appConfig.name,
        downloadedBytes: dl.downloadedBytes,
        totalBytes: dl.totalBytes,
        progress: dl.totalBytes > 0 ? Math.round((dl.downloadedBytes / dl.totalBytes) * 100) : 0
      });
    }
  });

  if (updated) {
    try {
      fs.writeFileSync(DOWNLOADS_STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) { /* ignore */ }
  }

  return pending;
});

// 3. Uninstall App
ipcMain.handle('launcher:uninstall-app', async (event, appId) => {
  try {
    const appFolder = path.join(APPS_DIR, appId);
    if (fs.existsSync(appFolder)) {
      fs.rmSync(appFolder, { recursive: true, force: true });
      log.info(`[UNINSTALL] App ${appId} removed from: ${appFolder}`);
      return { success: true };
    } else {
      return { success: false, error: 'Folder aplikasi tidak ditemukan.' };
    }
  } catch (error) {
    log.error(`[UNINSTALL] Failed for ${appId}:`, error);
    return { success: false, error: error.message };
  }
});

// 4. Launch App
ipcMain.handle('launcher:launch-app', async (event, appConfig) => {
  const appFolder = path.join(APPS_DIR, appConfig.id);
  // Gabungkan folder app + executable path dari config
  // (executablePath bisa berupa "Bin/Game.exe", jadi kita join)
  const exePath = path.join(appFolder, appConfig.executablePath);
  const cwd = path.dirname(exePath); // Working directory = folder tempat exe berada

  log.info(`Launching: ${exePath}`);

  if (!fs.existsSync(exePath)) {
    return { success: false, error: 'File executable tidak ditemukan.' };
  }

  try {
    // Spawn proses tanpa menunggu selesai (detached)
    // Tambahkan Kunci Keamanan sebagai argumen
    const launchArgs = ['--launcher-key=BANGDULL_STUDIO_SECRET_2024'];

    // Spawn proses detached (TERPISAH) dari Launcher
    // Ini membuat app berjalan sendiri. Kalau Launcher ditutup/crash, app tetap jalan.
    // stdio: 'ignore' memutus link I/O
    const { spawn } = require('child_process');
    const child = spawn(exePath, launchArgs, {
      cwd: cwd,
      detached: true,
      stdio: 'ignore'
    });

    child.unref(); // Biarkan child process berjalan independen
    return { success: true };
  } catch (error) {
    log.error(`Launch failed for ${appConfig.name}:`, error);
    return { success: false, error: error.message };
  }
});

// 4. Open App Folder
ipcMain.handle('launcher:open-folder', (event, appConfig) => {
  const appFolder = path.join(APPS_DIR, appConfig.id);
  shell.openPath(appFolder);
});

// 5. Open External URL (Robust Way via IPC)
ipcMain.handle('launcher:get-online-status', () => lastOnlineCount);

ipcMain.handle('launcher:open-external', async (event, url) => {
  log.info(`[OPEN-URL] IPC Request: ${url}`);
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (e) {
    log.error(`[OPEN-URL] Failed: ${e.message}`);
    return { success: false, error: e.message };
  }
});

