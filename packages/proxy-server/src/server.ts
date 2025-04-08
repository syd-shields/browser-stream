import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import {
    BrowserbaseBrowserConnectionService,
    BrowserEventStream,
    LocalBrowserConnectionService,
} from './browser-event-stream';
import { BrowserConnectionService } from './browser-event-stream';
import { handleError } from './errors';

export interface ProxyServerOptions {
    port?: number;
    browserService?: BrowserConnectionService;
    enableDomains?: string[];
    connectionTimeout?: number;
    autoReconnect?: boolean;
    maxReconnectAttempts?: number;
    reconnectDelay?: number;
}

export class ProxyServer {
    private wss: WebSocketServer;
    private browserEventStream: BrowserEventStream | null = null;
    private options: ProxyServerOptions;

    constructor(server: Server, options: ProxyServerOptions = {}) {
        this.options = options;
        this.wss = new WebSocketServer({ server });

        this.wss.on('connection', (ws: WebSocket) => {
            if (!this.browserEventStream) {
                ws.close(1011, 'Browser not connected');
                return;
            }

            this.browserEventStream.addClient(ws);
        });
    }

    public async connectToBrowser(browserbaseSessionId?: string, browserbaseApiKey?: string): Promise<void> {
        try {
            if (this.browserEventStream) {
                await this.browserEventStream.disconnect('Reconnecting to new browser');
            }

            if (browserbaseSessionId && browserbaseApiKey) {
                const browserbaseBrowserService = new BrowserbaseBrowserConnectionService();

                this.browserEventStream = new BrowserEventStream(browserbaseBrowserService, {
                    browserbaseSessionId,
                    browserbaseApiKey,
                    enableDomains: this.options.enableDomains,
                    connectionTimeout: this.options.connectionTimeout,
                    autoReconnect: this.options.autoReconnect,
                    maxReconnectAttempts: this.options.maxReconnectAttempts,
                    reconnectDelay: this.options.reconnectDelay,
                });
            } else {
                console.log('No session ID or API key provided. Using local browser connection service.');
                const localBrowserService = new LocalBrowserConnectionService();

                this.browserEventStream = new BrowserEventStream(localBrowserService, {
                    enableDomains: this.options.enableDomains,
                    connectionTimeout: this.options.connectionTimeout,
                    autoReconnect: this.options.autoReconnect,
                    maxReconnectAttempts: this.options.maxReconnectAttempts,
                    reconnectDelay: this.options.reconnectDelay,
                });
            }

            // Set up event listeners for the browser event stream
            this.browserEventStream.on('connect', () => {
                console.log(`Connected to browser session: ${browserbaseSessionId}`);
            });

            this.browserEventStream.on('disconnect', (reason) => {
                console.log(`Disconnected from browser session: ${browserbaseSessionId}, reason: ${reason}`);
            });

            this.browserEventStream.on('browser-event', (event) => {
                console.log(`Browser event: ${event.domain}.${event.method}`);
            });

            this.browserEventStream.on('', (event) => {
                console.log(`Browser event: ${event.domain}.${event.method}`);
            });

            await this.browserEventStream.connect();
        } catch (error) {
            handleError(error);
            throw error;
        }
    }

    public async disconnectFromBrowser(): Promise<void> {
        if (this.browserEventStream) {
            await this.browserEventStream.disconnect('Client requested disconnect');
            this.browserEventStream = null;
        }
    }

    public isConnected(): boolean {
        return this.browserEventStream?.isConnected() || false;
    }

    public getClientCount(): number {
        return this.browserEventStream?.getClientCount() || 0;
    }
}
