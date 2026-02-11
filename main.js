
// --- BangDull Launcher Main Process ---
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const unzipper = require('unzipper');
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

let mainWindow;

// Lokasi penyimpanan aplikasi (Default: %AppData%/BangDullLauncher/MyApps)
const APPS_DIR = path.join(app.getPath('userData'), 'MyApps');

if (!fs.existsSync(APPS_DIR)) {
  fs.mkdirSync(APPS_DIR, { recursive: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
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

  // Cek Status Aktivasi
  const isActivated = store.get('isActivated', false);

  if (isActivated) {
    mainWindow.loadFile('main.html');
    mainWindow.setMenuBarVisibility(true);
  } else {
    mainWindow.loadFile('activation.html');
    mainWindow.setMenuBarVisibility(false);
  }
}

app.whenReady().then(() => {
  createWindow();

  // --- AUTO-UPDATE LAUNCHER (sama seperti BangDull V1) ---
  if (app.isPackaged) {
    log.info('Checking for launcher updates...');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      log.info(`Update available: v${info.version}`);
      if (mainWindow) {
        mainWindow.webContents.send('launcher-update-status', {
          status: 'downloading',
          message: `Mengunduh update v${info.version}...`
        });
      }
    });

    autoUpdater.on('update-not-available', () => {
      log.info('Launcher is up to date.');
    });

    autoUpdater.on('update-downloaded', (info) => {
      log.info(`Update downloaded: v${info.version}. Will install on quit.`);
      if (mainWindow) {
        mainWindow.webContents.send('launcher-update-status', {
          status: 'ready',
          message: `Update v${info.version} siap! Restart untuk update.`
        });
      }
    });

    autoUpdater.on('error', (err) => {
      log.error('Auto-updater error:', err.message);
    });

    autoUpdater.checkForUpdates();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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
    const validation = keygen.validateKey(key, currentMachineId);

    if (validation.success) {
      store.set('isActivated', true);
      store.set('activationData', validation);
      return { success: true };
    } else {
      return { success: false, message: validation.message };
    }
  } catch (error) {
    log.error('Activation error:', error);
    return { success: false, message: 'Terjadi kesalahan sistem.' };
  }
});

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
// GANTI URL INI DENGAN URL RAW GITHUB ANDA NANTI
const REMOTE_MANIFEST_URL = 'https://raw.githubusercontent.com/ZeroX69/Bangdul-Studio-Launcher/refs/heads/main/apps.json';

ipcMain.handle('launcher:get-apps', async () => {
  try {
    // 1. Coba Fetch Manifest dari GitHub
    let manifest;
    try {
      const response = await axios.get(REMOTE_MANIFEST_URL, { timeout: 5000 }); // Timeout 5 detik
      manifest = response.data;
      // Simpan cache ke lokal agar jika offline tetap bisa buka
      fs.writeFileSync(path.join(__dirname, 'apps.json'), JSON.stringify(manifest, null, 2));
    } catch (netError) {
      log.warn('Gagal fetch remote manifest, menggunakan cache lokal:', netError.message);
      // Fallback ke file lokal
      const localManifestPath = path.join(__dirname, 'apps.json');
      if (fs.existsSync(localManifestPath)) {
        manifest = JSON.parse(fs.readFileSync(localManifestPath, 'utf-8'));
      }
    }

    if (!manifest) return [];

    // 2. Cek Status Aplikasi (Installed? Update Available?)
    const appsWithStatus = manifest.apps.map(appConfig => {
      const appFolder = path.join(APPS_DIR, appConfig.id);
      const exePath = path.join(appFolder, appConfig.executablePath);
      const isInstalled = fs.existsSync(exePath);

      let localVersion = '0.0.0';
      let updateAvailable = false;

      // Cek Local Version (baca package.json di folder app)
      // Asumsi package.json ada di root folder app
      const localPackageJson = path.join(appFolder, 'package.json');
      if (isInstalled && fs.existsSync(localPackageJson)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(localPackageJson, 'utf-8'));
          localVersion = pkg.version;

          // Bandingkan versi (Sederhana string compare, idealnya pakai semver)
          if (appConfig.version !== localVersion) {
            updateAvailable = true;
          }
        } catch (e) {
          log.warn(`Gagal baca versi lokal ${appConfig.id}:`, e);
        }
      }

      return {
        ...appConfig,
        isInstalled,
        localPath: exePath,
        localVersion,
        updateAvailable
      };
    });

    return appsWithStatus;

  } catch (error) {
    log.error('Fatal error in get-apps:', error);
    return [];
  }
});

// 2. Download & Install App (Supports .zip AND .exe)
ipcMain.handle('launcher:download-app', async (event, appConfig) => {
  const { id, downloadUrl } = appConfig;
  const isExe = downloadUrl.toLowerCase().endsWith('.exe');
  const targetDir = path.join(APPS_DIR, id);
  const tempFile = path.join(app.getPath('temp'), isExe ? `${id}-setup.exe` : `${id}.zip`);

  try {
    // Download file
    mainWindow.webContents.send('download-progress', { id, progress: 0, status: 'Downloading...' });

    const writer = fs.createWriteStream(tempFile);
    const response = await axios({
      url: downloadUrl,
      method: 'GET',
      responseType: 'stream'
    });

    const totalLength = response.headers['content-length'];
    let downloadedLength = 0;

    response.data.on('data', (chunk) => {
      downloadedLength += chunk.length;
      if (totalLength) {
        const progress = Math.round((downloadedLength / totalLength) * 100);
        mainWindow.webContents.send('download-progress', { id, progress, status: 'Downloading...' });
      }
    });

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    if (isExe) {
      // === MODE INSTALLER (.exe) ===
      mainWindow.webContents.send('download-progress', { id, progress: 100, status: 'Menjalankan Installer...' });
      log.info(`Launching installer: ${tempFile}`);

      // Jalankan installer, user akan klik Next-Next seperti biasa
      const child = require('child_process').spawn(tempFile, [], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();

      return { success: true, type: 'installer' };

    } else {
      // === MODE ZIP (Extract) ===
      // Pastikan folder target bersih
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      fs.mkdirSync(targetDir, { recursive: true });

      mainWindow.webContents.send('download-progress', { id, progress: 100, status: 'Extracting...' });

      await fs.createReadStream(tempFile)
        .pipe(unzipper.Extract({ path: targetDir }))
        .promise();

      // Cleanup Zip
      fs.unlinkSync(tempFile);

      return { success: true, type: 'zip' };
    }

  } catch (error) {
    log.error(`Download failed for ${id}:`, error);
    return { success: false, error: error.message };
  }
});

// 3. Launch App
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

    const child = execFile(exePath, launchArgs, { cwd: cwd });
    child.unref(); // Biarkan launcher tetap hidup atau tutup tidak masalah
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
