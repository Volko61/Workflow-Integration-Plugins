// Test script to verify the new FFmpeg command structure
const { spawn } = require('child_process');
const path = require('path');

// Simulate the command building process
function buildFFmpegCommand(options) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `screen-recording-${timestamp}.mp4`;
    const outputPath = path.resolve(process.cwd(), filename);

    // Start with video input (desktop)
    let args = [
        '-f', 'gdigrab',
        '-framerate', options.framerate || '30',
        '-i', 'desktop'
    ];

    // Add audio device if specified (must come before video for dshow)
    let audioInputAdded = false;
    if (options.audioDevice) {
        console.log(`Adding audio device: ${options.audioDevice}`);
        // Rebuild args array with audio first for dshow compatibility
        const originalArgs = [...args]; // Copy original args
        args = [
            '-f', 'dshow',
            '-i', `audio="${options.audioDevice}"`,
            // Then add video input
            '-f', originalArgs[0], // Use the original video format (gdigrab)
            originalArgs[1], // framerate
            originalArgs[2], // framerate value
            originalArgs[3], // -i
            originalArgs[4]  // input source (desktop, title=..., etc.)
        ];
        audioInputAdded = true;
        console.log('Audio input added before video input for dshow compatibility');
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
        console.log('Added audio encoding with AAC codec at 128k bitrate');
    }

    args.push('-t', '3'); // 3 second test
    args.push(outputPath);

    return { args, outputPath };
}

// Test with your audio device
const testOptions = {
    framerate: '30',
    audioDevice: 'Réseau de microphones (Qualcomm(R) Aqstic(TM) ACX Static Endpoints Audio Device)'
};

const { args, outputPath } = buildFFmpegCommand(testOptions);

console.log('Testing new command structure...');
console.log('Output file:', outputPath);

const fullCommand = `ffmpeg ${args.join(' ')}`;
console.log('Command:', fullCommand);

const recordingProcess = spawn('ffmpeg', args);

recordingProcess.on('close', (code) => {
    console.log(`Process closed with code: ${code}`);
    if (code === 0) {
        console.log('✅ Test successful! Audio and video recording works.');
        // Clean up
        require('fs').unlinkSync(outputPath);
        console.log('Test file cleaned up.');
    } else {
        console.log('❌ Test failed');
    }
});

recordingProcess.stderr.on('data', (data) => {
    const output = data.toString().trim();
    if (output && !output.includes('frame=')) {
        console.log('FFmpeg:', output);
    }
});