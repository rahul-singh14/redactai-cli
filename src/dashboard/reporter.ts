import chalk from 'chalk';
import { EndpointDatabase, EndpointDetails } from '../analysis/endpointDatabase';
import { DiscoveredApp } from '../discovery/appScanner';

interface HostStats {
    bytesSent: number;
    bytesReceived: number;
    details: EndpointDetails;
    payloadStructures: Set<string>;
    bypassed: boolean;
}

export class DashboardReporter {
    private appConnections = new Map<string, Map<string, HostStats>>();
    private currentApp: DiscoveredApp | null = null;
    private db = new EndpointDatabase();

    public setCurrentApp(app: DiscoveredApp) {
        this.currentApp = app;
        if (!this.appConnections.has(app.id)) {
            this.appConnections.set(app.id, new Map());
        }
    }

    private getStats(host: string): HostStats {
        const appId = this.currentApp ? this.currentApp.id : 'unknown';
        if (!this.appConnections.has(appId)) {
            this.appConnections.set(appId, new Map());
        }
        
        const hostMap = this.appConnections.get(appId)!;
        if (!hostMap.has(host)) {
            hostMap.set(host, {
                bytesSent: 0,
                bytesReceived: 0,
                details: this.db.classify(host),
                payloadStructures: new Set(),
                bypassed: false
            });
            console.log(chalk.cyan('[NEW CONNECTION]') + ` ${appId} -> ${chalk.bold(host)} [${hostMap.get(host)!.details.category}]`);
        }
        return hostMap.get(host)!;
    }

    public logConnection(host: string) {
        this.getStats(host);
    }

    public markBypassed(host: string) {
        const stats = this.getStats(host);
        stats.bypassed = true;
    }

    public addBytesSent(host: string, bytes: number) {
        const stats = this.getStats(host);
        stats.bytesSent += bytes;
        console.log(chalk.yellow('[PAYLOAD SENT]') + ` ${bytes} bytes to ${chalk.bold(host)}`);
    }

    public addBytesReceived(host: string, bytes: number) {
        const stats = this.getStats(host);
        stats.bytesReceived += bytes;
        // console.log(chalk.green(`[PAYLOAD RECEIVED]`) + ` ${bytes} bytes from ${chalk.bold(host)}`);
    }

    public logPayloadStructure(host: string, keys: string) {
        const stats = this.getStats(host);
        stats.payloadStructures.add(keys);
        console.log(chalk.magenta('[INSPECTED JSON KEYS]') + ` ${keys}`);
    }

    public printReport() {
        console.log('\n' + chalk.bgBlue.white.bold(' 🚨 REDACTAI EGRESS AUDIT REPORT 🚨 ') + '\n');
        
        if (this.appConnections.size === 0) {
            console.log(chalk.gray('No AI egress traffic detected during the audit session.'));
            return;
        }

        for (const [appId, hostMap] of this.appConnections.entries()) {
            console.log(chalk.bgGray.white.bold(` 📦 APPLICATION: ${appId.toUpperCase()} `));
            
            let hasAiApi = false;
            let isBypassed = false;

            for (const [host, stats] of hostMap.entries()) {
                console.log(chalk.bold.white(`\nEndpoint: ${host}`) + chalk.gray(` (${stats.details.provider})`));
                console.log(chalk.yellow(`  ⬆ Sent: ${stats.bytesSent} bytes`) + ' | ' + chalk.green(`⬇ Received: ${stats.bytesReceived} bytes`));
                
                if (stats.bypassed) {
                    console.log(chalk.red.bold('  ❌ BYPASS DETECTED: This tool ignores corporate proxies/DLP.'));
                    isBypassed = true;
                }

                if (stats.details.category === 'TELEMETRY') {
                    console.log(chalk.red('  ⚠️ Category: TELEMETRY (Tracking / Usage Data)'));
                } else if (stats.details.category === 'AI_API') {
                    console.log(chalk.magenta('  🧠 Category: AI_API (Model Prompts / Context)'));
                    hasAiApi = true;
                }

                if (stats.payloadStructures.size > 0) {
                    console.log(chalk.cyan('  📝 Sanitized Payload Structure (JSON Keys):'));
                    for (const keys of stats.payloadStructures) {
                        console.log(chalk.cyan(`      { ${keys} }`));
                    }
                }
            }

            console.log('\n' + chalk.bold('Risk Assessment:'));
            if (isBypassed) {
                console.log(chalk.red('🔴 NOT COVERED: This tool bypasses standard DLP. Must be blocked at the network level.'));
            } else if (hasAiApi) {
                console.log(chalk.yellow('🟡 COVERED: This tool sends AI API payloads, but routes safely through the Proxy/DLP.'));
            } else {
                console.log(chalk.green('🟢 FULLY LOCAL: No AI model API endpoints were contacted.'));
            }

            console.log('--------------------------------------------------\n');
        }
    }
}
