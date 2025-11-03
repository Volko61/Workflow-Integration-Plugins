/**
 * File system utilities tests
 */

const fs = require('fs');
const path = require('path');
const FileSystemUtils = require('../utils/fileSystem');

// Mock app.getPath
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mock/videos')
  }
}));

describe('FileSystemUtils', () => {
  const testDir = '/mock/test-recordings';

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock fs.existsSync
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    jest.spyOn(fs, 'mkdirSync').mockImplementation();
    jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024, mtime: new Date() });
    jest.spyOn(fs, 'readdirSync').mockReturnValue(['test1.mp4', 'test2.txt', 'test3.mp4']);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('ensureRecordingsDir', () => {
    it('should create directory if it does not exist', () => {
      FileSystemUtils.ensureRecordingsDir();
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('ResolveRecordings'),
        { recursive: true }
      );
    });

    it('should not create directory if it exists', () => {
      fs.existsSync.mockReturnValue(true);
      FileSystemUtils.ensureRecordingsDir();
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('generateRecordingFilename', () => {
    it('should generate filename with timestamp', () => {
      const filename = FileSystemUtils.generateRecordingFilename();
      expect(filename).toMatch(/^screen-recording-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.mp4$/);
    });

    it('should accept custom extension', () => {
      const filename = FileSystemUtils.generateRecordingFilename('.avi');
      expect(filename).toMatch(/\.avi$/);
    });
  });

  describe('getRecordingPath', () => {
    it('should return full path with provided filename', () => {
      const path = FileSystemUtils.getRecordingPath('test.mp4');
      expect(path).toContain('ResolveRecordings/test.mp4');
    });

    it('should generate filename if not provided', () => {
      const path = FileSystemUtils.getRecordingPath();
      expect(path).toContain('ResolveRecordings/screen-recording-');
    });
  });

  describe('fileExistsWithContent', () => {
    it('should return true for existing file with content', () => {
      fs.statSync.mockReturnValue({ size: 1024 });
      expect(FileSystemUtils.fileExistsWithContent('/test/file.mp4')).toBe(true);
    });

    it('should return false for non-existent file', () => {
      fs.statSync.mockImplementation(() => {
        throw new Error('File not found');
      });
      expect(FileSystemUtils.fileExistsWithContent('/test/nonexistent.mp4')).toBe(false);
    });

    it('should return false for empty file', () => {
      fs.statSync.mockReturnValue({ size: 0 });
      expect(FileSystemUtils.fileExistsWithContent('/test/empty.mp4')).toBe(false);
    });
  });

  describe('listRecordings', () => {
    it('should return list of MP4 files sorted by modification time', () => {
      const recordings = FileSystemUtils.listRecordings();
      expect(recordings).toHaveLength(2); // Only .mp4 files
      expect(recordings[0].name).toBe('test1.mp4');
      expect(recordings[1].name).toBe('test3.mp4');
    });

    it('should handle empty directory', () => {
      fs.readdirSync.mockReturnValue([]);
      const recordings = FileSystemUtils.listRecordings();
      expect(recordings).toHaveLength(0);
    });

    it('should handle errors gracefully', () => {
      fs.readdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      const recordings = FileSystemUtils.listRecordings();
      expect(recordings).toHaveLength(0);
    });
  });
});