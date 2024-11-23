const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const unzipper = require('unzipper'); 
const { dialog } = require('electron');

let mainWindow;

// Datenbankpfad festlegen
const dbFolder = path.join(__dirname, 'database');
const dbPath = path.join(dbFolder, 'anime.db');

// Sicherstellen, dass der Ordner 'database' existiert
if (!fs.existsSync(dbFolder)) {
    fs.mkdirSync(dbFolder, { recursive: true });
}

// Standard-Datenbank kopieren, falls sie fehlt
const defaultDbPath = path.join(__dirname, 'anime.db');
if (!fs.existsSync(dbPath)) {
    if (fs.existsSync(defaultDbPath)) {
        fs.copyFileSync(defaultDbPath, dbPath);
        console.log('Datenbank wurde in den Ordner "database" kopiert:', dbPath);
    } else {
        console.error('Standard-Datenbank nicht gefunden:', defaultDbPath);
    }
}

// Datenbank verbinden
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        console.error('Fehler beim Öffnen der Datenbank:', err.message);
    } else {
        console.log('Datenbank verbunden:', dbPath);
    }
});

// Fenster erstellen
function createWindow() {
    mainWindow = new BrowserWindow({
        icon: path.join(__dirname, 'icon.ico'),
        width: 800,
        height: 600,
        icon: path.join(__dirname, 'build/icon.ico'), // Hier das Icon setzen
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false, // Sicherheit verbessern
            contextIsolation: true, // Kommunikation über ipcRenderer
        },
    });

    mainWindow.loadFile('./renderer/index.html');

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// App bereitstellen
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// ** Kommunikation mit Renderer-Prozess **
// ** IPC-Handler für Charaktere **
ipcMain.handle('fetch-characters', async () => {
    const sql = 'SELECT * FROM Character';
    return new Promise((resolve, reject) => {
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error('Fehler beim Abrufen der Charaktere:', err);
                reject(err.message);
            } else {
                resolve(rows);
            }
        });
    });
});

ipcMain.handle('fetchCharacterDetails', async (event, id) => {
    const sqlCharacter = 'SELECT * FROM Character WHERE id = ?';
    const sqlAbilities = 'SELECT name FROM Abilities WHERE character_id = ?';

    return new Promise((resolve, reject) => {
        db.get(sqlCharacter, [id], (err, character) => {
            if (err) {
                console.error('Fehler beim Abrufen des Charakters:', err);
                reject(err.message);
            } else if (!character) {
                reject('Kein Charakter gefunden');
            } else {
                // Fähigkeiten abrufen
                db.all(sqlAbilities, [id], (err, abilities) => {
                    if (err) {
                        console.error('Fehler beim Abrufen der Fähigkeiten:', err);
                        reject(err.message);
                    } else {
                        character.abilities = abilities.map((a) => a.name); // Nur die Namen der Fähigkeiten
                        resolve(character);
                    }
                });
            }
        });
    });
});


// ** IPC-Handler für Fähigkeiten **
ipcMain.handle('fetchAbilityDetails', async (event, abilityName) => {
    const sql = 'SELECT * FROM Abilities WHERE name = ?';
    return new Promise((resolve, reject) => {
        db.get(sql, [abilityName], (err, row) => {
            if (err) {
                console.error('Fehler beim Abrufen der Fähigkeit:', err);
                reject(err.message);
            } else {
                if (row) {
                    resolve(row);
                } else {
                    reject('Keine Fähigkeit gefunden');
                }
            }
        });
    });
});


