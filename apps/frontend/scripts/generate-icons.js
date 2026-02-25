const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const publicDir = path.join(__dirname, '..', 'public');
const input = path.join(publicDir, 'logo1.svg');

if (!fs.existsSync(input)) {
  console.error('No se encontró logo1.svg en el directorio public. Coloca tu logo en public/logo1.svg');
  process.exit(1);
}

async function generate() {
  try {
    // 512x512
    await sharp(input).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(publicDir, 'favicon-512.png'));
    console.log('favicon-512.png generado');

    // 192x192
    await sharp(input).resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(publicDir, 'favicon-192.png'));
    console.log('favicon-192.png generado');

    // OG 1200x630
    await sharp(input).resize(1200, 630, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toFile(path.join(publicDir, 'og-1200x630.png'));
    console.log('og-1200x630.png generado');

    // favicon.ico (contains multiple sizes)
    const icoBuf = await sharp(input).resize(64, 64).png().toBuffer();
    // sharp does not write .ico directly; use png -> ico package would be needed. As fallback, write 48x48 and 32x32 PNGs and then user can convert.
    await sharp(input).resize(48, 48).png().toFile(path.join(publicDir, 'favicon-48.png'));
    await sharp(input).resize(32, 32).png().toFile(path.join(publicDir, 'favicon-32.png'));
    console.log('favicon-48.png, favicon-32.png generados (convertir a .ico si se desea)');

    console.log('\nListo. Archivos generados en public/:\n - favicon-512.png\n - favicon-192.png\n - og-1200x630.png\n - favicon-48.png\n - favicon-32.png\n');
    console.log('Si quieres generar un true .ico instalado en navegadores, instala el paquete "png-to-ico" y ejecuta una conversión adicional.');
  } catch (err) {
    console.error('Error generando iconos:', err);
    process.exit(1);
  }
}

generate();
