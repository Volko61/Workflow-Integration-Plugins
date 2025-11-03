/**
 * Centralized configuration and constants
 */

const path = require('path');

const CONFIG = {
  PLUGIN_ID: 'com.blackmagicdesign.resolve.screenrecorder',
  RECORDINGS_DIR: path.resolve(require('electron').app.getPath('videos'), 'ResolveRecordings'),

  SHORTCUTS: {
    START: 'CommandOrControl+Shift+R',
    STOP: 'CommandOrControl+Shift+S',
    TOGGLE: 'CommandOrControl+Shift+Space'
  },

  FFMEG_PATHS: [
    'ffmpeg',
    path.join(__dirname, 'ffmpeg.exe'),
    path.join(__dirname, 'bin', 'ffmpeg.exe')
  ],

  RECORDING: {
    MAX_FALLBACK_ATTEMPTS: 3,
    FORCE_KILL_TIMEOUT: 3000,
    MIN_REGION_SIZE: 16,
    DEFAULT_FRAMERATE: '30',
    DEFAULT_RESOLUTION: '1920x1080',
    CAMERA_RESOLUTIONS: {
      OBS: { width: 1280, height: 720, framerate: 60 },
      DEFAULT: { width: 1920, height: 1080, framerate: 30 }
    },
    ENCODING: {
      CODEC: 'libx264',
      PRESET: 'ultrafast',
      CRF: 22,
      PIXEL_FORMAT: 'yuv420p'
    }
  },

  UI: {
    WINDOW_WIDTH: 800,
    WINDOW_HEIGHT: 600,
    SOURCES_UPDATE_INTERVAL: 30000,
    INITIAL_UPDATE_DELAY: 2000,
    STATUS_MESSAGE_DURATION: 2000
  },

  POWER_SHELL: {
    GET_WINDOWS: `Get-Process | Where-Object {$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne ''} | Select-Object ProcessName, MainWindowTitle, Id | ConvertTo-Json -Depth 2`
  }
};

module.exports = CONFIG;