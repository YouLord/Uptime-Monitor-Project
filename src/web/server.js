/**
 * Web Server - Express + Socket.io + Static Dashboard
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import compression from 'compression';
import apiRouter from '../api/routes.js';
import config from '../../config.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cfg = config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: cfg.CORS_ORIGIN || '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Middleware
app.use(cors({ origin: cfg.CORS_ORIGIN || '*' }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 1000 || req.path.startsWith('/api/')) {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// API Routes
app.use('/api', apiRouter);

// Health check (no auth)
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Serve Dashboard SPA
const publicDir = resolve(__dirname, 'public');
const indexPath = join(publicDir, 'index.html');

app.use(express.static(publicDir, {
  maxAge: '1h',
  etag: true,
  lastModified: true
}));

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/healthz') || req.path.startsWith('/socket.io/')) {
    return next();
  }
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Dashboard not built. Run `npm run build` or check public/index.html');
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Socket.io for real-time updates
const userSockets = new Map(); // userId -> Set(socketId)
const monitorSubscriptions = new Map(); // monitorId -> Set(socketId)

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next();
  
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, cfg.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch {
    // Allow connection without auth for public status pages
    next();
  }
});

io.on('connection', (socket) => {
  const userId = socket.user?.id;
  
  if (userId) {
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId).add(socket.id);
  }
  
  console.log(`🔌 Client connected: ${socket.id} ${userId ? `(user: ${socket.user.username})` : '(anonymous)'}`);
  
  // Subscribe to monitor updates
  socket.on('subscribe:monitor', (monitorId) => {
    if (!monitorSubscriptions.has(monitorId)) monitorSubscriptions.set(monitorId, new Set());
    monitorSubscriptions.get(monitorId).add(socket.id);
    socket.join(`monitor:${monitorId}`);
  });
  
  socket.on('unsubscribe:monitor', (monitorId) => {
    monitorSubscriptions.get(monitorId)?.delete(socket.id);
    socket.leave(`monitor:${monitorId}`);
  });
  
  // Subscribe to all monitors (dashboard)
  socket.on('subscribe:all', () => {
    socket.join('monitors:all');
  });
  
  socket.on('unsubscribe:all', () => {
    socket.leave('monitors:all');
  });
  
  // Subscribe to incidents
  socket.on('subscribe:incidents', () => {
    socket.join('incidents:all');
  });
  
  socket.on('disconnect', (reason) => {
    if (userId) {
      userSockets.get(userId)?.delete(socket.id);
      if (userSockets.get(userId)?.size === 0) userSockets.delete(userId);
    }
    for (const [, sockets] of monitorSubscriptions) {
      sockets.delete(socket.id);
    }
    console.log(`🔌 Client disconnected: ${socket.id} (${reason})`);
  });
});

// Global emit functions for monitoring engine
global.emitMonitorUpdate = (monitorId, result) => {
  const update = { monitorId, result, timestamp: Date.now() };
  
  // Emit to specific monitor subscribers
  io.to(`monitor:${monitorId}`).emit('monitor:update', update);
  
  // Emit to dashboard subscribers
  io.to('monitors:all').emit('monitor:update', update);
};

global.emitIncidentUpdate = (action, incident, monitor) => {
  const update = { action, incident, monitor, timestamp: Date.now() };
  io.to('incidents:all').emit('incident:update', update);
  io.to('monitors:all').emit('incident:update', update);
};

global.checkAlertRules = (monitorId, monitor, result) => {
  // Already handled in alerts/index.js via global.checkAlertRules
};

global.getAllMonitorStatuses = () => {
  // This will be called by API routes
  return Array.from(monitorSubscriptions.entries()).map(([id]) => ({ id }));
};

global.getOpenIncidents = () => {
  // Would need to query incidentRepo
  return [];
};

// Start server
function startServer() {
  return new Promise((resolve) => {
    server.listen(cfg.PORT, cfg.HOST, () => {
      console.log(`
╔═══════════════════════════════════════════════╗
║  🚀 Uptime Monitor Server                    ║
║  HTTP:  http://${cfg.HOST}:${cfg.PORT}                  ║
║  WS:    ws://${cfg.HOST}:${cfg.PORT}                    ║
║  API:   http://${cfg.HOST}:${cfg.PORT}/api            ║
╚═══════════════════════════════════════════════╝
      `);
      resolve(server);
    });
  });
}

export { app, server, io, startServer };