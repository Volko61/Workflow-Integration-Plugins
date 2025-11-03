# Screen Recording Plugin - Issues & Solutions

This documents the specific technical issues encountered and solutions implemented during this conversation.

## Issue 1: Timeline Duplication Bug
**Problem**: Recordings were being added to DaVinci Resolve timeline twice instead of once when recording completed.

**Root Cause**: Multiple event handlers in the FFmpeg process close events were all calling `addRecordingToTimeline()`, causing duplicate timeline additions.

**Solution**: Implemented a global `timelineAdded` flag to prevent duplicate calls:
```javascript
let timelineAdded = false; // Global flag

// Reset when starting new recording
timelineAdded = false;

// Check flag before adding to timeline in all event handlers
if (code === 0 && mainWindow && !timelineAdded) {
    timelineAdded = true;
    addRecordingToTimeline(null, outputPath).then(result => {
        // Handle timeline addition
    });
}
```

## Issue 2: Window Recording FFmpeg Error
**Problem**: Window recording failed with FFmpeg error "Can't find window 'C:\Users\file.log', aborting." when recording windows with spaces in titles.

**Root Cause**: FFmpeg's gdigrab wasn't properly handling window titles with spaces. The command was being parsed incorrectly.

**Solution**: Added proper quoting around window titles in FFmpeg arguments:
```javascript
// Before: '-i', `title=${options.windowTitle}`
// After:  '-i', `title="${options.windowTitle}"`
```

## Issue 3: Camera Recording Audio Device Error
**Problem**: Camera recording failed with "Could not find audio only device" error when trying to record with audio.

**Root Cause**: The camera recording system was using complex altNames (device identifiers) instead of display names for audio devices, which didn't work with shell execution.

**Solution**: Modified `getBestAudioDevice()` to return display names instead of altNames:
```javascript
// Before: return preferredDevice.altName || preferredDevice.name;
// After:  return preferredDevice.name;
```

## Issue 4: OBS Virtual Camera Audio Failure
**Problem**: OBS Virtual Camera recording immediately failed with audio device not found error.

**Root Cause**: OBS Virtual Camera was still using `getCorrectAudioDeviceName()` which returned altNames, incompatible with shell execution.

**Solution**: Modified OBS Virtual Camera to use display names directly:
```javascript
// Before:
audioDevice = await getCorrectAudioDeviceName(audioDevice);
cameraCommand = `${getFFmpegPath()} -f dshow ... -i audio="${audioDevice.replace(/\\/g, '\\\\')}" ...`;

// After:
cameraCommand = `${getFFmpegPath()} -f dshow ... -i audio="${audioDevice}" ...`;
```

## Issue 5: Unwanted Audio Device Rescanning
**Problem**: User complained that audio devices were being rescanned when switching to "specific windows" mode, causing unnecessary delays and log spam.

**Root Cause**: The `updateSources()` function was being called when switching recording modes, which triggered audio device rescanning.

**Solution**: Implemented audio device caching to scan only once at startup:
```javascript
async function updateAvailableSources() {
    try {
        availableWindows = await getAvailableWindows();
        availableCameras = await getAvailableCameras();

        // Only scan audio devices once at startup - cache them for subsequent calls
        if (availableAudioDevices.length === 0) {
            availableAudioDevices = await getAvailableAudioDevices();
            debugLog(`Audio devices scanned and cached: ${availableAudioDevices.length} devices found`);
        }
        // ... rest
    }
}
```

## Issue 6: Audio Device Scanning on Mode Switch
**Problem**: Initially tried to force audio rescanning when switching to window mode to solve "no audio devices found" issue, but user specifically requested "never rescan".

**Root Cause**: Inconsistent approach to audio device caching vs. rescanning.

**Solution**: Removed all rescanning logic completely:
```javascript
// Modified region change handler to not trigger any rescanning
case 'window':
    windowSelectGroup.style.display = 'block';
    // Don't rescan - just show cached sources
    break;
```

## Issue 7: Audio Device Name Inconsistency
**Problem**: Different recording modes used different audio device naming conventions (display names vs altNames), causing compatibility issues.

**Root Cause**: Window recording used display names, while camera and OBS recording used altNames for shell execution.

**Solution**: Standardized all recording modes to use display names:
- Window recording: already used display names
- Camera recording: modified to use display names from `getBestAudioDevice()`
- OBS Virtual Camera: modified to use display names directly
- Removed all `getCorrectAudioDeviceName()` calls that returned altNames

## Key Technical Pattern: Shell Execution vs Direct Spawn
**Learning**: For FFmpeg commands with complex device names and special characters, shell execution works better than direct spawn with argument arrays.

**Pattern Applied**:
```javascript
// Use shell execution for complex commands
const shellCommand = `${getFFmpegPath()} -f dshow -i audio="${audioDeviceName}" -f gdigrab -i title="${windowTitle}" ... "${outputPath}"`;
recordingProcess = spawn(shellCommand, [], { shell: true });
```

## Key Technical Pattern: Global Flags for Duplicate Prevention
**Learning**: When multiple event handlers can trigger the same operation, use global flags to prevent duplicates.

**Pattern Applied**:
```javascript
let timelineAdded = false;

// Multiple event handlers check this flag before executing
if (!timelineAdded) {
    timelineAdded = true;
    // Perform operation
}
```

## Key Technical Pattern: Device Caching Strategy
**Learning**: Cache hardware devices at startup to avoid system calls and maintain consistency.

**Pattern Applied**:
```javascript
// Scan once, cache forever
if (availableAudioDevices.length === 0) {
    availableAudioDevices = await getAvailableAudioDevices();
}
```

## Summary
The main technical challenges involved:
1. **Consistent device naming** across different recording modes
2. **Proper FFmpeg command construction** with quoting and shell execution
3. **Preventing duplicate operations** through state management
4. **Performance optimization** through strategic caching
5. **User preference alignment** (no rescanning)