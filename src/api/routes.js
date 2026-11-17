/**
 * REST API Routes
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, requireRole, validateBody, rateLimit, generateToken } from './middleware.js';
import {
  userRepo,
  monitorRepo,
  checkResultRepo,
  statsRepo,
  incidentRepo,
  alertRuleRepo,
  alertHistoryRepo,
  maintenanceRepo,
  statusPageRepo,
  settingsRepo
} from '../db/repositories.js';
import { triggerCheck, getMonitorStatus, getAllMonitorStatuses } from '../monitors/index.js';
import { initAlerts, testAlertChannel, getAlertChannels } from '../alerts/index.js';
import { testWebhook } from '../alerts/webhook.js';
import { sendTestEmail } from '../alerts/email.js';
import config from '../../config.js';

const router = Router();

// Apply rate limiting to all API routes
router.use(rateLimit(60000, 120)); // 120 req/min

// ============================================
// Auth
// ============================================
router.post('/auth/register', validateBody(z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  email: z.string().email().optional(),
  password: z.string().min(8).max(128)
})), async (req, res) => {
  const { username, email, password } = req.validatedBody;
  
  // Check if registration is enabled
  const cfg = config();
  if (!cfg.ENABLE_REGISTRATION) {
    return res.status(403).json({ error: 'Registration is disabled' });
  }
  
  // Check if user exists
  const existing = await userRepo.findByUsername(username);
  if (existing) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  
  if (email) {
    const existingEmail = await userRepo.findByEmail?.(email);
    if (existingEmail) {
      return res.status(409).json({ error: 'Email already registered' });
    }
  }
  
  // Hash password
  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash(password, 12);
  
  const user = await userRepo.create(username, email, passwordHash, 'viewer');
  const token = generateToken(user);
  
  res.status(201).json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
});

router.post('/auth/login', validateBody(z.object({
  username: z.string(),
  password: z.string()
})), async (req, res) => {
  const { username, password } = req.validatedBody;
  
  const user = await userRepo.findByUsername(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const bcrypt = await import('bcryptjs');
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  await userRepo.updateLastLogin(user.id);
  const token = generateToken(user);
  
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
});

router.get('/auth/me', authMiddleware, async (req, res) => {
  const user = await userRepo.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  res.json({ user: { id: user.id, username: user.username, email: user.email, role: user.role, created_at: user.created_at, last_login: user.last_login } });
});

// ============================================
// Monitors
// ============================================
const monitorSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['http', 'https', 'ping', 'dns', 'tcp', 'ssl', 'keyword']),
  target: z.string().min(1),
  interval_seconds: z.number().int().min(10).max(86400).default(60),
  timeout_seconds: z.number().int().min(1).max(300).default(10),
  retries: z.number().int().min(0).max(10).default(3),
  method: z.string().default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  expected_status_codes: z.array(z.number()).default([200]),
  keyword: z.string().optional(),
  ignore_ssl: z.boolean().default(false),
  follow_redirects: z.boolean().default(true),
  max_redirects: z.number().int().min(1).max(50).default(10),
  dns_record_type: z.string().default('A'),
  dns_expected_ip: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  is_active: z.boolean().default(true),
  tags: z.array(z.string()).optional()
});

router.get('/monitors', authMiddleware, async (req, res) => {
  const { type, is_active, search, limit = 50, offset = 0 } = req.query;
  const monitors = await monitorRepo.findAll({
    type: type,
    is_active: is_active === 'true' ? true : is_active === 'false' ? false : undefined,
    search: search,
    limit: parseInt(limit),
    offset: parseInt(offset)
  });
  
  // Add latest check result for each
  const monitorsWithStatus = await Promise.all(monitors.map(async (m) => {
    const latest = await checkResultRepo.getLatest(m.id);
    return { ...m, last_check: latest };
  }));
  
  res.json({ monitors: monitorsWithStatus });
});

router.post('/monitors', authMiddleware, requireRole('admin', 'editor'), validateBody(monitorSchema), async (req, res) => {
  const monitor = await monitorRepo.create({ ...req.validatedBody, created_by: req.user.id });
  
  // Reload monitors in monitoring engine
  import('../monitors/index.js').then(m => m.reloadMonitors?.());
  
  res.status(201).json({ monitor });
});

router.get('/monitors/:id', authMiddleware, async (req, res) => {
  const monitor = await monitorRepo.findById(req.params.id);
  if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
  
  const latest = await checkResultRepo.getLatest(monitor.id);
  const stats = await statsRepo.getHourly(monitor.id, 24);
  const incidents = await incidentRepo.list({ monitor_id: monitor.id, limit: 10 });
  
  res.json({ monitor: { ...monitor, last_check: latest, stats_24h: stats, recent_incidents: incidents } });
});

router.patch('/monitors/:id', authMiddleware, requireRole('admin', 'editor'), validateBody(monitorSchema.partial()), async (req, res) => {
  const monitor = await monitorRepo.update(req.params.id, req.validatedBody);
  if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
  
  import('../monitors/index.js').then(m => m.reloadMonitors?.());
  
  res.json({ monitor });
});

router.delete('/monitors/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await monitorRepo.delete(req.params.id);
  import('../monitors/index.js').then(m => m.reloadMonitors?.());
  res.json({ success: true });
});

router.post('/monitors/:id/check', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const result = await triggerCheck(req.params.id);
  res.json(result);
});

router.get('/monitors/:id/history', authMiddleware, async (req, res) => {
  const { limit = 100, before } = req.query;
  const history = await checkResultRepo.findByMonitor(req.params.id, parseInt(limit), before ? parseInt(before) : null);
  res.json({ history });
});

router.get('/monitors/:id/stats', authMiddleware, async (req, res) => {
  const { hours = 24, days = 30 } = req.query;
  const hourly = await statsRepo.getHourly(req.params.id, parseInt(hours));
  const daily = await statsRepo.getDaily(req.params.id, parseInt(days));
  res.json({ hourly, daily });
});

// ============================================
// Incidents
// ============================================
router.get('/incidents', authMiddleware, async (req, res) => {
  const { status, monitor_id, limit = 50 } = req.query;
  const incidents = await incidentRepo.list({
    status: status,
    monitor_id: monitor_id,
    limit: parseInt(limit)
  });
  res.json({ incidents });
});

router.patch('/incidents/:id/acknowledge', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  // Would need an acknowledge function in incidentRepo
  res.json({ success: true, message: 'Not implemented yet' });
});

router.patch('/incidents/:id/resolve', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const { cause } = req.body;
  const incident = await incidentRepo.resolve(req.params.id, req.user.id, cause);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });
  res.json({ incident });
});

// ============================================
// Alert Rules
// ============================================
const alertRuleSchema = z.object({
  name: z.string().min(1).max(100),
  monitor_id: z.string().uuid().optional(),
  condition: z.enum(['down', 'degraded', 'ssl_expiring', 'response_time', 'status_code']),
  threshold: z.record(z.unknown()).optional(),
  channels: z.array(z.enum(['telegram', 'email', 'webhook'])).default(['telegram']),
  is_active: z.boolean().default(true),
  cooldown_seconds: z.number().int().min(0).max(86400).default(300)
});

router.get('/alert-rules', authMiddleware, async (req, res) => {
  const { monitor_id } = req.query;
  const rules = await alertRuleRepo.findAll(monitor_id);
  res.json({ rules });
});

router.post('/alert-rules', authMiddleware, requireRole('admin', 'editor'), validateBody(alertRuleSchema), async (req, res) => {
  const rule = await alertRuleRepo.create({ ...req.validatedBody, created_by: req.user.id });
  res.status(201).json({ rule });
});

router.patch('/alert-rules/:id', authMiddleware, requireRole('admin', 'editor'), validateBody(alertRuleSchema.partial()), async (req, res) => {
  const rule = await alertRuleRepo.update(req.params.id, req.validatedBody);
  if (!rule) return res.status(404).json({ error: 'Alert rule not found' });
  res.json({ rule });
});

router.delete('/alert-rules/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await alertRuleRepo.delete(req.params.id);
  res.json({ success: true });
});

router.post('/alert-rules/:id/test', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const { channel } = req.body;
  if (!channel) return res.status(400).json({ error: 'Channel required' });
  
  const result = await testAlertChannel(channel, req.params.id);
  res.json({ result });
});

// ============================================
// Alert History
// ============================================
router.get('/alert-history', authMiddleware, async (req, res) => {
  const { monitor_id, limit = 50 } = req.query;
  const history = await alertHistoryRepo.findByMonitor(monitor_id, parseInt(limit));
  res.json({ history });
});

// ============================================
// Status Pages (Public)
// ============================================
router.get('/status/:slug', async (req, res) => {
  const page = await statusPageRepo.findBySlug(req.params.slug);
  if (!page || !page.is_public) return res.status(404).json({ error: 'Status page not found' });
  
  const monitorIds = JSON.parse(page.monitor_ids || '[]');
  const monitors = [];
  
  for (const id of monitorIds) {
    const monitor = await monitorRepo.findById(id);
    if (monitor) {
      const latest = await checkResultRepo.getLatest(id);
      monitors.push({ ...monitor, status: latest?.status || 'unknown', last_check: latest });
    }
  }
  
  res.json({ page: { ...page, monitors } });
});

router.get('/status', async (req, res) => {
  // Simple status endpoint for load balancers
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// Dashboard Stats
// ============================================
router.get('/dashboard/stats', authMiddleware, async (req, res) => {
  const monitors = await monitorRepo.findAll({ limit: 1000 });
  const allStatuses = getAllMonitorStatuses();
  
  const total = monitors.length;
  const active = monitors.filter(m => m.is_active).length;
  const up = allStatuses.filter(s => s?.lastResult?.status === 'up').length;
  const down = allStatuses.filter(s => s?.lastResult?.status === 'down').length;
  const degraded = allStatuses.filter(s => s?.lastResult?.status === 'degraded').length;
  
  const recentIncidents = await incidentRepo.list({ limit: 10 });
  const openIncidents = recentIncidents.filter(i => i.status === 'open').length;
  
  res.json({
    total,
    active,
    up,
    down,
    degraded,
    open_incidents: openIncidents,
    uptime_percentage: total > 0 ? ((up + degraded) / total * 100).toFixed(2) : 100
  });
});

// ============================================
// Alert Channels Status
// ============================================
router.get('/alert-channels', authMiddleware, requireRole('admin'), async (req, res) => {
  res.json({ channels: getAlertChannels() });
});

router.post('/alert-channels/test', authMiddleware, requireRole('admin'), async (req, res) => {
  const { channel } = req.body;
  let result;
  
  switch (channel) {
    case 'webhook':
      result = await testWebhook();
      break;
    case 'email':
      const cfg = config();
      if (!cfg.ALERT_EMAIL_TO) return res.status(400).json({ error: 'No test email configured' });
      result = await sendTestEmail(cfg.ALERT_EMAIL_TO);
      break;
    default:
      return res.status(400).json({ error: 'Unsupported channel for testing' });
  }
  
  res.json({ result });
});

// ============================================
// Settings
// ============================================
router.get('/settings', authMiddleware, requireRole('admin'), async (req, res) => {
  const settings = await settingsRepo.getAll();
  res.json({ settings });
});

router.patch('/settings', authMiddleware, requireRole('admin'), async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'Key required' });
  
  await settingsRepo.set(key, value);
  res.json({ success: true });
});

// ============================================
// Health Check
// ============================================
router.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '1.0.0'
  });
});

export default router;