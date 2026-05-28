const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const publicDir = path.join(__dirname, '..', 'public');
const brandDir = path.join(publicDir, 'brand');
const markInput = path.join(brandDir, 'pique-isotipo.svg');
const markInput40 = path.join(brandDir, 'pique-isotipo-40.svg');
const markInput28 = path.join(brandDir, 'pique-isotipo-28.svg');
const logoInput = path.join(brandDir, 'pique-logo-horizontal.svg');
const ogGradientInput = path.join(publicDir, 'image 42.png');

if (!fs.existsSync(markInput) || !fs.existsSync(logoInput) || !fs.existsSync(ogGradientInput)) {
  console.error('No se encontraron los SVG fuente en public/brand.');
  process.exit(1);
}

function writeIco(entries, outputPath) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const directories = entries.map((entry) => {
    const directory = Buffer.alloc(16);
    directory.writeUInt8(entry.size === 256 ? 0 : entry.size, 0);
    directory.writeUInt8(entry.size === 256 ? 0 : entry.size, 1);
    directory.writeUInt8(0, 2);
    directory.writeUInt8(0, 3);
    directory.writeUInt16LE(1, 4);
    directory.writeUInt16LE(32, 6);
    directory.writeUInt32LE(entry.bytes.length, 8);
    directory.writeUInt32LE(offset, 12);
    offset += entry.bytes.length;
    return directory;
  });

  fs.writeFileSync(outputPath, Buffer.concat([header, ...directories, ...entries.map((entry) => entry.bytes)]));
}

async function generate() {
  try {
    await sharp(markInput).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(publicDir, 'favicon-512.png'));
    await sharp(markInput).resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(publicDir, 'favicon-192.png'));

    const favicon48 = await sharp(markInput40).resize(48, 48).png().toBuffer();
    const favicon32 = await sharp(markInput28).resize(32, 32).png().toBuffer();
    fs.writeFileSync(path.join(publicDir, 'favicon-48.png'), favicon48);
    fs.writeFileSync(path.join(publicDir, 'favicon-32.png'), favicon32);
    writeIco([
      { size: 32, bytes: favicon32 },
      { size: 48, bytes: favicon48 },
    ], path.join(publicDir, 'favicon.ico'));

    const logoBuffer = await sharp(logoInput).resize({ width: 520 }).png().toBuffer();
    const centeredCardLogoBuffer = await sharp(logoBuffer).trim().png().toBuffer();
    const ogBackgroundBuffer = await sharp(ogGradientInput)
      .resize(1200, 630, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();
    const ogOverlay = Buffer.from(`
      <svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="1200" height="630" fill="#F5F4F0" fill-opacity="0.12"/>
        <rect x="244" y="184" width="712" height="262" rx="46" fill="#F5F4F0" fill-opacity="0.62"/>
        <rect x="244" y="184" width="712" height="262" rx="46" stroke="#FFFFFF" stroke-opacity="0.42" stroke-width="2"/>
      </svg>
    `);
    await sharp({
      create: {
        width: 1200,
        height: 630,
        channels: 4,
        background: { r: 245, g: 244, b: 240, alpha: 1 },
      },
    })
      .composite([
        { input: ogBackgroundBuffer, top: 0, left: 0 },
        { input: ogOverlay, top: 0, left: 0 },
        { input: centeredCardLogoBuffer, top: 246, left: 401 },
      ])
      .png()
      .toFile(path.join(publicDir, 'og-1200x630-card.png'));

    await sharp({
      create: {
        width: 1200,
        height: 630,
        channels: 4,
        background: { r: 245, g: 244, b: 240, alpha: 1 },
      },
    })
      .composite([
        { input: ogBackgroundBuffer, top: 0, left: 0 },
        { input: Buffer.from(`
          <svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="1200" height="630" fill="#F5F4F0" fill-opacity="0.08"/>
          </svg>
        `), top: 0, left: 0 },
        { input: centeredCardLogoBuffer, top: 246, left: 401 },
      ])
      .png()
      .toFile(path.join(publicDir, 'og-1200x630.png'));

    console.log('Assets Pique generados desde public/brand con escala de isotipo del design system.');
  } catch (err) {
    console.error('Error generando iconos:', err);
    process.exit(1);
  }
}

generate();
