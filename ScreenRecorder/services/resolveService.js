/**
 * DaVinci Resolve integration service
 */

const CONFIG = require('../config/constants');

class ResolveService {
  constructor(logger) {
    this.logger = logger;
    this.resolveObj = null;
    this.projectManagerObj = null;
  }

  /**
   * Initialize Resolve interface
   * @returns {Promise<Object|null>} Resolve object or null if failed
   */
  async initializeInterface() {
    try {
      const WorkflowIntegration = require('./WorkflowIntegration.node');
      const isSuccess = await WorkflowIntegration.Initialize(CONFIG.PLUGIN_ID);

      if (!isSuccess) {
        this.logger.error('Failed to initialize Resolve interface!');
        return null;
      }

      const resolveObj = await WorkflowIntegration.GetResolve();
      if (!resolveObj) {
        this.logger.error('Failed to get Resolve object!');
        return null;
      }

      this.logger.log('Resolve interface initialized successfully');
      return resolveObj;
    } catch (error) {
      this.logger.error(`Resolve interface initialization error: ${error.message}`);
      return null;
    }
  }

  /**
   * Get Resolve object (lazy initialization)
   * @returns {Promise<Object|null>} Resolve object
   */
  async getResolve() {
    if (!this.resolveObj) {
      this.resolveObj = await this.initializeInterface();
    }
    return this.resolveObj;
  }

  /**
   * Get project manager object
   * @returns {Promise<Object|null>} Project manager object
   */
  async getProjectManager() {
    if (!this.projectManagerObj) {
      const resolve = await this.getResolve();
      if (resolve) {
        this.projectManagerObj = await resolve.GetProjectManager();
        if (!this.projectManagerObj) {
          this.logger.error('Failed to get ProjectManager object!');
        }
      }
    }
    return this.projectManagerObj;
  }

  /**
   * Get current project object
   * @returns {Promise<Object|null>} Current project object
   */
  async getCurrentProject() {
    const projectManager = await this.getProjectManager();
    if (projectManager) {
      const currentProject = await projectManager.GetCurrentProject();
      if (!currentProject) {
        this.logger.error('Failed to get current project object!');
      }
      return currentProject;
    }
    return null;
  }

  /**
   * Get media pool object
   * @returns {Promise<Object|null>} Media pool object
   */
  async getMediaPool() {
    const project = await this.getCurrentProject();
    if (project) {
      const mediaPool = await project.GetMediaPool();
      if (!mediaPool) {
        this.logger.error('Failed to get MediaPool object!');
      }
      return mediaPool;
    }
    return null;
  }

  /**
   * Get root folder object
   * @returns {Promise<Object|null>} Root folder object
   */
  async getRootFolder() {
    const mediaPool = await this.getMediaPool();
    if (!mediaPool) return null;
    return await mediaPool.GetRootFolder();
  }

  /**
   * Add recording to timeline automatically
   * @param {string} filePath - Path to recording file
   * @returns {Promise<Object>} Timeline addition result
   */
  async addRecordingToTimeline(filePath) {
    try {
      this.logger.log(`Adding recording to timeline: ${filePath}`);

      const resolve = await this.getResolve();
      if (!resolve) {
        return { success: false, error: 'Failed to connect to DaVinci Resolve' };
      }

      const mediaStorage = await resolve.GetMediaStorage();
      if (!mediaStorage) {
        return { success: false, error: 'Failed to get media storage' };
      }

      const mediaPool = await this.getMediaPool();
      if (!mediaPool) {
        return { success: false, error: 'Failed to get media pool' };
      }

      const clips = await mediaStorage.AddItemListToMediaPool([filePath]);
      if (!clips || clips.length === 0) {
        return { success: false, error: 'Failed to import media file' };
      }

      const project = await this.getCurrentProject();
      if (!project) {
        return { success: false, error: 'Failed to get current project' };
      }

      const timelineResult = await this._handleTimelineCreation(mediaPool, project, clips);

      this.logger.log(`Successfully added recording to timeline: ${timelineResult.timelineName}`);
      return {
        success: true,
        timelineName: timelineResult.timelineName,
        createdNewTimeline: timelineResult.createdNewTimeline,
        message: timelineResult.createdNewTimeline ?
          `Recording added to new timeline "${timelineResult.timelineName}"` :
          `Recording added to existing timeline "${timelineResult.timelineName}"`
      };

    } catch (error) {
      this.logger.error(`Error adding recording to timeline: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle timeline creation or addition
   * @param {Object} mediaPool - Media pool object
   * @param {Object} project - Project object
   * @param {Array} clips - Clips to add
   * @returns {Promise<Object>} Timeline result
   * @private
   */
  async _handleTimelineCreation(mediaPool, project, clips) {
    let timeline = await project.GetCurrentTimeline();
    let timelineName;
    let createdNewTimeline = false;

    if (!timeline) {
      // Create new timeline
      timelineName = `Screen Recording - ${new Date().toLocaleString()}`;
      timeline = await mediaPool.CreateTimelineFromClips(timelineName, clips);
      createdNewTimeline = true;

      if (!timeline) {
        throw new Error('Failed to create timeline');
      }

      const success = await project.SetCurrentTimeline(timeline);
      if (!success) {
        throw new Error('Failed to set current timeline');
      }

      this.logger.log(`Created new timeline: ${timelineName}`);
    } else {
      // Use existing timeline
      timelineName = await timeline.GetName();
      this.logger.log(`Using existing timeline: ${timelineName}`);

      await this._addClipsToExistingTimeline(timeline, clips);
    }

    return { timelineName, createdNewTimeline };
  }

  /**
   * Add clips to existing timeline using multiple methods
   * @param {Object} timeline - Timeline object
   * @param {Array} clips - Clips to add
   * @private
   */
  async _addClipsToExistingTimeline(timeline, clips) {
    const currentTimecode = await timeline.GetCurrentTimecode();
    this.logger.log(`Current timecode: ${currentTimecode}`);

    const methods = [
      // Method 1: Insert at current position
      () => timeline.InsertClips([clips[0]], currentTimecode),
      // Method 2: Drop at current position
      () => timeline.DropClips([clips[0]], currentTimecode),
      // Method 3: Append to end
      () => this.getMediaPool().then(mediaPool => mediaPool.AppendToTimeline([clips[0]])),
      // Method 4: Drop at end
      () => timeline.DropClips([clips[0]], null)
    ];

    for (let i = 0; i < methods.length; i++) {
      try {
        const result = await methods[i]();
        if (result) {
          const methodNames = ['InsertClips', 'DropClips (position)', 'AppendToTimeline', 'DropClips (end)'];
          this.logger.log(`Clip added successfully using ${methodNames[i]}`);
          return;
        }
      } catch (error) {
        this.logger.error(`Method ${i + 1} failed: ${error.message}`);
      }
    }

    throw new Error('Failed to add clip to timeline using any available method');
  }

  /**
   * Check if Resolve is available
   * @returns {Promise<boolean>} True if Resolve is available
   */
  async isResolveAvailable() {
    try {
      const resolve = await this.getResolve();
      return resolve !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Reset cached objects (useful for testing or reconnection)
   */
  resetCache() {
    this.resolveObj = null;
    this.projectManagerObj = null;
  }
}

module.exports = ResolveService;