const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Recording controls
    startRecording: (options) => ipcRenderer.invoke('recording:start', options),
    stopRecording: () => ipcRenderer.invoke('recording:stop'),
    getRecordingSettings: () => ipcRenderer.invoke('recording:getSettings'),
    isRecording: () => ipcRenderer.invoke('recording:isRecording'),
    listRecordings: () => ipcRenderer.invoke('recording:listRecordings'),

    // DaVinci Resolve integration
    addToTimeline: (filePath) => ipcRenderer.invoke('resolve:addToTimeline', filePath),

    // Source management
    updateSources: () => ipcRenderer.invoke('sources:update'),
    getWindows: () => ipcRenderer.invoke('sources:getWindows'),
    getCameras: () => ipcRenderer.invoke('sources:getCameras'),
    getSources: async () => {
        const windows = await ipcRenderer.invoke('sources:getWindows');
        const cameras = await ipcRenderer.invoke('sources:getCameras');
        return { windows, cameras };
    },

    // Recording events
    onRecordingCompleted: (callback) => ipcRenderer.on('recording:completed', callback),
    onSourcesUpdated: (callback) => ipcRenderer.on('sources-updated', callback),
    onGlobalShortcutStart: (callback) => ipcRenderer.on('global-shortcut-start', callback),
    onGlobalShortcutStop: (callback) => ipcRenderer.on('global-shortcut-stop', callback),
    onGlobalShortcutToggle: (callback) => ipcRenderer.on('global-shortcut-toggle', callback),

    // Remove event listeners
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});