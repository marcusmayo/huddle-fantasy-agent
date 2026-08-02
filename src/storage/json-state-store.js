'use strict';

const fs = require('node:fs');
const path = require('node:path');

class JsonStateStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
  }

  load() {
    if (!fs.existsSync(this.filePath)) return { sessions: {} };
    return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
  }

  save(state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tempPath, this.filePath);
  }
}

class MemoryStateStore {
  constructor(initial = { sessions: {} }) {
    this.state = structuredClone(initial);
  }

  load() {
    return structuredClone(this.state);
  }

  save(state) {
    this.state = structuredClone(state);
  }
}

module.exports = { JsonStateStore, MemoryStateStore };
