const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'packages', 'kath');
const lib = path.join(root, 'lib');
const command = process.argv[2];

function copyDirectory(source, destination) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const src = path.join(source, entry.name);
        const dst = path.join(destination, entry.name);
        if (entry.isDirectory()) {
            copyDirectory(src, dst);
        } else if (entry.isFile()) {
            fs.copyFileSync(src, dst);
        }
    }
}

if (command === 'clean') {
    fs.rmSync(lib, { recursive: true, force: true });
    process.exit(0);
}

if (command === 'assets') {
    copyDirectory(path.join(root, 'src', 'browser', 'style'), path.join(lib, 'browser', 'style'));
    process.exit(0);
}

console.error('Usage: node CJS/extension-files.cjs <clean|assets>');
process.exit(2);
