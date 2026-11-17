/**
 * Main monitoring engine - orchestrates all check types
 */

import { checkHttp, checkKeyword } from './http.js';
import { checkSsl, checkMultipleSsl } from './ssl.js';
import { checkPing, checkTcp } from './ping.js';
import { checkDns, checkDnsAllRecords } from './dns.js';
import { monitorRepo, checkResultRepo, statsRepo, incidentRepo } from '../db/repositories.js';
import { now, nowSec } from '../db/index.js';
import config from '../config.js';

const checkFunctions = {
  http: checkHttp,
  https: checkHttp,
  keyword: checkKeyword,
  ssl: checkSsl,
  ping: checkPing,
  tcp: checkTcp,
  dns: checkDns
};

let isRunning = false;
let checkInterval = null;
let activeMonitors = new Map(); // monitorId -> { timer, lastCheck }

export async function startMonitoring() {
  if (isRunning) return;
  isRunning = true;
  
  const cfg = config();
  console.log('🔍 Starting monitoring engine...');
  
  // Load active monitors
  await loadActiveMonitors();
  
  // Start check loop
  checkInterval = setInterval(runChecks, 10000); // Every 10 seconds check for due monitors
  
  // Start stats aggregation (hourly)
  setInterval(aggregateStats, 60 * 60 * 1000); // Every hour
  // Run once on start
  setTimeout(aggregateStats, 5000);
  
  // Cleanup old data daily
  setInterval(cleanupOldData, 24 * 60 * 60 * 1000);
  
  console.log(`✅ Monitoring engine started (checking every 10s)`);
}

export async function stopMonitoring() {
  isRunning = false;
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  // Clear all monitor timers
  for (const [, monitor] of activeMonitors) {
    if (monitor.timer) clearTimeout(monitor.timer);
  }
  activeMonitors.clear();
  console.log('🛑 Monitoring engine stopped');
}

export async function reloadMonitors() {
  await loadActiveMonitors();
}

async function loadActiveMonitors() {
  const monitors = await monitorRepo.getActiveMonitors();
  activeMonitors.clear();
  
  for (const monitor of monitors) {
    activeMonitors.set(monitor.id, {
      monitor,
      timer: null,
      lastCheck: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0
    });
  }
  
  console.log(`📊 Loaded ${activeMonitors.size} active monitors`);
}

async function runChecks() {
  if (!isRunning) return;
  
  const nowMs = now();
  const cfg = config();
  const maxConcurrent = cfg.MAX_CONCURRENT_CHECKS;
  
  // Find monitors that need checking
  const dueMonitors = [];
  for (const [id, data] of activeMonitors) {
    const monitor = data.monitor;
    const intervalMs = monitor.interval_seconds * 1000;
    
    if (nowMs - data.lastCheck >= intervalMs) {
      dueMonitors.push({ id, data, monitor });
    }
  }
  
  if (dueMonitors.length === 0) return;
  
  // Limit concurrent checks
  const toCheck = dueMonitors.slice(0, maxConcurrent);
  
  // Run checks in parallel with concurrency limit
  const promises = toCheck.map(({ id, data, monitor }) => runSingleCheck(id, monitor));
  await Promise.allSettled(promises);
}

