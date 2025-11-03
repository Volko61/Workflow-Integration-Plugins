/**
 * Screen region selection utility
 */

const { ipcMain, BrowserWindow } = require('electron');
const CONFIG = require('../config/constants');

class RegionSelector {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Get screen region selection from user
   * @returns {Promise<Object|null>} Selected region or null if cancelled
   */
  async getScreenRegion() {
    return new Promise((resolve, reject) => {
      const { screen } = require('electron');
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.bounds;
      const { x: screenX, y: screenY } = primaryDisplay.bounds;
      const scaleFactor = primaryDisplay.scaleFactor;

      this.logger.log(`Screen info: bounds=${screenX},${screenY} ${screenWidth}x${screenHeight}, scale=${scaleFactor}x`);

      const regionWindow = this._createRegionWindow(screenX, screenY, screenWidth, screenHeight);
      const htmlContent = this._generateSelectionHTML(screenX, screenY, scaleFactor);

      regionWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));

      this._setupRegionHandlers(regionWindow, resolve, reject);
    });
  }

  /**
   * Create region selection window
   * @param {number} screenX - Screen X position
   * @param {number} screenY - Screen Y position
   * @param {number} screenWidth - Screen width
   * @param {number} screenHeight - Screen height
   * @returns {BrowserWindow} Region selection window
   * @private
   */
  _createRegionWindow(screenX, screenY, screenWidth, screenHeight) {
    return new BrowserWindow({
      width: screenWidth,
      height: screenHeight,
      x: screenX,
      y: screenY,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: false,
      backgroundColor: '#00000030',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
  }

  /**
   * Generate HTML content for region selection
   * @param {number} screenX - Screen X position
   * @param {number} screenY - Screen Y position
   * @param {number} scaleFactor - Screen scale factor
   * @returns {string} HTML content
   * @private
   */
  _generateSelectionHTML(screenX, screenY, scaleFactor) {
    return `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            margin:0; padding:0;
            background:rgba(0,0,0,0.2);
            font-family:Arial;
            user-select:none;
            overflow:hidden;
        }
        #selection-box {
            position:absolute;
            border:2px dashed #ff0000;
            background:rgba(255,0,0,0.1);
            pointer-events:none;
            display:none;
        }
        #instructions {
            position:absolute;
            top:20px; left:20px;
            background:rgba(0,0,0,0.8);
            color:white;
            padding:15px;
            border-radius:5px;
            font-size:14px;
        }
        .button {
            background:#ff0000;
            color:white;
            border:none;
            padding:10px 20px;
            margin:5px;
            border-radius:3px;
            cursor:pointer;
        }
        .button:hover { background:#cc0000; }
        #controls {
            position:absolute;
            top:20px; right:20px;
            background:rgba(0,0,0,0.8);
            color:white;
            padding:15px;
            border-radius:5px;
        }
    </style>
</head>
<body>
    <div id="instructions">
        <strong>Select Recording Region</strong><br>
        Click and drag to select an area<br>
        Press ESC to cancel
    </div>
    <div id="controls">
        <button class="button" onclick="selectRegion()">Select Region</button>
        <button class="button" onclick="recordFull()">Record Full Screen</button>
    </div>
    <div id="selection-box"></div>
    <script>
        const screenX = ${screenX};
        const screenY = ${screenY};
        const scaleFactor = ${scaleFactor};
        const MIN_SIZE = ${CONFIG.RECORDING.MIN_REGION_SIZE};
        let isSelecting = false, startX, startY, endX, endY;
        const selectionBox = document.getElementById('selection-box');

        function startSelection(e) {
            isSelecting = true;
            startX = e.clientX;
            startY = e.clientY;
            selectionBox.style.left = startX + 'px';
            selectionBox.style.top = startY + 'px';
            selectionBox.style.width = '0px';
            selectionBox.style.height = '0px';
            selectionBox.style.display = 'block';
            e.preventDefault();
        }

        function updateSelection(e) {
            if (!isSelecting) return;
            endX = e.clientX;
            endY = e.clientY;
            const left = Math.min(startX, endX);
            const top = Math.min(startY, endY);
            const width = Math.abs(endX - startX);
            const height = Math.abs(endY - startY);
            selectionBox.style.left = left + 'px';
            selectionBox.style.top = top + 'px';
            selectionBox.style.width = width + 'px';
            selectionBox.style.height = height + 'px';
        }

        function endSelection(e) {
            if (!isSelecting) return;
            isSelecting = false;
            endX = e.clientX;
            endY = e.clientY;

            let width = Math.abs(endX - startX);
            let height = Math.abs(endY - startY);

            // Validate minimum size
            if (width < MIN_SIZE || height < MIN_SIZE) {
                alert('Selected region is too small. Minimum size is ' + MIN_SIZE + 'x' + MIN_SIZE + ' pixels.');
                selectRegion(); // Restart selection
                return;
            }

            let region = {
                x: Math.min(startX, endX) + screenX,
                y: Math.min(startY, endY) + screenY,
                width: width,
                height: height
            };

            // Adjust for scale factor
            if (scaleFactor !== 1) {
                region.x = Math.round(region.x * scaleFactor);
                region.y = Math.round(region.y * scaleFactor);
                region.width = Math.round(region.width * scaleFactor);
                region.height = Math.round(region.height * scaleFactor);
            }

            // Ensure even dimensions for H.264
            region.width = Math.floor(region.width / 2) * 2;
            region.height = Math.floor(region.height / 2) * 2;

            console.log('Region selected: x=' + region.x + ', y=' + region.y + ', width=' + region.width + ', height=' + region.height);
            require('electron').ipcRenderer.send('region-selected', region);
        }

        function selectRegion() {
            document.body.style.cursor = 'crosshair';
            document.addEventListener('mousedown', startSelection);
            document.addEventListener('mousemove', updateSelection);
            document.addEventListener('mouseup', endSelection);
            document.getElementById('instructions').innerHTML = '<strong>Click and drag to select region</strong><br>Press ESC to cancel<br>Minimum size: ' + MIN_SIZE + 'x' + MIN_SIZE + ' pixels';
            document.getElementById('controls').style.display = 'none';
        }

        function recordFull() {
            require('electron').ipcRenderer.send('region-selected', null);
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') require('electron').ipcRenderer.send('region-selected', null);
        });

        selectRegion();
    </script>
</body>
</html>`;
  }

  /**
   * Setup event handlers for region selection
   * @param {BrowserWindow} regionWindow - Region selection window
   * @param {Function} resolve - Promise resolve function
   * @param {Function} reject - Promise reject function
   * @private
   */
  _setupRegionHandlers(regionWindow, resolve, reject) {
    const regionHandler = (event, region) => {
      regionWindow.close();
      ipcMain.removeListener('region-selected', regionHandler);
      resolve(region);
    };

    ipcMain.once('region-selected', regionHandler);

    regionWindow.on('closed', () => {
      ipcMain.removeListener('region-selected', regionHandler);
      reject(new Error('Region selection cancelled'));
    });
  }

  /**
   * Validate and adjust region dimensions
   * @param {Object} region - Selected region
   * @returns {Object} Validated and adjusted region
   */
  validateRegion(region) {
    if (!region) return null;

    // Validate minimum size
    if (region.width < CONFIG.RECORDING.MIN_REGION_SIZE ||
        region.height < CONFIG.RECORDING.MIN_REGION_SIZE) {
      throw new Error(`Selected region is too small (${region.width}x${region.height}). Minimum size is ${CONFIG.RECORDING.MIN_REGION_SIZE}x${CONFIG.RECORDING.MIN_REGION_SIZE} pixels.`);
    }

    // Adjust dimensions to be even (required for H.264)
    const evenWidth = Math.floor(region.width / 2) * 2;
    const evenHeight = Math.floor(region.height / 2) * 2;

    const adjustedRegion = {
      x: region.x,
      y: region.y,
      width: evenWidth,
      height: evenHeight
    };

    if (evenWidth !== region.width || evenHeight !== region.height) {
      this.logger.log(`Adjusted region from ${region.width}x${region.height} to ${evenWidth}x${evenHeight} (H.264 requires even dimensions)`);
    }

    return adjustedRegion;
  }
}

module.exports = RegionSelector;