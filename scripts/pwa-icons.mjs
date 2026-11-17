// Genera los iconos PWA a partir de public/logo.png: npm run pwa:icons
import sharp from 'sharp';
const src = 'public/logo.png';
const { data } = await sharp(src).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
const background = { r: data[0], g: data[1], b: data[2], alpha: 1 };
for (const s of [64, 192, 512]) await sharp(src).resize(s, s).png().toFile(`public/pwa-${s}x${s}.png`);
await sharp(src).resize(180, 180).png().toFile('public/apple-touch-icon-180x180.png');
// Maskable: el logo dentro de la zona segura (80%) sobre el color de fondo.
for (const s of [192, 512]) {
  const side = Math.round(s * 0.8);
  const inner = await sharp(src).resize(side, side).png().toBuffer();
  await sharp({ create: { width: s, height: s, channels: 4, background } })
    .composite([{ input: inner, gravity: 'center' }]).png().toFile(`public/maskable-icon-${s}x${s}.png`);
}
console.log('ok', background);
