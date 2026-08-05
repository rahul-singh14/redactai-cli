import chalk from 'chalk';
import { ProxyServer } from '../proxy/proxyServer';
import { CAManager } from '../proxy/caManager';
import { DashboardReporter } from '../dashboard/reporter';
import { AppScanner } from '../discovery/appScanner';
import { ProcessLauncher } from '../launcher/processLauncher';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as readline from 'readline';

const REDACTAI_HOME = path.join(os.homedir(), '.redactai-cli');

export async function startCommand() {
    try {
        console.log(chalk.bgBlue.white.bold('\n 🚀 REDACTAI EGRESS AUDITOR \n'));
        
        if (!fs.existsSync(REDACTAI_HOME)) {
            fs.mkdirSync(REDACTAI_HOME, { recursive: true });
        }

        console.log(chalk.blue('Initializing CA and TLS Proxy...'));
        const caManager = new CAManager(REDACTAI_HOME);
        await caManager.initialize();
        
        const reporter = new DashboardReporter();
        const proxy = new ProxyServer(caManager, reporter);
        
        const port = await proxy.start(0);
        console.log(chalk.green(`✅ Diagnostic Proxy listening on http://127.0.0.1:${port}`));
        
        console.log(chalk.blue('\nScanning for AI applications on this machine...'));
        const scanner = new AppScanner();
        const discoveredApps = scanner.scan();
        
        if (discoveredApps.length === 0) {
            console.log(chalk.yellow('No known AI applications discovered on this machine.'));
            console.log(chalk.gray('You can still manually route traffic by exporting HTTP_PROXY.'));
            
            // Manual mode
            reporter.setCurrentApp({ id: 'manual', name: 'Manual Agent', executablePath: '', type: 'agent' });
        } else {
            console.log(chalk.green(`Discovered ${discoveredApps.length} AI applications:`));
            discoveredApps.forEach((app, idx) => {
                console.log(chalk.cyan(`  [${idx + 1}] ${app.name} (${app.executablePath})`));
            });

            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            const answer = await new Promise<string>(resolve => {
                rl.question(chalk.yellow(`\nSelect an app to audit [1-${discoveredApps.length}] or 'm' for manual mode: `), resolve);
            });

            let appToAudit;
            if (answer.toLowerCase() === 'm') {
                appToAudit = { id: 'manual', name: 'Manual Agent', executablePath: '', type: 'agent' as const };
                console.log(chalk.yellow('\nManual mode selected. Route traffic by exporting HTTP_PROXY.'));
            } else {
                const idx = parseInt(answer, 10) - 1;
                appToAudit = discoveredApps[idx >= 0 && idx < discoveredApps.length ? idx : 0];
                console.log(chalk.yellow(`\nSelected: ${appToAudit.name}`));
            }

            reporter.setCurrentApp(appToAudit);
            
            if (appToAudit.id !== 'manual') {
                if (appToAudit.executablePath.startsWith('[running process:')) {
                    console.log(chalk.yellow(`\n${appToAudit.name} is already running in the background.`));
                    console.log(chalk.yellow('To audit it, you must configure its proxy manually or restart it with:'));
                    console.log(chalk.cyan(`export HTTP_PROXY=http://127.0.0.1:${port}`));
                    console.log(chalk.cyan(`export NODE_EXTRA_CA_CERTS=${caManager.getCaPath()}`));
                } else {
                    const launcher = new ProcessLauncher();
                    launcher.launch(appToAudit, port, caManager.getCaPath());
                }
            }

            console.log(chalk.cyan('\nMonitoring for AI traffic... (Press Enter again to stop and generate report)\n'));

            // We need to wait for another enter to stop
            rl.on('line', async () => {
                console.log(chalk.blue('\n\nStopping diagnostic proxy and analyzing logs...'));
                await proxy.stop();
                reporter.printReport();
                process.exit(0);
            });
        }

        // Handle Graceful Shutdown on Enter key for manual mode
        if (discoveredApps.length === 0) {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            rl.on('line', async () => {
                console.log(chalk.blue('\n\nStopping diagnostic proxy and analyzing logs...'));
                await proxy.stop();
                reporter.printReport();
                process.exit(0);
            });
        }
        
        // Also handle Ctrl+C
        process.on('SIGINT', async () => {
            console.log(chalk.blue('\n\nStopping diagnostic proxy...'));
            await proxy.stop();
            reporter.printReport();
            process.exit(0);
        });
    } catch (err: any) {
        console.error(chalk.red(`\n❌ Fatal Error: ${err.message}`));
        process.exit(1);
    }
}
