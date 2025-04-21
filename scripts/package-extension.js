#!/usr/bin/env node

/**
 * Custom packaging script that works around the ZIP comment issue
 * that can occur when packaging on Windows but installing on Unix
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// First prepare the package
require('./prepare-package');

// Get the package version
const packagePath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const version = pkg.version;
const name = pkg.name;

// Output file name
const vsixPath = path.join(__dirname, '..', `${name}-${version}.vsix`);

try {
  // Run vsce package with minimal options
  console.log('Packaging extension...');
  execSync('vsce package --no-git-tag-version --no-update-package-json --no-dependencies --no-yarn', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });
  
  console.log(`\nPackaged extension: ${vsixPath}`);
  console.log('\nTo install on Linux/macOS:');
  console.log(`code --install-extension ${name}-${version}.vsix`);
  
} catch (err) {
  console.error('Error packaging extension:', err);
  process.exit(1);
}
