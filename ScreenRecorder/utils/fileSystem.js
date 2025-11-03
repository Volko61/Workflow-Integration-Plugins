/**
 * File system utilities
 */

const fs = require('fs');
const path = require('path');
const CONFIG = require('../config/constants');

class FileSystemUtils {
  /**
   * Ensure recordings directory exists
   */
  static ensureRecordingsDir() {
    if (!fs.existsSync(CONFIG.RECORDINGS_DIR)) {
      fs.mkdirSync(CONFIG.RECORDINGS_DIR, { recursive: true });
    }
  }

  /**
   * Generate unique recording filename with timestamp
   * @param {string} extension - File extension (default: .mp4)
   * @returns {string} Generated filename
   */
  static generateRecordingFilename(extension = '.mp4') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `screen-recording-${timestamp}${extension}`;
  }

  /**
   * Get full path for recording file
   * @param {string} filename - Filename (optional)
   * @returns {string} Full file path
   */
  static getRecordingPath(filename = null) {
    const finalFilename = filename || this.generateRecordingFilename();
    return path.join(CONFIG.RECORDINGS_DIR, finalFilename);
  }

  /**
   * Check if file exists and has content
   * @param {string} filePath - Path to file
   * @returns {boolean} True if file exists and has size > 0
   */
  static fileExistsWithContent(filePath) {
    try {
      const stats = fs.statSync(filePath);
      return stats.size > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * List all recordings in the recordings directory
   * @returns {Array} Array of recording objects
   */
  static listRecordings() {
    try {
      this.ensureRecordingsDir();

      if (!fs.existsSync(CONFIG.RECORDINGS_DIR)) {
        return [];
      }

      return fs.readdirSync(CONFIG.RECORDINGS_DIR)
        .filter(file => file.endsWith('.mp4'))
        .map(file => {
          const filePath = path.join(CONFIG.RECORDINGS_DIR, file);
          const stats = fs.statSync(filePath);
          return {
            name: file,
            path: filePath,
            size: stats.size,
            modified: stats.mtime
          };
        })
        .sort((a, b) => b.modified - a.modified);

    } catch (error) {
      console.error(`Failed to list recordings: ${error.message}`);
      return [];
    }
  }
}

module.exports = FileSystemUtils;