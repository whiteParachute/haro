#!/usr/bin/env node
'use strict';
const { runCli } = require('../dist/index.js');
const result = runCli();
process.exit(result.exitCode);
