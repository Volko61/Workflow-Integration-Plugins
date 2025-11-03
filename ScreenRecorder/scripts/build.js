/**
 * Build script for the screen recorder plugin
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
  SOURCE_DIR: path.resolve(__dirname, '..'),
  BUILD_DIR: path.resolve(__dirname, '..', 'dist'),
  FILES_TO_COPY: [
    'manifest.xml',
    'index.html',
    'preload.js',
    'WorkflowIntegration.node',
    'css/',
    'config/',
    'utils/',
    'services/'
  ],
  MAIN_FILES: {
    'main.js': 'main.refactored.js',
    'renderer.js': 'renderer.refactored.js'
  }
};

class Builder {
  constructor() {
    this.buildDir = CONFIG.BUILD_DIR;
  }

  /**
   * Clean build directory
   */
  clean() {
    if (fs.existsSync(this.buildDir)) {
      fs.rmSync(this.buildDir, { recursive: true, force: true });
      console.log('✓ Cleaned build directory');
    }
  }

  /**
   * Create build directory
   */
  createBuildDir() {
    fs.mkdirSync(this.buildDir, { recursive: true });
    console.log('✓ Created build directory');
  }

  /**
   * Copy file or directory
   * @param {string} source - Source path
   * @param {string} target - Target path
   */
  copyRecursive(source, target) {
    const sourcePath = path.join(CONFIG.SOURCE_DIR, source);
    const targetPath = path.join(this.buildDir, target);

    if (fs.existsSync(sourcePath)) {
      const stats = fs.statSync(sourcePath);

      if (stats.isDirectory()) {
        fs.mkdirSync(targetPath, { recursive: true });
        const files = fs.readdirSync(sourcePath);
        files.forEach(file => {
          this.copyRecursive(path.join(source, file), path.join(target, file));
        });
      } else {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }

  /**
   * Copy required files
   */
  copyFiles() {
    CONFIG.FILES_TO_COPY.forEach(file => {
      this.copyRecursive(file, file);
      console.log(`✓ Copied ${file}`);
    });

    // Copy main files with correct names
    Object.entries(CONFIG.MAIN_FILES).forEach(([target, source]) => {
      const sourcePath = path.join(CONFIG.SOURCE_DIR, source);
      const targetPath = path.join(this.buildDir, target);

      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, targetPath);
        console.log(`✓ Copied ${source} -> ${target}`);
      } else {
        console.warn(`⚠ Source file not found: ${source}`);
      }
    });
  }

  /**
   * Create package.json for build
   */
  createPackageJson() {
    const sourcePackagePath = path.join(CONFIG.SOURCE_DIR, 'package.test.json');
    const targetPackagePath = path.join(this.buildDir, 'package.json');

    if (fs.existsSync(sourcePackagePath)) {
      const packageData = JSON.parse(fs.readFileSync(sourcePackagePath, 'utf8'));
      // Remove devDependencies for production build
      delete packageData.devDependencies;
      delete packageData.scripts.test;
      delete packageData.scripts['test:watch'];
      delete packageData.scripts['test:coverage'];
      delete packageData.jest;

      fs.writeFileSync(targetPackagePath, JSON.stringify(packageData, null, 2));
      console.log('✓ Created package.json for build');
    }
  }

  /**
   * Validate build
   */
  validateBuild() {
    const requiredFiles = [
      'main.js',
      'renderer.js',
      'index.html',
      'preload.js',
      'manifest.xml',
      'package.json'
    ];

    const missingFiles = requiredFiles.filter(file => {
      const filePath = path.join(this.buildDir, file);
      return !fs.existsSync(filePath);
    });

    if (missingFiles.length > 0) {
      console.error('❌ Build validation failed - missing files:');
      missingFiles.forEach(file => console.error(`  - ${file}`));
      return false;
    }

    console.log('✓ Build validation passed');
    return true;
  }

  /**
   * Show build summary
   */
  showSummary() {
    const stats = fs.statSync(this.buildDir);
    console.log('\n📊 Build Summary:');
    console.log(`   Build directory: ${this.buildDir}`);
    console.log(`   Created: ${stats.birthtime.toLocaleString()}`);
    console.log('   Status: ✅ Build successful!');
  }

  /**
   * Run complete build process
   */
  build() {
    console.log('🚀 Starting build process...\n');

    try {
      this.clean();
      this.createBuildDir();
      this.copyFiles();
      this.createPackageJson();

      if (this.validateBuild()) {
        this.showSummary();
        process.exit(0);
      } else {
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Build failed:', error.message);
      process.exit(1);
    }
  }
}

// Run build if called directly
if (require.main === module) {
  const builder = new Builder();
  builder.build();
}

module.exports = Builder;