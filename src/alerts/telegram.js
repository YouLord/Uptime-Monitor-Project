/**
 * Telegram Bot Alert Channel
 */

import { Telegraf, Markup } from 'telegraf';
import config from '../../config.js';

let bot = null;
let isInitialized = false;

export function initTelegram() {
  const cfg = config();
  if (!cfg.TELEGRAM_BOT_TOKEN) {
    console.log('📱 Telegram bot not configured (TELEGRAM_BOT_TOKEN missing)');
    return false;
  }
  
  try {
    bot = new Telegraf(cfg.TELEGRAM_BOT_TOKEN);
    
    // Command handlers
    bot.command('start', (ctx) => {
      ctx.reply(
        '🤖 *Uptime Monitor Bot*\n\n' +
        'Use /status to check all monitors\n' +
        'Use /monitor <id> to check specific monitor\n' +
        'Use /incidents to see open incidents',
        { parse_mode: 'Markdown' }
      );
    });
    
    bot.command('status', async (ctx) => {
      if (!isAuthorized(ctx)) return;
      const monitors = global.getAllMonitorStatuses?.() || [];
      const up = monitors.filter(m => m.lastResult?.status === 'up').length;
      const down = monitors.filter(m => m.lastResult?.status === 'down').length;
      
      ctx.reply(
        `📊 *Status Summary*\n` +
        `✅ Up: ${up}\n` +
        `❌ Down: ${down}\n` +
        `📈 Total: ${monitors.length}`,
        { parse_mode: 'Markdown' }
      );
    });
    
    bot.command('incidents', async (ctx) => {
      if (!isAuthorized(ctx)) return;
      const incidents = global.getOpenIncidents?.() || [];
      if (incidents.length === 0) {
        ctx.reply('✅ No open incidents');
        return;
      }
      
      const msg = incidents.slice(0, 10).map(inc => 
        `🚨 *${inc.monitor_name}*\n` +
        `Started: ${new Date(inc.started_at).toLocaleString()}\n` +
        `Duration: ${formatDuration(Date.now() - inc.started_at)}`
      ).join('\n\n');
      
      ctx.reply(msg, { parse_mode: 'Markdown' });
    });
    
    bot.launch();
    isInitialized = true;
    console.log('📱 Telegram bot started');
    return true;
  } catch (error) {
    console.error('❌ Failed to start Telegram bot:', error.message);
    return false;
  }
}

function isAuthorized(ctx) {
  const cfg = config();
  if (!cfg.TELEGRAM_CHAT_ID) return true; // No restriction
  
  const chatId = ctx.chat?.id?.toString();
  const allowedIds = cfg.TELEGRAM_CHAT_ID.split(',').map(id => id.trim());
  
  if (!allowedIds.includes(chatId)) {
    ctx.reply('⛔ Not authorized to use this bot');
    return false;
  }
  return true;
}

export async function sendTelegramAlert(monitor, result, alertRule) {
  if (!bot || !isInitialized) return { status: 'failed', error: 'Bot not initialized' };
  
  const cfg = config();
  const chatIds = (cfg.TELEGRAM_CHAT_ID || '').split(',').map(id => id.trim()).filter(Boolean);
  
  if (chatIds.length === 0) {
    return { status: 'failed', error: 'No chat IDs configured' };
  }
  
  const isDown = result.status === 'down';
  const emoji = isDown ? '🔴' : result.status === 'degraded' ? '🟡' : '🟢';
  const statusText = isDown ? 'DOWN' : result.status === 'degraded' ? 'DEGRADED' : 'UP';
  
  const message = 
    `${emoji} *${monitor.name} is ${statusText}*\n\n` +
    `🔗 *Target:* ${monitor.target}\n` +
    `📍 *Type:* ${monitor.type.toUpperCase()}\n` +
    `⏱ *Response:* ${result.response_time_ms}ms\n` +
    (result.status_code ? `📋 *Status Code:* ${result.status_code}\n` : '') +
    (result.error_message ? `❌ *Error:* ${result.error_message}\n` : '') +
    `\n🕐 ${new Date().toLocaleString()}`;
  
  const keyboard = Markup.inlineKeyboard([
    Markup.button.url('🌐 Open Dashboard', `${cfg.DASHBOARD_URL || 'http://localhost:3000'}/monitor/${monitor.id}`),
    Markup.button.callback('✅ Acknowledge', `ack_${monitor.id}`),
    Markup.button.callback('🔕 Silence 1h', `silence_${monitor.id}_3600`)
  ]);
  
  const results = [];
  for (const chatId of chatIds) {
    try {
      await bot.telegram.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...keyboard
      });
      results.push({ chatId, status: 'sent' });
    } catch (error) {
      results.push({ chatId, status: 'failed', error: error.message });
    }
  }
  
  return { status: 'sent', details: results };
}

export async function sendTelegramIncidentAlert(incident, monitor, action) {
  if (!bot || !isInitialized) return;
  
  const cfg = config();
  const chatIds = (cfg.TELEGRAM_CHAT_ID || '').split(',').map(id => id.trim()).filter(Boolean);
  
  const emoji = action === 'created' ? '🚨' : '✅';
  const actionText = action === 'created' ? 'STARTED' : 'RESOLVED';
  
  const message = 
    `${emoji} *Incident ${actionText}*\n\n` +
    `🔗 *Monitor:* ${monitor.name}\n` +
    `🎯 *Target:* ${monitor.target}\n` +
    `⏱ *Started:* ${new Date(incident.started_at).toLocaleString()}\n` +
    (incident.ended_at ? `✅ *Ended:* ${new Date(incident.ended_at).toLocaleString()}\n` : '') +
    (incident.duration_seconds ? `⏳ *Duration:* ${formatDuration(incident.duration_seconds * 1000)}\n` : '');
  
  for (const chatId of chatIds) {
    try {
      await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Failed to send incident alert:', error.message);
    }
  }
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function stopTelegram() {
  if (bot) {
    bot.stop();
    isInitialized = false;
  }
}

export function getBot() {
  return bot;
}