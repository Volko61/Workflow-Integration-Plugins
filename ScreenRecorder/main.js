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
let timelineAdded = false; // Prevent duplicate timeline additions

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


// Get available audio devices (microphones and system audio)
async function getAvailableAudioDevices() {
    return new Promise((resolve) => {
        exec('ffmpeg -list_devices true -f dshow -i dummy', (error, stdout, stderr) => {
            if (error) {
                debugLog(`Error getting audio devices: ${error.message}`);
            }

            try {
                const output = stderr || stdout || '';
                const audioDevices = [];
                const lines = output.split('\n');

                let inAudioDevices = false;
                let currentDevice = null;
                let lookingForAltName = false;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    if (line.includes('[dshow @')) {
                        // Check if this line indicates audio devices section
                        if (line.includes('DirectShow audio devices')) {
                            inAudioDevices = true;
                        } else if (line.includes('DirectShow video devices')) {
                            inAudioDevices = false;
                        } else if (line.includes('(audio)')) {
                            // Line contains an audio device directly
                            const nameMatch = line.match(/"([^"]+)"\s*\(audio\)/);

                            if (nameMatch) {
                                // Look for alternative name in the next line
                                let altName = null;
                                if (i + 1 < lines.length && lines[i + 1].includes('Alternative name')) {
                                    const altMatch = lines[i + 1].match(/Alternative name "([^"]+)"/);
                                    if (altMatch) {
                                        altName = altMatch[1];
                                    }
                                }

                                currentDevice = {
                                    name: nameMatch[1],
                                    altName: altName,
                                    isDefault: nameMatch[1].toLowerCase().includes('microphone') || nameMatch[1].toLowerCase().includes('réseau')
                                };
                                audioDevices.push(currentDevice);
                                currentDevice = null;
                            }
                        }
                    } else if (inAudioDevices && line.includes('"')) {
                        // Parse audio devices in the section
                        const nameMatch = line.match(/"([^"]+)"/);

                        if (nameMatch) {
                            // Look for alternative name in the next line
                            let altName = null;
                            if (i + 1 < lines.length && lines[i + 1].includes('Alternative name')) {
                                const altMatch = lines[i + 1].match(/Alternative name "([^"]+)"/);
                                if (altMatch) {
                                    altName = altMatch[1];
                                }
                            }

                            currentDevice = {
                                name: nameMatch[1],
                                altName: altName,
                                isDefault: nameMatch[1].toLowerCase().includes('microphone') || nameMatch[1].toLowerCase().includes('réseau')
                            };
                            audioDevices.push(currentDevice);
                            currentDevice = null;
                        }
                    }
                }

                debugLog(`Found audio devices: ${JSON.stringify(audioDevices)}`);
                resolve(audioDevices);
            } catch (parseError) {
                debugLog(`Error parsing audio devices: ${parseError.message}`);
                resolve([]);
            }
        });
    });
}

// Get the best audio device for recording (prefer microphone, fallback to any audio device)
async function getBestAudioDevice() {
    try {
        // Use cached audio devices instead of rescanning
        const devices = availableAudioDevices.length > 0 ? availableAudioDevices : await getAvailableAudioDevices();
        if (devices.length === 0) {
            debugLog('No audio devices found');
            return null;
        }

        // First try to find a device with "microphone" or "réseau" in the name
        let preferredDevice = devices.find(device =>
            device.name.toLowerCase().includes('microphone') ||
            device.name.toLowerCase().includes('réseau')
        );

        // If no preferred device found, use the first available device
        if (!preferredDevice) {
            preferredDevice = devices[0];
            debugLog(`Using first available audio device: ${preferredDevice.name}`);
        } else {
            debugLog(`Using preferred audio device: ${preferredDevice.name}`);
        }

        // Return the display name for shell execution compatibility
        return preferredDevice.name;
    } catch (error) {
        debugLog(`Error getting audio device: ${error.message}`);
        return null;
    }
}

// Get the correct audio device name (with fallback to alternative name)
async function getCorrectAudioDeviceName(displayName) {
    try {
        // Use cached audio devices instead of rescanning
        const devices = availableAudioDevices.length > 0 ? availableAudioDevices : await getAvailableAudioDevices();
        const deviceInfo = devices.find(device => device.name === displayName);

        if (deviceInfo && deviceInfo.altName) {
            debugLog(`Using alternative device name for "${displayName}": ${deviceInfo.altName}`);
            return deviceInfo.altName;
        }

        return displayName;
    } catch (error) {
        debugLog(`Error getting correct audio device name: ${error.message}`);
        return displayName;
    }
}

// Update available sources
async function updateAvailableSources() {
    try {
        availableWindows = await getAvailableWindows();
        availableCameras = await getAvailableCameras();

        // Only scan audio devices once at startup - cache them for subsequent calls
        if (availableAudioDevices.length === 0) {
            availableAudioDevices = await getAvailableAudioDevices();
            debugLog(`Audio devices scanned and cached: ${availableAudioDevices.length} devices found`);
        }

        if (mainWindow) {
            mainWindow.webContents.send('sources-updated', {
                windows: availableWindows,
                cameras: availableCameras,
                audioDevices: availableAudioDevices
            });
        }

        debugLog(`Found ${availableWindows.length} windows, ${availableCameras.length} cameras, and ${availableAudioDevices.length} cached audio devices`);
    } catch (error) {
        debugLog(`Error updating sources: ${error.message}`);
    }
}


// Setup global shortcuts
function setupGlobalShortcuts() {
    try {
        // Start recording shortcut
        globalShortcut.register(SHORTCUTS.START, () => {
            if (!isRecording && mainWindow) {
                debugLog('Global shortcut: Start recording');
                // Send start signal to renderer
                mainWindow.webContents.send('global-shortcut-start');
            }
        });

        // Stop recording shortcut
        globalShortcut.register(SHORTCUTS.STOP, () => {
            if (isRecording && mainWindow) {
                debugLog('Global shortcut: Stop recording');
                // Send stop signal to renderer
                mainWindow.webContents.send('global-shortcut-stop');
            }
        });

        // Toggle recording shortcut
        globalShortcut.register(SHORTCUTS.TOGGLE, () => {
            if (mainWindow) {
                debugLog('Global shortcut: Toggle recording');
                // Send toggle signal to renderer
                mainWindow.webContents.send('global-shortcut-toggle');
            }
        });

        debugLog('Global shortcuts registered');
    } catch (error) {
        debugLog(`Error setting up global shortcuts: ${error.message}`);
    }
}

// Cleanup global shortcuts
function cleanupGlobalShortcuts() {
    globalShortcut.unregisterAll();
    debugLog('Global shortcuts unregistered');
}

// Function to log into renderer window console
function debugLog(message) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            // Properly escape the message for JavaScript execution
            const escapedMessage = String(message).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
            mainWindow.webContents.executeJavaScript(`console.log('%cMAIN:', 'color: #800', '${escapedMessage}');`);
        } catch (error) {
            // Fallback to console if window is being destroyed
            console.log('MAIN:', message);
        }
    } else {
        // Fallback to console if window is destroyed
        console.log('MAIN:', message);
    }
}

