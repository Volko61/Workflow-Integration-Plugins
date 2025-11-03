/**
 * Source service tests
 */

const SourceService = require('../services/sourceService');

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn()
}));

const mockExec = require('child_process').exec;

describe('SourceService', () => {
  let sourceService;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      log: jest.fn(),
      error: jest.fn()
    };
    sourceService = new SourceService(mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAvailableWindows', () => {
    it('should parse valid PowerShell output', async () => {
      const mockWindows = [
        { ProcessName: 'chrome', MainWindowTitle: 'Chrome Window', Id: 1234 },
        { ProcessName: 'notepad', MainWindowTitle: 'Notepad', Id: 5678 }
      ];

      mockExec.mockImplementation((command, callback) => {
        callback(null, JSON.stringify(mockWindows), '');
      });

      const windows = await sourceService.getAvailableWindows();

      expect(windows).toHaveLength(2);
      expect(windows[0]).toEqual({
        name: 'Chrome Window',
        processName: 'chrome',
        id: 1234,
        title: 'Chrome Window'
      });
    });

    it('should handle empty PowerShell output', async () => {
      mockExec.mockImplementation((command, callback) => {
        callback(null, '', '');
      });

      const windows = await sourceService.getAvailableWindows();
      expect(windows).toHaveLength(0);
    });

    it('should handle PowerShell errors', async () => {
      mockExec.mockImplementation((command, callback) => {
        callback(new Error('PowerShell failed'), '', '');
      });

      const windows = await sourceService.getAvailableWindows();
      expect(windows).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should filter windows without titles', async () => {
      const mockWindows = [
        { ProcessName: 'chrome', MainWindowTitle: 'Chrome Window', Id: 1234 },
        { ProcessName: 'background', MainWindowTitle: '', Id: 5678 },
        { ProcessName: 'system', MainWindowTitle: null, Id: 9012 }
      ];

      mockExec.mockImplementation((command, callback) => {
        callback(null, JSON.stringify(mockWindows), '');
      });

      const windows = await sourceService.getAvailableWindows();
      expect(windows).toHaveLength(1);
      expect(windows[0].name).toBe('Chrome Window');
    });
  });

  describe('getAvailableCameras', () => {
    it('should parse FFmpeg device output', async () => {
      const mockFFmpegOutput = `
[dshow @ 000000] DirectShow video devices (some may be both video and audio devices)
[dshow @ 000000]  "OBS Virtual Camera" (video)
[dshow @ 000000]  "Integrated Webcam" (video)
[dshow @ 000000] DirectShow audio devices
[dshow @ 000000]  "Microphone" (audio)
      `;

      mockExec.mockImplementation((command, callback) => {
        callback(null, '', mockFFmpegOutput);
      });

      const cameras = await sourceService.getAvailableCameras();

      expect(cameras).toHaveLength(2);
      expect(cameras[0]).toEqual({
        name: 'OBS Virtual Camera',
        isOBS: true
      });
      expect(cameras[1]).toEqual({
        name: 'Integrated Webcam',
        isOBS: false
      });
    });

    it('should handle FFmpeg errors', async () => {
      mockExec.mockImplementation((command, callback) => {
        callback(new Error('FFmpeg not found'), '', '');
      });

      const cameras = await sourceService.getAvailableCameras();
      expect(cameras).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle empty device list', async () => {
      const mockFFmpegOutput = `
[dshow @ 000000] DirectShow video devices
[dshow @ 000000] DirectShow audio devices
      `;

      mockExec.mockImplementation((command, callback) => {
        callback(null, '', mockFFmpegOutput);
      });

      const cameras = await sourceService.getAvailableCameras();
      expect(cameras).toHaveLength(0);
    });
  });

  describe('updateAvailableSources', () => {
    it('should update both windows and cameras', async () => {
      // Mock windows
      mockExec.mockImplementation((command, callback) => {
        if (command.includes('powershell')) {
          callback(null, JSON.stringify([{ ProcessName: 'test', MainWindowTitle: 'Test Window', Id: 123 }]), '');
        } else if (command.includes('ffmpeg')) {
          callback(null, '', '[dshow @ 000000] "Test Camera" (video)');
        }
      });

      const onSourcesUpdated = jest.fn();
      const sources = await sourceService.updateAvailableSources(onSourcesUpdated);

      expect(sources.windows).toHaveLength(1);
      expect(sources.cameras).toHaveLength(1);
      expect(onSourcesUpdated).toHaveBeenCalledWith(sources);
    });

    it('should handle update errors gracefully', async () => {
      mockExec.mockImplementation((command, callback) => {
        callback(new Error('Update failed'), '', '');
      });

      const sources = await sourceService.updateAvailableSources();

      expect(sources.windows).toHaveLength(0);
      expect(sources.cameras).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('isWindowAvailable', () => {
    it('should return true for available window', () => {
      sourceService.availableWindows = [
        { title: 'Test Window', name: 'Test Window' }
      ];

      expect(sourceService.isWindowAvailable('Test Window')).toBe(true);
    });

    it('should return false for unavailable window', () => {
      sourceService.availableWindows = [
        { title: 'Other Window', name: 'Other Window' }
      ];

      expect(sourceService.isWindowAvailable('Test Window')).toBe(false);
    });
  });

  describe('isCameraAvailable', () => {
    it('should return true for available camera', () => {
      sourceService.availableCameras = [
        { name: 'Test Camera', isOBS: false }
      ];

      expect(sourceService.isCameraAvailable('Test Camera')).toBe(true);
    });

    it('should return false for unavailable camera', () => {
      sourceService.availableCameras = [
        { name: 'Other Camera', isOBS: false }
      ];

      expect(sourceService.isCameraAvailable('Test Camera')).toBe(false);
    });
  });

  describe('getCurrentSources', () => {
    it('should return current available sources', () => {
      sourceService.availableWindows = [{ title: 'Test Window' }];
      sourceService.availableCameras = [{ name: 'Test Camera' }];

      const sources = sourceService.getCurrentSources();

      expect(sources).toEqual({
        windows: [{ title: 'Test Window' }],
        cameras: [{ name: 'Test Camera' }]
      });
    });
  });
});