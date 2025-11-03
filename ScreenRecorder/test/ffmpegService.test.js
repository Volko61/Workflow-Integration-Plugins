/**
 * FFmpeg service tests
 */

const FFmpegService = require('../services/ffmpegService');

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

const mockSpawn = require('child_process').spawn;

describe('FFmpegService', () => {
  let ffmpegService;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      log: jest.fn(),
      error: jest.fn()
    };
    ffmpegService = new FFmpegService(mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getFFmpegPath', () => {
    it('should return the first FFmpeg path', () => {
      const path = ffmpegService.getFFmpegPath();
      expect(path).toBe('ffmpeg');
    });
  });

  describe('checkFFmpegAvailability', () => {
    it('should return true when FFmpeg is available', async () => {
      const mockProcess = {
        on: jest.fn((event, callback) => {
          if (event === 'close') callback(0);
        })
      };
      mockSpawn.mockReturnValue(mockProcess);

      const result = await ffmpegService.checkFFmpegAvailability();
      expect(result).toBe(true);
    });

    it('should return false when FFmpeg is not available', async () => {
      const mockProcess = {
        on: jest.fn((event, callback) => {
          if (event === 'close') callback(1);
        })
      };
      mockSpawn.mockReturnValue(mockProcess);

      const result = await ffmpegService.checkFFmpegAvailability();
      expect(result).toBe(false);
    });
  });

  describe('generateFFmpegArgs', () => {
    it('should generate desktop recording args', () => {
      const options = { sourceType: 'desktop', framerate: '30' };
      const args = ffmpegService.generateFFmpegArgs(options);

      expect(args).toContain('-f', 'gdigrab');
      expect(args).toContain('-framerate', '30');
      expect(args).toContain('-i', 'desktop');
      expect(args).toContain('-c:v', 'libx264');
    });

    it('should generate window recording args', () => {
      const options = { sourceType: 'window', windowTitle: 'Test Window', framerate: '30' };
      const args = ffmpegService.generateFFmpegArgs(options);

      expect(args).toContain('-f', 'gdigrab');
      expect(args).toContain('-i', 'title=Test Window');
    });

    it('should generate camera recording args', () => {
      const options = { sourceType: 'camera', cameraName: 'Test Camera', framerate: '30' };
      const args = ffmpegService.generateFFmpegArgs(options);

      expect(args).toContain('-f', 'dshow');
      expect(args).toContain('-i', expect.stringContaining('video="Test Camera"'));
    });

    it('should generate region recording args', () => {
      const options = { sourceType: 'desktop', framerate: '30' };
      const region = { x: 100, y: 200, width: 800, height: 600 };
      const args = ffmpegService.generateFFmpegArgs(options, region);

      expect(args).toContain('-video_size', '800x600');
      expect(args).toContain('-offset_x', '100');
      expect(args).toContain('-offset_y', '200');
    });

    it('should add resolution scaling when specified', () => {
      const options = { sourceType: 'desktop', resolution: '1280x720' };
      const args = ffmpegService.generateFFmpegArgs(options);

      expect(args).toContain('-vf', 'scale=1280x720');
    });
  });

  describe('generateCameraFallbackCommands', () => {
    it('should generate OBS camera command', () => {
      const options = { cameraName: 'OBS Virtual Camera', resolution: '1920x1080' };
      const commands = ffmpegService._generateCameraFallbackCommands(options, '/test/output.mp4');

      expect(commands).toHaveLength(1);
      expect(commands[0]).toContain('framerate 60');
      expect(commands[0]).toContain('scale=1920x1080');
    });

    it('should generate regular camera fallback commands', () => {
      const options = { cameraName: 'Regular Camera', resolution: '1280x720' };
      const commands = ffmpegService._generateCameraFallbackCommands(options, '/test/output.mp4');

      expect(commands).toHaveLength(3);
      expect(commands[0]).toContain('video_size 1920x1080');
      expect(commands[1]).not.toContain('video_size');
      expect(commands[2]).toContain('video_size 1280x720');
    });
  });

  describe('getState', () => {
    it('should return initial state', () => {
      const state = ffmpegService.getState();
      expect(state).toEqual({
        isRecording: false,
        currentRecordingPath: null,
        hasProcess: false
      });
    });

    it('should return updated state during recording', () => {
      ffmpegService.isRecording = true;
      ffmpegService.currentRecordingPath = '/test/recording.mp4';
      ffmpegService.recordingProcess = { pid: 123 };

      const state = ffmpegService.getState();
      expect(state).toEqual({
        isRecording: true,
        currentRecordingPath: '/test/recording.mp4',
        hasProcess: true
      });
    });
  });

  describe('_isShellProcess', () => {
    it('should identify shell processes', () => {
      const shellProcess = {
        spawnargs: ['shell'],
        spawnfile: 'cmd.exe'
      };
      expect(ffmpegService._isShellProcess(shellProcess)).toBe(true);
    });

    it('should identify regular processes', () => {
      const regularProcess = {
        spawnargs: ['ffmpeg'],
        spawnfile: 'ffmpeg.exe'
      };
      expect(ffmpegService._isShellProcess(regularProcess)).toBe(false);
    });
  });

  describe('_resetRecordingState', () => {
    it('should reset all recording state', () => {
      ffmpegService.isRecording = true;
      ffmpegService.currentRecordingPath = '/test.mp4';
      ffmpegService.recordingProcess = { pid: 123 };
      ffmpegService.forceKillTimeout = setTimeout(() => {}, 1000);

      ffmpegService._resetRecordingState();

      expect(ffmpegService.isRecording).toBe(false);
      expect(ffmpegService.currentRecordingPath).toBe(null);
      expect(ffmpegService.recordingProcess).toBe(null);
      expect(ffmpegService.forceKillTimeout).toBe(null);
    });
  });
});