// Get available ffmpeg executable
function getFFmpegPath() {
    const possiblePaths = [
        'ffmpeg', // Assumes ffmpeg is in PATH
        path.join(__dirname, 'ffmpeg.exe'), // Local ffmpeg
        path.join(__dirname, 'bin', 'ffmpeg.exe'), // Local ffmpeg in bin folder
    ];

    return possiblePaths[0]; // Default to system ffmpeg
}

// Get screen region selection
async function getScreenRegion() {
    return new Promise((resolve, reject) => {
        const { screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.bounds;
        const { x: screenX, y: screenY } = primaryDisplay.bounds;
        const scaleFactor = primaryDisplay.scaleFactor;

        debugLog(`Screen info: bounds=${screenX},${screenY} ${screenWidth}x${screenHeight}, scale=${scaleFactor}x`);

        // Create a transparent window for region selection
        const regionWindow = new BrowserWindow({
            width: screenWidth,
            height: screenHeight,
            x: screenX,
            y: screenY,
            frame: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            transparent: false,
            backgroundColor: '#00000030',
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        // Load selection interface with proper coordinate handling
        const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <style>
        body { margin:0; padding:0; background:rgba(0,0,0,0.2); font-family:Arial; user-select:none; overflow:hidden; }
        #selection-box { position:absolute; border:2px dashed #ff0000; background:rgba(255,0,0,0.1); pointer-events:none; }
        #instructions { position:absolute; top:20px; left:20px; background:rgba(0,0,0,0.8); color:white; padding:15px; border-radius:5px; font-size:14px; }
        .button { background:#ff0000; color:white; border:none; padding:10px 20px; margin:5px; border-radius:3px; cursor:pointer; }
        .button:hover { background:#cc0000; }
        #controls { position:absolute; top:20px; right:20px; background:rgba(0,0,0,0.8); color:white; padding:15px; border-radius:5px; }
    </style>
</head>
<body>
    <div id="instructions"><strong>Select Recording Region</strong><br>Click and drag to select an area<br>Press ESC to cancel</div>
    <div id="controls"><button class="button" onclick="selectRegion()">Select Region</button><button class="button" onclick="recordFull()">Record Full Screen</button></div>
    <div id="selection-box"></div>
    <script>
        const screenX = ${screenX};
        const screenY = ${screenY};
        const scaleFactor = ${scaleFactor};
        let isSelecting = false, startX, startY, endX, endY;
        const selectionBox = document.getElementById('selection-box');

        function startSelection(e) {
            isSelecting = true;
            startX = e.clientX;
            startY = e.clientY;
            selectionBox.style.left = startX + 'px';
            selectionBox.style.top = startY + 'px';
            selectionBox.style.width = '0px';
            selectionBox.style.height = '0px';
            selectionBox.style.display = 'block';
            e.preventDefault();
        }

        function updateSelection(e) {
            if (!isSelecting) return;
            endX = e.clientX; endY = e.clientY;
            const left = Math.min(startX, endX);
            const top = Math.min(startY, endY);
            const width = Math.abs(endX - startX);
            const height = Math.abs(endY - startY);
            selectionBox.style.left = left + 'px';
            selectionBox.style.top = top + 'px';
            selectionBox.style.width = width + 'px';
            selectionBox.style.height = height + 'px';
        }

        function endSelection(e) {
            if (!isSelecting) return;
            isSelecting = false;
            endX = e.clientX; endY = e.clientY;
            let region = {
                x: Math.min(startX, endX) + screenX,
                y: Math.min(startY, endY) + screenY,
                width: Math.abs(endX - startX),
                height: Math.abs(endY - startY)
            };
            if (scaleFactor !== 1) {
                region.x = Math.round(region.x * scaleFactor);
                region.y = Math.round(region.y * scaleFactor);
                region.width = Math.round(region.width * scaleFactor);
                region.height = Math.round(region.height * scaleFactor);
            }
            console.log('Region selected: x=' + region.x + ', y=' + region.y + ', width=' + region.width + ', height=' + region.height);
            require('electron').ipcRenderer.send('region-selected', region);
        }

        function selectRegion() {
            document.body.style.cursor = 'crosshair';
            document.addEventListener('mousedown', startSelection);
            document.addEventListener('mousemove', updateSelection);
            document.addEventListener('mouseup', endSelection);
            document.getElementById('instructions').innerHTML = '<strong>Click and drag to select region</strong><br>Press ESC to cancel';
            document.getElementById('controls').style.display = 'none';
        }

        function recordFull() { require('electron').ipcRenderer.send('region-selected', null); }
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') require('electron').ipcRenderer.send('region-selected', null); });
        selectRegion();
    </script>
</body>
</html>`;

        regionWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));

        // Handle region selection
        const regionHandler = (event, region) => {
            regionWindow.close();
            ipcMain.removeListener('region-selected', regionHandler);
            resolve(region);
        };

        ipcMain.once('region-selected', regionHandler);

        // Handle window close (user closed without selection)
        regionWindow.on('closed', () => {
            ipcMain.removeListener('region-selected', regionHandler);
            reject(new Error('Region selection cancelled'));
        });
    });
}

// Start screen recording
async function startRecording(event, options) {
    if (isRecording) {
        debugLog('Recording already in progress');
        return { success: false, error: 'Recording already in progress' };
    }

    ensureRecordingsDir();

    // Reset timeline flag for new recording
    timelineAdded = false;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `screen-recording-${timestamp}.mp4`;
    const outputPath = path.join(RECORDINGS_DIR, filename);
    debugLog(`app.getPath('videos'): ${app.getPath('videos')}`);
    debugLog(`Output path: ${outputPath}`);
    debugLog(`RECORDINGS_DIR: ${RECORDINGS_DIR}`);

    // Get region if selection mode
    let region = null;
    if (options.region === 'selection') {
        try {
            region = await getScreenRegion();
            if (!region) {
                return { success: false, error: 'Region selection cancelled' };
            }
        } catch (error) {
            return { success: false, error: 'Region selection failed: ' + error.message };
        }
    }

    // Build ffmpeg command for screen recording
    let args = [];
    let inputSource = '';
    let cleanCameraName = '';

    // Configure input source based on region selection and source type
    if (options.sourceType === 'camera') {
        // Clean camera name and remove any brackets or extra characters
        cleanCameraName = options.cameraName.replace(/[\[\]]/g, '').trim();
        debugLog(`Original camera name: "${options.cameraName}"`);
        debugLog(`Clean camera name: "${cleanCameraName}"`);
        debugLog(`Is OBS Camera: ${cleanCameraName.toLowerCase().includes('obs virtual')}`);

        // Use DirectShow for camera input with different settings for OBS vs regular cameras
        if (cleanCameraName.toLowerCase().includes('obs virtual')) {
            // OBS Virtual Camera requires specific settings: 1280x720 at 60fps
            args = [
                '-f', 'dshow',
                '-framerate', '60', // OBS Virtual Camera only supports ~60fps
                '-i', `video="${cleanCameraName}"`
            ];
            debugLog(`Using OBS Virtual Camera settings (1280x720 @ 60fps native)`);
        } else {
            // Regular camera - add video_size parameter and ensure proper input format
            args = [
                '-f', 'dshow',
                '-framerate', options.framerate || '30',
                '-video_size', '1920x1080', // Request HD resolution
                '-i', `video="${cleanCameraName}"`
            ];
            debugLog(`Using regular camera settings with video_size`);
        }

        debugLog(`Recording camera: ${cleanCameraName}`);
        debugLog(`Camera command: ffmpeg ${args.join(' ')}`);
        debugLog(`FFmpeg input argument: "${args[args.length - 1]}"`);
        debugLog(`All FFmpeg args:`, JSON.stringify(args, null, 2));
    } else if (options.sourceType === 'window' && options.windowTitle) {
        // Use specific window with gdigrab - properly quote the window title for shell execution
        args = [
            '-f', 'gdigrab',
            '-framerate', options.framerate || '30',
            '-i', `title="${options.windowTitle}"`
        ];
        debugLog(`Recording window: ${options.windowTitle}`);
    } else if (region) {
        // Validate region size
        if (region.width < 16 || region.height < 16) {
            return {
                success: false,
                error: `Selected region is too small (${region.width}x${region.height}). Minimum size is 16x16 pixels.`
            };
        }

        // Adjust dimensions to be even (required for H.264)
        const evenWidth = Math.floor(region.width / 2) * 2;
        const evenHeight = Math.floor(region.height / 2) * 2;

        if (evenWidth !== region.width || evenHeight !== region.height) {
            debugLog(`Adjusted region from ${region.width}x${region.height} to ${evenWidth}x${evenHeight} (H.264 requires even dimensions)`);
        }

        // Use selected region with gdigrab - try alternative format
        args = [
            '-f', 'gdigrab',
            '-video_size', `${evenWidth}x${evenHeight}`,
            '-framerate', options.framerate || '30',
            '-offset_x', region.x.toString(),
            '-offset_y', region.y.toString(),
            '-i', 'desktop',
            '-draw_mouse', '1',
            '-probesize', '10M',
            '-analyzeduration', '0'
        ];
        debugLog(`Recording region: ${evenWidth}x${evenHeight} at (${region.x}, ${region.y})`);
        debugLog(`Original selected region: ${region.width}x${region.height} at (${region.x}, ${region.y})`);
        debugLog(`Screen info: Region selected at (${region.x}, ${region.y}) with dimensions ${region.width}x${region.height}`);
    } else {
        // Full desktop
        args = [
            '-f', 'gdigrab',
            '-framerate', options.framerate || '30',
            '-i', 'desktop'
        ];
        debugLog('Recording full desktop');
    }

    // Add audio device if specified (must come before video for dshow compatibility)
    let audioInputAdded = false;
    if (options.audioDevice && options.sourceType !== 'camera') { // Don't add audio for cameras here - they have their own audio logic
        debugLog(`Adding audio device: ${options.audioDevice}`);

        // Try the display name first (it works better with shell execution)
        const audioDeviceName = options.audioDevice;

        // Build shell command for audio compatibility (spawn has issues with complex device names)
        const shellCommand = `${getFFmpegPath()} -f dshow -i audio="${audioDeviceName}" ${args.join(' ')} -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 128k "${outputPath}"`;

        debugLog(`Using shell execution for audio recording: ${shellCommand}`);
        recordingProcess = spawn(shellCommand, [], { shell: true });

        // Set recording state to true for shell execution
        isRecording = true;
        currentRecordingPath = outputPath;
        originalRecordingPath = outputPath;

        audioInputAdded = true;
        debugLog('Audio recording started with shell execution for compatibility');

        // Set up event handlers for shell-based recording
        recordingProcess.on('close', (code, signal) => {
            debugLog(`Recording process closed with code: ${code}, signal: ${signal}`);

            // Reset state
            isRecording = false;
            recordingProcess = null;
            currentRecordingPath = null;

            // Add recording to timeline (single call to avoid duplication)
            if (mainWindow && !timelineAdded) {
                timelineAdded = true;
                addRecordingToTimeline(null, outputPath).then(result => {
                    mainWindow.webContents.send('recording:completed', {
                        success: true,
                        filePath: outputPath,
                        timelineResult: result
                    });
                });
            }
        });

        recordingProcess.stderr.on('data', (data) => {
            const output = data.toString().trim();
            if (output && !output.includes('frame=') && !output.includes('size=') && !output.includes('time=') && !output.includes('bitrate=') && !output.includes('speed=')) {
                debugLog(`FFmpeg stderr: ${output}`);
            }
        });

        // Return early since we're handling everything with shell execution
        return { success: true, outputPath };
    }


    // Add video encoding options
    args.push('-c:v', 'libx264');
    args.push('-preset', 'ultrafast');
    args.push('-crf', '22');
    args.push('-pix_fmt', 'yuv420p');

    // Add audio encoding if audio input was added
    if (audioInputAdded) {
        args.push('-c:a', 'aac');
        args.push('-b:a', '128k');
        debugLog('Added audio encoding with AAC codec at 128k bitrate');
    }

    // For camera recordings, add flush_packets to make files more resilient to sudden termination
    if (options.sourceType === 'camera') {
        args.push('-flush_packets', '1');
        debugLog('Added flush_packets option for camera recording to prevent file corruption');
    }

    // Add resolution scaling if needed (but not for region selection)
    if (options.resolution && options.resolution !== 'desktop' && !region) {
        args.push('-vf', `scale=${options.resolution}`);
    }

    args.push(outputPath);

    try {
        // Log the FFmpeg command for debugging
        const fullCommand = `${getFFmpegPath()} ${args.join(' ')}`;
        debugLog(`FFmpeg command: ${fullCommand}`);

        // Test if this exact command works manually
        if (options.sourceType === 'camera') {
            debugLog(`Manual test command would be: ${fullCommand.replace(cleanCameraName, cleanCameraName)}`);
        }

        // Use shell execution for all camera recording to avoid bracket issues
        if (options.sourceType === 'camera') {
            debugLog(`Using shell execution for camera recording`);

            // Set up fallback attempts for regular cameras
            if (cleanCameraName.toLowerCase().includes('obs virtual')) {
                // OBS Virtual Camera: use native framerate and allow scaling to desired resolution
                // Use the selected audio device if provided, otherwise try to get the best one
                let audioDevice = options.audioDevice || await getBestAudioDevice();
                let cameraCommand;
                if (audioDevice) {
                    // Get the correct device name (with fallback to alternative name)
                    audioDevice = await getCorrectAudioDeviceName(audioDevice);
                    // Include both video and audio
                    cameraCommand = `${getFFmpegPath()} -f dshow -framerate 60 -i video="${cleanCameraName}" -f dshow -i audio="${audioDevice.replace(/\\/g, '\\\\')}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 128k -flush_packets 1 -vf scale=${options.resolution || '1920x1080'} "${outputPath}"`;
                    debugLog(`OBS Virtual Camera with audio (${audioDevice}): ${cameraCommand}`);
                } else {
                    // Video only if no audio device found
                    cameraCommand = `${getFFmpegPath()} -f dshow -framerate 60 -i video="${cleanCameraName}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -flush_packets 1 -vf scale=${options.resolution || '1920x1080'} "${outputPath}"`;
                    debugLog(`OBS Virtual Camera video only (no audio device found): ${cameraCommand}`);
                }
                debugLog('Added flush_packets option for OBS Virtual Camera to prevent file corruption');
                recordingProcess = spawn(cameraCommand, [], { shell: true });
            } else {
                // Regular camera: use automatic fallback system with audio
                const targetResolution = options.resolution || '1920x1080';

                // Get audio device for regular cameras too
                getBestAudioDevice().then(audioDevice => {
                    const fallbackCommands = [];

                    if (audioDevice) {
                        // Commands with audio
                        debugLog(`Adding audio device (${audioDevice}) to regular camera recording`);
                        fallbackCommands.push(
                            // Approach 1: Request 1920x1080 input with audio
                            `${getFFmpegPath()} -f dshow -framerate ${options.framerate || '30'} -video_size 1920x1080 -i video="${cleanCameraName}" -f dshow -i audio="${audioDevice.replace(/\\/g, '\\\\')}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 128k -flush_packets 1 ${targetResolution !== '1920x1080' ? `-vf scale=${targetResolution}` : ''} "${outputPath}"`,
                            // Fallback 1: No video_size specified with audio
                            `${getFFmpegPath()} -f dshow -framerate ${options.framerate || '30'} -i video="${cleanCameraName}" -f dshow -i audio="${audioDevice.replace(/\\/g, '\\\\')}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 128k -flush_packets 1 ${targetResolution !== '1920x1080' ? `-vf scale=${targetResolution}` : ''} "${outputPath}"`,
                            // Fallback 2: Use 1280x720 input with audio
                            `${getFFmpegPath()} -f dshow -framerate ${options.framerate || '30'} -video_size 1280x720 -i video="${cleanCameraName}" -f dshow -i audio="${audioDevice.replace(/\\/g, '\\\\')}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 128k -flush_packets 1 -vf scale=${targetResolution} "${outputPath}"`
                        );
                    } else {
                        // Commands without audio (fallback)
                        debugLog('No audio device found for regular camera, recording video only');
                        fallbackCommands.push(
                            // Approach 1: Request 1920x1080 input
                            `${getFFmpegPath()} -f dshow -framerate ${options.framerate || '30'} -video_size 1920x1080 -i video="${cleanCameraName}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -flush_packets 1 ${targetResolution !== '1920x1080' ? `-vf scale=${targetResolution}` : ''} "${outputPath}"`,
                            // Fallback 1: No video_size specified
                            `${getFFmpegPath()} -f dshow -framerate ${options.framerate || '30'} -i video="${cleanCameraName}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -flush_packets 1 ${targetResolution !== '1920x1080' ? `-vf scale=${targetResolution}` : ''} "${outputPath}"`,
                            // Fallback 2: Use 1280x720 input
                            `${getFFmpegPath()} -f dshow -framerate ${options.framerate || '30'} -video_size 1280x720 -i video="${cleanCameraName}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -flush_packets 1 -vf scale=${targetResolution} "${outputPath}"`
                        );
                    }
                    debugLog('Added flush_packets option to all camera fallback commands to prevent file corruption');

                    let currentAttempt = 0;
                    let ioErrorDetected = false;

                    function attemptRecording() {
                        if (currentAttempt >= fallbackCommands.length) {
                            debugLog(`All fallback attempts failed for camera recording`);
                            isRecording = false;
                            recordingProcess = null;
                            const failedFilePath = currentRecordingPath;
                            currentRecordingPath = null;
                            if (mainWindow) {
                                mainWindow.webContents.send('recording:completed', {
                                    success: false,
                                    filePath: failedFilePath,
                                    error: `Camera recording failed: All attempts failed. The camera may be in use by another application. Try closing apps like Discord, Zoom, or OBS that might be using the camera, or use OBS Virtual Camera instead.`
                                });
                            }
                            return;
                        }

                        const cameraCommand = fallbackCommands[currentAttempt];
                        const attemptName = currentAttempt === 0 ? 'Primary approach' : `Fallback ${currentAttempt}`;

                        // Create unique filename for each attempt
                        let currentOutputPath = outputPath;
                        if (currentAttempt > 0) {
                            const ext = path.extname(outputPath);
                            const base = path.basename(outputPath, ext);
                            const dir = path.dirname(outputPath);
                            currentOutputPath = path.join(dir, `${base}_attempt${currentAttempt}${ext}`);
                        }

                        // Update the command with the unique filename and add overwrite flag
                        const modifiedCommand = cameraCommand.replace(outputPath, currentOutputPath).replace('ffmpeg', 'ffmpeg -y');

                        debugLog(`Trying ${attemptName}: ${modifiedCommand}`);
                        debugLog(`Clean camera command: ${modifiedCommand}`);

                        recordingProcess = spawn(modifiedCommand, [], { shell: true });
                        ioErrorDetected = false;

                    // Add event handlers for manual stopping
                    recordingProcess.on('close', (code, signal) => {
                        debugLog(`${attemptName} closed with code: ${code}, signal: ${signal}, I/O error: ${ioErrorDetected}`);

                        // Reset state if process was manually stopped or failed
                        const wasManuallyStopped = signal === 'SIGTERM' || signal === 'SIGKILL' ||
                                               (signal === null && code !== 0 && code !== null) ||
                                               (signal === null && code === 1); // Windows often uses exit code 1 for terminated processes

                        if (wasManuallyStopped) {
                            debugLog(`Camera recording was manually stopped or failed. Code: ${code}, Signal: ${signal}`);
                            isRecording = false;
                            recordingProcess = null;
                            const completedFilePath = currentRecordingPath || originalRecordingPath; // Use fallback if main path was reset
                            debugLog(`Camera fallback stopping - currentRecordingPath: ${currentRecordingPath}, originalRecordingPath: ${originalRecordingPath}, using: ${completedFilePath}`);
                            currentRecordingPath = null;
                            if (mainWindow) {
                                // For camera recordings, check if the file is valid even with exit code 1
                                const wasStopped = signal === 'SIGTERM' || (signal === null && code === 1);
                                let isValidRecording = false;

                                debugLog(`Camera recording analysis - wasStopped: ${wasStopped}, completedFilePath: ${completedFilePath}`);

                                if (wasStopped && completedFilePath) {
                                    try {
                                        const fs = require('fs');
                                        debugLog(`Checking if camera recording file exists: ${completedFilePath}`);

                                        if (fs.existsSync(completedFilePath)) {
                                            const stats = fs.statSync(completedFilePath);
                                            debugLog(`Camera recording file found - size: ${stats.size} bytes`);

                                            if (stats.size > 1024) { // At least 1KB - indicates a valid recording
                                                isValidRecording = true;
                                                debugLog(`Camera recording stopped by user, file is valid: ${completedFilePath} (${stats.size} bytes)`);
                                            } else {
                                                debugLog(`Camera recording file too small: ${stats.size} bytes`);
                                            }
                                        } else {
                                            debugLog(`Camera recording file does not exist: ${completedFilePath}`);
                                        }
                                    } catch (fileCheckError) {
                                        debugLog(`Error checking camera recording file: ${fileCheckError.message}`);
                                    }
                                } else {
                                    debugLog(`Camera recording - not checking file: wasStopped=${wasStopped}, hasFilePath=${!!completedFilePath}`);
                                }

                                if (isValidRecording && !timelineAdded) {
                                    // Valid recording - add to timeline and report success
                                    debugLog(`Camera recording valid - adding to timeline`);
                                    timelineAdded = true;
                                    addRecordingToTimeline(null, completedFilePath).then(result => {
                                        mainWindow.webContents.send('recording:completed', {
                                            success: true,
                                            filePath: completedFilePath,
                                            timelineResult: result,
                                            warning: 'Camera recording stopped by user'
                                        });
                                    });
                                } else {
                                    // No valid recording file
                                    debugLog(`Camera recording invalid - reporting failure`);
                                    mainWindow.webContents.send('recording:completed', {
                                        success: false,
                                        filePath: null,
                                        error: wasStopped
                                            ? 'Camera recording stopped but no valid file created'
                                            : `Camera recording failed with exit code ${code}, signal: ${signal}`
                                    });
                                }
                            }
                            return;
                        }

                        if (code === 0 && !ioErrorDetected) {
                            // Success - check if file has content
                            try {
                                const stats = fs.statSync(currentOutputPath);
                                if (stats.size > 0) {
                                    debugLog(`Camera recording successful with ${attemptName}`);
                                    isRecording = false;
                                    recordingProcess = null;
                                    currentRecordingPath = null;
                                    if (mainWindow && !timelineAdded) {
                                        timelineAdded = true;
                                        addRecordingToTimeline(null, currentOutputPath).then(result => {
                                            mainWindow.webContents.send('recording:completed', {
                                                success: true,
                                                filePath: currentOutputPath,
                                                timelineResult: result
                                            });
                                        });
                                    }
                                    return;
                                }
                            } catch (fileError) {
                                debugLog(`Failed to check output file: ${fileError.message}`);
                            }
                        }

                        // This attempt failed, try next fallback
                        currentAttempt++;
                        debugLog(`${attemptName} failed, trying next approach...`);
                        setTimeout(attemptRecording, 1000); // Wait 1 second before retry
                    });

                    recordingProcess.stderr.on('data', (data) => {
                        const stderrOutput = data.toString().trim();
                        if (stderrOutput) {
                            debugLog(`FFmpeg stderr: ${stderrOutput}`);

                            // Detect camera I/O errors
                            if (stderrOutput.includes('Error during demuxing: I/O error') ||
                                stderrOutput.includes('No filtered frames for output stream')) {
                                debugLog(`Camera I/O Error detected in ${attemptName}`);
                                ioErrorDetected = true;
                            }
                        }
                    });

  
                    recordingProcess.on('error', (error) => {
                        debugLog(`${attemptName} process error: ${error.message}`);
                        currentAttempt++;

                        // Reset state if this was the last attempt
                        if (currentAttempt >= fallbackCommands.length) {
                            debugLog(`All camera recording attempts failed due to errors`);
                            isRecording = false;
                            recordingProcess = null;
                            const errorFilePath = currentRecordingPath;
                            currentRecordingPath = null;
                            if (mainWindow) {
                                mainWindow.webContents.send('recording:completed', {
                                    success: false,
                                    filePath: errorFilePath,
                                    error: `Camera recording failed: All attempts failed with errors. ${error.message}`
                                });
                            }
                            return;
                        }

                        debugLog(`${attemptName} error, trying next approach...`);
                        setTimeout(attemptRecording, 1000);
                    });
                }

                // Start with the first approach
                attemptRecording();
                }).catch(error => {
                    debugLog(`Error getting audio device for regular camera: ${error.message}`);
                    // Fallback to video-only recording
                    const fallbackCommands = [
                        `${getFFmpegPath()} -f dshow -framerate ${options.framerate || '30'} -video_size 1920x1080 -i video="${cleanCameraName}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -flush_packets 1 ${targetResolution !== '1920x1080' ? `-vf scale=${targetResolution}` : ''} "${outputPath}"`,
                        `${getFFmpegPath()} -f dshow -framerate ${options.framerate || '30'} -i video="${cleanCameraName}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -flush_packets 1 ${targetResolution !== '1920x1080' ? `-vf scale=${targetResolution}` : ''} "${outputPath}"`,
                        `${getFFmpegPath()} -f dshow -framerate ${options.framerate || '30'} -video_size 1280x720 -i video="${cleanCameraName}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -flush_packets 1 -vf scale=${targetResolution} "${outputPath}"`
                    ];

                    let currentAttempt = 0;
                    function attemptRecording() {
                        const modifiedCommand = fallbackCommands[currentAttempt].replace(outputPath, outputPath).replace('ffmpeg', 'ffmpeg -y');
                        recordingProcess = spawn(modifiedCommand, [], { shell: true });
                        // Add event handlers similar to above...
                    }
                    attemptRecording();
                });
            }
        } else {
            // Screen/window recording uses array execution
            recordingProcess = spawn(getFFmpegPath(), args);
        }
        // Set recording state to true for all recording types
        isRecording = true;
        currentRecordingPath = outputPath; // Store the recording path for stop functionality
        originalRecordingPath = outputPath; // Store original path for camera recordings
        debugLog(`Set currentRecordingPath to: ${currentRecordingPath}`);
        debugLog(`Set originalRecordingPath to: ${originalRecordingPath}`);

        // Note: For camera recording, error handling is done inside the fallback system
        // For non-camera recording, set up error handling here
        if (options.sourceType !== 'camera') {
            recordingProcess.on('error', (error) => {
                debugLog(`Recording process error: ${error.message}`);
                isRecording = false;
                recordingProcess = null;

                if (mainWindow) {
                    mainWindow.webContents.send('recording:completed', {
                        success: false,
                        error: `Recording process error: ${error.message}`
                    });
                }
            });

            recordingProcess.on('close', (code, signal) => {
                debugLog(`Recording process closed with code: ${code}, signal: ${signal}`);
                isRecording = false;
                recordingProcess = null;

                if (code === 0 && mainWindow && !timelineAdded) {
                    // Successfully completed recording
                    timelineAdded = true;
                    addRecordingToTimeline(null, outputPath).then(result => {
                        mainWindow.webContents.send('recording:completed', {
                            success: true,
                            filePath: outputPath,
                            timelineResult: result
                        });
                    });
                } else if (code !== null && code !== 0) {
                    // For camera recordings, exit code 1 is expected when manually stopped via taskkill
                    // Check if this was a camera recording by checking if the file exists and has content
                    try {
                        const fs = require('fs');
                        if (fs.existsSync(outputPath)) {
                            const stats = fs.statSync(outputPath);
                            if (stats.size > 1024) { // At least 1KB - indicates a valid recording
                                debugLog(`Recording completed with exit code ${code}, but file is valid (${stats.size} bytes)`);
                                if (mainWindow && !timelineAdded) {
                                    timelineAdded = true;
                                    addRecordingToTimeline(null, outputPath).then(result => {
                                        mainWindow.webContents.send('recording:completed', {
                                            success: true,
                                            filePath: outputPath,
                                            timelineResult: result,
                                            warning: `Recording completed with exit code ${code} (normal for cameras)`
                                        });
                                    });
                                }
                                return;
                            }
                        }
                    } catch (fileCheckError) {
                        debugLog(`Error checking recording file: ${fileCheckError.message}`);
                    }

                    // FFmpeg exited with error and file is invalid or missing
                    debugLog(`FFmpeg failed with exit code ${code}`);
                    if (mainWindow) {
                        mainWindow.webContents.send('recording:completed', {
                            success: false,
                            error: `FFmpeg recording failed with exit code ${code}`
                        });
                    }
                } else if (signal) {
                    // Process was killed by signal
                    debugLog(`Recording process killed by signal: ${signal}`);
                }
            });

            recordingProcess.stderr.on('data', (data) => {
                const stderrOutput = data.toString().trim();
                if (stderrOutput) {
                    debugLog(`FFmpeg stderr: ${stderrOutput}`);
                }
            });

            recordingProcess.stdin.on('error', (error) => {
                debugLog(`FFmpeg stdin error: ${error.message}`);
            });

            recordingProcess.stdout.on('data', (data) => {
                const stdoutOutput = data.toString().trim();
                if (stdoutOutput) {
                    debugLog(`FFmpeg stdout: ${stdoutOutput}`);
                }
            });

            debugLog(`Recording started: ${outputPath}`);
        } else {
            debugLog(`Camera recording fallback system started`);
        }

        return { success: true, filePath: outputPath };

    } catch (error) {
        debugLog(`Failed to start recording: ${error.message}`);
        isRecording = false;
        recordingProcess = null;
        return { success: false, error: error.message };
    }
}

// Stop screen recording
async function stopRecording(event) {
    if (!isRecording || !recordingProcess) {
        debugLog('No recording in progress');
        return { success: false, error: 'No recording in progress' };
    }

    try {
        debugLog(`Attempting to stop recording process. PID: ${recordingProcess.pid}, Killed: ${recordingProcess.killed}`);

        // Check if this is a shell process by examining spawnargs or other properties
        const isShellProcess = recordingProcess.spawnargs &&
            (recordingProcess.spawnargs.includes('shell') ||
             recordingProcess.spawnfile?.includes('cmd.exe') ||
             recordingProcess.spawnfile?.includes('powershell.exe'));

        debugLog(`Process detection - Is shell process: ${isShellProcess}, Spawnargs: ${JSON.stringify(recordingProcess.spawnargs)}`);

        // For shell processes (OBS Virtual Camera), try stdin termination first
        if (isShellProcess && recordingProcess.pid) {
            debugLog('Detected shell process (OBS Virtual Camera), trying stdin termination first');

            // Try to send "q" to stdin for graceful FFmpeg termination
            try {
                if (recordingProcess.stdin && !recordingProcess.stdin.destroyed) {
                    debugLog('Sending "q" to OBS Virtual Camera stdin for graceful termination');
                    recordingProcess.stdin.write('q');

                    // Set a timeout for graceful termination
                    setTimeout(() => {
                        if (recordingProcess && !recordingProcess.killed) {
                            debugLog('Graceful stdin termination timed out, using taskkill');
                            // Fallback to taskkill if stdin doesn't work
                            const { exec } = require('child_process');
                            exec(`taskkill /F /T /PID ${recordingProcess.pid}`, (error, stdout, stderr) => {
                                if (error) {
                                    debugLog(`Taskkill failed: ${error.message}`);
                                    recordingProcess.kill('SIGTERM');
                                } else {
                                    debugLog(`Taskkill successful: ${stdout}`);
                                    handleSuccessfulOBSKill();
                                }
                            });
                        }
                    }, 2000); // 2 second timeout for stdin termination

                } else {
                    debugLog('Stdin not available for OBS Virtual Camera, using immediate taskkill');
                    // Immediate taskkill if stdin is not available
                    const { exec } = require('child_process');
                    exec(`taskkill /F /T /PID ${recordingProcess.pid}`, (error, stdout, stderr) => {
                        if (error) {
                            debugLog(`Taskkill failed: ${error.message}`);
                            recordingProcess.kill('SIGTERM');
                        } else {
                            debugLog(`Taskkill successful: ${stdout}`);
                            handleSuccessfulOBSKill();
                        }
                    });
                }
            } catch (stdinError) {
                debugLog(`Stdin termination failed: ${stdinError.message}, using taskkill`);
                // Fallback to taskkill if stdin fails
                const { exec } = require('child_process');
                exec(`taskkill /F /T /PID ${recordingProcess.pid}`, (error, stdout, stderr) => {
                    if (error) {
                        debugLog(`Taskkill failed: ${error.message}`);
                        recordingProcess.kill('SIGTERM');
                    } else {
                        debugLog(`Taskkill successful: ${stdout}`);
                        handleSuccessfulOBSKill();
                    }
                });
            }

            // Helper function to handle successful OBS kill
            const handleSuccessfulOBSKill = () => {
                debugLog('OBS process termination - clearing timeout and processing recording');
                // Clear timeout and reset state immediately
                if (stopRecording.forceKillTimeout) {
                    clearTimeout(stopRecording.forceKillTimeout);
                    stopRecording.forceKillTimeout = null;
                }

                processOBSRecording();
            };

            // Function to process OBS recording completion
            const processOBSRecording = () => {
                // Store the recording path before resetting state
                const completedFilePath = currentRecordingPath || originalRecordingPath;
                recordingProcess = null;
                isRecording = false;
                currentRecordingPath = null;
                originalRecordingPath = null;

                debugLog('OBS Virtual Camera process terminated successfully');

                // Wait a moment for the file to be properly finalized
                setTimeout(() => {
                    // Manually trigger recording completion flow
                    if (completedFilePath && mainWindow) {
                        debugLog(`Processing OBS camera recording: ${completedFilePath}`);

                        // Check if the recording file is valid
                        try {
                            const fs = require('fs');
                            if (fs.existsSync(completedFilePath)) {
                                const stats = fs.statSync(completedFilePath);
                                debugLog(`OBS recording file found - size: ${stats.size} bytes`);

                                if (stats.size > 1024) { // At least 1KB - indicates a valid recording
                                    debugLog(`OBS camera recording is valid: ${completedFilePath} (${stats.size} bytes)`);

                                    // Additional check: verify MP4 file header
                                    try {
                                        const fd = fs.openSync(completedFilePath, 'r');
                                        const buffer = Buffer.alloc(8); // Read first 8 bytes
                                        fs.readSync(fd, buffer, 0, 8, 0);
                                        fs.closeSync(fd);

                                        // Check for valid MP4 signature (ftyp box)
                                        const header = buffer.toString('ascii', 4, 8);
                                        if (header === 'ftyp') {
                                            debugLog('Valid MP4 file header detected');
                                        } else {
                                            debugLog(`Warning: MP4 file header not recognized. Found: "${header}"`);
                                        }
                                    } catch (headerError) {
                                        debugLog(`Could not verify MP4 header: ${headerError.message}`);
                                    }

                                    // Add to timeline and report success
                                    if (!timelineAdded) {
                                        timelineAdded = true;
                                        addRecordingToTimeline(null, completedFilePath).then(result => {
                                        if (mainWindow && !mainWindow.isDestroyed()) {
                                            mainWindow.webContents.send('recording:completed', {
                                                success: true,
                                                filePath: completedFilePath,
                                                timelineResult: result,
                                                warning: 'OBS Virtual Camera recording stopped by user'
                                            });
                                        }
                                    }).catch(timelineError => {
                                        debugLog(`Timeline integration failed for OBS recording: ${timelineError.message}`);
                                        if (mainWindow && !mainWindow.isDestroyed()) {
                                            mainWindow.webContents.send('recording:completed', {
                                                success: true,
                                                filePath: completedFilePath,
                                                error: 'Recording completed but timeline integration failed'
                                            });
                                        }
                                    });
                                    }
                                } else {
                                    debugLog(`OBS recording file too small: ${stats.size} bytes`);
                                    if (mainWindow && !mainWindow.isDestroyed()) {
                                        mainWindow.webContents.send('recording:completed', {
                                            success: false,
                                            filePath: null,
                                            error: 'OBS Virtual Camera recording stopped but file is invalid or empty'
                                        });
                                    }
                                }
                            } else {
                                debugLog(`OBS recording file does not exist: ${completedFilePath}`);
                                if (mainWindow && !mainWindow.isDestroyed()) {
                                    mainWindow.webContents.send('recording:completed', {
                                        success: false,
                                        filePath: null,
                                        error: 'OBS Virtual Camera recording stopped but no file was created'
                                    });
                                }
                            }
                        } catch (fileCheckError) {
                            debugLog(`Error checking OBS recording file: ${fileCheckError.message}`);
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('recording:completed', {
                                    success: false,
                                    filePath: null,
                                    error: `Error checking OBS recording file: ${fileCheckError.message}`
                                });
                            }
                        }
                    }
                }, 500); // Wait 500ms for file finalization
            };

            // Add close event listener for graceful stdin termination
            if (recordingProcess) {
                recordingProcess.on('close', (code, signal) => {
                    debugLog(`OBS process closed with code: ${code}, signal: ${signal}`);
                    if (signal === 'SIGTERM' || (signal === null && (code === 0 || code === 1))) {
                        debugLog('OBS process terminated gracefully via stdin');
                        processOBSRecording();
                    }
                });
            }
        } else {
            // For non-shell processes, use graceful stdin termination
            debugLog('Stopping recording via stdin (screen/window recording)');
            debugLog(`Process details - PID: ${recordingProcess.pid}, Stdin exists: ${!!recordingProcess.stdin}, Stdin destroyed: ${recordingProcess.stdin?.destroyed}`);

            try {
                if (recordingProcess.stdin && !recordingProcess.stdin.destroyed) {
                    debugLog('Attempting to write "q" to stdin...');
                    recordingProcess.stdin.write('q');
                    debugLog('Successfully sent "q" to ffmpeg for graceful termination');
                } else {
                    debugLog('Stdin not available, falling back to SIGTERM');
                    recordingProcess.kill('SIGTERM');
                }
            } catch (stdinError) {
                debugLog(`Failed to write to stdin, killing process: ${stdinError.message}`);
                recordingProcess.kill('SIGTERM');
            }
        }

        // Force kill after timeout if it doesn't stop gracefully
        const forceKillTimeout = setTimeout(() => {
            if (recordingProcess && !recordingProcess.killed) {
                debugLog('Force killing recording process after timeout');
                try {
                    recordingProcess.kill('SIGKILL');
                } catch (killError) {
                    debugLog(`Failed to force kill process: ${killError.message}`);
                }
                // Reset state regardless of kill success
                recordingProcess = null;
                isRecording = false;
                currentRecordingPath = null;
                originalRecordingPath = null;
            }
        }, 3000); // Reduced timeout from 5 seconds to 3 seconds

        // Store the timeout so we can clear it if cleanup happens earlier
        stopRecording.forceKillTimeout = forceKillTimeout;

        debugLog('Stop recording signal sent');
        return { success: true };

    } catch (error) {
        debugLog(`Failed to stop recording: ${error.message}`);
        // Reset state on error
        isRecording = false;
        recordingProcess = null;
        currentRecordingPath = null;
        originalRecordingPath = null;
        return { success: false, error: error.message };
    }
}

// Check if ffmpeg is available
async function checkFFmpeg() {
    return new Promise((resolve) => {
        const process = spawn(getFFmpegPath(), ['-version']);
        process.on('close', (code) => {
            resolve(code === 0);
        });
        process.on('error', () => {
            resolve(false);
        });
    });
}

// Get recording settings
async function getRecordingSettings() {
    return {
        recordingsDir: RECORDINGS_DIR,
        ffmpegAvailable: await checkFFmpeg()
    };
}

// List all recordings in the recordings directory
async function listRecordings() {
    try {
        ensureRecordingsDir();

        if (!fs.existsSync(RECORDINGS_DIR)) {
            return [];
        }

        const files = fs.readdirSync(RECORDINGS_DIR)
            .filter(file => file.endsWith('.mp4'))
            .map(file => {
                const filePath = path.join(RECORDINGS_DIR, file);
                const stats = fs.statSync(filePath);
                return {
                    name: file,
                    path: filePath,
                    size: stats.size,
                    modified: stats.mtime
                };
            })
            .sort((a, b) => b.modified - a.modified); // Sort by modification time, newest first

        return files;

    } catch (error) {
        debugLog(`Failed to list recordings: ${error.message}`);
        return [];
    }
}

// DaVinci Resolve API Functions

// Function to log into renderer window console
function debugLog(message) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            // Properly escape the message for JavaScript execution
            const escapedMessage = String(message).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
            mainWindow.webContents.executeJavaScript(`console.log('%cMAIN:', 'color: #800', '${escapedMessage}');`);
        } catch (error) {
            // Fallback to console if window is being destroyed
            console.log('MAIN:', message);
        }
    } else {
        // Fallback to console if window is destroyed
        console.log('MAIN:', message);
    }
}

