import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const electron = require('electron');
const out = path.join(process.cwd(), 'smoke.png');

const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(process.cwd(), 'out/main/index.js'), '--smoke', `--smoke-out=${out}`], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code) => {
  console.log(`[smoke] electron exited with ${code}; screenshot: ${out}`);
  process.exit(code ?? 0);
});
