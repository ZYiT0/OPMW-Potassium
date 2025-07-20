const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Expose functions for window controls
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    maximizeWindow: () => ipcRenderer.send('maximize-window'),
    closeWindow: () => ipcRenderer.send('close-window'),

    // Expose functions for Opiumware interaction
    // This now correctly expects a single 'data' object argument,
    // which contains { code, port }, and passes it directly.
    connectAndSend: (data) => ipcRenderer.invoke('connect-and-send', data), // <--- THIS IS THE KEY CHANGE
    checkPortStatus: (port) => ipcRenderer.invoke('check-port-status', port),
    autoAttach: () => ipcRenderer.invoke('auto-attach')
});