import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {appendFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

// Uses the packaged application's real GitHub provider and isolated user data.
// The installation/download path is tested separately by update-install-check.
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = resolve(process.argv[2] ?? join(desktop, '../../release/win-unpacked/Gold Work Studio.exe'));
const root = resolve(process.argv[3] ?? join(process.env.TEMP, 'goldwork-github-check-' + Date.now()));
const profile = join(root, 'profile');
const port = 19363;
const source = 'https://github.com/Vova2808/gold-work-studio-updates';
const report = {startedAt: new Date().toISOString(), source, passed: false};
await mkdir(profile, {recursive: true});
const configuration = await readFile(join(dirname(executable), 'resources/app-update.yml'), 'utf8');
assert.match(configuration, /provider: github/);
assert.match(configuration, /repo: gold-work-studio-updates/);
assert.match(configuration, /owner: Vova2808/);
const child = spawn(executable, [`--remote-debugging-port=${port}`], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: {...process.env, GWS_USER_DATA_DIR: profile, GWS_BACKGROUND_TEST: '1', ELECTRON_RENDERER_URL: '', PORTABLE_EXECUTABLE_DIR: '', GH_TOKEN: '', GITHUB_TOKEN: ''}
});
child.stdout.on('data', part => {void appendFile(join(root, 'application.log'), part);});
child.stderr.on('data', part => {void appendFile(join(root, 'application.log'), part);});
let launchError, socket;
child.on('error', error => {launchError = error;});
async function waitFor(work, timeout = 180_000) {
  const until = Date.now() + timeout; let last;
  while (Date.now() < until) {
    if (launchError) throw launchError;
    if (child.exitCode !== null || child.signalCode !== null) throw Error('Application closed before validation');
    try {const value = await work(); if (value) return value;} catch (error) {last = error;}
    await delay(500);
  }
  throw Error('Timed out: ' + (last?.message ?? 'application not ready'));
}
try {
  const target = await waitFor(async () => {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
    return targets.find(t => t.type === 'page' && t.url.startsWith('file:') && t.webSocketDebuggerUrl);
  });
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {socket.addEventListener('open', done, {once: true}); socket.addEventListener('error', fail, {once: true});});
  let id = 0; const pending = new Map();
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data), task = pending.get(result.id);
    if (!task) return;
    pending.delete(result.id);
    if (result.error) task.reject(Error(result.error.message)); else task.resolve(result.result);
  });
  const evaluate = async expression => {
    const command = {id: ++id, method: 'Runtime.evaluate', params: {expression, awaitPromise: true, returnByValue: true}};
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {pending.delete(command.id); reject(Error('IPC timeout'));}, 90_000);
      pending.set(command.id, {resolve: value => {clearTimeout(timer); resolve(value);}, reject: error => {clearTimeout(timer); reject(error);}});
      socket.send(JSON.stringify(command));
    });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await waitFor(() => evaluate('Boolean(window.goldWork)'));
  const info = await evaluate('window.goldWork.getAppInfo()');
  assert.equal(resolve(info.dataPath), profile);
  report.version = info.version;
  report.state = await evaluate('window.goldWork.checkAppUpdates()');
  assert.equal(report.state.status, 'up-to-date', JSON.stringify(report.state));
  report.passed = true;
  await evaluate('window.goldWork.closeWindow()');
  console.log(JSON.stringify({passed: true, version: info.version, source, status: report.state.status}));
} catch (error) {
  report.error = error.stack; throw error;
} finally {
  socket?.close();
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([new Promise(done => child.once('exit', done)), delay(3000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  report.completedAt = new Date().toISOString();
  await writeFile(join(root, 'github-update-test-result.json'), JSON.stringify(report, null, 2));
}
