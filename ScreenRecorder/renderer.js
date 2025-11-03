let isRecording = false;
let recordingSettings = null;

// DOM elements (will be initialized after DOM loads)
let startBtn, stopBtn, statusText, ffmpegStatus, refreshBtn;
let framerateSelect, resolutionSelect, regionSelect;
let windowSelect, cameraSelect, audioSelect;
let windowSelectGroup, cameraSelectGroup;

// Initialize DOM elements
function initializeDOMElements() {
    startBtn = document.getElementById('startBtn');
    stopBtn = document.getElementById('stopBtn');
    refreshBtn = document.getElementById('refreshBtn');
    statusText = document.getElementById('status');
    ffmpegStatus = document.getElementById('ffmpegStatus');
    framerateSelect = document.getElementById('framerate');
    resolutionSelect = document.getElementById('resolution');
    regionSelect = document.getElementById('region');
    windowSelect = document.getElementById('windowSelect');
    cameraSelect = document.getElementById('cameraSelect');
    audioSelect = document.getElementById('audioSelect');
    windowSelectGroup = document.getElementById('windowSelectGroup');
    cameraSelectGroup = document.getElementById('cameraSelectGroup');
}

// Initialize
async function init() {
    try {
        // Initialize DOM elements first
        initializeDOMElements();

        recordingSettings = await window.electronAPI.getRecordingSettings();

        if (recordingSettings.ffmpegAvailable) {
            ffmpegStatus.textContent = 'FFmpeg: Available';
            ffmpegStatus.style.color = 'green';
        } else {
            ffmpegStatus.textContent = 'FFmpeg: Not Found';
            ffmpegStatus.style.color = 'red';
            startBtn.disabled = true;
        }

        // Listen for recording completion
        window.electronAPI.onRecordingCompleted((event, data) => {
            handleRecordingCompleted(data);
        });

        // Listen for sources updates
        window.electronAPI.onSourcesUpdated((event, data) => {
            updateSourceLists(data);
        });

        // Listen for global shortcuts
        window.electronAPI.onGlobalShortcutStart(() => {
            handleGlobalShortcutStart();
        });

        window.electronAPI.onGlobalShortcutStop(() => {
            handleGlobalShortcutStop();
        });

        window.electronAPI.onGlobalShortcutToggle(() => {
            handleGlobalShortcutToggle();
        });

        // Setup region change listener
        regionSelect.addEventListener('change', handleRegionChange);

        // Initial sources update
        await updateSources();

    } catch (error) {
        console.error('Failed to initialize:', error);
        statusText.textContent = 'Failed to initialize: ' + error.message;
    }
}

// Handle recording completion
async function handleRecordingCompleted(data) {
    if (data.success) {
        isRecording = false;
        updateRecordingUI();

        if (data.timelineResult && data.timelineResult.success) {
            if (data.timelineResult.createdNewTimeline) {
                statusText.textContent = `✅ Recording added to new timeline: ${data.timelineResult.timelineName}`;
            } else {
                statusText.textContent = `✅ Recording added to existing timeline: ${data.timelineResult.timelineName}`;
            }
            statusText.style.color = 'green';
        } else {
            // Timeline integration failed, show manual instructions
            const fileName = data.filePath ? data.filePath.split(/[\\\/]/).pop() : 'Unknown file';
            statusText.textContent = `⚠️ Timeline integration failed - see manual instructions`;
            statusText.style.color = 'orange';

            const timelineError = data.timelineResult ? data.timelineResult.error : 'Unknown error';
            const fileLocation = data.filePath || 'Unknown location';
            alert(`⚠️ Automatic timeline integration failed: ${timelineError}\n\nManual import required:\n\nFile location: ${fileLocation}\n\nIn DaVinci Resolve, you can:\n1. Go to Media Pool\n2. Right-click and import media\n3. Navigate to the recordings folder\n4. Select "${fileName}"\n5. Drag it to your timeline`);
        }
    } else {
        statusText.textContent = `Recording failed: ${data.error}`;
        statusText.style.color = 'red';
    }
}

// Update recording UI state
function updateRecordingUI() {
    if (isRecording) {
        startBtn.disabled = true;
        stopBtn.disabled = false;
        statusText.textContent = 'Recording in progress...';
        statusText.style.color = 'red';
    } else {
        startBtn.disabled = false;
        stopBtn.disabled = true;
        statusText.textContent = 'Ready to record';
        statusText.style.color = 'black';
    }
}

