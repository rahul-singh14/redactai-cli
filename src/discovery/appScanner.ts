import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';

export interface DiscoveredApp {
    id: string;
    name: string;
    executablePath: string;
    type: 'editor' | 'cli' | 'agent';
}

export class AppScanner {
    public scan(): DiscoveredApp[] {
        const apps: DiscoveredApp[] = [];
        const platform = os.platform();

        if (platform === 'win32') {
            this.scanWindows(apps);
        } else if (platform === 'darwin') {
            this.scanMacOS(apps);
        } else {
            this.scanLinux(apps);
        }

        // Also scan running processes for AI tools that might be installed
        // in non-standard locations
        this.scanRunningProcesses(apps);

        // Check for VS Code extensions (Copilot, Cody, Continue)
        const vscodeApp = apps.find(a => a.id === 'vscode');
        if (vscodeApp) {
            const extensionsDir = path.join(os.homedir(), '.vscode', 'extensions');
            if (fs.existsSync(extensionsDir)) {
                try {
                    const extensions = fs.readdirSync(extensionsDir);
                    const aiExtensions = extensions.filter(e =>
                        e.startsWith('github.copilot-') ||
                        e.startsWith('sourcegraph.cody-') ||
                        e.startsWith('continue.')
                    );
                    if (aiExtensions.length > 0) {
                        vscodeApp.name = `VS Code (${aiExtensions.map(e => e.split('-')[0].split('.')[1]).join(', ')})`;
                    }
                } catch {
                    // Can't read extensions dir, keep generic name
                }
            }
        }

        return apps;
    }

    private scanWindows(apps: DiscoveredApp[]) {
        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

        const knownApps = [
            {
                id: 'cursor',
                name: 'Cursor AI',
                type: 'editor' as const,
                paths: [
                    path.join(localAppData, 'Programs', 'cursor', 'Cursor.exe'),
                    path.join(localAppData, 'cursor', 'Cursor.exe'),
                ]
            },
            {
                id: 'windsurf',
                name: 'Windsurf',
                type: 'editor' as const,
                paths: [
                    path.join(localAppData, 'Programs', 'windsurf', 'Windsurf.exe'),
                    path.join(localAppData, 'Programs', 'Windsurf', 'Windsurf.exe'),
                ]
            },
            {
                id: 'vscode',
                name: 'VS Code',
                type: 'editor' as const,
                paths: [
                    path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'),
                    path.join(programFiles, 'Microsoft VS Code', 'Code.exe'),
                ]
            },
            {
                id: 'kiro',
                name: 'Kiro',
                type: 'editor' as const,
                paths: [
                    path.join(localAppData, 'Programs', 'kiro', 'Kiro.exe'),
                    path.join(localAppData, 'Programs', 'Kiro', 'Kiro.exe'),
                ]
            },
            {
                id: 'chatgpt',
                name: 'ChatGPT Desktop',
                type: 'agent' as const,
                paths: [
                    path.join(localAppData, 'Programs', 'chatgpt', 'ChatGPT.exe'),
                    path.join(appData, 'ChatGPT', 'ChatGPT.exe'),
                ]
            },
            {
                id: 'claude',
                name: 'Claude Desktop',
                type: 'agent' as const,
                paths: [
                    path.join(localAppData, 'Programs', 'claude', 'Claude.exe'),
                    path.join(appData, 'Claude', 'Claude.exe'),
                ]
            },
            {
                id: 'lmstudio',
                name: 'LM Studio',
                type: 'agent' as const,
                paths: [
                    path.join(localAppData, 'Programs', 'lm-studio', 'LM Studio.exe'),
                ]
            }
        ];

        for (const app of knownApps) {
            // Check if we already discovered this app via a previous path
            if (apps.find(a => a.id === app.id)) continue;

            for (const p of app.paths) {
                if (fs.existsSync(p)) {
                    apps.push({
                        id: app.id,
                        name: app.name,
                        executablePath: p,
                        type: app.type
                    });
                    break; // Found it, don't check other paths
                }
            }
        }

    }

    private scanMacOS(apps: DiscoveredApp[]) {
        const knownApps = [
            { id: 'cursor', name: 'Cursor AI', type: 'editor' as const, path: '/Applications/Cursor.app/Contents/MacOS/Cursor' },
            { id: 'windsurf', name: 'Windsurf', type: 'editor' as const, path: '/Applications/Windsurf.app/Contents/MacOS/Windsurf' },
            { id: 'vscode', name: 'VS Code', type: 'editor' as const, path: '/Applications/Visual Studio Code.app/Contents/MacOS/Electron' },
            { id: 'kiro', name: 'Kiro', type: 'editor' as const, path: '/Applications/Kiro.app/Contents/MacOS/Kiro' },
            { id: 'chatgpt', name: 'ChatGPT Desktop', type: 'agent' as const, path: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT' },
            { id: 'claude', name: 'Claude Desktop', type: 'agent' as const, path: '/Applications/Claude.app/Contents/MacOS/Claude' },
            { id: 'lmstudio', name: 'LM Studio', type: 'agent' as const, path: '/Applications/LM Studio.app/Contents/MacOS/LM Studio' },
        ];

        for (const app of knownApps) {
            if (fs.existsSync(app.path)) {
                apps.push({ id: app.id, name: app.name, executablePath: app.path, type: app.type });
            }
        }
    }

    private scanLinux(apps: DiscoveredApp[]) {
        const homeBin = path.join(os.homedir(), '.local', 'bin');
        const knownApps = [
            { id: 'cursor', name: 'Cursor AI', type: 'editor' as const, paths: ['/usr/bin/cursor', path.join(homeBin, 'cursor')] },
            { id: 'vscode', name: 'VS Code', type: 'editor' as const, paths: ['/usr/bin/code', '/usr/share/code/code'] },
        ];

        for (const app of knownApps) {
            for (const p of app.paths) {
                if (fs.existsSync(p)) {
                    apps.push({ id: app.id, name: app.name, executablePath: p, type: app.type });
                    break;
                }
            }
        }
    }

    private scanRunningProcesses(apps: DiscoveredApp[]) {
        // Skip if we can't run system commands
        try {
            const platform = os.platform();
            let output = '';

            if (platform === 'win32') {
                output = child_process.execSync(
                    'wmic process get name,executablepath /format:csv',
                    { encoding: 'utf8', timeout: 5000 }
                );
            } else {
                output = child_process.execSync(
                    'ps -eo comm',
                    { encoding: 'utf8', timeout: 5000 }
                );
            }

            const processNames = output.toLowerCase();
            const processIndicators = [
                { id: 'ollama', name: 'Ollama', type: 'agent' as const, keyword: 'ollama' },
                { id: 'aider', name: 'Aider', type: 'cli' as const, keyword: 'aider' },
                { id: 'warp', name: 'Warp Terminal (AI)', type: 'cli' as const, keyword: 'warp' },
            ];

            for (const proc of processIndicators) {
                if (apps.find(a => a.id === proc.id)) continue;
                if (processNames.includes(proc.keyword)) {
                    apps.push({
                        id: proc.id,
                        name: proc.name,
                        executablePath: `[running process: ${proc.keyword}]`,
                        type: proc.type
                    });
                }
            }
        } catch {
            // Process scan failed, not critical
        }
    }
}
