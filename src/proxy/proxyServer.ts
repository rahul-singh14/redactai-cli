import * as net from 'net';
import * as http from 'http';
import { CAManager } from './caManager';
import { DashboardReporter } from '../dashboard/reporter';

export class ProxyServer {
    private proxy: any; // http-mitm-proxy instance
    private caManager: CAManager;
    private reporter: DashboardReporter;
    
    constructor(
        caManager: CAManager,
        reporter: DashboardReporter
    ) {
        this.caManager = caManager;
        this.reporter = reporter;
        
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mitmProxy = require('http-mitm-proxy');
        this.proxy = new mitmProxy.Proxy();
        
        this.setupHandlers();
    }

    private setupHandlers() {
        this.proxy.onError((ctx: any, err: any, _errorKind: any) => {
            const host = ctx?.clientToProxyRequest?.headers?.host || 'unknown';
            
            // Check for pinning failure (client rejected our cert)
            if (err?.code === 'ECONNRESET' || err?.message?.includes('certificate unknown') || err?.message?.includes('bad certificate')) {
                // This means the AI tool detected the MITM and rejected it!
                // This is a BYPASS detection.
                this.reporter.logConnection(host);
                this.reporter.markBypassed(host);
                console.log(`\n❌ [BYPASS DETECTED] Host ${host} rejected the Local CA. This tool uses Certificate Pinning.`);
            }
        });

        // onConnect is called when a CONNECT request is received.
        this.proxy.onConnect((req: http.IncomingMessage, socket: net.Socket, head: any, callback: any) => {
            const host = req.url?.split(':')[0] || '';
            this.reporter.logConnection(host);
            
            // In the Auditor, we intercept ALL traffic. No passthrough lists.
            return callback();
        });

        // onRequest is called when a decrypted HTTP request is received
        this.proxy.onRequest((ctx: any, callback: any) => {
            const rawHost = ctx.clientToProxyRequest.headers.host || '';
            const host = rawHost.split(':')[0]; // Strip port for consistent matching
            
            let bytesSent = 0;
            const chunks: Buffer[] = [];
            let bufferedSize = 0;
            const MAX_BUFFER_SIZE = 100 * 1024; // 100KB limit to prevent OOM on large uploads
            
            ctx.onRequestData((ctx: any, chunk: Buffer, callback: any) => {
                bytesSent += chunk.length;
                if (bufferedSize < MAX_BUFFER_SIZE) {
                    chunks.push(chunk);
                    bufferedSize += chunk.length;
                }
                return callback(null, chunk);
            });

            ctx.onRequestEnd((ctx: any, callback: any) => {
                if (bytesSent > 0) {
                    this.reporter.addBytesSent(host, bytesSent);
                    
                    try {
                        const body = Buffer.concat(chunks).toString('utf8');
                        if (body.startsWith('{') || body.startsWith('[')) {
                            const parsed = JSON.parse(body);
                            const keys = Array.isArray(parsed) ? 'Array of objects' : Object.keys(parsed).join(', ');
                            this.reporter.logPayloadStructure(host, keys);
                        }
                    } catch (e) {
                        // Not JSON, ignore
                    }
                }
                return callback();
            });

            let bytesReceived = 0;
            ctx.onResponseData((ctx: any, chunk: Buffer, callback: any) => {
                bytesReceived += chunk.length;
                return callback(null, chunk); // Forward untouched
            });

            ctx.onResponseEnd((ctx: any, callback: any) => {
                if (bytesReceived > 0) {
                    this.reporter.addBytesReceived(host, bytesReceived);
                }
                return callback();
            });

            return callback();
        });
    }

    public async start(port: number = 0): Promise<number> {
        return new Promise((resolve, reject) => {
            try {
                this.proxy.listen({
                    port,
                    sslCaDir: this.caManager.getStoragePath(),
                    keepAlive: true,
                    forceSNI: true
                }, (err: any) => {
                    if (err) {
                        return reject(err);
                    }
                    
                    const actualPort = this.proxy.httpServer.address().port;
                    resolve(actualPort);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    public async stop(): Promise<void> {
        return new Promise((resolve) => {
            this.proxy.close();
            resolve();
        });
    }
}
