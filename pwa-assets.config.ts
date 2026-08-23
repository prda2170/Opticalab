import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

/**
 * Icon generation for the installable build: `npm run icons` rasterises
 * `public/icon.svg` into every size a browser or OS asks for, writing them back into
 * `public/` where the manifest expects them.
 *
 * The generated PNGs are committed, so a clone can build without running sharp — and so a
 * change to the mark shows up as an actual diff rather than silently at deploy time.
 *
 * `minimal2023` is the small set that still covers everything real: a 64 px favicon, the
 * 192 and 512 the manifest requires, a padded 512 maskable for Android, and a 180 for iOS.
 */
export default defineConfig({
  preset: minimal2023Preset,
  images: ['public/icon.svg'],
});
