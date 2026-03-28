import { test as setup } from '@playwright/test';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

function waitForServer(url, timeout = 10_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      if (Date.now() - start > timeout) {
        reject(new Error(`Server not ready after ${timeout}ms`));
        return;
      }
      try {
        const res = await fetch(url);
        if (res.ok) { resolve(); return; }
      } catch {}
      setTimeout(check, 100);
    };
    check();
  });
}

setup('start web server', async () => {
  if (await isPortInUse(8080)) return;

  const root = path.join(import.meta.dirname, '..', '..');
  const child = spawn('npx', ['serve', '.', '-l', '8080', '--no-clipboard'], {
    cwd: root,
    stdio: 'ignore',
  });

  process.on('exit', () => child.kill());

  await waitForServer('http://localhost:8080');
});