// ** Einzige Registrierung des Update-Handlers **
ipcMain.handle('select-and-apply-update', async () => {
    try {
        // Öffnet den Explorer für die Auswahl der ZIP-Datei
        const { canceled, filePaths } = await dialog.showOpenDialog({
            title: 'Wähle eine Update-ZIP-Datei aus',
            properties: ['openFile'],
            filters: [{ name: 'ZIP-Dateien', extensions: ['zip'] }],
        });

        if (canceled || filePaths.length === 0) {
            return { success: false, error: 'Keine Datei ausgewählt.' };
        }

        const zipPath = filePaths[0];
        const extractTo = path.join(__dirname, 'extracted_update'); // Temporärer Ordner

        // Temporären Ordner erstellen
        if (!fs.existsSync(extractTo)) {
            fs.mkdirSync(extractTo, { recursive: true });
        }

        // ZIP entpacken
        console.log(`Entpacke ZIP-Datei: ${zipPath}`);
        await fs.createReadStream(zipPath).pipe(unzipper.Extract({ path: extractTo })).promise();
        console.log('ZIP-Datei erfolgreich entpackt.');

        // Zielordner vorbereiten
        const imageDir = path.join(__dirname, 'Images');
        const dbDir = path.join(__dirname, 'database');
        const rendererDir = path.join(__dirname, 'renderer'); // Der Ordner, in den index.html, index.css, index.js kopiert werden

        if (!fs.existsSync(imageDir)) {
            fs.mkdirSync(imageDir, { recursive: true });
        }

      // Update-Dateien verarbeiten
const updateFiles = fs.readdirSync(extractTo);
updateFiles.forEach((file) => {
    const fullPath = path.join(extractTo, file);
    const stat = fs.statSync(fullPath);  // Überprüfen, ob es eine Datei oder ein Ordner ist

    try {
        if (stat.isDirectory()) {
            // Ordner behandeln
            console.log(`Ordner gefunden: ${fullPath}`);
            if (file === 'Images') {
                const targetDir = path.join(__dirname, 'Images');
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                    console.log(`Images-Ordner erfolgreich erstellt oder vorhanden: ${targetDir}`);
                }
            }
        } else if (stat.isFile()) {
            // Dateien behandeln
            const targetPath = getTargetPath(file); // Bestimmt den Zielpfad für die Datei
            if (targetPath) {
                console.log(`Verarbeite Datei: ${file}`);
                fs.copyFileSync(fullPath, targetPath);  // Ersetzt oder fügt die Datei hinzu
                console.log(`${file} erfolgreich verarbeitet.`);
            }
        }
    } catch (err) {
        console.error(`Fehler beim Verarbeiten der Datei ${file}:`, err);
    }
});

// Funktion zum Bestimmen des Zielpfads für verschiedene Dateitypen
function getTargetPath(file) {
    const isDev = !app.isPackaged; // Prüft, ob die App im Entwicklungsmodus läuft
    const basePath = isDev ? __dirname : process.resourcesPath; // Dynamischer Basis-Pfad

    const imageDir = path.join(basePath, 'Images');
    const dbDir = path.join(basePath, 'database');
    const rendererDir = path.join(basePath, 'renderer');

    // Prüfen und Zielpfad bestimmen
    if (file.endsWith('.png') || file.endsWith('.jpg')) {
        // Für Bilder
        const targetPath = path.join(imageDir, file);
        ensureFileReplaced(targetPath); // Alte Datei löschen, falls vorhanden
        return targetPath;
    } else if (file === 'anime.db') {
        // Für die Datenbank
        const targetPath = path.join(dbDir, file);
        ensureFileReplaced(targetPath); // Alte Datei löschen, falls vorhanden
        return targetPath;
    } else if (file.endsWith('.html')) {
        // Für HTML-Dateien
        const targetPath = path.join(rendererDir, file);
        ensureFileReplaced(targetPath); // Alte Datei löschen, falls vorhanden
        return targetPath;
    } else if (file.endsWith('.css')) {
        // Für CSS-Dateien
        const targetPath = path.join(rendererDir, file);
        ensureFileReplaced(targetPath); // Alte Datei löschen, falls vorhanden
        return targetPath;
    } else if (file.endsWith('.js')) {
        // Für JavaScript-Dateien
        const targetPath = file === 'main.js' 
            ? path.join(basePath, file) // Hauptordner für main.js
            : path.join(rendererDir, file); // renderer Ordner für andere JS-Dateien
        ensureFileReplaced(targetPath); // Alte Datei löschen, falls vorhanden
        return targetPath;
    }

    return null; // Falls die Datei nicht behandelt wird
}

// Hilfsfunktion: Löscht eine Datei, falls sie existiert
function ensureFileReplaced(filePath) {
    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath); // Datei löschen
            console.log(`Alte Datei gelöscht: ${filePath}`);
        } catch (err) {
            console.error(`Fehler beim Löschen der Datei ${filePath}:`, err);
        }
    }
}

// Temporäre Dateien löschen
fs.rmSync(extractTo, { recursive: true, force: true });
console.log('Temporäre Dateien gelöscht.');

return { success: true };
} catch (err) {
    console.error('Fehler beim Anwenden des Updates:', err);
    return { success: false, error: err.message };
}
});