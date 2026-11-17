/**
 * Generic Webhook Alert Channel
 */

import crypto from 'crypto';
import axios from 'axios';
import config from '../../config.js';

export async function sendWebhookAlert(monitor, result, alertRule) {
  const cfg = config();
  const webhookUrl = cfg.WEBHOOK_URL;
  const webhookSecret = cfg.WEBHOOK_SECRET;
  
  if (!webhookUrl) {
    return { status: 'failed', error: 'Webhook URL not configured' };
  }
  
  const payload = {
    alert_rule: alertRule ? { id: alertRule.id, name: alertRule.name } : null,
    monitor: {
      id: monitor.id,
      name: monitor.name,
      type: monitor.type,
      target: monitor.target,
      interval_seconds: monitor.interval_seconds
    },
    check_result: {
      status: result.status,
      response_time_ms: result.response_time_ms,
      status_code: result.status_code,
      error_message: result.error_message,
      timestamp: new Date().toISOString()
    },
    triggered_at: new Date().toISOString()
  };
  
  // Sign payload if secret configured
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'UptimeMonitor/1.0'
  };
  
  if (webhookSecret) {
    const signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');
    headers['X-Signature-Sha256'] = `sha256=${signature}`;
  }
  
  try {
    const response = await axios.post(webhookUrl, payload, {
      headers,
      timeout: 10000,
      validateStatus: (status) => status < 500 // Don't throw on 4xx
    });
    
    return { 
      status: 'sent', 
      response_status: response.status,
      response_data: response.data 
    };
  } catch (error) {
    return { 
      status: 'failed', 
      error: error.message,
      response_status: error.response?.status,
      response_data: error.response?.data
    };
  }
}

export async function sendWebhookIncident(incident, monitor, action) {
  const cfg = config();
  const webhookUrl = cfg.WEBHOOK_URL;
  const webhookSecret = cfg.WEBHOOK_SECRET;
  
  if (!webhookUrl) return { status: 'skipped', reason: 'No webhook URL' };
  
  const payload = {
    event: `incident.${action}`, // incident.created, incident.resolved
    incident: {
      id: incident.id,
      monitor_id: incident.monitor_id,
      started_at: new Date(incident.started_at).toISOString(),
      ended_at: incident.ended_at ? new Date(incident.ended_at).toISOString() : null,
      duration_seconds: incident.duration_seconds,
      status: incident.status,
      cause: incident.cause
    },
    monitor: {
      id: monitor.id,
      name: monitor.name,
      target: monitor.target,
      type: monitor.type
    },
    triggered_at: new Date().toISOString()
  };
  
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'UptimeMonitor/1.0' };
  
  if (webhookSecret) {
    const signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');
    headers['X-Signature-Sha256'] = `sha256=${signature}`;
  }
  
  try {
    await axios.post(webhookUrl, payload, { headers, timeout: 10000 });
    return { status: 'sent' };
  } catch (error) {
    return { status: 'failed', error: error.message };
  }
}

// Test webhook
export async function testWebhook() {
  const cfg = config();
  const webhookUrl = cfg.WEBHOOK_URL;
  
  if (!webhookUrl) {
    return { status: 'failed', error: 'Webhook URL not configured' };
  }
  
  const payload = {
    event: 'test',
    message: 'This is a test webhook from Uptime Monitor',
    timestamp: new Date().toISOString()
  };
  
  try {
    await axios.post(webhookUrl, payload, { timeout: 5000 });
    return { status: 'sent' };
  } catch (error) {
    return { status: 'failed', error: error.message };
  }
}