// Initialize Resolve interface and returns Resolve object
async function initResolveInterface() {
    try {
        const isSuccess = await WorkflowIntegration.Initialize(PLUGIN_ID);
        if (!isSuccess) {
            debugLog('Error: Failed to initialize Resolve interface!');
            return null;
        }

        const resolveInterfacObj = await WorkflowIntegration.GetResolve();
        if (!resolveInterfacObj) {
            debugLog('Error: Failed to get Resolve object!');
            return null;
        }

        return resolveInterfacObj;
    } catch (error) {
        debugLog(`Resolve interface initialization error: ${error.message}`);
        return null;
    }
}

// Gets Resolve object
async function getResolve() {
    if (!resolveObj) {
        resolveObj = await initResolveInterface();
    }
    return resolveObj;
}

// Gets project manager object
async function getProjectManager() {
    if (!projectManagerObj) {
        const resolve = await getResolve();
        if (resolve) {
            projectManagerObj = await resolve.GetProjectManager();
            if (!projectManagerObj) {
                debugLog('Error: Failed to get ProjectManager object!');
            }
        }
    }
    return projectManagerObj;
}

// Gets current project object
async function getCurrentProject() {
    const projectManager = await getProjectManager();
    if (projectManager) {
        const currentProject = await projectManager.GetCurrentProject();
        if (!currentProject) {
            debugLog('Error: Failed to get current project object!');
        }
        return currentProject;
    }
    return null;
}

