// Script to handle all package preparation steps
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Starting package preparation...');

// 1. Normalize package.json
try {
  console.log('Normalizing package.json...');
  const packagePath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
} catch (err) {
  console.error('Error normalizing package.json:', err);
  process.exit(1);
}

// 2. Create placeholder icon if it doesn't exist
try {
  console.log('Checking for icon...');
  const iconPath = path.join(__dirname, '..', 'images', 'icon.png');
  const svgIconPath = path.join(__dirname, '..', 'images', 'icon.svg');
  
  if (!fs.existsSync(iconPath) && !fs.existsSync(svgIconPath)) {
    console.log('Creating placeholder icon...');
    require('./create-icon');
  }
} catch (err) {
  console.error('Error creating icon:', err);
  // Non-fatal, continue
}

// 3. Ensure consistent line endings
try {
  console.log('Ensuring consistent line endings...');
  const files = [
    path.join(__dirname, '..', 'package.json'),
    path.join(__dirname, '..', 'README.md'),
    path.join(__dirname, '..', '.vscodeignore')
  ];
  
  files.forEach(file => {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      // Convert all line endings to LF
      const normalized = content.replace(/\r\n/g, '\n');
      fs.writeFileSync(file, normalized, 'utf8');
    }
  });
} catch (err) {
  console.error('Error normalizing line endings:', err);
  // Non-fatal, continue
}

// 4. Clean any previous build artifacts
try {
  console.log('Cleaning previous build artifacts...');
  const vsixFiles = fs.readdirSync(path.join(__dirname, '..'))
    .filter(file => file.endsWith('.vsix'));
    
  vsixFiles.forEach(file => {
    fs.unlinkSync(path.join(__dirname, '..', file));
    console.log(`Deleted: ${file}`);
  });
} catch (err) {
  console.error('Error cleaning artifacts:', err);
  // Non-fatal, continue
}

console.log('Package preparation complete!');
