// Retained by source cleanup; included in 0.0.46 to restore deleted cache files.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stage, hash, hashFiles, files, progress, runNpm } = require('./stage-cache.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache44-'));
const src = path.join(dir, 'src'); fs.mkdirSync(src);
const input = path.join(src, 'source.cs'), output = path.join(dir, 'lib', 'out.js');
fs.mkdirSync(path.dirname(output)); fs.writeFileSync(input, 'v1');
let count = 0;
const spec = { name: 'compile', cacheRoot: path.join(dir, 'cache'), inputs: [input], outputs: [output], action: () => { count++; fs.writeFileSync(output, 'built:' + fs.readFileSync(input)); } };
stage(spec); stage(spec); assert.equal(count, 1);
const stamp = fs.statSync(input).mtime;
fs.writeFileSync(input, 'v2'); fs.utimesSync(input, stamp, stamp); stage(spec); assert.equal(count, 2);
fs.writeFileSync(output, 'damaged'); stage(spec); assert.equal(count, 3);
fs.rmSync(output); stage(spec); assert.equal(count, 4);
stage({ ...spec, force: true }); assert.equal(count, 5);
stage({ ...spec, args: ['Debug'] }); assert.equal(count, 6);
// Failure clears an earlier cache and retry must execute.
assert.throws(() => stage({ ...spec, force: true, action: () => { throw Error('failure'); } }));
stage({ ...spec, args: ['Debug'] }); assert.equal(count, 7);
let h = hash([src]); const added = path.join(src, 'another.cs'); fs.writeFileSync(added, 'added'); assert.notEqual(hash([src]), h); fs.rmSync(added); assert.equal(hash([src]), h);
assert.notEqual(hash([path.join(src, 'missing.cs')]), hash([]));
const record = fs.readdirSync(spec.cacheRoot).find(p => p.endsWith('.json'));
fs.writeFileSync(path.join(spec.cacheRoot, record), '{}'); stage({ ...spec, args: ['Debug'] }); assert.equal(count, 8);
// Edits during compilation prevent cache publication.
stage({ ...spec, force: true, action: () => { count++; fs.writeFileSync(input, 'v3'); fs.writeFileSync(output, 'v3'); } });
stage(spec); assert.equal(count, 10);
// A second stage only rebuilds when its upstream output bytes change.
const image = path.join(dir, 'image'); let links = 0;
const link = { name: 'link', cacheRoot: spec.cacheRoot, inputs: [output], outputs: [image], action: () => { links++; fs.copyFileSync(output, image); } };
stage(link); stage(link); assert.equal(links, 1);
stage({ ...spec, force: true }); stage(link); assert.equal(links, 1);
fs.writeFileSync(input, 'v4'); stage(spec); stage(link); assert.equal(links, 2);
// Dependency digest can exclude addon rebuild outputs without hiding package damage.
const packageFile = path.join(dir, 'package.json'), nativeFile = path.join(dir, 'addon.node');
fs.writeFileSync(packageFile, '{}'); fs.writeFileSync(nativeFile, 'native-v1'); let installs = 0;
const dependencies = { name: 'dependencies', cacheRoot: spec.cacheRoot, inputs: [input], outputs: [packageFile, nativeFile], outputDigest: () => hash([packageFile]), action: () => { installs++; } };
stage(dependencies); fs.writeFileSync(nativeFile, 'native-v2'); stage(dependencies); assert.equal(installs, 1);
fs.writeFileSync(packageFile, '{"damaged":true}'); stage(dependencies); assert.equal(installs, 2);
// Windows paths remain individual arguments. Exercise all commands through
// the real launcher function; mock only the child process, not its construction.
const npmCli = path.join(dir, 'Node toolchain', 'node_modules', 'npm', 'bin', 'npm-cli.js');
fs.mkdirSync(path.dirname(npmCli), { recursive: true }); fs.writeFileSync(npmCli, '// fixture');
const commands = [['install', '--include=dev', '--workspaces'], ['run', 'build', '--workspace', '@kath/extension'], ['run', 'rebuild', '--workspace', '@kath/electron'], ['run', 'build:frontend', '--workspace', '@kath/electron']];
for (const args of commands) {
    let launched = false;
    runNpm({ node: 'C:\\Kand I\\Kath\\.toolchain\\Node\\node.exe', npmCli, args, cwd: 'C:\\Kand I\\Kath\\.toolchain\\NpmWorkspace', env: { fixture: 'value' }, spawn: (executable, argv, options) => {
        launched = true;
        assert.equal(executable, 'C:\\Kand I\\Kath\\.toolchain\\Node\\node.exe');
        assert.deepEqual(argv, [npmCli, ...args]); assert.equal(options.stdio, 'inherit');
        assert.equal(options.cwd, 'C:\\Kand I\\Kath\\.toolchain\\NpmWorkspace');
        assert.deepEqual(options.env, { fixture: 'value' }); return { status: 0 };
    } });
    assert(launched);
}
assert.throws(() => runNpm({ node: 'node', npmCli: npmCli + '.missing', args: [], cwd: dir }), /Bundled npm CLI is missing/);
assert.throws(() => runNpm({ node: 'node', npmCli, args: ['install'], cwd: dir, spawn: () => ({ status: 7 }) }), /exit 7/);
assert.throws(() => runNpm({ node: 'node', npmCli, args: ['install'], cwd: dir, spawn: () => ({ error: Error('spawn failure') }) }), /spawn failure/);
// Execute a fixture JS CLI with actual Node, including a path containing spaces.
fs.writeFileSync(npmCli, 'require("fs").writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)))');
const received = path.join(dir, 'received.json');
runNpm({ node: process.execPath, npmCli, args: [received, '--workspace', '@kath/electron', 'argument with spaces'], cwd: dir });
assert.deepEqual(JSON.parse(fs.readFileSync(received)), ['--workspace', '@kath/electron', 'argument with spaces']);
console.log('Npm launcher construction, error handling and real Node CLI argument forwarding passed.');
// Progress runs inside synchronous work and remains bounded between reports.
let clock = 0; const messages = [];
const report = progress('fixture scan', { now: () => clock, log: line => messages.push(line), interval: 5000 });
report('first'); clock = 4999; report('early'); assert.equal(messages.length, 0);
clock = 5000; report('5 files scanned'); report('duplicate'); assert.equal(messages.length, 1);
clock = 10000; report('8 MiB read'); assert.equal(messages.length, 2);
assert(messages[0].includes('5 files scanned')); assert(messages[1].includes('8 MiB read'));
const selected = files([src]);
assert.equal(hashFiles(selected, selected), hash(selected, [], true));
const scanReports = []; files([src], false, line => scanReports.push(line)); assert(scanReports.length > 0);
const hashReports = []; hash([src], [], false, line => hashReports.push(line)); assert(hashReports.some(line => line.includes('MiB read')));
// An explicit workspace link can be used as a root, but nested links never recurse.
const linked = path.join(dir, 'linked'); fs.symlinkSync(src, linked, 'junction');
assert(files([linked]).length > 0);
fs.symlinkSync(src, path.join(src, 'cycle'), 'junction'); assert.equal(files([src]).length, selected.length);
const log = console.log, phaseMessages = [];
try { console.log = line => phaseMessages.push(line); stage({ ...spec, force: true }); }
finally { console.log = log; }
assert(phaseMessages[0].includes('checking cache inputs'));
const completed = phaseMessages.findIndex(line => line.includes('command completed'));
const saved = phaseMessages.findIndex(line => line.includes('cache saved'));
assert(completed >= 0 && saved > completed);
console.log('Synchronous progress throttling, scan/hash reporting, digest equivalence, junction cycle protection and completion ordering passed.');
fs.rmSync(dir, { recursive: true });
console.log('Real Node cache tests: hits, content changes with preserved timestamps, output corruption/deletion, force/config changes, failure retry, missing/add/remove inputs, corrupt records, editor races and dependency propagation passed.');
