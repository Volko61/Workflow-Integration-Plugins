/**
 * FFmpeg service for handling recording operations
 */

const { spawn, exec } = require('child_process');
const CONFIG = require('../config/constants');
const FileSystemUtils = require('../utils/fileSystem');

class FFmpegService {
  constructor(logger) {
    this.logger = logger;
    this.recordingProcess = null;
    this.isRecording = false;
    this.currentRecordingPath = null;
    this.forceKillTimeout = null;
  }

  /**
   * Get FFmpeg executable path
   * @returns {string} FFmpeg path
   */
  getFFmpegPath() {
    return CONFIG.FFMEG_PATHS[0]; // Default to system ffmpeg
  }

  /**
   * Check if FFmpeg is available
   * @returns {Promise<boolean>} True if FFmpeg is available
   */
  async checkFFmpegAvailability() {
    return new Promise((resolve) => {
      const process = spawn(this.getFFmpegPath(), ['-version']);
      process.on('close', (code) => resolve(code === 0));
      process.on('error', () => resolve(false));
    });
  }

  /**
   * Generate FFmpeg arguments based on recording options
   * @param {Object} options - Recording options
   * @param {Object} region - Selected region (optional)
   * @returns {Array} FFmpeg arguments
   */
  generateFFmpegArgs(options, region = null) {
    const args = [];
    const { sourceType, framerate = CONFIG.RECORDING.DEFAULT_FRAMERATE } = options;

    // Configure input source
    switch (sourceType) {
      case 'camera':
        return this._generateCameraArgs(options);

      case 'window':
        args.push(
          '-f', 'gdigrab',
          '-framerate', framerate,
          '-i', `title=${options.windowTitle}`
        );
        break;

      default:
        if (region) {
          args.push(
            '-f', 'gdigrab',
            '-video_size', `${region.width}x${region.height}`,
            '-framerate', framerate,
            '-offset_x', region.x.toString(),
            '-offset_y', region.y.toString(),
            '-i', 'desktop',
            '-draw_mouse', '1',
            '-probesize', '10M',
            '-analyzeduration', '0'
          );
        } else {
          args.push(
            '-f', 'gdigrab',
            '-framerate', framerate,
            '-i', 'desktop'
          );
        }
        break;
    }

    // Add encoding options
    args.push(
      '-c:v', CONFIG.RECORDING.ENCODING.CODEC,
      '-preset', CONFIG.RECORDING.ENCODING.PRESET,
      '-crf', CONFIG.RECORDING.ENCODING.CRF.toString(),
      '-pix_fmt', CONFIG.RECORDING.ENCODING.PIXEL_FORMAT
    );

    // Add resolution scaling if needed (but not for region selection)
    if (options.resolution && options.resolution !== 'desktop' && !region) {
      args.push('-vf', `scale=${options.resolution}`);
    }

    return args;
  }

  /**
   * Generate camera-specific FFmpeg arguments
   * @param {Object} options - Recording options
   * @returns {Array} Camera FFmpeg arguments
   * @private
   */
  _generateCameraArgs(options) {
    const cleanCameraName = options.cameraName.replace(/[\[\]]/g, '').trim();
    const isOBS = cleanCameraName.toLowerCase().includes('obs virtual');

    if (isOBS) {
      // OBS Virtual Camera settings
      return [
        '-f', 'dshow',
        '-framerate', CONFIG.RECORDING.CAMERA_RESOLUTIONS.OBS.framerate.toString(),
        '-i', `video="${cleanCameraName}"`
      ];
    } else {
      // Regular camera settings
      return [
        '-f', 'dshow',
        '-framerate', options.framerate || CONFIG.RECORDING.DEFAULT_FRAMERATE,
        '-video_size', `${CONFIG.RECORDING.CAMERA_RESOLUTIONS.DEFAULT.width}x${CONFIG.RECORDING.CAMERA_RESOLUTIONS.DEFAULT.height}`,
        '-i', `video="${cleanCameraName}"`
      ];
    }
  }

