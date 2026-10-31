const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../scripts/build-desktop.cjs'), 'utf8');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-builder-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({version: '1.2.3'}));
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  function execute(args = [], {host = 'linux', fail, missing = false, stale = false} = {}) {
    const calls = [], messages = [];
    const fakeProcess = {platform: host, arch: 'x64', versions: {node: '22.12.0'}, getuid: () => 1000, execPath: '/node', env: {}, argv: ['node', 'builder', host === 'darwin' ? 'mac' : 'linux', '--no-pause', ...args], stdin: {isTTY: false}, stdout: {isTTY: false}};
    const module = {exports: {}};
    const mockRequire = name => name === 'node:child_process' ? {spawnSync(command, argv) {
      const action = argv.join(' '); calls.push(action);
      if (fail && action.includes(fail)) return {status: 1};
      if (action === 'ci') {
        const bin = path.join(root, 'node_modules/electron/dist', host === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
        fs.mkdirSync(path.dirname(bin), {recursive: true}); fs.writeFileSync(bin, 'fake');
        fs.mkdirSync(path.join(root, 'node_modules/electron-builder'), {recursive: true});
        fs.writeFileSync(path.join(root, 'node_modules/electron-builder/cli.js'), 'fake');
      }
      if (action.includes('dist:') && !missing) {
        const platform = host === 'darwin' ? 'mac' : 'linux';
        const arch = argv.find(a => ['--x64', '--arm64', '--universal'].includes(a)).slice(2);
        const output = path.join(root, 'dist/v1.2.3'); fs.mkdirSync(output, {recursive: true});
        for (const ext of platform === 'mac' ? ['dmg', 'zip'] : ['AppImage', 'deb']) {
          const file = path.join(output, `SlotForgePaddock-1.2.3-${platform}-${arch}.${ext}`);
          fs.writeFileSync(file, 'fake installer');
          if (stale) fs.utimesSync(file, new Date(0), new Date(0));
        }
      }
      return {status: 0};
    }} : require(name);
    mockRequire.main = module;
    vm.runInNewContext(source, {require: mockRequire, module, __dirname: path.join(root, 'scripts'), process: fakeProcess, console: {log: s => messages.push(s), error: s => messages.push(s)}, Buffer, Date});
    return {calls, messages, code: fakeProcess.exitCode || 0};
  }
  return {root, execute};
}

test('normal native build checks before packaging and writes usable checksums', t => {
  const {root, execute} = fixture(t), result = execute();
  assert.equal(result.code, 0);
  assert.deepEqual(result.calls, ['ci', 'run check', 'test', 'run dist:linux -- --x64 --publish never']);
  const sums = fs.readFileSync(path.join(root, 'dist/v1.2.3/SHA256SUMS-linux-x64.txt'), 'utf8');
  assert.match(sums, /^[a-f0-9]{64}  SlotForgePaddock-1.2.3-linux-x64.AppImage\n/);
  assert.match(sums, /\.deb\n$/);
});
test('failed checks stop packaging and never claim success', t => {
  const {execute} = fixture(t), result = execute([], {fail: 'run check'});
  assert.equal(result.code, 1);
  assert.deepEqual(result.calls, ['ci', 'run check']);
  assert.ok(!result.messages.some(s => s.includes('Ready in')));
});
test('quick builds reinstall on lockfile changes and otherwise reuse matching dependencies', t => {
  const {root, execute} = fixture(t);
  assert.equal(execute().code, 0);
  assert.deepEqual(execute(['--quick']).calls, ['run dist:linux -- --x64 --publish never']);
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{"changed":true}');
  assert.deepEqual(execute(['--quick']).calls, ['ci', 'run dist:linux -- --x64 --publish never']);
});
test('macOS defaults to universal installers and accepts Apple Silicon-only builds', t => {
  const {execute} = fixture(t);
  const universal = execute([], {host: 'darwin'});
  assert.equal(universal.code, 0);
  assert.equal(universal.calls.at(-1), 'run dist:mac -- --universal --publish never');
  assert.equal(execute(['--quick', '--arch', 'arm64'], {host: 'darwin'}).calls.at(-1), 'run dist:mac -- --arm64 --publish never');
});
test('missing or stale installers cannot be reported as a successful build', t => {
  const {execute} = fixture(t);
  for (const state of [{missing: true}, {stale: true}, {fail: 'dist:linux'}]) {
    const result = execute([], state);
    assert.equal(result.code, 1);
    assert.ok(!result.messages.some(s => s.includes('Ready in')));
  }
});

test('a quick rebuild cannot reuse recent untouched installers as if it produced them', t => {
  const {execute}=fixture(t);
  assert.equal(execute().code,0);
  const result=execute(['--quick'],{missing:true});
  assert.equal(result.code,1);
  assert.ok(!result.messages.some(s=>s.includes('Ready in')));
});
test('wrong operating systems and unsupported architectures stop before modifying dependencies', t => {
  const {execute} = fixture(t);
  for (const result of [execute([], {host: 'win32'}), execute(['--arch', 'universal']), execute(['--arch']), execute(['--unknown'])]) {
    assert.equal(result.code, 1); assert.deepEqual(result.calls, []);
  }
  assert.equal(execute(['--help'], {host: 'win32'}).code, 0);
});
