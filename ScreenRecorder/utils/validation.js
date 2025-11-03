/**
 * Input validation utilities
 */

class Validator {
  /**
   * Validate recording options
   * @param {Object} options - Recording options to validate
   * @returns {Object} Validation result
   */
  static validateRecordingOptions(options) {
    const errors = [];

    if (!options) {
      errors.push('Recording options are required');
      return { valid: false, errors };
    }

    // Validate framerate
    if (options.framerate) {
      const framerate = parseInt(options.framerate);
      if (isNaN(framerate) || framerate < 1 || framerate > 120) {
        errors.push('Framerate must be between 1 and 120');
      }
    }

    // Validate resolution
    if (options.resolution && options.resolution !== 'desktop') {
      const resolutionPattern = /^\d+x\d+$/;
      if (!resolutionPattern.test(options.resolution)) {
        errors.push('Resolution must be in format WIDTHxHEIGHT (e.g., 1920x1080)');
      } else {
        const [width, height] = options.resolution.split('x').map(Number);
        if (width < 320 || height < 240 || width > 7680 || height > 4320) {
          errors.push('Resolution must be between 320x240 and 7680x4320');
        }
      }
    }

    // Validate source type
    const validSourceTypes = ['desktop', 'window', 'camera'];
    if (options.sourceType && !validSourceTypes.includes(options.sourceType)) {
      errors.push(`Source type must be one of: ${validSourceTypes.join(', ')}`);
    }

    // Validate region
    const validRegions = ['desktop', 'window', 'camera', 'selection'];
    if (options.region && !validRegions.includes(options.region)) {
      errors.push(`Region must be one of: ${validRegions.join(', ')}`);
    }

    // Validate window title for window recording
    if (options.sourceType === 'window' && !options.windowTitle) {
      errors.push('Window title is required for window recording');
    }

    // Validate camera name for camera recording
    if (options.sourceType === 'camera' && !options.cameraName) {
      errors.push('Camera name is required for camera recording');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate region selection
   * @param {Object} region - Region to validate
   * @param {number} minSize - Minimum allowed size
   * @returns {Object} Validation result
   */
  static validateRegion(region, minSize = 16) {
    const errors = [];

    if (!region) {
      return { valid: true, errors: [] }; // null region means full screen
    }

    // Check required properties
    const requiredProps = ['x', 'y', 'width', 'height'];
    for (const prop of requiredProps) {
      if (typeof region[prop] !== 'number' || isNaN(region[prop])) {
        errors.push(`Region ${prop} must be a valid number`);
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    // Validate values
    if (region.width < minSize) {
      errors.push(`Region width must be at least ${minSize} pixels`);
    }

    if (region.height < minSize) {
      errors.push(`Region height must be at least ${minSize} pixels`);
    }

    if (region.x < 0) {
      errors.push('Region X coordinate cannot be negative');
    }

    if (region.y < 0) {
      errors.push('Region Y coordinate cannot be negative');
    }

    // Check for reasonable maximum values (8K resolution)
    if (region.width > 7680) {
      errors.push('Region width cannot exceed 7680 pixels');
    }

    if (region.height > 4320) {
      errors.push('Region height cannot exceed 4320 pixels');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate file path
   * @param {string} filePath - File path to validate
   * @returns {Object} Validation result
   */
  static validateFilePath(filePath) {
    const errors = [];

    if (!filePath || typeof filePath !== 'string') {
      errors.push('File path must be a non-empty string');
      return { valid: false, errors };
    }

    // Check for invalid characters (Windows)
    const invalidChars = /[<>:"|?*]/;
    if (invalidChars.test(filePath)) {
      errors.push('File path contains invalid characters');
    }

    // Check for reasonable length
    if (filePath.length > 260) {
      errors.push('File path is too long (max 260 characters)');
    }

    // Check extension
    if (!filePath.toLowerCase().endsWith('.mp4')) {
      errors.push('File must have .mp4 extension');
    }

    // Check directory traversal attempts
    if (filePath.includes('..') || filePath.includes('~')) {
      errors.push('File path contains invalid directory references');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate window information
   * @param {Object} window - Window information to validate
   * @returns {Object} Validation result
   */
  static validateWindowInfo(window) {
    const errors = [];

    if (!window || typeof window !== 'object') {
      errors.push('Window information must be an object');
      return { valid: false, errors };
    }

    if (!window.title || typeof window.title !== 'string') {
      errors.push('Window title is required and must be a string');
    }

    if (window.title.length > 255) {
      errors.push('Window title is too long (max 255 characters)');
    }

    if (window.name && typeof window.name !== 'string') {
      errors.push('Window name must be a string');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate camera information
   * @param {Object} camera - Camera information to validate
   * @returns {Object} Validation result
   */
  static validateCameraInfo(camera) {
    const errors = [];

    if (!camera || typeof camera !== 'object') {
      errors.push('Camera information must be an object');
      return { valid: false, errors };
    }

    if (!camera.name || typeof camera.name !== 'string') {
      errors.push('Camera name is required and must be a string');
    }

    if (camera.name.length > 255) {
      errors.push('Camera name is too long (max 255 characters)');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Sanitize string input
   * @param {string} input - Input to sanitize
   * @param {number} maxLength - Maximum allowed length
   * @returns {string} Sanitized string
   */
  static sanitizeString(input, maxLength = 255) {
    if (!input || typeof input !== 'string') {
      return '';
    }

    return input
      .trim()
      .replace(/[<>:"|?*]/g, '') // Remove invalid characters
      .substring(0, maxLength)
      .replace(/\s+/g, ' '); // Normalize whitespace
  }

  /**
   * Validate and sanitize recording settings
   * @param {Object} settings - Settings to validate and sanitize
   * @returns {Object} Validation result with sanitized settings
   */
  static validateAndSanitizeSettings(settings) {
    const errors = [];
    const sanitized = {};

    if (!settings || typeof settings !== 'object') {
      errors.push('Settings must be an object');
      return { valid: false, errors, sanitized: {} };
    }

    // Validate and sanitize each setting
    if (settings.framerate !== undefined) {
      const framerate = parseInt(settings.framerate);
      if (isNaN(framerate) || framerate < 1 || framerate > 120) {
        errors.push('Invalid framerate');
      } else {
        sanitized.framerate = framerate.toString();
      }
    }

    if (settings.resolution !== undefined) {
      if (settings.resolution === 'desktop') {
        sanitized.resolution = 'desktop';
      } else if (/^\d+x\d+$/.test(settings.resolution)) {
        sanitized.resolution = settings.resolution;
      } else {
        errors.push('Invalid resolution format');
      }
    }

    if (settings.region !== undefined) {
      const validRegions = ['desktop', 'window', 'camera', 'selection'];
      if (validRegions.includes(settings.region)) {
        sanitized.region = settings.region;
      } else {
        errors.push('Invalid region');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitized
    };
  }

  /**
   * Create validation error message
   * @param {Array} errors - Array of error messages
   * @returns {string} Formatted error message
   */
  static formatValidationErrors(errors) {
    if (!errors || errors.length === 0) {
      return '';
    }

    if (errors.length === 1) {
      return errors[0];
    }

    return `Multiple errors occurred:\n• ${errors.join('\n• ')}`;
  }
}

module.exports = Validator;