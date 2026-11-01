#!/usr/bin/env node
// Executable entry: `npm create @lvy-jsd/dsh-tool-ultra-plugin@latest my-ext -- --type filter`
import { main } from './cli.js'

process.exitCode = main()
