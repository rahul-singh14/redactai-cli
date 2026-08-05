import * as forge from 'node-forge';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CAMetadata {
    /** Directory passed to http-mitm-proxy as sslCaDir. */
    caDir: string;
    /** Path to the root CA certificate (this is the file the user installs into the trust store). */
    certPath: string;
    /** Path to the root CA private key (owner-only). */
    keyPath: string;
    expiresAt: number;
}

/**
 * Manages the Local Certificate Authority used by the proxy for MITM.
 *
 * IMPORTANT: http-mitm-proxy owns the CA on disk. It expects, under its `sslCaDir`:
 *   <caDir>/certs/ca.pem          <- root certificate
 *   <caDir>/keys/ca.private.key   <- root private key
 * and it mints per-host leaf certificates itself using that CA.
 *
 * To keep a single source of truth, this manager generates the CA directly into
 * that layout (if absent) and reports `certPath` = <caDir>/certs/ca.pem, which is
 * exactly the certificate the user must trust. This guarantees the CA the OS
 * trusts is the same CA the proxy signs leaf certificates with.
 */
export class CAManager {
    private caDir: string;
    private certsDir: string;
    private keysDir: string;
    private certPath: string;
    private keyPath: string;
    private activeCA: CAMetadata | null = null;

    // Root CA validity in years (must be between 1 and 10).
    private validityYears = 2;

    constructor(baseDir?: string) {
        // baseDir is the http-mitm-proxy sslCaDir.
        this.caDir = baseDir || path.join(os.homedir(), '.redactai', 'ca');
        this.certsDir = path.join(this.caDir, 'certs');
        this.keysDir = path.join(this.caDir, 'keys');
        // http-mitm-proxy's fixed filenames.
        this.certPath = path.join(this.certsDir, 'ca.pem');
        this.keyPath = path.join(this.keysDir, 'ca.private.key');

        fs.mkdirSync(this.caDir, { recursive: true, mode: 0o700 });
        fs.mkdirSync(this.certsDir, { recursive: true, mode: 0o700 });
        fs.mkdirSync(this.keysDir, { recursive: true, mode: 0o700 });
    }

    public getStoragePath(): string {
        return this.caDir;
    }

    public getCaPath(): string {
        return this.certPath;
    }

    /**
     * Ensures a valid CA exists on disk, generating one if absent, expiring, or
     * stored with insecure permissions.
     */
    async initialize(): Promise<void> {
        if (fs.existsSync(this.certPath) && fs.existsSync(this.keyPath)) {
            if (!this.isPrivateKeyOwnerOnly(this.keyPath)) {
                console.warn('🛡️ RedactAI: CA private key has insecure permissions. Regenerating...');
                await this.regenerate();
                return;
            }

            try {
                const certPem = fs.readFileSync(this.certPath, 'utf8');
                const cert = forge.pki.certificateFromPem(certPem);
                const now = Date.now();
                const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

                if (cert.validity.notAfter.getTime() - now < thirtyDaysMs) {
                    console.warn('🛡️ RedactAI: CA certificate expiring soon. Regenerating...');
                    await this.regenerate();
                    return;
                }

                this.activeCA = {
                    caDir: this.caDir,
                    certPath: this.certPath,
                    keyPath: this.keyPath,
                    expiresAt: cert.validity.notAfter.getTime(),
                };
                return;
            } catch (err) {
                console.warn('🛡️ RedactAI: Existing CA is unreadable. Regenerating...', err);
                await this.regenerate();
                return;
            }
        }

        await this.generate();
    }

    /**
     * Checks that the private key file is readable/writable only by the owner (0o600).
     */
    isPrivateKeyOwnerOnly(keyPath: string = this.activeCA?.keyPath || this.keyPath): boolean {
        if (!keyPath || !fs.existsSync(keyPath)) return false;
        if (os.platform() === 'win32') {
            // Windows does not support UNIX file modes like 0o600.
            // fs.statSync returns 0o666 for writable files, which fails the strict check.
            return true;
        }
        const stat = fs.statSync(keyPath);
        return (stat.mode & 0o777) === 0o600;
    }

    /**
     * Regenerates the CA in place. Generates into staging files first, then
     * atomically replaces the live cert/key so a failure leaves the previous CA
     * intact. On success, updates the active CA pointer to the live paths.
     */
    async regenerate(): Promise<void> {
        const stageCert = `${this.certPath}.stage`;
        const stageKey = `${this.keyPath}.stage`;

        try {
            const meta = await this.writeCA(stageCert, stageKey);

            // Atomically promote staging to live.
            fs.renameSync(stageCert, this.certPath);
            fs.renameSync(stageKey, this.keyPath);
            fs.renameSync(stageKey.replace('ca.private.key', 'ca.public.key'), this.keyPath.replace('ca.private.key', 'ca.public.key'));

            // Point the active CA at the LIVE paths, not the staging paths.
            this.activeCA = {
                caDir: this.caDir,
                certPath: this.certPath,
                keyPath: this.keyPath,
                expiresAt: meta.expiresAt,
            };
        } catch (error) {
            // Roll back: discard any staging artifacts, keep the previous CA active.
            if (fs.existsSync(stageCert)) fs.rmSync(stageCert);
            if (fs.existsSync(stageKey)) fs.rmSync(stageKey);
            console.error('🛡️ RedactAI: CA regeneration failed, previous CA retained.', error);
            throw error;
        }
    }

