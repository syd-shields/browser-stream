import { EventEmitter } from 'events';
import { Browser, BrowserContext, CDPSession, chromium, Page } from 'playwright-core';
import { Protocol } from 'playwright-core/types/protocol';
import { handleError, ServerError } from './errors';
import { BrowserEvent, DomInteractionEventData } from './types';
import { isCDPDomain } from './utils';
import { v4 as uuidv4 } from 'uuid';
import { WebSocket } from 'ws';

export interface BrowserConnectionOptions {
    browserbaseSessionId?: string;
    browserbaseApiKey?: string;
    enableDomains?: string[];
    connectionTimeout?: number; // ms
    autoReconnect?: boolean;
    maxReconnectAttempts?: number;
    reconnectDelay?: number;
}

export interface BrowserConnectionResponse {
    success: boolean;
    connected: boolean;
    browser?: Browser;
    context?: BrowserContext;
    page?: Page;
    cdpSession?: CDPSession;
}

export interface BrowserConnectionService {
    connect(options: BrowserConnectionOptions): Promise<BrowserConnectionResponse>;
    disconnect(browser: Browser): Promise<BrowserConnectionResponse>;
}

export class BrowserbaseBrowserConnectionService implements BrowserConnectionService {
    async connect(options: BrowserConnectionOptions) {
        try {
            const browser = await chromium.connectOverCDP(
                `wss://connect.browserbase.com?apiKey=${options.browserbaseApiKey}&sessionId=${options.browserbaseSessionId}`
            );
            const context = browser.contexts()[0];
            const page = context.pages()[0];
            const cdpSession = await page.context().newCDPSession(page);

            return {
                success: true,
                connected: true,
                browser,
                context,
                page,
                cdpSession,
            };
        } catch (error) {
            handleError(error);
            return { success: false, connected: false };
        }
    }
    async disconnect(browser: Browser) {
        try {
            await browser.close();
            return { success: true, connected: false };
        } catch (error) {
            return { success: false, connected: false };
        }
    }
}
export class LocalBrowserConnectionService implements BrowserConnectionService {
    //@ts-ignore
    async connect(options: Parial<BrowserConnectionOptions>) {
        try {
            const browser = await chromium.launch({
                headless: false,
            });
            const context = await browser.newContext();
            const page = await context.newPage();
            const cdpSession = await page.context().newCDPSession(page);

            console.log('Connected to local browser');
            return { success: true, connected: true, browser, context, page, cdpSession };
        } catch (error) {
            handleError(error);

            console.log('Failed to connect to local browser', error);
            return { success: false, connected: false };
        }
    }
    async disconnect(browser: Browser): Promise<BrowserConnectionResponse> {
        try {
            await browser.close();
            return { success: true, connected: false };
        } catch (error) {
            return { success: false, connected: false };
        }
    }
}

const defaultConfig: Partial<BrowserConnectionOptions> = {
    connectionTimeout: 30000,
    autoReconnect: true,
    maxReconnectAttempts: 5,
    reconnectDelay: 5000,
};

interface RegisteredClient {
    id: string;
    client: WebSocket;
    createdAt: Date;
    lastActive: Date;
}

export class BrowserEventStream extends EventEmitter {
    private createdAt: Date = new Date();
    private clientRegistry: Map<string, RegisteredClient> = new Map();

    private options: BrowserConnectionOptions;
    private browserService: BrowserConnectionService;

    private clients: Set<WebSocket> = new Set();

    private connected: boolean = false;
    private connecting: boolean = false;

    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private cdpSession: CDPSession | null = null;

