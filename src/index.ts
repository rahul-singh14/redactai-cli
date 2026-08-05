#!/usr/bin/env node

import { Command } from 'commander';
import { startCommand } from './commands/start';

const program = new Command();

program
    .name('redactai-audit')
    .description('CLI to audit AI egress traffic and verify DLP coverage')
    .version('1.0.0');

program
    .command('start')
    .description('Start the diagnostic proxy and monitor AI traffic')
    .action(startCommand);

program.parse();
