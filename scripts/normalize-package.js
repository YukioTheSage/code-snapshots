// Simple script to normalize package.json
const fs = require('fs');
const path = require('path');

// Read the package.json
const packagePath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

// Write it back with normalized formatting
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

console.log('package.json normalized');