    constructor(browserService: BrowserConnectionService, options: BrowserConnectionOptions) {
        super();

        this.options = {
            ...defaultConfig,
            ...options,
        };

        this.browserService = browserService;

        // Bind methods to ensure correct 'this' context
        this.connect = this.connect.bind(this);
        this.disconnect = this.disconnect.bind(this);
        this.isConnected = this.isConnected.bind(this);
        this.getCreatedAt = this.getCreatedAt.bind(this);
        this.getClientCount = this.getClientCount.bind(this);
        this.sendCdpCommandToBrowser = this.sendCdpCommandToBrowser.bind(this);
        this.broadcastToClients = this.broadcastToClients.bind(this);
        this.setupStandardCdpEventListeners = this.setupStandardCdpEventListeners.bind(this);
        this.injectDomInteractionTracker = this.injectDomInteractionTracker.bind(this);
    }
    public async connect() {
        if (this.connected || this.connecting) return;
        this.connecting = true;
        console.log('Connecting to the browser event stream...');
        try {
            const { browser, context, page, cdpSession } = await this.browserService.connect(this.options);

            console.log('Connected to the browser event stream');

            if (!browser) throw new ServerError(`Failed to connect to browser, no browser returned`);
            if (!context) throw new ServerError(`Failed to connect to browser, no context returned`);
            if (!page) throw new ServerError(`Failed to connect to browser, no page returned`);
            if (!cdpSession) throw new ServerError(`Failed to connect to browser, no CDP client returned`);

            this.browser = browser;
            this.context = context;
            this.page = page;
            this.cdpSession = cdpSession;

            // Set up event listeners
            try {
                await this.setUpEventListeners();
            } catch (error) {
                handleError(error);
            }

            // Inject DOM interaction tracker
            try {
                await this.injectDomInteractionTracker();
            } catch (error) {
                handleError(error);
            }

            this.connected = true;
            this.connecting = false;

            this.emit('connect', {
                browserbaseSessionId: this.options.browserbaseSessionId,
                timestamp: Date.now(),
            });
        } catch (error) {
            this.connecting = false;
            console.log('Failed to connect to the browser event stream', error);
            handleError(error);
        }
    }
    public async disconnect(reason?: string) {
        if (!this.connected && !this.connecting) return;

        if (this.cdpSession) {
            try {
                await this.cdpSession.detach();
            } catch (error) {
                console.warn('Error detaching CDP client:', error);
                handleError(error);
            }
            this.cdpSession = null;
        }

        if (this.page) {
            try {
                await this.page.close();
            } catch (error) {
                console.warn('Error closing page:', error);
                handleError(error);
            }
            this.page = null;
        }

        if (this.context) {
            try {
                await this.context.close();
            } catch (error) {
                console.warn('Error closing context:', error);
                handleError(error);
            }
            this.context = null;
        }

        if (this.browser) {
            try {
                await this.browser.close();
            } catch (error) {
                console.warn('Error closing browser:', error);
                handleError(error);
            }
            this.browser = null;
        }

        this.connected = false;
        this.connecting = false;

        this.emit('disconnect', {
            reason,
            browserbaseSessionId: this.options.browserbaseSessionId,
            timestamp: Date.now(),
        });
    }
    public isConnected(): boolean {
        return this.connected;
    }
    public getCreatedAt(): Date {
        return this.createdAt;
    }
    public getClientCount(): number {
        return this.clients.size;
    }
    private generateClientId(client: WebSocket): string {
        // Check if client already exists in registry
        for (const [id, registry] of this.clientRegistry.entries()) {
            if (registry.client === client) {
                registry.lastActive = new Date();
                return id;
            }
        }

        // Generate new UUID for new client
        const id = uuidv4();
        this.clientRegistry.set(id, {
            id,
            client,
            createdAt: new Date(),
            lastActive: new Date(),
        });

        return id;
    }
    public addClient(client: WebSocket): BrowserEventStream {
        const clientId = this.generateClientId(client);
        this.clients.add(client);

        // Set up client cleanup on close
        client.addEventListener('close', () => {
            this.removeClient(client);
        });

        // Notify plugins of client connection
        this.emit('client-connected', {
            clientId,
            timestamp: Date.now(),
        });

        return this;
    }
    private removeClient(client: WebSocket): void {
        this.clients.delete(client);

        // Find and remove from registry
        for (const [id, registry] of this.clientRegistry.entries()) {
            if (registry.client === client) {
                this.clientRegistry.delete(id);
                this.emit('client-disconnected', {
                    clientId: id,
                    timestamp: Date.now(),
                });
                break;
            }
        }
    }
    public getClientById(clientId: string): RegisteredClient | undefined {
        return this.clientRegistry.get(clientId);
    }
    public broadcastToClients(event: BrowserEvent): void {
        const message = JSON.stringify({ event });
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) client.send(message);
            else this.removeClient(client);
        }
    }
    public async sendCdpCommandToBrowser(method: keyof Protocol.CommandParameters, params: any = {}): Promise<any> {
        if (!this.cdpSession) throw new ServerError('Cannot send command. CDP client not initialized.');
        if (!this.connected) throw new ServerError('Cannot send command. Not connected to browser.');

        try {
            return await this.cdpSession.send(method, params);
        } catch (error) {
            handleError(error);
        }
    }
    private async setUpEventListeners() {
        if (!this.cdpSession) throw new Error('Cannot set up event listeners. CDP client not initialized.');
        const domains = this.options.enableDomains || [];

        for (const domain of domains) {
            try {
                const enableCommand = `${domain}.enable` as any;
                await this.cdpSession.send(enableCommand);
            } catch (error) {
                console.warn(`Failed to enable ${domain} domain`, error);
                handleError(error);
            }
        }

        // Set up page navigation listener
        if (this.page) {
            this.page.on('load', async () => {
                console.log('Page loaded, injecting DOM interaction tracker...');
                await this.injectDomInteractionTracker();
            });
        }

        this.setupStandardCdpEventListeners();
    }
    private setupStandardCdpEventListeners() {
        if (!this.cdpSession) throw new Error('Cannot set up event listeners. CDP client not initialized.');

        const createEventHandler = (method: string) => (params: any) => {
            //@ts-ignore
            const [domain, eventName] = method.split('.');
            if (!isCDPDomain(domain)) throw new Error(`Invalid CDP domain: ${domain}`);

            let browserEvent: BrowserEvent = {
                browserbaseSessionId: this.options.browserbaseSessionId,
                timestamp: Date.now(),
                type: 'browser',
                domain,
                method,
                params,
            };

            this.broadcastToClients(browserEvent);
            this.emit('browser-event', browserEvent);
        };

        this.cdpSession.addListener('Page.loadEventFired', createEventHandler('Page.loadEventFired'));
        this.cdpSession.addListener('Page.frameNavigated', createEventHandler('Page.frameNavigated'));
        this.cdpSession.addListener('Network.requestWillBeSent', createEventHandler('Network.requestWillBeSent'));
        this.cdpSession.addListener('Network.responseReceived', createEventHandler('Network.responseReceived'));
        this.cdpSession.addListener('Console.messageAdded', createEventHandler('Console.messageAdded'));
        this.cdpSession.addListener('Runtime.consoleAPICalled', createEventHandler('Runtime.consoleAPICalled'));
        this.cdpSession.addListener('Runtime.exceptionThrown', createEventHandler('Runtime.exceptionThrown'));
        this.cdpSession.addListener('DOM.documentUpdated', createEventHandler('DOM.documentUpdated'));
    }
    private async injectDomInteractionTracker() {
        if (!this.cdpSession) {
            console.warn('Cannot inject DOM tracker: CDP session not initialized');
            return;
        }
        if (!this.page) {
            console.warn('Cannot inject DOM tracker: Page not initialized');
            return;
        }

        try {
            console.log('Starting DOM interaction tracker injection...');

            // Enable necessary CDP domains
            await this.cdpSession.send('Runtime.enable');
            await this.cdpSession.send('DOM.enable');
            console.log('Enabled required CDP domains');

            // Inject the tracker as a function
            await this.page.evaluate(() => {
                // Type declarations for browser types
                interface BrowserElement {
                    tagName: string;
                    id: string;
                    className: string;
                    isContentEditable: boolean;
                    attributes: { name: string; value: string }[];
                    getBoundingClientRect(): {
                        top: number;
                        right: number;
                        bottom: number;
                        left: number;
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    };
                    addEventListener(type: string, listener: (event: BrowserEvent) => void): void;
                    querySelectorAll(selectors: string): BrowserElement[];
                }

                interface BrowserInputElement extends BrowserElement {
                    type: string;
                    value: string;
                    checked: boolean;
                    placeholder: string;
                    name: string;
                    disabled: boolean;
                    readOnly: boolean;
                }

                interface BrowserEvent {
                    target: BrowserEventTarget | null;
                }

                interface BrowserEventTarget {
                    nodeType: number;
                    nodeName: string;
                }

                interface BrowserCSSStyleDeclaration {
                    display: string;
                    visibility: string;
                }

                interface BrowserWindow {
                    getComputedStyle(element: BrowserElement): BrowserCSSStyleDeclaration;
                }

                interface BrowserMutationObserver {
                    observe(target: BrowserElement, options: { childList: boolean; subtree: boolean }): void;
                }

                interface BrowserMutationRecord {
                    addedNodes: BrowserNodeList;
                }

                interface BrowserNode {
                    nodeType: number;
                    nodeName: string;
                }

                interface BrowserNodeList {
                    length: number;
                    item(index: number): BrowserNode | null;
                    [index: number]: BrowserNode;
                }

                // Define the element details type
                interface ElementDetails {
                    tagName: string;
                    id: string;
                    className: string;
                    type: string | null;
                    value: string | null;
                    checked: boolean;
                    placeholder: string;
                    name: string;
                    isContentEditable: boolean;
                    isVisible: boolean;
                    isDisabled: boolean;
                    isReadOnly: boolean;
                    attributes: { name: string; value: string }[];
                    rect: {
                        top: number;
                        right: number;
                        bottom: number;
                        left: number;
                        width: number;
                        height: number;
                        x: number;
                        y: number;
                    };
                }

                // Define the DomInteractionTracker type
                interface DomInteractionTrackerType {
                    trackedElements: Map<BrowserElement, Record<string, (event: BrowserEvent) => void>>;
                    interactionTypes: string[];
                    getElementDetails(element: BrowserElement): ElementDetails | null;
                    reportInteraction(type: string, element: BrowserElement, event: BrowserEvent): void;
                    trackElement(element: BrowserElement): void;
                    trackExistingElements(): void;
                    init(): void;
                }

                // Cast global objects to our browser types
                const window = (globalThis as unknown as { window: BrowserWindow }).window;
                const document = (
                    globalThis as unknown as {
                        document: {
                            documentElement: BrowserElement;
                            addEventListener(type: string, listener: (event: BrowserEvent) => void): void;
                        };
                    }
                ).document;

                const MutationObserver = (
                    globalThis as unknown as {
                        MutationObserver: new (
                            callback: (mutations: BrowserMutationRecord[]) => void
                        ) => BrowserMutationObserver;
                    }
                ).MutationObserver;

                console.log('DOM tracker script executing...');

                // Self-contained tracker that doesn't modify global window
                const DomInteractionTracker: DomInteractionTrackerType = {
                    // Track elements we've already attached listeners to
                    trackedElements: new Map<BrowserElement, Record<string, (event: BrowserEvent) => void>>(),

                    // Types of interactions we want to track
                    interactionTypes: [
                        'click',
                        'focus',
                        'blur',
                        'input',
                        'change',
                        'mousedown',
                        'mouseup',
                        'touchstart',
                        'touchend',
                    ],

                    // Helper to get element details
                    getElementDetails: function (
                        this: DomInteractionTrackerType,
                        element: BrowserElement
                    ): ElementDetails | null {
                        if (!element) {
                            console.log('Invalid element provided to getElementDetails');
                            return null;
                        }

                        try {
                            // Get basic element info
                            const rect = element.getBoundingClientRect();
                            const computedStyle = window.getComputedStyle(element);

                            return {
                                tagName: element.tagName,
                                id: element.id,
                                className: element.className,
                                type: (element as BrowserInputElement).type || null,
                                value: null,
                                checked: (element as BrowserInputElement).checked,
                                placeholder: (element as BrowserInputElement).placeholder,
                                name: (element as BrowserInputElement).name,
                                isContentEditable: element.isContentEditable,
                                isVisible: computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden',
                                isDisabled: (element as BrowserInputElement).disabled,
                                isReadOnly: (element as BrowserInputElement).readOnly,
                                attributes: element.attributes,
                                rect: {
                                    top: rect.top,
                                    right: rect.right,
                                    bottom: rect.bottom,
                                    left: rect.left,
                                    width: rect.width,
                                    height: rect.height,
                                    x: rect.x,
                                    y: rect.y,
                                },
                            };
                        } catch (error) {
                            console.error('Error getting element details:', error);
                            return null;
                        }
                    },

                    // Report an interaction event
                    reportInteraction: function (
                        this: DomInteractionTrackerType,
                        type: string,
                        element: BrowserElement,
                        //@ts-ignore
                        event: BrowserEvent
                    ) {
                        console.log('Reporting interaction:', type, element.tagName);
                        const details = this.getElementDetails(element);
                        if (!details) {
                            console.log('No details available for element');
                            return;
                        }

                        // Add event-specific data
                        const eventData: {
                            type: string;
                            element: ElementDetails;
                            timestamp: number;
                        } = {
                            type,
                            element: details,
                            timestamp: Date.now(),
                        };

                        // Report via console for the proxy to intercept
                        console.info(
                            'BROWSERBASE_EVENT_PROXY:DOM_INTERACTION:' + type.toUpperCase(),
                            JSON.stringify(eventData)
                        );
                    },

                    // Track an element by adding event listeners
                    trackElement: function (this: DomInteractionTrackerType, element: BrowserElement) {
                        // Skip if already tracked or not an element
                        if (!element) {
                            console.log('Invalid element provided to trackElement');
                            return;
                        }
                        if (this.trackedElements.has(element)) {
                            console.log('Element already tracked:', element.tagName);
                            return;
                        }

                        console.log('Tracking new element:', element.tagName);

                        // Create a map of event listeners for this element
                        const listeners: Record<string, (event: BrowserEvent) => void> = {};
                        this.trackedElements.set(element, listeners);

                        // Add listeners for all interaction types
                        const self = this;
                        this.interactionTypes.forEach(function (type: string) {
                            const listener = function (event: BrowserEvent) {
                                console.log('Interaction detected:', type, element.tagName);
                                self.reportInteraction(type, element, event);
                            };
                            element.addEventListener(type, listener);
                            listeners[type] = listener;
                        });
                    },

                    // Track all existing interactive elements
                    trackExistingElements: function (this: DomInteractionTrackerType) {
                        console.log('Tracking existing interactive elements...');
                        // Find all potentially interactive elements
                        const interactiveSelectors = [
                            'a',
                            'button',
                            'input',
                            'textarea',
                            'select',
                            'option',
                            '[role="button"]',
                            '[role="checkbox"]',
                            '[role="radio"]',
                            '[role="tab"]',
                            '[role="menuitem"]',
                            '[contenteditable="true"]',
                            '[tabindex]',
                        ];

                        const elements = document.documentElement.querySelectorAll(interactiveSelectors.join(','));
                        console.log('Found', elements.length, 'interactive elements');
                        for (let i = 0; i < elements.length; i++) {
                            this.trackElement(elements[i]);
                        }
                    },

                    // Initialize the tracker
                    init: function (this: DomInteractionTrackerType) {
                        console.log('Initializing DOM interaction tracker...');

                        // Set up mutation observer to track new elements
                        const self = this;
                        const observer = new MutationObserver(function (mutations: BrowserMutationRecord[]) {
                            console.log('DOM mutation detected');
                            mutations.forEach(function (mutation) {
                                // Track new nodes
                                if (mutation.addedNodes) {
                                    for (let i = 0; i < mutation.addedNodes.length; i++) {
                                        const node = mutation.addedNodes[i];
                                        // Track the node itself if it's an element
                                        if (node.nodeType === 1) {
                                            console.log('New element added:', node.nodeName);
                                            self.trackElement(node as unknown as BrowserElement);

                                            // Track all interactive descendants
                                            if ('querySelectorAll' in node) {
                                                const interactiveSelectors = [
                                                    'a',
                                                    'button',
                                                    'input',
                                                    'textarea',
                                                    'select',
                                                    'option',
                                                    '[role="button"]',
                                                    '[role="checkbox"]',
                                                    '[role="radio"]',
                                                    '[role="tab"]',
                                                    '[role="menuitem"]',
                                                    '[contenteditable="true"]',
                                                    '[tabindex]',
                                                ];

                                                const elements = (node as unknown as BrowserElement).querySelectorAll(
                                                    interactiveSelectors.join(',')
                                                );
                                                console.log('Found', elements.length, 'new interactive elements');
                                                for (let i = 0; i < elements.length; i++) {
                                                    self.trackElement(elements[i]);
                                                }
                                            }
                                        }
                                    }
                                }
                            });
                        });

                        // Start observing the document
                        observer.observe(document.documentElement, {
                            childList: true,
                            subtree: true,
                        });

                        // Track existing elements
                        this.trackExistingElements();

                        // Special handling for focus/blur events at the document level
                        document.addEventListener('focusin', function (e) {
                            console.log('Focus in detected');
                            if (e.target) {
                                self.reportInteraction('focus', e.target as unknown as BrowserElement, e);
                            }
                        });

                        document.addEventListener('focusout', function (e) {
                            console.log('Focus out detected');
                            if (e.target) {
                                self.reportInteraction('blur', e.target as unknown as BrowserElement, e);
                            }
                        });

                        // Report initialization complete
                        console.info('BROWSERBASE_EVENT_PROXY:INITIALIZED');
                        console.log('DOM interaction tracker initialized successfully');
                    },
                };

                // Initialize the tracker
                DomInteractionTracker.init();
            });

            console.log('DOM tracker script injected successfully');

            // Listen for our custom console messages
            this.cdpSession.on('Runtime.consoleAPICalled', (params: any) => {
                if (params.type === 'info' && params.args && params.args.length > 0) {
                    try {
                        const message = params.args[0].value;
                        console.log('Console message received:', message);

                        // Check if this is one of our custom events
                        if (
                            message &&
                            typeof message === 'string' &&
                            message.startsWith('BROWSERBASE_EVENT_PROXY:DOM_INTERACTION:')
                        ) {
                            console.log('Processing DOM interaction event');
                            if (params.args.length > 1) {
                                const eventType = message.split(':')[2];
                                const eventData = JSON.parse(params.args[1].value) as DomInteractionEventData;

                                // Create a synthetic DOM interaction event
                                const interactionEvent: BrowserEvent = {
                                    browserbaseSessionId: this.options.browserbaseSessionId,
                                    timestamp: Date.now(),
                                    type: 'browser',
                                    domain: 'DOM',
                                    method: `DOM.interaction.${eventType.toLowerCase()}`,
                                    params: eventData,
                                };

                                console.log('Broadcasting DOM interaction event:', interactionEvent);
                                this.broadcastToClients(interactionEvent);
                                this.emit('browser-event', interactionEvent);
                            }
                        }
                    } catch (error) {
                        console.error('Error processing console message:', error);
                        handleError(error);
                    }
                }
            });

            console.log('DOM interaction tracker setup complete');
        } catch (error) {
            console.error('Failed to setup DOM interaction tracker:', error);
            handleError(error);
        }
    }
}
