// Retained by source cleanup; included in 0.0.46 to restore deleted cache files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child = require('child_process');
const excluded = new Set(['.git', '.toolchain', 'node_modules', 'bin', 'obj', 'Artifacts', 'lib', 'src-gen']);
// Synchronous scans must report from inside the loop; timers cannot run while
// filesystem hashing is in progress. Inject the clock/logger for deterministic tests.
function progress(label, { now = Date.now, log = console.log, interval = 5000 } = {}) {
    let last = now();
    return detail => {
        const current = now();
        if (current - last >= interval) { log(`[INFO] ${label}: ${detail}`); last = current; }
    };
}
function files(paths, outputs = false, report = () => {}) {
    const found = new Set();
    function visit(p, entry) {
        // Explicit junction roots are allowed; recursive workspace links are not.
        if (entry?.isSymbolicLink()) return;
        if (!entry && !fs.existsSync(p)) return;
        const st = entry || fs.statSync(p);
        if (st.isFile()) {
            found.add(path.resolve(p));
            report(`${found.size.toLocaleString()} files scanned`);
        } else if (st.isDirectory()) for (const e of fs.readdirSync(p, { withFileTypes: true })) {
            if (!outputs && e.isDirectory() && excluded.has(e.name)) continue;
            visit(path.join(p, e.name), e);
        }
    }
    paths.forEach(p => visit(p));
    return [...found].sort();
}
function hashFiles(selected, paths, values = [], report = () => {}) {
    const h = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(65536);
    h.update(JSON.stringify(['KathStageCache:1', values, [...paths].sort()]));
    let bytes = 0, completed = 0;
    for (const file of selected) {
        h.update(JSON.stringify([file, fs.statSync(file).size]));
        const fd = fs.openSync(file, 'r');
        try {
            let count;
            while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) {
                h.update(buffer.subarray(0, count)); bytes += count;
                report(`${completed.toLocaleString()}/${selected.length.toLocaleString()} files checked; ${Math.floor(bytes / 1048576)} MiB read`);
            }
        } finally { fs.closeSync(fd); }
        completed++;
        report(`${completed.toLocaleString()}/${selected.length.toLocaleString()} files checked; ${Math.floor(bytes / 1048576)} MiB read`);
    }
    return h.digest('hex');
}
function hash(paths, values = [], outputs = false, report = () => {}) {
    return hashFiles(files(paths, outputs, report), paths, values, report);
}
function stage({ name, cacheRoot, inputs, outputs, args = [], force = false, outputDigest, action }) {
    const cacheFile = path.join(cacheRoot, hash([], [name, outputs]) + '.json');
    console.log(`[INFO] ${name}: checking cache inputs...`);
    const report = progress(`${name} cache check`);
    const inputHash = hash(inputs, [name, args], false, report);
    const digest = () => outputDigest ? outputDigest(report) : hash(outputs, [], true, report);
    const ready = outputs.length && outputs.every(p => fs.existsSync(p) && files([p], true, report).length);
    let cache;
    try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
    if (!force && ready && cache?.schema === 1 && cache.inputs === inputHash && cache.outputs === digest()) {
        console.log(`[ OK ] ${name}: cached; inputs and outputs are current.`); return;
    }
    fs.rmSync(cacheFile, { force: true });
    console.log(`[INFO] ${name}...`); action();
    console.log(`[ OK ] ${name}: command completed; verifying outputs and saving cache...`);
    if (!outputs.every(p => fs.existsSync(p) && files([p], true, report).length)) throw new Error(`${name} did not produce its required outputs.`);
    if (hash(inputs, [name, args], false, report) !== inputHash) { console.log(`[INFO] ${name}: inputs changed; cache not saved.`); return; }
    fs.mkdirSync(cacheRoot, { recursive: true });
    const temp = cacheFile + '.' + crypto.randomUUID() + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify({ schema: 1, inputs: inputHash, outputs: digest() })); fs.renameSync(temp, cacheFile); }
    finally { fs.rmSync(temp, { force: true }); }
    console.log(`[ OK ] ${name}: output verification completed; cache saved.`);
}
function runNpm({ node, npmCli, args, cwd, env = process.env, spawn = child.spawnSync }) {
    if (!fs.existsSync(npmCli)) throw new Error(`Bundled npm CLI is missing: ${npmCli}`);
    // Run the bundled JS entry point with Node directly. No cmd.exe command
    // string is needed, so Windows paths/spaces cannot become escaped quotes.
    const result = spawn(node, [npmCli, ...args], { cwd, stdio: 'inherit', env });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed with exit ${result.status}`);
}
function build(root, force) {
    const workspace = path.join(root, '.toolchain', 'NpmWorkspace');
    const modules = path.join(workspace, 'node_modules');
    const cacheRoot = path.join(root, '.toolchain', 'StageCache');
    const npmCli = path.join(root, '.toolchain', 'Node', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const extension = path.join(root, 'packages', 'kath');
    const electron = path.join(root, 'applications', 'electron');
    const common = [__filename, process.execPath, npmCli, path.join(path.dirname(npmCli), '..', 'package.json')];
    const packageInputs = [path.join(root, 'JSON'), path.join(extension, 'package.json'), path.join(electron, 'package.json')];
    const invoke = args => runNpm({ node: process.execPath, npmCli, args, cwd: workspace });
    const dependencies = [path.join(modules, '@theia', 'core', 'package.json'), path.join(modules, '@theia', 'cli', 'package.json'), path.join(modules, 'typescript', 'bin', 'tsc'), path.join(modules, 'electron', 'dist', 'electron.exe')];
    // Native addons are rebuilt by the next stage. Exclude their generated build
    // directories from dependency integrity so rebuilding does not trigger npm install.
    const dependencyDigest = report => {
        console.log('[INFO] Kath npm dependencies: checking installed file contents (large installations can take several minutes)...');
        const selected = files([modules], true, report).filter(p =>
            !/\.node$/.test(p) && !/[\\/](?:build|out|Release|Debug|\.cache)[\\/]/i.test(p));
        // The list is already sorted and resolved; do not traverse/stat it again.
        return hashFiles(selected, selected, [], report);
    };
    const installedFiles = () => {
        console.log('[INFO] Kath: scanning installed package metadata and native binaries...');
        return files([modules], true, progress('Kath installed package scan')).filter(p => /(?:package\.json|\.node|electron\.exe)$/.test(p));
    };
    stage({ name: 'Kath npm dependencies', cacheRoot, inputs: [...common, ...packageInputs, path.join(root, 'Scripts', 'Install-KathToolchain.ps1')], outputs: dependencies, outputDigest: dependencyDigest, force, args: ['install', '--include=dev', '--workspaces'], action: () => invoke(['install', '--include=dev', '--workspaces']) });
    // Fingerprint installed package metadata and native binaries as downstream inputs.
    // An npm reinstall or altered native addon must invalidate affected build stages.
    let installed = installedFiles();
    const msvcInputs = [];
    const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (fs.existsSync(vswhere)) {
        msvcInputs.push(vswhere);
        const query = child.spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-find', 'VC\\Tools\\MSVC\\**\\bin\\Hostx64\\x64\\cl.exe'], { encoding: 'utf8' });
        if (query.status !== 0) throw new Error('Could not fingerprint the installed MSVC toolchain.');
        for (const compiler of query.stdout.trim().split(/\r?\n/).filter(Boolean)) {
            for (const name of ['cl.exe', 'c1.dll', 'c1xx.dll', 'c2.dll', 'link.exe']) msvcInputs.push(path.join(path.dirname(compiler), name));
        }
    }
    const nativeOutputs = installed.filter(p => /(?:\.node|electron\.exe)$/.test(p));
    stage({ name: 'Kath Electron native modules', cacheRoot, inputs: [...common, ...packageInputs, ...msvcInputs, path.join(root, '.toolchain', 'Python', 'python.exe'), ...installed.filter(p => /package\.json$/.test(p))], outputs: nativeOutputs, force, args: ['run', 'rebuild', '--workspace', '@kath/electron'], action: () => invoke(['run', 'rebuild', '--workspace', '@kath/electron']) });
    installed = installedFiles();
    stage({ name: 'Kath extension', cacheRoot, inputs: [...common, ...packageInputs, ...installed, path.join(extension, 'src'), path.join(extension, 'tsconfig.json'), path.join(root, 'CJS', 'extension-files.cjs')], outputs: [path.join(extension, 'lib')], force, args: ['run', 'build', '--workspace', '@kath/extension'], action: () => invoke(['run', 'build', '--workspace', '@kath/extension']) });
    stage({ name: 'Kath Electron frontend', cacheRoot, inputs: [...common, ...packageInputs, ...installed, ...files([path.join(extension, 'lib')], true), electron], outputs: [path.join(electron, 'lib'), path.join(electron, 'src-gen')], force, args: ['run', 'build:frontend', '--workspace', '@kath/electron'], action: () => invoke(['run', 'build:frontend', '--workspace', '@kath/electron']) });
}
module.exports = { files, hash, hashFiles, progress, stage, runNpm };
if (require.main === module) {
    try { build(path.resolve(process.argv[2]), process.argv.includes('--force')); }
    catch (e) { console.error(`[FAIL] ${e.message}`); process.exitCode = 1; }
}
