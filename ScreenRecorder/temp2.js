const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, exec } = require('child_process');

// Import DaVinci Resolve Workflow Integration
const WorkflowIntegration = require('./WorkflowIntegration.node');

const PLUGIN_ID = 'com.blackmagicdesign.resolve.screenrecorder';

let mainWindow;
let recordingProcess = null;
let isRecording = false;
let currentRecordingPath = null; // Track the current recording file path
let originalRecordingPath = null; // Store the original output path for camera recordings

// DaVinci Resolve objects
let resolveObj = null;
let projectManagerObj = null;

// Global shortcuts
const SHORTCUTS = {
    START: 'CommandOrControl+Shift+R',
    STOP: 'CommandOrControl+Shift+S',
    TOGGLE: 'CommandOrControl+Shift+Space'
};

// Available sources
let availableWindows = [];
let availableCameras = [];
let availableAudioDevices = [];

 const RECORDINGS_DIR = path.resolve(app.getPath('videos'), 'ResolveRecordings');


// Ensure recordings directory exists
function ensureRecordingsDir() {
    debugLog(`Recordings directory: ${RECORDINGS_DIR}`);

    if (!fs.existsSync(RECORDINGS_DIR)) {
        debugLog(`Creating recordings directory: ${RECORDINGS_DIR}`);
        fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    } else {
        debugLog(`Recordings directory already exists: ${RECORDINGS_DIR}`);
    }
}

// Get available windows for recording
async function getAvailableWindows() {
    return new Promise((resolve) => {
        // Use a more reliable PowerShell command to get windows with titles
        const powershellCommand = `powershell -Command "Get-Process | Where-Object {$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne ''} | Select-Object ProcessName, MainWindowTitle, Id | ConvertTo-Json -Depth 2"`;

        exec(powershellCommand, { encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error) {
                debugLog(`Error getting windows: ${error.message}`);
                debugLog(`Stderr: ${stderr}`);
                resolve([]);
                return;
            }

            debugLog(`PowerShell output: ${stdout}`);

            try {
                // Handle both single object and array outputs from PowerShell
                let processes = [];
                if (stdout.trim()) {
                    const parsed = JSON.parse(stdout);
                    processes = Array.isArray(parsed) ? parsed : [parsed];
                }

                const windows = processes
                    .filter(p => p.MainWindowTitle && p.MainWindowTitle.trim() !== '')
                    .map(p => ({
                        name: p.MainWindowTitle,
                        processName: p.ProcessName || 'Unknown',
                        id: p.Id || 0,
                        title: p.MainWindowTitle
                    }));

                debugLog(`Found ${windows.length} windows with titles`);
                resolve(windows);
            } catch (parseError) {
                debugLog(`Error parsing windows: ${parseError.message}`);
                debugLog(`Raw output: ${stdout}`);
                resolve([]);
            }
        });
    });
}

// Get available cameras (including OBS Virtual Camera)
async function getAvailableCameras() {
    return new Promise((resolve) => {
        exec('ffmpeg -list_devices true -f dshow -i dummy', (error, stdout, stderr) => {
            if (error) {
                debugLog(`Error getting cameras: ${error.message}`);
            }

            try {
                const output = stderr || stdout || '';
                const videoDevices = [];
                const lines = output.split('\n');

                let inVideoDevices = false;
                for (const line of lines) {
                    if (line.includes('[dshow @')) {
                        // Check if this line indicates video devices section
                        if (line.includes('DirectShow video devices')) {
                            inVideoDevices = true;
                        } else if (line.includes('DirectShow audio devices')) {
                            inVideoDevices = false;
                        } else if (line.includes('(video)')) {
                            // Line contains a video device directly
                            const match = line.match(/"([^"]+)"/);
                            if (match) {
                                videoDevices.push({
                                    name: match[1],
                                    isOBS: match[1].toLowerCase().includes('obs virtual camera')
                                });
                            }
                        }
                    } else if (inVideoDevices && line.includes('"')) {
                        // Parse video devices in the section
                        const match = line.match(/"([^"]+)"/);
                        if (match) {
                            videoDevices.push({
                                name: match[1],
                                isOBS: match[1].toLowerCase().includes('obs virtual camera')
                            });
                        }
                    }
                }

                debugLog(`Found cameras: ${JSON.stringify(videoDevices)}`);
                resolve(videoDevices);
            } catch (parseError) {
                debugLog(`Error parsing cameras: ${parseError.message}`);
                resolve([]);
            }
        });
    });
}
