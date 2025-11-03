/**
 * Centralized error handling utility
 */

class ErrorHandler {
  constructor(logger) {
    this.logger = logger;
    this.errorCounts = new Map();
    this.maxRetries = 3;
    this.retryDelays = [1000, 2000, 5000]; // Progressive delays
  }

  /**
   * Handle error with retry logic
   * @param {Error} error - The error that occurred
   * @param {string} context - Context where error occurred
   * @param {Function} retryFunction - Function to retry
   * @param {Object} options - Retry options
   * @returns {Promise} Retry result
   */
  async handleWithRetry(error, context, retryFunction, options = {}) {
    const errorKey = `${context}:${error.message}`;
    const currentCount = this.errorCounts.get(errorKey) || 0;

    if (currentCount >= (options.maxRetries || this.maxRetries)) {
      this.logger.error(`Max retries exceeded for ${context}: ${error.message}`);
      this.errorCounts.delete(errorKey);
      throw new Error(`Failed after ${currentCount} retries: ${error.message}`);
    }

    this.errorCounts.set(errorKey, currentCount + 1);
    const delay = this.retryDelays[Math.min(currentCount, this.retryDelays.length - 1)];

    this.logger.warn(`Retry ${currentCount + 1}/${this.maxRetries} for ${context} in ${delay}ms: ${error.message}`);

    await this.delay(delay);
    return retryFunction();
  }

  /**
   * Handle and categorize errors
   * @param {Error} error - Error to handle
   * @param {string} context - Context where error occurred
   * @returns {Object} Error handling result
   */
  handleError(error, context) {
    const errorInfo = {
      message: error.message,
      context,
      timestamp: new Date().toISOString(),
      recoverable: this.isRecoverableError(error),
      category: this.categorizeError(error)
    };

    this.logger.error(`[${errorInfo.category}] ${context}: ${error.message}`, error);

    // Clean up error counts for recoverable errors
    if (errorInfo.recoverable) {
      this.cleanupErrorCounts(context);
    }

    return errorInfo;
  }

  /**
   * Check if error is recoverable
   * @param {Error} error - Error to check
   * @returns {boolean} True if error is recoverable
   */
  isRecoverableError(error) {
    const recoverablePatterns = [
      /ECONNREFUSED/i,
      /ETIMEDOUT/i,
      /ENOTFOUND/i,
      /temporary failure/i,
      /device in use/i,
      /camera is busy/i
    ];

    return recoverablePatterns.some(pattern => pattern.test(error.message));
  }

  /**
   * Categorize error type
   * @param {Error} error - Error to categorize
   * @returns {string} Error category
   */
  categorizeError(error) {
    if (error.message.includes('FFmpeg')) return 'FFMPEG_ERROR';
    if (error.message.includes('camera') || error.message.includes('video')) return 'CAMERA_ERROR';
    if (error.message.includes('window') || error.message.includes('screen')) return 'SCREEN_ERROR';
    if (error.message.includes('Resolve') || error.message.includes('timeline')) return 'RESOLVE_ERROR';
    if (error.message.includes('file') || error.message.includes('directory')) return 'FILE_ERROR';
    if (error.message.includes('permission') || error.message.includes('access')) return 'PERMISSION_ERROR';
    return 'UNKNOWN_ERROR';
  }

  /**
   * Create user-friendly error message
   * @param {Object} errorInfo - Error information
   * @returns {string} User-friendly message
   */
  createUserMessage(errorInfo) {
    const messages = {
      FFMPEG_ERROR: 'Recording failed due to FFmpeg error. Please check FFmpeg installation.',
      CAMERA_ERROR: 'Camera access failed. Please check if camera is available and not in use by another application.',
      SCREEN_ERROR: 'Screen capture failed. Please check display permissions.',
      RESOLVE_ERROR: 'DaVinci Resolve integration failed. Please ensure Resolve is running and a project is open.',
      FILE_ERROR: 'File operation failed. Please check disk space and permissions.',
      PERMISSION_ERROR: 'Permission denied. Please run the application with appropriate permissions.',
      UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.'
    };

    return messages[errorInfo.category] || messages.UNKNOWN_ERROR;
  }

  /**
   * Clean up error counts for a context
   * @param {string} context - Context to clean up
   */
  cleanupErrorCounts(context) {
    for (const [key] of this.errorCounts) {
      if (key.startsWith(context)) {
        this.errorCounts.delete(key);
      }
    }
  }

  /**
   * Clear all error counts
   */
  clearAllErrorCounts() {
    this.errorCounts.clear();
  }

  /**
   * Get error statistics
   * @returns {Object} Error statistics
   */
  getErrorStats() {
    const stats = {};
    for (const [key, count] of this.errorCounts) {
      const [context] = key.split(':');
      stats[context] = (stats[context] || 0) + count;
    }
    return stats;
  }

  /**
   * Delay execution for specified milliseconds
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise} Delay promise
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create safe function wrapper with error handling
   * @param {Function} fn - Function to wrap
   * @param {string} context - Context for error handling
   * @returns {Function} Wrapped function
   */
  safeFunction(fn, context) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        const errorInfo = this.handleError(error, context);
        throw new Error(this.createUserMessage(errorInfo));
      }
    };
  }
}

module.exports = ErrorHandler;