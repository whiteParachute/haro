#!/usr/bin/env node
'use strict';
const { writeSync } = require('node:fs');
const { runCli } = require('../dist/index.js');

patchSyncWrite(process.stdout, 1);
patchSyncWrite(process.stderr, 2);

function patchSyncWrite(stream, fd) {
  const originalWrite = stream.write.bind(stream);
  stream.write = function patchedWrite(chunk, encoding, callback) {
    const done = typeof encoding === 'function' ? encoding : callback;
    try {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8');
      writeSync(fd, buffer);
      if (typeof done === 'function') done();
      return true;
    } catch (error) {
      return originalWrite(chunk, encoding, callback);
    }
  };
}

function flushStream(stream) {
  return new Promise((resolve) => {
    if (!stream || typeof stream.write !== 'function') {
      resolve();
      return;
    }
    if (stream.writableNeedDrain) {
      stream.once('drain', resolve);
      return;
    }
    setImmediate(resolve);
  });
}

async function main() {
  try {
    const result = await runCli();
    await Promise.all([flushStream(process.stdout), flushStream(process.stderr)]);
    process.exitCode = result.exitCode;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    await flushStream(process.stderr);
    process.exitCode = 1;
  }
}

main();