    /**
     * First-time generation directly into the live cert/key paths.
     */
    private async generate(): Promise<void> {
        const tmpCert = `${this.certPath}.tmp.${Date.now()}`;
        const tmpKey = `${this.keyPath}.tmp.${Date.now()}`;

        try {
            const meta = await this.writeCA(tmpCert, tmpKey);
            fs.renameSync(tmpCert, this.certPath);
            fs.renameSync(tmpKey, this.keyPath);
            fs.renameSync(tmpKey.replace('ca.private.key', 'ca.public.key'), this.keyPath.replace('ca.private.key', 'ca.public.key'));
            this.activeCA = {
                caDir: this.caDir,
                certPath: this.certPath,
                keyPath: this.keyPath,
                expiresAt: meta.expiresAt,
            };
        } catch (error) {
            if (fs.existsSync(tmpCert)) fs.rmSync(tmpCert);
            if (fs.existsSync(tmpKey)) fs.rmSync(tmpKey);
            throw error;
        }
    }

    /**
     * Generates a root CA keypair + certificate and writes them to the given
     * paths (cert world-readable, key owner-only). Returns basic metadata.
     */
    private writeCA(certPath: string, keyPath: string): Promise<{ expiresAt: number }> {
        return new Promise((resolve, reject) => {
            forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 }, (err, keys) => {
                if (err) return reject(err);

                try {
                    const cert = forge.pki.createCertificate();
                    cert.publicKey = keys.publicKey;
                    cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(16));

                    const now = new Date();
                    cert.validity.notBefore = now;

                    const years = Math.max(1, Math.min(10, this.validityYears));
                    const expiresAt = new Date(now);
                    expiresAt.setFullYear(now.getFullYear() + years);
                    cert.validity.notAfter = expiresAt;

                    const attrs = [
                        { name: 'commonName', value: 'RedactAI Local Proxy CA' },
                        { name: 'organizationName', value: 'RedactAI' },
                    ];
                    cert.setSubject(attrs);
                    cert.setIssuer(attrs);
                    cert.setExtensions([
                        { name: 'basicConstraints', cA: true },
                        { name: 'keyUsage', keyCertSign: true, cRLSign: true },
                        { name: 'subjectKeyIdentifier' },
                    ]);

                    cert.sign(keys.privateKey, forge.md.sha256.create());

                    const pemCert = forge.pki.certificateToPem(cert);
                    const pemKey = forge.pki.privateKeyToPem(keys.privateKey);
                    const pemPubKey = forge.pki.publicKeyToPem(keys.publicKey);

                    // Write to temp files
                    const tempCert = `${certPath}.tmp.${Date.now()}`;
                    const tempKey = `${keyPath}.tmp.${Date.now()}`;
                    const pubKeyPath = keyPath.replace('ca.private.key', 'ca.public.key');
                    const tempPubKey = `${pubKeyPath}.tmp.${Date.now()}`;

                    const fdCert = fs.openSync(tempCert, 'w');
                    fs.writeSync(fdCert, pemCert);
                    fs.fsyncSync(fdCert);
                    fs.closeSync(fdCert);

                    const fdKey = fs.openSync(tempKey, 'w', 0o600);
                    fs.writeSync(fdKey, pemKey);
                    fs.fsyncSync(fdKey);
                    fs.closeSync(fdKey);
                    
                    const fdPubKey = fs.openSync(tempPubKey, 'w');
                    fs.writeSync(fdPubKey, pemPubKey);
                    fs.fsyncSync(fdPubKey);
                    fs.closeSync(fdPubKey);

                    // Rename temp to target
                    fs.renameSync(tempCert, certPath);
                    fs.renameSync(tempKey, keyPath);
                    fs.renameSync(tempPubKey, pubKeyPath);

                    resolve({ expiresAt: expiresAt.getTime() });
                } catch (genErr) {
                    reject(genErr);
                }
            });
        });
    }

    /**
     * Returns the active CA metadata, including the sslCaDir to hand to the proxy
     * and the root cert path the user must install into their trust store.
     */
    getActiveCA(): CAMetadata | null {
        return this.activeCA;
    }
}
