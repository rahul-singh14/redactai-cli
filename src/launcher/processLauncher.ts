import { spawn, ChildProcess } from 'child_process';
import { DiscoveredApp } from '../discovery/appScanner';
import chalk from 'chalk';
import * as path from 'path';
import * as os from 'os';

export class ProcessLauncher {
    public launch(app: DiscoveredApp, proxyPort: number, caPath: string): ChildProcess {
        console.log(chalk.blue(`🚀 Launching ${app.name} with forced proxy routing...`));

        const proxyUrl = `http://127.0.0.1:${proxyPort}`;

        const env = {
            ...process.env,
            HTTP_PROXY: proxyUrl,
            HTTPS_PROXY: proxyUrl,
            http_proxy: proxyUrl,
            https_proxy: proxyUrl,
            NODE_EXTRA_CA_CERTS: caPath,
            SSL_CERT_FILE: caPath,          // For Rust, Go, Python
            REQUESTS_CA_BUNDLE: caPath,     // For Python requests library
            // Specifically for VS Code / Electron based apps
            ELECTRON_NO_ATTACH_CONSOLE: 'true'
        };

        const args: string[] = [];

        // If it's an editor like VS Code or Cursor, we pass arguments to isolate it
        // so it doesn't just re-use an existing open window and ignore the env vars.
        if (app.type === 'editor') {
            args.push('--new-window');
            args.push('--user-data-dir=' + path.join(os.tmpdir(), `${app.id}_audit_profile`));
        }

        try {
            const child = spawn(app.executablePath, args, {
                env,
                detached: true,
                stdio: 'ignore'
            });

            child.on('error', (err) => {
                console.log(chalk.red(`\n❌ Failed to launch ${app.name}: ${err.message}`));
                console.log(chalk.yellow('Please check if the executable path is valid or run in manual mode.'));
            });

            child.unref();

            return child;
        } catch (err: any) {
            console.log(chalk.red(`\n❌ Failed to spawn process ${app.name}: ${err.message}`));
            return null as unknown as ChildProcess;
        }
    }
}
