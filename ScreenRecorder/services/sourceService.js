/**
 * Source detection and management service
 */

const { exec } = require('child_process');
const CONFIG = require('../config/constants');

class SourceService {
  constructor(logger) {
    this.logger = logger;
    this.availableWindows = [];
    this.availableCameras = [];
  }

  /**
   * Get available windows for recording
   * @returns {Promise<Array>} Array of window objects
   */
  async getAvailableWindows() {
    return new Promise((resolve) => {
      exec(CONFIG.POWER_SHELL.GET_WINDOWS, { encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) {
          this.logger.error(`Error getting windows: ${error.message}`);
          resolve([]);
          return;
        }

        try {
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

          this.logger.log(`Found ${windows.length} windows with titles`);
          this.availableWindows = windows;
          resolve(windows);
        } catch (parseError) {
          this.logger.error(`Error parsing windows: ${parseError.message}`);
          resolve([]);
        }
      });
    });
  }

  /**
   * Get available cameras
   * @returns {Promise<Array>} Array of camera objects
   */
  async getAvailableCameras() {
    return new Promise((resolve) => {
      exec('ffmpeg -list_devices true -f dshow -i dummy', (error, stdout, stderr) => {
        if (error) {
          this.logger.error(`Error getting cameras: ${error.message}`);
        }

        try {
          const output = stderr || stdout || '';
          const videoDevices = this._parseFFmpegDevices(output);

          this.logger.log(`Found cameras: ${JSON.stringify(videoDevices)}`);
          this.availableCameras = videoDevices;
          resolve(videoDevices);
        } catch (parseError) {
          this.logger.error(`Error parsing cameras: ${parseError.message}`);
          resolve([]);
        }
      });
    });
  }

  /**
   * Parse FFmpeg device list output
   * @param {string} output - FFmpeg output
   * @returns {Array} Array of video devices
   * @private
   */
  _parseFFmpegDevices(output) {
    const videoDevices = [];
    const lines = output.split('\n');
    let inVideoDevices = false;

    for (const line of lines) {
      if (line.includes('[dshow @')) {
        if (line.includes('DirectShow video devices')) {
          inVideoDevices = true;
        } else if (line.includes('DirectShow audio devices')) {
          inVideoDevices = false;
        } else if (line.includes('(video)')) {
          const match = line.match(/"([^"]+)"/);
          if (match) {
            videoDevices.push({
              name: match[1],
              isOBS: match[1].toLowerCase().includes('obs virtual camera')
            });
          }
        }
      } else if (inVideoDevices && line.includes('"')) {
        const match = line.match(/"([^"]+)"/);
        if (match) {
          videoDevices.push({
            name: match[1],
            isOBS: match[1].toLowerCase().includes('obs virtual camera')
          });
        }
      }
    }

    return videoDevices;
  }

  /**
   * Update all available sources
   * @param {Function} onSourcesUpdated - Callback for when sources are updated
   * @returns {Promise<Object>} Updated sources
   */
  async updateAvailableSources(onSourcesUpdated = null) {
    try {
      const [windows, cameras] = await Promise.all([
        this.getAvailableWindows(),
        this.getAvailableCameras()
      ]);

      const sources = { windows, cameras };

      if (onSourcesUpdated) {
        onSourcesUpdated(sources);
      }

      this.logger.log(`Found ${windows.length} windows and ${cameras.length} cameras`);
      return sources;
    } catch (error) {
      this.logger.error(`Error updating sources: ${error.message}`);
      return { windows: [], cameras: [] };
    }
  }

  /**
   * Get current available sources
   * @returns {Object} Current sources
   */
  getCurrentSources() {
    return {
      windows: this.availableWindows,
      cameras: this.availableCameras
    };
  }

  /**
   * Validate window selection
   * @param {string} windowTitle - Window title to validate
   * @returns {boolean} True if window is available
   */
  isWindowAvailable(windowTitle) {
    return this.availableWindows.some(window => window.title === windowTitle);
  }

  /**
   * Validate camera selection
   * @param {string} cameraName - Camera name to validate
   * @returns {boolean} True if camera is available
   */
  isCameraAvailable(cameraName) {
    return this.availableCameras.some(camera => camera.name === cameraName);
  }
}

module.exports = SourceService;