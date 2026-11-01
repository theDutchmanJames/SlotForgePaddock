// Native installer builder. Never reads or changes collection data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

function options(args) {
  const platform = args.shift();
  if (!['linux', 'mac'].includes(platform)) throw Error('Choose linux or mac.');
  const result = {platform, quick: false, pause: true, help: false, arch: platform === 'mac' ? 'universal' : process.arch};
  while (args.length) {
    const arg = args.shift();
    if (arg === '--quick') result.quick = true;
    else if (arg === '--no-pause') result.pause = false;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--arch') result.arch = args.shift();
    else throw Error(`Unknown option: ${arg}. Use --help for instructions.`);
  }
  if (!result.help && !(platform === 'mac' ? ['universal', 'x64', 'arm64'] : ['x64', 'arm64']).includes(result.arch)) {
    throw Error('Unsupported architecture. Use --arch x64 or --arch arm64 (macOS also supports universal).');
  }
  return result;
}

function run(command, args) {
  const result = spawnSync(command, args, {cwd: root, stdio: 'inherit', env: process.env});
  if (result.error) throw Error(`Could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) throw Error(`${command} ${args.join(' ')} failed${result.signal ? ` (${result.signal})` : ` (exit ${result.status})`}. No successful build is reported.`);
}

function build(config) {
  const {platform, arch, quick} = config;
  if (config.help) {
    console.log(`SlotForge Paddock ${platform === 'mac' ? 'macOS' : 'Linux'} builder
Run on the target operating system with Node.js >=22.12 and npm installed.
Normal build: install locked dependencies, run checks and tests, package installers.
  --quick       Reuse matching dependencies and skip checks/tests.
  --arch ARCH   ${platform === 'mac' ? 'universal (default), x64 or arm64' : 'x64 or arm64 (default: this machine)'}.
  --no-pause    Do not wait for Enter when launched in a terminal.
  --help        Show these instructions.
Files are written to dist/v<version>/. Nothing is installed automatically.`);
    return;
  }
  if (process.platform !== (platform === 'mac' ? 'darwin' : 'linux')) throw Error(`Run this builder on ${platform === 'mac' ? 'macOS' : 'Linux'}. It cannot build these installers on ${process.platform}.`);
  if (process.getuid?.() === 0) throw Error('Run the builder as your normal user, without sudo.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw Error('Node.js 22.12 or newer is required by the pinned Electron toolchain.');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const stampPath = path.join(root, 'node_modules', '.paddock-build-dependencies');
  const fingerprint = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'package-lock.json'))).update(fs.readFileSync(path.join(root, 'package.json'))).update(`${process.platform}/${process.arch}/${major}`).digest('hex');
  const binary = path.join(root, 'node_modules/electron/dist', platform === 'mac' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
  let dependenciesMatch = false;
  try { dependenciesMatch = fs.readFileSync(stampPath, 'utf8') === fingerprint && fs.existsSync(binary) && fs.existsSync(path.join(root, 'node_modules/electron-builder/cli.js')); } catch {}
  console.log(`Building SlotForge Paddock ${pkg.version} for ${platform}/${arch}.`);
  if (!quick || !dependenciesMatch) {
    console.log('Installing dependencies from package-lock.json...');
    run('npm', ['ci']);
    if (!fs.existsSync(binary)) run(process.execPath, [path.join(root, 'node_modules/electron/install.js')]);
    if (!fs.existsSync(binary)) throw Error('Electron was not installed for this operating system.');
    fs.writeFileSync(stampPath, fingerprint);
  } else console.log('Reusing dependencies from the previous matching build.');
  if (quick) console.log('Quick build: syntax checks and automated tests are skipped.');
  else {
    run('npm', ['run', 'check']);
    run('npm', ['test']);
  }
  const output = path.join(root, 'dist', `v${pkg.version}`);
  const extensions = platform === 'mac' ? ['dmg', 'zip'] : ['AppImage', 'deb'];
  // electron-builder uses each Linux package format's native architecture label.
  const files = extensions.map(ext => `SlotForgePaddock-${pkg.version}-${platform}-${platform === 'linux' && arch === 'x64' ? (ext === 'deb' ? 'amd64' : 'x86_64') : arch}.${ext}`);
  const signature = stat => [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join('/');
  const previous = new Map(files.map(file=>{try{return [file,signature(fs.statSync(path.join(output,file)))];}catch(error){if(error.code!=='ENOENT')throw error;return [file,null];}}));
  const started = Date.now();
  run('npm', ['run', `dist:${platform}`, '--', `--${arch}`, '--publish', 'never']);
  for (const file of files) {
    const stat = fs.statSync(path.join(output, file));
    if (!stat.isFile() || stat.size === 0 || stat.mtimeMs < started - 2000 || previous.get(file)===signature(stat)) throw Error(`Missing or stale installer: ${file}`);
  }
  const sums = files.map(file => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(output, file))).digest('hex')}  ${file}`).join('\n') + '\n';
  fs.writeFileSync(path.join(output, `SHA256SUMS-${platform}-${arch}.txt`), sums);
  console.log(`\nReady in ${output}:\n${files.map(file => `  ${file}`).join('\n')}\n  SHA256SUMS-${platform}-${arch}.txt`);
  console.log(platform === 'mac' ? 'Open the DMG and drag SlotForge Paddock to Applications. Builds use local ad-hoc signing, not Apple notarisation.' : 'Open the .deb with your package manager, or mark the AppImage executable and run it.');
}

if (require.main === module) {
  let config;
  try { config = options(process.argv.slice(2)); build(config); }
  catch (error) { console.error(`\nBuild stopped: ${error.message}`); process.exitCode = 1; }
  if (!process.argv.includes('--no-pause') && !config?.help && process.stdin.isTTY && process.stdout.isTTY) {
    const readline = require('node:readline').createInterface({input: process.stdin, output: process.stdout});
    readline.question('\nPress Enter to close. ', () => readline.close());
  }
}

module.exports = {options};
