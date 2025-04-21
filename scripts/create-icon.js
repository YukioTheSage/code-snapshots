// Create a simple placeholder icon for the extension
const fs = require('fs');
const path = require('path');

// Simple SVG icon
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" fill="#2C2C54"/>
  <circle cx="64" cy="64" r="48" fill="none" stroke="#FFD460" stroke-width="8"/>
  <text x="64" y="78" font-family="Arial" font-size="60" text-anchor="middle" fill="#FFD460">S</text>
</svg>`;

// Create images directory if it doesn't exist
const imagesDir = path.join(__dirname, '..', 'images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir);
}

// Write the SVG file
fs.writeFileSync(path.join(imagesDir, 'icon.svg'), svg, 'utf8');

console.log('Created icon.svg in images directory');
console.log('Note: For production, you should convert this to PNG format');
