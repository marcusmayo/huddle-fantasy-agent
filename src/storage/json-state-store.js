'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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
    const tempPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      const descriptor = fs.openSync(tempPath, 'wx', 0o600);
      try {
        fs.writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      throw error;
    }
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
