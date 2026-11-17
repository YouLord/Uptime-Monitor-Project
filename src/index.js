/**
 * Uptime Monitor - Main Entry Point
 */

import { initDatabase, closeDatabase } from './db/index.js';
import { startMonitoring, stopMonitoring } from './monitors/index.js';
import { initAlerts } from './alerts/index.js';
import { startServer } from './web/server.js';
import config from './config.js';

async function main() {
  console.log(`
╔═══════════════════════════════════════════════╗
║  🚀 Uptime Monitor v1.0.0                    ║
║  Starting up...                              ║
╚═══════════════════════════════════════════════╝
  `);
  
  try {
    // Initialize database
    initDatabase();
    console.log('✅ Database initialized');
    
    // Initialize alerts
    initAlerts();
    
    // Start monitoring engine
    await startMonitoring();
    
    // Start web server
    await startServer();
    
    console.log('✅ Uptime Monitor started successfully!');
    
  } catch (error) {
    console.error('❌ Failed to start:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal) {
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
  
  try {
    await stopMonitoring();
    closeDatabase();
    console.log('✅ Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
});

main();