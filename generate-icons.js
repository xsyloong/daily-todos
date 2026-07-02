// 这是一个简单的 Node.js 脚本，用于生成基础的占位图标
// 需要安装: npm install sharp

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const iconDir = path.join(__dirname, 'src-tauri', 'icons');

// 创建一个简单的 SVG 图标
const svgIcon = `
<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="80" fill="url(#grad)"/>
  <text x="256" y="320" font-family="Arial" font-size="280" fill="white" text-anchor="middle">✓</text>
</svg>
`;

async function generateIcons() {
  const buffer = Buffer.from(svgIcon);

  // Generate PNG icons
  await sharp(buffer).resize(32, 32).png().toFile(path.join(iconDir, '32x32.png'));
  await sharp(buffer).resize(128, 128).png().toFile(path.join(iconDir, '128x128.png'));
  await sharp(buffer).resize(256, 256).png().toFile(path.join(iconDir, '128x128@2x.png'));
  await sharp(buffer).resize(512, 512).png().toFile(path.join(iconDir, 'icon.png'));

  console.log('✓ Icons generated successfully!');
  console.log('Note: .icns and .ico files need platform-specific tools to generate.');
  console.log('For Windows .ico: Use online converter or ImageMagick');
  console.log('For macOS .icns: Use iconutil on macOS');
}

if (require.main === module) {
  generateIcons().catch(console.error);
}
