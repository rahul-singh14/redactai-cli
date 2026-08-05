export type EndpointCategory = 'AI_API' | 'TELEMETRY' | 'AUXILIARY' | 'UNKNOWN';

export interface EndpointDetails {
    provider: string;
    category: EndpointCategory;
}

export class EndpointDatabase {
    private db: Map<string, EndpointDetails> = new Map();

    constructor() {
        this.initializeData();
    }

    private initializeData() {
        // OpenAI
        this.db.set('api.openai.com', { provider: 'OpenAI', category: 'AI_API' });
        this.db.set('chatgpt.com', { provider: 'OpenAI', category: 'AI_API' });

        // Anthropic
        this.db.set('api.anthropic.com', { provider: 'Anthropic', category: 'AI_API' });

        // Cursor
        this.db.set('api2.cursor.sh', { provider: 'Cursor', category: 'AI_API' });
        this.db.set('telemetry.cursor.sh', { provider: 'Cursor', category: 'TELEMETRY' });
        this.db.set('repo-context.cursor.sh', { provider: 'Cursor', category: 'AI_API' });

        // Windsurf / Codeium
        this.db.set('api.codeium.com', { provider: 'Codeium', category: 'AI_API' });
        this.db.set('telemetry.codeium.com', { provider: 'Codeium', category: 'TELEMETRY' });

        // GitHub Copilot
        this.db.set('api.githubcopilot.com', { provider: 'GitHub', category: 'AI_API' });
        this.db.set('default.exp-tas.com', { provider: 'Microsoft', category: 'TELEMETRY' });
        
        // Kiro
        this.db.set('runtime.eu-central-1.kiro.dev', { provider: 'Kiro', category: 'AI_API' });
        this.db.set('management.eu-central-1.kiro.dev', { provider: 'Kiro', category: 'AUXILIARY' });
    }

    public classify(host: string): EndpointDetails {
        // Simple direct match for now, could be enhanced with regex for subdomains
        if (this.db.has(host)) {
            return this.db.get(host)!;
        }

        // Fuzzy matching
        if (host.includes('telemetry') || host.includes('metrics') || host.includes('analytics')) {
            return { provider: 'Unknown', category: 'TELEMETRY' };
        }

        if (host.includes('api') || host.includes('ai.')) {
            return { provider: 'Unknown', category: 'AI_API' };
        }

        return { provider: 'Unknown', category: 'UNKNOWN' };
    }
}
