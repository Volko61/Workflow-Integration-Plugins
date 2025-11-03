/**
 * Centralized logging utility
 */

const CONFIG = require('../config/constants');

class Logger {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
  }

  /**
   * Log message to both renderer console and main console
   * @param {string} message - Message to log
   * @param {string} type - Log type (log, error, warn, info)
   */
  log(message, type = 'log') {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] ${message}`;

    // Log to main process console
    console[type](formattedMessage);

    // Log to renderer console if window is available
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        const escapedMessage = String(message)
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "\\'")
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r');

        const colorMap = {
          log: '#800',
          error: '#f00',
          warn: '#f80',
          info: '#08f'
        };

        const color = colorMap[type] || '#800';
        this.mainWindow.webContents.executeJavaScript(
          `console.log('%cMAIN:', 'color: ${color}', '${escapedMessage}');`
        );
      } catch (error) {
        console.log('Renderer logging failed:', error.message);
      }
    }
  }

  error(message) {
    this.log(message, 'error');
  }

  warn(message) {
    this.log(message, 'warn');
  }

  info(message) {
    this.log(message, 'info');
  }

  /**
   * Update main window reference
   * @param {BrowserWindow} mainWindow - New main window reference
   */
  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }
}

module.exports = Logger;