// Gets media pool object
async function getMediaPool() {
    const project = await getCurrentProject();
    if (project) {
        const mediaPool = await project.GetMediaPool();
        if (!mediaPool) {
            debugLog('Error: Failed to get MediaPool object!');
        }
        return mediaPool;
    }
    return null;
}

// Gets root folder object
async function getRootFolder() {
    const mediaPool = await getMediaPool();
    if (!mediaPool) return null;
    return await mediaPool.GetRootFolder();
}

// Add recording to timeline automatically
async function addRecordingToTimeline(event, filePath) {
    try {
        debugLog(`Adding recording to timeline: ${filePath}`);

        // Initialize Resolve interface
        const resolve = await getResolve();
        if (!resolve) {
            return { success: false, error: 'Failed to connect to DaVinci Resolve' };
        }

        // Get media storage
        const mediaStorage = await resolve.GetMediaStorage();
        if (!mediaStorage) {
            return { success: false, error: 'Failed to get media storage' };
        }

        // Add the file to media pool
        const mediaPool = await getMediaPool();
        if (!mediaPool) {
            return { success: false, error: 'Failed to get media pool' };
        }

        // Import the media file
        const clips = await mediaStorage.AddItemListToMediaPool([filePath]);
        if (!clips || clips.length === 0) {
            return { success: false, error: 'Failed to import media file' };
        }

        // Get current project
        const project = await getCurrentProject();
        if (!project) {
            return { success: false, error: 'Failed to get current project' };
        }

        // Get current timeline
        let timeline = await project.GetCurrentTimeline();
        let timelineName;
        let createdNewTimeline = false;

        if (!timeline) {
            // No current timeline, create a new one
            timelineName = `Screen Recording - ${new Date().toLocaleString()}`;
            timeline = await mediaPool.CreateTimelineFromClips(timelineName, clips);
            createdNewTimeline = true;

            if (!timeline) {
                return { success: false, error: 'Failed to create timeline' };
            }

            // Set the new timeline as current
            const success = await project.SetCurrentTimeline(timeline);
            if (!success) {
                return { success: false, error: 'Failed to set current timeline' };
            }

            debugLog(`Created new timeline: ${timelineName}`);
        } else {
            // Use existing timeline
            timelineName = await timeline.GetName();
            debugLog(`Using existing timeline: ${timelineName}`);

            // Add clips to current timeline at cursor position
            try {
                // Get current timeline position (playhead position)
                const currentTimecode = await timeline.GetCurrentTimecode();
                debugLog(`Current timecode: ${currentTimecode}`);

                // Try different methods to add clip to timeline
                let success = false;

                // Method 1: Try to insert at current position
                try {
                    const insertResult = await timeline.InsertClips([clips[0]], currentTimecode);
                    if (insertResult) {
                        debugLog('Clip inserted at cursor position');
                        success = true;
                    }
                } catch (insertError) {
                    debugLog(`InsertClips failed: ${insertError.message}`);
                }

                // Method 2: Try to drop clip at current position
                if (!success) {
                    try {
                        const dropResult = await timeline.DropClips([clips[0]], currentTimecode);
                        if (dropResult) {
                            debugLog('Clip dropped at cursor position');
                            success = true;
                        }
                    } catch (dropError) {
                        debugLog(`DropClips failed: ${dropError.message}`);
                    }
                }

                // Method 3: Try to append to end of timeline
                if (!success) {
                    try {
                        const appendResult = await mediaPool.AppendToTimeline([clips[0]]);
                        if (appendResult) {
                            debugLog('Clip appended to timeline');
                            success = true;
                        }
                    } catch (appendError) {
                        debugLog(`AppendToTimeline failed: ${appendError.message}`);
                    }
                }

                // Method 4: Try to drop clip at end of timeline
                if (!success) {
                    try {
                        const endResult = await timeline.DropClips([clips[0]], null);
                        if (endResult) {
                            debugLog('Clip dropped at end of timeline');
                            success = true;
                        }
                    } catch (endError) {
                        debugLog(`DropClips (end) failed: ${endError.message}`);
                    }
                }

                if (!success) {
                    return { success: false, error: 'Failed to add clip to timeline using any available method' };
                }

            } catch (timelineError) {
                return { success: false, error: `Timeline error: ${timelineError.message}` };
            }
        }

        debugLog(`Successfully added recording to timeline: ${timelineName}`);
        return {
            success: true,
            timelineName: timelineName,
            createdNewTimeline: createdNewTimeline,
            message: createdNewTimeline ?
                `Recording added to new timeline "${timelineName}"` :
                `Recording added to existing timeline "${timelineName}"`
        };

    } catch (error) {
        debugLog(`Error adding recording to timeline: ${error.message}`);
        return { success: false, error: error.message };
    }
}