  /**
   * Generate fallback camera commands
   * @param {Object} options - Recording options
   * @param {string} outputPath - Output file path
   * @returns {Array} Array of fallback commands
   * @private
   */
  _generateCameraFallbackCommands(options, outputPath) {
    const cleanCameraName = options.cameraName.replace(/[\[\]]/g, '').trim();
    const targetResolution = options.resolution || CONFIG.RECORDING.DEFAULT_RESOLUTION;
    const ffmpegPath = this.getFFmpegPath();

    if (cleanCameraName.toLowerCase().includes('obs virtual')) {
      // OBS Virtual Camera command
      return [
        `${ffmpegPath} -f dshow -framerate ${CONFIG.RECORDING.CAMERA_RESOLUTIONS.OBS.framerate} -i video="${cleanCameraName}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -vf scale=${targetResolution} "${outputPath}"`
      ];
    } else {
      // Regular camera fallbacks
      const framerate = options.framerate || CONFIG.RECORDING.DEFAULT_FRAMERATE;
      const scaleFilter = targetResolution !== CONFIG.RECORDING.DEFAULT_RESOLUTION ? `-vf scale=${targetResolution}` : '';

      return [
        // Primary: Request 1920x1080 input
        `${ffmpegPath} -f dshow -framerate ${framerate} -video_size ${CONFIG.RECORDING.DEFAULT_RESOLUTION} -i video="${cleanCameraName}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p ${scaleFilter} "${outputPath}"`,
        // Fallback 1: No video_size specified
        `${ffmpegPath} -f dshow -framerate ${framerate} -i video="${cleanCameraName}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p ${scaleFilter} "${outputPath}"`,
        // Fallback 2: Use 1280x720 input
        `${ffmpegPath} -f dshow -framerate ${framerate} -video_size 1280x720 -i video="${cleanCameraName}" -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -vf scale=${targetResolution} "${outputPath}"`
      ];
    }
  }

  /**
   * Start recording process
   * @param {Object} options - Recording options
   * @param {Object} region - Selected region (optional)
   * @param {Function} onComplete - Completion callback
   * @returns {Promise<Object>} Recording result
   */
  async startRecording(options, region = null, onComplete = null) {
    if (this.isRecording) {
      return { success: false, error: 'Recording already in progress' };
    }

    FileSystemUtils.ensureRecordingsDir();
    const outputPath = FileSystemUtils.getRecordingPath();

    this.logger.log(`Starting recording: ${outputPath}`);

    try {
      if (options.sourceType === 'camera') {
        return await this._startCameraRecording(options, outputPath, onComplete);
      } else {
        return await this._startScreenRecording(options, region, outputPath, onComplete);
      }
    } catch (error) {
      this.logger.error(`Failed to start recording: ${error.message}`);
      this._resetRecordingState();
      return { success: false, error: error.message };
    }
  }

  /**
   * Start camera recording with fallback system
   * @param {Object} options - Recording options
   * @param {string} outputPath - Output file path
   * @param {Function} onComplete - Completion callback
   * @returns {Promise<Object>} Recording result
   * @private
   */
  async _startCameraRecording(options, outputPath, onComplete) {
    const fallbackCommands = this._generateCameraFallbackCommands(options, outputPath);
    let currentAttempt = 0;
    let ioErrorDetected = false;

    return new Promise((resolve) => {
      const attemptRecording = () => {
        if (currentAttempt >= fallbackCommands.length) {
          this.logger.error('All camera recording attempts failed');
          this._resetRecordingState();
          if (onComplete) {
            onComplete({
              success: false,
              error: 'Camera recording failed: All attempts failed. The camera may be in use by another application.'
            });
          }
          resolve({ success: false, error: 'All camera recording attempts failed' });
          return;
        }

        const cameraCommand = fallbackCommands[currentAttempt];
        const attemptName = currentAttempt === 0 ? 'Primary approach' : `Fallback ${currentAttempt}`;
        const currentOutputPath = currentAttempt > 0 ?
          FileSystemUtils.getRecordingPath(`_attempt${currentAttempt}.mp4`) : outputPath;

        const modifiedCommand = cameraCommand.replace(outputPath, currentOutputPath).replace('ffmpeg', 'ffmpeg -y');

        this.logger.log(`Trying ${attemptName}: ${modifiedCommand}`);

        this.recordingProcess = spawn(modifiedCommand, [], { shell: true });
        this.isRecording = true;
        this.currentRecordingPath = currentOutputPath;
        ioErrorDetected = false;

        this._setupCameraProcessHandlers(currentAttempt, attemptName, currentOutputPath,
          fallbackCommands.length, ioErrorDetected, attemptRecording, onComplete, resolve);
      };

      attemptRecording();
    });
  }

