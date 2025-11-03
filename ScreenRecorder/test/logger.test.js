/**
 * Logger utility tests
 */

const Logger = require('../utils/logger');

describe('Logger', () => {
  let logger;
  let mockMainWindow;

  beforeEach(() => {
    mockMainWindow = {
      isDestroyed: () => false,
      webContents: {
        executeJavaScript: jest.fn()
      }
    };
    logger = new Logger(mockMainWindow);
  });

  describe('log', () => {
    it('should log message to console', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      logger.log('Test message');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[20'),
        expect.stringContaining('Test message')
      );
      consoleSpy.mockRestore();
    });

    it('should log to renderer when window is available', () => {
      logger.log('Test message');
      expect(mockMainWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining("console.log('%cMAIN:', 'color: #800', 'Test message');")
      );
    });

    it('should handle renderer logging errors gracefully', () => {
      mockMainWindow.webContents.executeJavaScript.mockImplementation(() => {
        throw new Error('Renderer error');
      });
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.log('Test message');

      expect(consoleSpy).toHaveBeenCalledWith('Renderer logging failed:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe('error', () => {
    it('should log error messages', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      logger.error('Error message');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[20'),
        expect.stringContaining('Error message')
      );
      consoleSpy.mockRestore();
    });
  });

  describe('setMainWindow', () => {
    it('should update main window reference', () => {
      const newWindow = { id: 'new-window' };
      logger.setMainWindow(newWindow);
      expect(logger.mainWindow).toBe(newWindow);
    });
  });
});