'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const manifest = require('./manifest.json');
const root = path.resolve(__dirname, '../..');
function loadBaseline() {
  const directory = path.join(root, '.media-build', `scoring-baseline-${manifest.baselineCommit}`);
  const hashes = {};
  for (const file of manifest.baselineFiles) {
    const bytes = execFileSync('git', ['show', `${manifest.baselineCommit}:${file}`], { cwd: root, maxBuffer: 1024 * 1024, windowsHide: true });
    hashes[file] = createHash('sha256').update(bytes).digest('hex');
    const destination = path.join(directory, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (!fs.existsSync(destination) || !fs.readFileSync(destination).equals(bytes)) fs.writeFileSync(destination, bytes);
  }
  return { ...require(path.join(directory, 'src/domain/draft-board.js')),
    ...require(path.join(directory, 'src/domain/roster-value.js')), sourceHashes: hashes, commit: manifest.baselineCommit };
}
module.exports = { loadBaseline };