  /**
   * Setup camera recording process event handlers
   * @param {number} currentAttempt - Current attempt number
   * @param {string} attemptName - Attempt name for logging
   * @param {string} currentOutputPath - Current output path
   * @param {number} totalAttempts - Total number of attempts
   * @param {boolean} ioErrorDetected - I/O error flag
   * @param {Function} attemptRecording - Function to retry recording
   * @param {Function} onComplete - Completion callback
   * @param {Function} resolve - Promise resolve function
   * @private
   */
  _setupCameraProcessHandlers(currentAttempt, attemptName, currentOutputPath,
    totalAttempts, ioErrorDetected, attemptRecording, onComplete, resolve) {

    this.recordingProcess.on('close', (code, signal) => {
      this.logger.log(`${attemptName} closed with code: ${code}, signal: ${signal}, I/O error: ${ioErrorDetected}`);

      const wasManuallyStopped = signal === 'SIGTERM' || signal === 'SIGKILL' ||
        (signal === null && code !== 0 && code !== null) ||
        (signal === null && code === 1);

      if (wasManuallyStopped) {
        this.logger.log(`Camera recording was manually stopped. Code: ${code}, Signal: ${signal}`);
        this._resetRecordingState();
        if (onComplete) {
          onComplete({
            success: signal === 'SIGTERM' || (signal === null && code === 1),
            filePath: currentOutputPath,
            error: signal === 'SIGTERM' || (signal === null && code === 1) ?
              'Recording stopped by user' : `Camera recording failed with exit code ${code}`
          });
        }
        resolve({ success: true });
        return;
      }

      if (code === 0 && !ioErrorDetected && FileSystemUtils.fileExistsWithContent(currentOutputPath)) {
        this.logger.log(`Camera recording successful with ${attemptName}`);
        this._resetRecordingState();
        if (onComplete) {
          onComplete({ success: true, filePath: currentOutputPath });
        }
        resolve({ success: true, filePath: currentOutputPath });
        return;
      }

      // This attempt failed, try next fallback
      currentAttempt++;
      if (currentAttempt < totalAttempts) {
        this.logger.log(`${attemptName} failed, trying next approach...`);
        setTimeout(attemptRecording, 1000);
      } else {
        this.logger.error(`All camera recording attempts failed`);
        this._resetRecordingState();
        if (onComplete) {
          onComplete({ success: false, error: 'All camera recording attempts failed' });
        }
        resolve({ success: false, error: 'All camera recording attempts failed' });
      }
    });

    this.recordingProcess.stderr.on('data', (data) => {
      const stderrOutput = data.toString().trim();
      if (stderrOutput) {
        this.logger.log(`FFmpeg stderr: ${stderrOutput}`);

        if (stderrOutput.includes('Error during demuxing: I/O error') ||
          stderrOutput.includes('No filtered frames for output stream')) {
          this.logger.log(`Camera I/O Error detected in ${attemptName}`);
          ioErrorDetected = true;
        }
      }
    });

    this.recordingProcess.on('error', (error) => {
      this.logger.error(`${attemptName} process error: ${error.message}`);
      currentAttempt++;

      if (currentAttempt >= totalAttempts) {
        this.logger.error(`All camera recording attempts failed due to errors`);
        this._resetRecordingState();
        if (onComplete) {
          onComplete({ success: false, error: `All attempts failed: ${error.message}` });
        }
        resolve({ success: false, error: `All attempts failed: ${error.message}` });
        return;
      }

      this.logger.log(`${attemptName} error, trying next approach...`);
      setTimeout(attemptRecording, 1000);
    });
  }

  /**
   * Start screen/window recording
   * @param {Object} options - Recording options
   * @param {Object} region - Selected region (optional)
   * @param {string} outputPath - Output file path
   * @param {Function} onComplete - Completion callback
   * @returns {Promise<Object>} Recording result
   * @private
   */
  async _startScreenRecording(options, region, outputPath, onComplete) {
    const args = this.generateFFmpegArgs(options, region);
    args.push(outputPath);

    const fullCommand = `${this.getFFmpegPath()} ${args.join(' ')}`;
    this.logger.log(`FFmpeg command: ${fullCommand}`);

    this.recordingProcess = spawn(this.getFFmpegPath(), args);
    this.isRecording = true;
    this.currentRecordingPath = outputPath;

    this._setupScreenProcessHandlers(outputPath, onComplete);

    return { success: true, filePath: outputPath };
  }

