const { app, BrowserWindow, ipcMain } = require('electron');
const net = require('net');
const zlib = require('zlib');
const util = require('util');

// Promisify zlib.deflate for async/await usage
const deflate = util.promisify(zlib.deflate);

const PORTS = ["8392", "8393", "8394", "8395", "8396", "8397"];

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        frame: false, // Use custom title bar
        webPreferences: {
            preload: `${__dirname}/preload.js`,
            nodeIntegration: false, // Keep nodeIntegration false for security
            contextIsolation: true, // Keep contextIsolation true for security
            enableRemoteModule: false // Disable remote module
        }
    });

    mainWindow.loadFile('index.html');

    // Handle window controls (minimize, maximize, close)
    ipcMain.on('minimize-window', () => {
        mainWindow.minimize();
    });

    ipcMain.on('maximize-window', () => {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    });

    ipcMain.on('close-window', () => {
        mainWindow.close();
    });

    // Optional: Open DevTools
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

/**
 * Compresses data using Zlib.
 * @param {Buffer} data - The data to compress.
 * @returns {Promise<Buffer>} The compressed data.
 */
async function compressData(data) {
    try {
        const compressed = await deflate(data);
        return compressed;
    } catch (error) {
        console.error('Compression failed:', error);
        throw new Error(`Compression failed: ${error.message}`);
    }
}

/**
 * Custom utility to add a timeout to a Promise.
 * @param {Promise<any>} promise The promise to race against a timeout.
 * @param {number} ms The timeout in milliseconds.
 * @param {string} errorMessage The error message to reject with if timeout occurs.
 * @returns {Promise<any>} A promise that resolves or rejects based on the input promise or timeout.
 */
function promiseTimeout(promise, ms, errorMessage) {
    // Create a promise that rejects in <ms> milliseconds
    const timeout = new Promise((resolve, reject) => {
        const id = setTimeout(() => {
            clearTimeout(id);
            reject(new Error(errorMessage));
        }, ms);
    });

    // Returns a race between our timeout and the passed in promise
    return Promise.race([
        promise,
        timeout
    ]);
}


/**
 * Internal function to connect to Opiumware on a given port and send code.
 * This function is used by both the IPC handler and auto-attach.
 * @param {string} code - The code to send.
 * @param {string} port - The port to connect to.
 * @returns {Promise<string>} A message indicating success or failure.
 */
async function _connectAndSendInternal(code, port) {
    return new Promise(async (resolve) => {
        const client = new net.Socket();
        const timeoutMs = 3000; // 3 seconds timeout for connection

        try {
            // Attempt to connect with a timeout using our custom promiseTimeout
            await promiseTimeout(new Promise((res, rej) => {
                client.connect(port, '127.0.0.1', () => {
                    console.log(`Successfully connected to Opiumware on port: ${port}`);
                    res();
                });
                client.on('error', (err) => {
                    // It's crucial to destroy the client and reject on connection errors
                    client.destroy(); 
                    rej(err);
                });
                // Ensure socket also handles its own timeout for direct connection issues
                client.setTimeout(timeoutMs);
                client.on('timeout', () => {
                    client.destroy();
                    rej(new Error(`Connection attempt to port ${port} timed out.`));
                });
            }), timeoutMs, `Connection to port ${port} timed out`); // Pass timeoutMs here as a number

            if (code && code !== "NULL") {
                const plaintextBuffer = Buffer.from(code, 'utf8');
                const compressedData = await compressData(plaintextBuffer);

                client.write(compressedData, () => {
                    console.log(`Script sent to port ${port} (${compressedData.length} bytes)`);
                    client.end(); // Close the connection after sending
                    resolve(`Successfully executed script on port: ${port}`);
                });
            } else {
                client.end(); // Close connection if no code to send
                resolve(`Successfully connected to Opiumware on port: ${port} (no script sent)`);
            }

        } catch (error) {
            client.destroy(); // Ensure socket is closed on error
            console.error(`Failed to connect or send on port ${port}:`, error.message);
            resolve(`Failed to connect or send on port ${port}: ${error.message}`);
        }
    });
}

/**
 * IPC handler for connecting to Opiumware and sending code.
 * Expects an object { code: string, port: string } as the second argument from the renderer.
 */
ipcMain.handle('connect-and-send', async (event, { code, port }) => {
    return _connectAndSendInternal(code, port);
});

/**
 * Checks if a specific port is open and connectable.
 * @param {string} port - The port number to check.
 * @returns {Promise<boolean>} True if the port is open, false otherwise.
 */
ipcMain.handle('check-port-status', async (event, port) => {
    return new Promise((resolve) => {
        const client = new net.Socket();
        const timeoutMs = 1000; // 1 second timeout for status check

        client.once('connect', () => {
            client.destroy(); // Close connection immediately after successful connect
            resolve(true);
        });

        client.once('error', (err) => {
            client.destroy();
            resolve(false);
        });

        client.once('timeout', () => { // Ensure this is also handled
            client.destroy();
            resolve(false);
        });

        client.connect(port, '127.0.0.1');
        client.setTimeout(timeoutMs);
    });
});

/**
 * Attempts to connect to any available Opiumware port.
 * @returns {Promise<string>} The port connected to, or an error message.
 */
ipcMain.handle('auto-attach', async () => {
    for (const port of PORTS) {
        try {
            // Call the internal function directly for auto-attach
            // We pass "NULL" for code as auto-attach just checks connectivity without sending a script
            const result = await _connectAndSendInternal("NULL", port); 
            if (result.startsWith('Successfully connected')) {
                return port; // Return the connected port
            }
        } catch (error) {
            console.error(`Auto-attach failed on port ${port}:`, error.message);
        }
    }
    return "Failed to connect on all ports";
});