function createWindow() {
    // Create the browser window
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        useContentSize: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            // Enable camera access permissions
            sandbox: false
        }
    });

    mainWindow.on('close', function(e) {
        if (isRecording) {
            e.preventDefault();
            dialog.showMessageBox(mainWindow, {
                type: 'question',
                buttons: ['Stop Recording & Exit', 'Cancel'],
                defaultId: 0,
                message: 'Recording is in progress. Stop recording and exit?'
            }).then((result) => {
                if (result.response === 0) {
                    stopRecording(null);
                    setTimeout(() => app.quit(), 2000);
                }
            });
        } else {
            app.quit();
        }
    });

    // Load index.html
    mainWindow.loadFile('index.html');

    // Open DevTools for debugging (remove in production)
    // mainWindow.webContents.openDevTools();
}

// Register IPC handlers
function registerHandlers() {
    ipcMain.handle('recording:start', startRecording);
    ipcMain.handle('recording:stop', stopRecording);
    ipcMain.handle('recording:getSettings', getRecordingSettings);
    ipcMain.handle('recording:isRecording', () => isRecording);
    ipcMain.handle('recording:listRecordings', listRecordings);
    ipcMain.handle('resolve:addToTimeline', addRecordingToTimeline);
    ipcMain.handle('sources:update', updateAvailableSources);
    ipcMain.handle('sources:getWindows', getAvailableWindows);
    ipcMain.handle('sources:getCameras', getAvailableCameras);
    ipcMain.handle('sources:getAudioDevices', () => availableAudioDevices);
}

app.whenReady().then(() => {
    // Request camera permissions
    app.on('accessibility-support-changed', () => {
        debugLog('Accessibility support changed');
    });

    registerHandlers();
    createWindow();
    ensureRecordingsDir();
    setupGlobalShortcuts();

    // Update sources after a short delay
    setTimeout(() => {
        updateAvailableSources();
    }, 2000);

    // Update sources every 30 seconds
    setInterval(updateAvailableSources, 30000);
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Cleanup on exit
app.on('before-quit', () => {
    if (isRecording && recordingProcess) {
        recordingProcess.kill();
    }
    cleanupGlobalShortcuts();
});

app.on('will-quit', () => {
    cleanupGlobalShortcuts();
});