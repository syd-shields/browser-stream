import { createServer } from 'http';
import { ProxyServer } from './server';

const server = createServer();
const proxyServer = new ProxyServer(server, {
    enableDomains: ['Page', 'Network', 'Runtime', 'DOM'],
    connectionTimeout: 30000,
    autoReconnect: true,
    maxReconnectAttempts: 5,
    reconnectDelay: 5000,
});

// Example usage
async function main() {
    const PORT = process.env.PORT || 8080;

    server.listen(PORT, async () => {
        console.log(`Proxy server listening on port ${PORT}`);
        console.log('Connecting to browser...');
        await proxyServer.connectToBrowser('your-browserbase-session-id', 'your-browserbase-api-key');
        // for local use, you can use the following line instead:
        // await proxyServer.connectToBrowser();
    });

    // Example of handling server shutdown
    process.on('SIGINT', async () => {
        console.log('Shutting down...');
        await proxyServer.disconnectFromBrowser();
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    });
}

main().catch(console.error);
