// Build the project then start preview server on port 4201
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('Building...');
try {
  execSync('npm run build', { stdio: 'inherit', cwd: __dirname });
  console.log('Build successful. Starting preview on port 4201...');
} catch (e) {
  console.error('Build failed:', e.message);
  process.exit(1);
}

const preview = spawn('npx', ['vite', 'preview', '--port', '4201', '--strictPort'], {
  stdio: 'inherit',
  cwd: __dirname,
  shell: true,
});

preview.on('error', (e) => console.error('Preview error:', e));
process.on('SIGTERM', () => preview.kill());
process.on('SIGINT', () => preview.kill());