// Start recording
async function startRecording() {
    if (isRecording) return;

    try {
        const region = regionSelect.value;
        let options = {
            framerate: framerateSelect.value,
            resolution: resolutionSelect.value,
            region: region
        };

        // Add source-specific options
        if (region === 'window') {
            const selectedWindow = windowSelect.value;
            if (selectedWindow) {
                options.sourceType = 'window';
                options.windowTitle = selectedWindow;
            } else {
                statusText.textContent = 'Please select a window to record';
                return;
            }
        } else if (region === 'camera') {
            const selectedCamera = cameraSelect.value;
            if (selectedCamera) {
                options.sourceType = 'camera';
                options.cameraName = selectedCamera;
            } else {
                statusText.textContent = 'Please select a camera to record';
                return;
            }
        } else {
            options.sourceType = 'desktop';
        }

        // Add audio device option
        const selectedAudioDevice = audioSelect.value;
        if (selectedAudioDevice) {
            options.audioDevice = selectedAudioDevice;
            console.log(`Using audio device: ${selectedAudioDevice}`);
        } else {
            console.log('No audio device selected, recording video only');
        }

        const result = await window.electronAPI.startRecording(options);

        if (result.success) {
            isRecording = true;
            updateRecordingUI();
            statusText.textContent = 'Recording started...';
        } else {
            statusText.textContent = `Failed to start recording: ${result.error}`;
        }

    } catch (error) {
        console.error('Failed to start recording:', error);
        statusText.textContent = 'Failed to start recording: ' + error.message;
    }
}

// Stop recording
async function stopRecording() {
    if (!isRecording) return;

    try {
        const result = await window.electronAPI.stopRecording();

        if (result.success) {
            statusText.textContent = 'Stopping recording...';
        } else {
            statusText.textContent = `Failed to stop recording: ${result.error}`;
        }

    } catch (error) {
        console.error('Failed to stop recording:', error);
        statusText.textContent = 'Failed to stop recording: ' + error.message;
    }
}

// Handle region selection change
function handleRegionChange() {
    const selectedRegion = regionSelect.value;

    // Hide all selection groups first
    windowSelectGroup.style.display = 'none';
    cameraSelectGroup.style.display = 'none';

    // Show appropriate group based on selection
    switch (selectedRegion) {
        case 'window':
            windowSelectGroup.style.display = 'block';
            // Don't rescan - just show cached sources
            break;
        case 'camera':
            cameraSelectGroup.style.display = 'block';
            // Don't rescan - just show cached sources
            break;
        case 'selection':
            // Region selection would trigger a screen overlay
            statusText.textContent = 'Click Start Recording to select region';
            break;
        default:
            // Full desktop - no additional options needed
            break;
    }
}

// Update source lists (windows and cameras)
async function updateSources() {
    try {
        const sources = await window.electronAPI.getSources();
        updateSourceLists(sources);
    } catch (error) {
        console.error('Failed to get sources:', error);
    }
}

// Update the source lists in the UI
function updateSourceLists(data) {
    if (!data) return;

    // Update window list
    if (data.windows && data.windows.length > 0) {
        windowSelect.innerHTML = '';
        data.windows.forEach(window => {
            const option = document.createElement('option');
            option.value = window.title; // Use window title instead of ID for FFmpeg
            option.textContent = window.name;
            windowSelect.appendChild(option);
        });
    } else {
        windowSelect.innerHTML = '<option value="">No windows found</option>';
    }

    // Update camera list
    if (data.cameras && data.cameras.length > 0) {
        cameraSelect.innerHTML = '';
        data.cameras.forEach(camera => {
            const option = document.createElement('option');
            option.value = camera.name; // Use camera name as value since no id property exists
            option.textContent = camera.name;
            cameraSelect.appendChild(option);
        });
    } else {
        cameraSelect.innerHTML = '<option value="">No cameras found</option>';
    }

    // Update audio device list
    if (data.audioDevices && data.audioDevices.length > 0) {
        audioSelect.innerHTML = '<option value="">No audio (video only)</option>';
        data.audioDevices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.name;
            option.textContent = device.name;
            if (device.isDefault) {
                option.selected = true;
            }
            audioSelect.appendChild(option);
        });
    } else {
        audioSelect.innerHTML = '<option value="">No audio devices found</option>';
    }
}

// Handle global shortcut start
function handleGlobalShortcutStart() {
    if (!isRecording) {
        startRecording();
    }
}

// Handle global shortcut stop
function handleGlobalShortcutStop() {
    if (isRecording) {
        stopRecording();
    }
}

// Handle global shortcut toggle
function handleGlobalShortcutToggle() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

// Refresh sources manually
async function refreshSources() {
    try {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';

        await updateSources();

        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh Sources';
        statusText.textContent = 'Sources refreshed successfully';
        statusText.style.color = 'green';

        setTimeout(() => {
            statusText.textContent = 'Ready to record';
            statusText.style.color = 'black';
        }, 2000);

    } catch (error) {
        console.error('Failed to refresh sources:', error);
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh Sources';
        statusText.textContent = 'Failed to refresh sources';
        statusText.style.color = 'red';
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    init();

    // Add event listeners after DOM is loaded
    startBtn.addEventListener('click', startRecording);
    stopBtn.addEventListener('click', stopRecording);
    refreshBtn.addEventListener('click', refreshSources);
});