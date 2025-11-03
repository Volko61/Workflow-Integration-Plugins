/**
 * Region selector utility tests
 */

const RegionSelector = require('../utils/regionSelector');

// Mock electron modules
jest.mock('electron', () => ({
  ipcMain: {
    once: jest.fn(),
    removeListener: jest.fn()
  },
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadURL: jest.fn(),
    on: jest.fn(),
    close: jest.fn()
  })),
  screen: {
    getPrimaryDisplay: jest.fn(() => ({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1
    }))
  }
}));

describe('RegionSelector', () => {
  let regionSelector;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      log: jest.fn(),
      error: jest.fn()
    };
    regionSelector = new RegionSelector(mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateRegion', () => {
    it('should return null for null region', () => {
      const result = regionSelector.validateRegion(null);
      expect(result).toBeNull();
    });

    it('should pass valid region through unchanged', () => {
      const region = { x: 100, y: 200, width: 800, height: 600 };
      const result = regionSelector.validateRegion(region);
      expect(result).toEqual(region);
    });

    it('should adjust odd dimensions to even', () => {
      const region = { x: 100, y: 200, width: 801, height: 603 };
      const result = regionSelector.validateRegion(region);
      expect(result).toEqual({
        x: 100,
        y: 200,
        width: 800, // 801 -> 800
        height: 602 // 603 -> 602
      });
    });

    it('should throw error for region too small', () => {
      const region = { x: 100, y: 200, width: 10, height: 10 };
      expect(() => regionSelector.validateRegion(region)).toThrow(
        'Selected region is too small (10x10). Minimum size is 16x16 pixels.'
      );
    });

    it('should log dimension adjustments', () => {
      const region = { x: 100, y: 200, width: 801, height: 603 };
      regionSelector.validateRegion(region);
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Adjusted region from 801x603 to 800x602 (H.264 requires even dimensions)'
      );
    });
  });

  describe('_generateSelectionHTML', () => {
    it('should generate valid HTML with screen parameters', () => {
      const html = regionSelector._generateSelectionHTML(0, 0, 1);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('const screenX = 0');
      expect(html).toContain('const screenY = 0');
      expect(html).toContain('const scaleFactor = 1');
      expect(html).toContain('const MIN_SIZE = 16');
    });

    it('should include selection interface elements', () => {
      const html = regionSelector._generateSelectionHTML(0, 0, 1);
      expect(html).toContain('id="selection-box"');
      expect(html).toContain('id="instructions"');
      expect(html).toContain('id="controls"');
      expect(html).toContain('selectRegion()');
      expect(html).toContain('recordFull()');
    });

    it('should include event handlers', () => {
      const html = regionSelector._generateSelectionHTML(0, 0, 1);
      expect(html).toContain('addEventListener(\'mousedown\'');
      expect(html).toContain('addEventListener(\'mousemove\'');
      expect(html).toContain('addEventListener(\'mouseup\'');
      expect(html).toContain('addEventListener(\'keydown\'');
    });
  });

  describe('_createRegionWindow', () => {
    it('should create window with correct parameters', () => {
      const { BrowserWindow } = require('electron');
      const mockWindow = { loadURL: jest.fn(), on: jest.fn() };
      BrowserWindow.mockImplementation(() => mockWindow);

      regionSelector._createRegionWindow(100, 200, 1920, 1080);

      expect(BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 1920,
          height: 1080,
          x: 100,
          y: 200,
          frame: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          transparent: false,
          backgroundColor: '#00000030',
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
          }
        })
      );
    });
  });

  describe('_setupRegionHandlers', () => {
    it('should setup IPC handlers and window events', () => {
      const { ipcMain } = require('electron');
      const mockWindow = { close: jest.fn(), on: jest.fn() };
      const mockResolve = jest.fn();
      const mockReject = jest.fn();

      regionSelector._setupRegionHandlers(mockWindow, mockResolve, mockReject);

      expect(ipcMain.once).toHaveBeenCalledWith('region-selected', expect.any(Function));
      expect(mockWindow.on).toHaveBeenCalledWith('closed', expect.any(Function));
    });
  });
});