  /**
   * Setup screen recording process event handlers
   * @param {string} outputPath - Output file path
   * @param {Function} onComplete - Completion callback
   * @private
   */
  _setupScreenProcessHandlers(outputPath, onComplete) {
    this.recordingProcess.on('error', (error) => {
      this.logger.error(`Recording process error: ${error.message}`);
      this._resetRecordingState();
      if (onComplete) {
        onComplete({ success: false, error: `Recording process error: ${error.message}` });
      }
    });

    this.recordingProcess.on('close', (code, signal) => {
      this.logger.log(`Recording process closed with code: ${code}, signal: ${signal}`);
      this._resetRecordingState();

      if (code === 0) {
        if (onComplete) {
          onComplete({ success: true, filePath: outputPath });
        }
      } else if (code !== null && code !== 0) {
        this.logger.error(`FFmpeg failed with exit code ${code}`);
        if (onComplete) {
          onComplete({ success: false, error: `FFmpeg recording failed with exit code ${code}` });
        }
      } else if (signal) {
        this.logger.log(`Recording process killed by signal: ${signal}`);
      }
    });

    this.recordingProcess.stderr.on('data', (data) => {
      const stderrOutput = data.toString().trim();
      if (stderrOutput) {
        this.logger.log(`FFmpeg stderr: ${stderrOutput}`);
      }
    });
  }

  /**
   * Stop recording process
   * @returns {Promise<Object>} Stop result
   */
  async stopRecording() {
    if (!this.isRecording || !this.recordingProcess) {
      return { success: false, error: 'No recording in progress' };
    }

    try {
      this.logger.log(`Stopping recording process. PID: ${this.recordingProcess.pid}`);

      const isShellProcess = this._isShellProcess(this.recordingProcess);

      if (isShellProcess || !this.recordingProcess.stdin || this.recordingProcess.stdin.destroyed) {
        await this._stopShellRecording();
      } else {
        await this._stopScreenRecording();
      }

      this._setupForceKillTimeout();

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to stop recording: ${error.message}`);
      this._resetRecordingState();
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if process is a shell process
   * @param {ChildProcess} process - Process to check
   * @returns {boolean} True if shell process
   * @private
   */
  _isShellProcess(process) {
    return process.spawnargs &&
      (process.spawnargs.includes('shell') ||
       process.spawnfile?.includes('cmd.exe') ||
       process.spawnfile?.includes('powershell.exe'));
  }

  /**
   * Stop shell-based recording (camera)
   * @private
   */
  async _stopShellRecording() {
    this.logger.log('Stopping camera recording (shell process)');

    if (process.platform === 'win32') {
      if (this.recordingProcess.pid) {
        const { exec } = require('child_process');
        exec(`taskkill /F /T /PID ${this.recordingProcess.pid}`, (error, stdout) => {
          if (error) {
            this.logger.error(`Taskkill failed: ${error.message}`);
            this.recordingProcess.kill('SIGTERM');
          } else {
            this.logger.log(`Process tree killed successfully: ${stdout}`);
            this._cleanupForceKillTimeout();
            this._resetRecordingState();
          }
        });
      }
    } else {
      this.recordingProcess.kill('SIGTERM');
    }
  }

  /**
   * Stop screen recording via stdin
   * @private
   */
  async _stopScreenRecording() {
    this.logger.log('Stopping screen/window recording via stdin');
    try {
      this.recordingProcess.stdin.write('q');
    } catch (error) {
      this.logger.error(`Failed to write to stdin, killing process: ${error.message}`);
      this.recordingProcess.kill('SIGTERM');
    }
  }

  /**
   * Setup force kill timeout
   * @private
   */
  _setupForceKillTimeout() {
    this.forceKillTimeout = setTimeout(() => {
      if (this.recordingProcess && !this.recordingProcess.killed) {
        this.logger.log('Force killing recording process after timeout');
        try {
          this.recordingProcess.kill('SIGKILL');
        } catch (error) {
          this.logger.error(`Failed to force kill process: ${error.message}`);
        }
        this._resetRecordingState();
      }
    }, CONFIG.RECORDING.FORCE_KILL_TIMEOUT);
  }

  /**
   * Cleanup force kill timeout
   * @private
   */
  _cleanupForceKillTimeout() {
    if (this.forceKillTimeout) {
      clearTimeout(this.forceKillTimeout);
      this.forceKillTimeout = null;
    }
  }

  /**
   * Reset recording state
   * @private
   */
  _resetRecordingState() {
    this.isRecording = false;
    this.recordingProcess = null;
    this.currentRecordingPath = null;
    this._cleanupForceKillTimeout();
  }

  /**
   * Get current recording state
   * @returns {Object} Recording state
   */
  getState() {
    return {
      isRecording: this.isRecording,
      currentRecordingPath: this.currentRecordingPath,
      hasProcess: this.recordingProcess !== null
    };
  }
}

module.exports = FFmpegService;