async function runSingleCheck(monitorId, monitor) {
  const data = activeMonitors.get(monitorId);
  if (!data) return;
  
  const checkFn = checkFunctions[monitor.type];
  if (!checkFn) {
    console.warn(`⚠️ No check function for type: ${monitor.type}`);
    return;
  }
  
  data.lastCheck = now();
  
  try {
    // Execute check with retries
    let result = null;
    let lastError = null;
    
    for (let attempt = 0; attempt <= monitor.retries; attempt++) {
      try {
        result = await checkFn(monitor);
        if (result.status === 'up' || attempt === monitor.retries) break;
        // Wait before retry
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      } catch (err) {
        lastError = err;
        if (attempt === monitor.retries) throw err;
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    
    if (!result) {
      result = {
        status: 'down',
        response_time_ms: 0,
        error_message: lastError?.message || 'Unknown error'
      };
    }
    
    // Save result
    await checkResultRepo.create({
      monitor_id: monitorId,
      timestamp: now(),
      status: result.status,
      response_time_ms: result.response_time_ms,
      status_code: result.status_code,
      response_body: result.response_body,
      error_message: result.error_message,
      ssl_info: result.ssl_info,
      dns_info: result.dns_info
    });
    
    // Update monitor state
    if (result.status === 'up') {
      data.consecutiveFailures = 0;
      data.consecutiveSuccesses++;
    } else {
      data.consecutiveFailures++;
      data.consecutiveSuccesses = 0;
    }
    
    // Check for incidents
    await handleIncident(monitorId, monitor, result);
    
    // Check alert rules
    await checkAlerts(monitorId, monitor, result);
    
    // Emit real-time update (will be handled by Socket.io in web server)
    global.emitMonitorUpdate?.(monitorId, result);
    
  } catch (error) {
    console.error(`❌ Check failed for ${monitor.name} (${monitorId}):`, error.message);
    
    // Save error result
    await checkResultRepo.create({
      monitor_id: monitorId,
      timestamp: now(),
      status: 'down',
      response_time_ms: 0,
      error_message: error.message
    });
    
    data.consecutiveFailures++;
    data.consecutiveSuccesses = 0;
  }
}

async function handleIncident(monitorId, monitor, result) {
  const existingIncident = await incidentRepo.findOpenByMonitor(monitorId);
  
  if (result.status === 'down') {
    // Create incident if none exists
    if (!existingIncident) {
      const incident = await incidentRepo.create(monitorId);
      console.log(`🚨 Incident created for ${monitor.name}: ${incident.id}`);
      global.emitIncidentUpdate?.('created', incident, monitor);
    }
  } else if (result.status === 'up' && existingIncident) {
    // Resolve incident
    const incident = await incidentRepo.resolve(existingIncident.id, null, `Auto-resolved: ${result.error_message || 'Service recovered'}`);
    console.log(`✅ Incident resolved for ${monitor.name}: ${incident.id}`);
    global.emitIncidentUpdate?.('resolved', incident, monitor);
  }
}

async function checkAlerts(monitorId, monitor, result) {
  // This will be implemented in alerts/index.js
  global.checkAlertRules?.(monitorId, monitor, result);
}

async function aggregateStats() {
  console.log('📈 Aggregating hourly stats...');
  
  const monitors = await monitorRepo.getActiveMonitors();
  const hourTimestamp = Math.floor(now() / (60 * 60 * 1000)) * (60 * 60 * 1000);
  
  for (const monitor of monitors) {
    const results = await checkResultRepo.findByMonitor(monitor.id, 1000, hourTimestamp + 60 * 60 * 1000);
    const hourlyResults = results.filter(r => r.timestamp >= hourTimestamp && r.timestamp < hourTimestamp + 60 * 60 * 1000);
    
    if (hourlyResults.length === 0) continue;
    
    const successful = hourlyResults.filter(r => r.status === 'up').length;
    const failed = hourlyResults.filter(r => r.status === 'down').length;
    const degraded = hourlyResults.filter(r => r.status === 'degraded').length;
    
    const responseTimes = hourlyResults
      .filter(r => r.response_time_ms !== null)
      .map(r => r.response_time_ms);
    
    const stats = {
      total: hourlyResults.length,
      successful: successful + degraded, // degraded counts as successful for uptime
      failed,
      avg: responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : null,
      min: responseTimes.length > 0 ? Math.min(...responseTimes) : null,
      max: responseTimes.length > 0 ? Math.max(...responseTimes) : null,
      uptime: ((successful + degraded) / hourlyResults.length) * 100
    };
    
    await statsRepo.upsertHourly(monitor.id, hourTimestamp, stats);
  }
  
  console.log(`📈 Aggregated stats for ${monitors.length} monitors`);
}

async function cleanupOldData() {
  console.log('🧹 Cleaning up old data...');
  
  const cfg = config();
  const retentionMs = cfg.RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const olderThan = now() - retentionMs;
  
  await checkResultRepo.cleanup(olderThan);
  
  // Also cleanup old incidents (keep resolved incidents longer)
  const incidentRetentionMs = cfg.RETENTION_DAYS * 2 * 24 * 60 * 60 * 1000;
  const incidentOlderThan = now() - incidentRetentionMs;
  
  // This would need a cleanup function in incidentRepo
  console.log('🧹 Cleanup completed');
}

// Manual check trigger (for API)
export async function triggerCheck(monitorId) {
  const data = activeMonitors.get(monitorId);
  if (!data) return { error: 'Monitor not found or inactive' };
  
  await runSingleCheck(monitorId, data.monitor);
  return { success: true };
}

// Get monitor status summary
export function getMonitorStatus(monitorId) {
  const data = activeMonitors.get(monitorId);
  if (!data) return null;
  
  return {
    monitor: data.monitor,
    lastCheck: data.lastCheck,
    consecutiveFailures: data.consecutiveFailures,
    consecutiveSuccesses: data.consecutiveSuccesses,
    nextCheckIn: data.monitor.interval_seconds * 1000 - (now() - data.lastCheck)
  };
}

export function getAllMonitorStatuses() {
  const statuses = [];
  for (const [id, data] of activeMonitors) {
    statuses.push(getMonitorStatus(id));
  }
  return statuses;
}