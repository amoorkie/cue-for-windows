const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const expected = require('../package.json').version;
const archives = [];
function find(directory, depth = 0) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === 'app.asar') archives.push(file);
    else if (entry.isDirectory() && depth < 5) find(file, depth + 1);
  }
}
find(path.resolve('dist'));
assert.ok(archives.length, 'No packaged apps found');
for (const archive of archives) {
  assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).version, expected);
  for (const file of ['main.js', 'preload.js', 'src/prompts.js', 'src/llm.js', 'src/local-stt.js', 'renderer/index.html', 'renderer/renderer.js', 'renderer/styles.css']) {
    assert.ok(asar.extractFile(archive, path.normalize(file)).equals(fs.readFileSync(file)), `Source mismatch: ${file}`);
  }
  for (const file of ['worker.py', 'download.py']) {
    assert.ok(fs.readFileSync(path.join(archive + '.unpacked', 'src', 'local-stt', file)).equals(fs.readFileSync(path.join('src', 'local-stt', file))), `Unpacked worker mismatch: ${file}`);
  }
  assert.ok(!asar.listPackage(archive).some((file) => /(?:^|[\\/])(?:\.local-stt|cue-data\.json|__pycache__)(?:[\\/]|$)|\.onnx$/i.test(file)), 'Private settings, cache or model weights in package');
  console.log(JSON.stringify({ archive, version: expected, verified: true }));
}
