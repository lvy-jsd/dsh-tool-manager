#!/usr/bin/env node
// Executable entry: `npm create tool-manager-plugin@latest my-ext -- --type filter`
import { main } from './cli.js'

process.exitCode = main()
