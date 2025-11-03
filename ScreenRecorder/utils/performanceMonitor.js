/**
 * Performance monitoring utility
 */

class PerformanceMonitor {
  constructor(logger) {
    this.logger = logger;
    this.metrics = new Map();
    this.timers = new Map();
    this.thresholds = {
      memoryUsage: 500 * 1024 * 1024, // 500MB
      cpuUsage: 80, // 80%
      responseTime: 5000 // 5 seconds
    };
  }

  /**
   * Start timing an operation
   * @param {string} operation - Operation name
   * @param {Object} metadata - Additional metadata
   */
  startTimer(operation, metadata = {}) {
    const timerId = `${operation}_${Date.now()}`;
    this.timers.set(timerId, {
      operation,
      startTime: process.hrtime.bigint(),
      startMemory: process.memoryUsage(),
      metadata
    });
    return timerId;
  }

  /**
   * End timing an operation
   * @param {string} timerId - Timer ID from startTimer
   * @param {Object} additionalData - Additional data to record
   * @returns {Object} Performance metrics
   */
  endTimer(timerId, additionalData = {}) {
    const timer = this.timers.get(timerId);
    if (!timer) {
      this.logger.warn(`Timer not found: ${timerId}`);
      return null;
    }

    const endTime = process.hrtime.bigint();
    const endMemory = process.memoryUsage();
    const duration = Number(endTime - timer.startTime) / 1000000; // Convert to milliseconds

    const metrics = {
      operation: timer.operation,
      duration: Math.round(duration),
      memoryDelta: {
        rss: endMemory.rss - timer.startMemory.rss,
        heapUsed: endMemory.heapUsed - timer.startMemory.heapUsed,
        heapTotal: endMemory.heapTotal - timer.startMemory.heapTotal
      },
      metadata: { ...timer.metadata, ...additionalData },
      timestamp: new Date().toISOString()
    };

    this.recordMetrics(timer.operation, metrics);
    this.timers.delete(timerId);

    // Check performance thresholds
    this.checkThresholds(metrics);

    return metrics;
  }

  /**
   * Record performance metrics
   * @param {string} operation - Operation name
   * @param {Object} metrics - Metrics to record
   */
  recordMetrics(operation, metrics) {
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, []);
    }

    const operationMetrics = this.metrics.get(operation);
    operationMetrics.push(metrics);

    // Keep only last 100 entries per operation
    if (operationMetrics.length > 100) {
      operationMetrics.shift();
    }
  }

  /**
   * Check performance thresholds and log warnings
   * @param {Object} metrics - Metrics to check
   */
  checkThresholds(metrics) {
    // Check response time
    if (metrics.duration > this.thresholds.responseTime) {
      this.logger.warn(`Slow operation detected: ${metrics.operation} took ${metrics.duration}ms`);
    }

    // Check memory usage
    const currentMemory = process.memoryUsage();
    if (currentMemory.heapUsed > this.thresholds.memoryUsage) {
      this.logger.warn(`High memory usage: ${Math.round(currentMemory.heapUsed / 1024 / 1024)}MB`);
    }

    // Check memory leaks
    if (metrics.memoryDelta.heapUsed > 50 * 1024 * 1024) { // 50MB increase
      this.logger.warn(`Potential memory leak in ${metrics.operation}: ${Math.round(metrics.memoryDelta.heapUsed / 1024 / 1024)}MB increase`);
    }
  }

  /**
   * Get performance statistics for an operation
   * @param {string} operation - Operation name
   * @returns {Object} Performance statistics
   */
  getStats(operation) {
    const operationMetrics = this.metrics.get(operation) || [];

    if (operationMetrics.length === 0) {
      return null;
    }

    const durations = operationMetrics.map(m => m.duration);
    const memoryDeltas = operationMetrics.map(m => m.memoryDelta.heapUsed);

    return {
      operation,
      count: operationMetrics.length,
      duration: {
        avg: this.average(durations),
        min: Math.min(...durations),
        max: Math.max(...durations),
        median: this.median(durations)
      },
      memoryDelta: {
        avg: Math.round(this.average(memoryDeltas)),
        min: Math.min(...memoryDeltas),
        max: Math.max(...memoryDeltas),
        median: Math.round(this.median(memoryDeltas))
      },
      lastUpdated: operationMetrics[operationMetrics.length - 1].timestamp
    };
  }

  /**
   * Get all performance statistics
   * @returns {Object} All performance statistics
   */
  getAllStats() {
    const allStats = {};
    for (const operation of this.metrics.keys()) {
      allStats[operation] = this.getStats(operation);
    }
    return allStats;
  }

  /**
   * Get system performance information
   * @returns {Object} System performance info
   */
  getSystemInfo() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024) // MB
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      uptime: process.uptime(),
      pid: process.pid
    };
  }

  /**
   * Log performance summary
   */
  logPerformanceSummary() {
    const allStats = this.getAllStats();
    const systemInfo = this.getSystemInfo();

    this.logger.info('=== Performance Summary ===');
    this.logger.info(`System - Memory: ${systemInfo.memory.heapUsed}MB, Uptime: ${Math.round(systemInfo.uptime)}s`);

    for (const [operation, stats] of Object.entries(allStats)) {
      this.logger.info(
        `${operation}: ${stats.count} calls, ` +
        `avg duration: ${Math.round(stats.duration.avg)}ms, ` +
        `avg memory delta: ${Math.round(stats.memoryDelta.avg / 1024 / 1024)}MB`
      );
    }
  }

  /**
   * Clear all metrics
   */
  clearMetrics() {
    this.metrics.clear();
    this.timers.clear();
    this.logger.info('Performance metrics cleared');
  }

  /**
   * Calculate average of array of numbers
   * @param {Array} numbers - Array of numbers
   * @returns {number} Average
   */
  average(numbers) {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
  }

  /**
   * Calculate median of array of numbers
   * @param {Array} numbers - Array of numbers
   * @returns {number} Median
   */
  median(numbers) {
    if (numbers.length === 0) return 0;

    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[middle - 1] + sorted[middle]) / 2;
    } else {
      return sorted[middle];
    }
  }

  /**
   * Create a performance monitor wrapper for any function
   * @param {Function} fn - Function to monitor
   * @param {string} operation - Operation name
   * @returns {Function} Wrapped function
   */
  monitorFunction(fn, operation) {
    return async (...args) => {
      const timerId = this.startTimer(operation, { argsCount: args.length });
      try {
        const result = await fn(...args);
        this.endTimer(timerId, { success: true });
        return result;
      } catch (error) {
        this.endTimer(timerId, { success: false, error: error.message });
        throw error;
      }
    };
  }

  /**
   * Set performance thresholds
   * @param {Object} thresholds - New thresholds
   */
  setThresholds(thresholds) {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  /**
   * Export metrics to JSON
   * @returns {string} JSON string of metrics
   */
  exportMetrics() {
    return JSON.stringify({
      stats: this.getAllStats(),
      systemInfo: this.getSystemInfo(),
      thresholds: this.thresholds,
      timestamp: new Date().toISOString()
    }, null, 2);
  }
}

module.exports = PerformanceMonitor;