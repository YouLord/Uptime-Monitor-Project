/**
 * Alert System - Central coordinator for all alert channels
 */

import { sendTelegramAlert, sendTelegramIncidentAlert, initTelegram } from './telegram.js';
import { sendEmailAlert, initEmail } from './email.js';
import { sendWebhookAlert, sendWebhookIncident } from './webhook.js';
import { alertRuleRepo, alertHistoryRepo } from '../db/repositories.js';
import config from '../../config.js';

let isInitialized = false;

export function initAlerts() {
  if (isInitialized) return;
  
  // Initialize channels
  initTelegram();
  initEmail();
  // Webhook doesn't need init
  
  // Register global handlers for monitoring engine
  global.checkAlertRules = checkAlertRules;
  global.emitIncidentUpdate = handleIncidentAlert;
  
  isInitialized = true;
  console.log('🔔 Alert system initialized');
}

async function checkAlertRules(monitorId, monitor, result) {
  try {
    // Get applicable alert rules (specific to monitor + global)
    const rules = await alertRuleRepo.findAll(monitorId);
    
    for (const rule of rules) {
      if (!rule.is_active) continue;
      
      // Check cooldown
      const lastAlert = await getLastAlertTime(rule.id, monitorId);
      const cooldownMs = rule.cooldown_seconds * 1000;
      if (lastAlert && Date.now() - lastAlert < cooldownMs) {
        continue; // Still in cooldown
      }
      
      // Evaluate condition
      const shouldAlert = evaluateCondition(rule, result);
      if (!shouldAlert) continue;
      
      // Send alerts through configured channels
      const channels = typeof rule.channels === 'string' ? JSON.parse(rule.channels) : rule.channels;
      
      for (const channel of channels) {
        await sendAlert(channel, rule, monitor, result);
      }
    }
  } catch (error) {
    console.error('❌ Alert evaluation error:', error.message);
  }
}

function evaluateCondition(rule, result) {
  const threshold = typeof rule.threshold === 'string' ? JSON.parse(rule.threshold) : (rule.threshold || {});
  
  switch (rule.condition) {
    case 'down':
      return result.status === 'down';
    
    case 'degraded':
      return result.status === 'degraded' || result.status === 'down';
    
    case 'response_time':
      if (result.response_time_ms === null) return false;
      const maxMs = threshold.value || threshold.max_ms || 5000;
      return result.response_time_ms > maxMs;
    
    case 'status_code':
      if (!result.status_code) return false;
      const expectedCodes = threshold.codes || [200];
      return !expectedCodes.includes(result.status_code);
    
    case 'ssl_expiring':
      if (!result.ssl_info?.days_remaining) return false;
      const days = threshold.days || 30;
      return result.ssl_info.days_remaining <= days && result.ssl_info.days_remaining > 0;
    
    default:
      return false;
  }
}

async function sendAlert(channel, rule, monitor, result) {
  let alertResult = { status: 'failed', error: 'Unknown channel' };
  
  try {
    switch (channel) {
      case 'telegram':
        alertResult = await sendTelegramAlert(monitor, result, rule);
        break;
      case 'email':
        alertResult = await sendEmailAlert(monitor, result, rule);
        break;
      case 'webhook':
        alertResult = await sendWebhookAlert(monitor, result, rule);
        break;
      default:
        alertResult = { status: 'failed', error: `Unknown channel: ${channel}` };
    }
  } catch (error) {
    alertResult = { status: 'failed', error: error.message };
  }
  
  // Record in history
  await alertHistoryRepo.create({
    alert_rule_id: rule.id,
    monitor_id: monitor.id,
    channel,
    status: alertResult.status === 'sent' ? 'sent' : 'failed',
    message: alertResult.status === 'sent' ? 'Alert sent successfully' : null,
    error: alertResult.error || null
  });
  
  return alertResult;
}

async function handleIncidentAlert(action, incident, monitor) {
  // action: 'created' or 'resolved'
  const rules = await alertRuleRepo.findAll(monitor.id);
  
  for (const rule of rules) {
    if (!rule.is_active) continue;
    
    const channels = typeof rule.channels === 'string' ? JSON.parse(rule.channels) : rule.channels;
    
    for (const channel of channels) {
      try {
        let alertResult;
        if (channel === 'telegram') {
          alertResult = await sendTelegramIncidentAlert(incident, monitor, action);
        } else if (channel === 'webhook') {
          alertResult = await sendWebhookIncident(incident, monitor, action);
        }
        
        await alertHistoryRepo.create({
          alert_rule_id: rule.id,
          monitor_id: monitor.id,
          channel,
          status: alertResult?.status === 'sent' ? 'sent' : 'failed',
          message: `Incident ${action}`,
          error: alertResult?.error || null
        });
      } catch (error) {
        console.error(`Failed to send incident alert via ${channel}:`, error.message);
      }
    }
  }
}

async function getLastAlertTime(ruleId, monitorId) {
  // This would need a query to alert_history
  // For now, return null (no cooldown tracking in MVP)
  // TODO: Implement proper cooldown tracking
  return null;
}

// Manual alert testing
export async function testAlertChannel(channel, monitorId = null) {
  const mockMonitor = monitorId ? await import('../db/repositories.js').then(m => m.monitorRepo.findById(monitorId)) : {
    id: 'test',
    name: 'Test Monitor',
    target: 'https://example.com',
    type: 'http'
  };
  
  const mockResult = {
    status: 'down',
    response_time_ms: 5000,
    status_code: 500,
    error_message: 'Test alert - service unavailable'
  };
  
  const mockRule = { id: 'test-rule', name: 'Test Rule', channels: [channel] };
  
  return sendAlert(channel, mockRule, mockMonitor, mockResult);
}

export function getAlertChannels() {
  const cfg = config();
  return {
    telegram: !!cfg.TELEGRAM_BOT_TOKEN,
    email: !!cfg.SMTP_HOST,
    webhook: !!cfg.WEBHOOK_URL
  };
}