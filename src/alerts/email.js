/**
 * Email Alert Channel (SMTP)
 */

import nodemailer from 'nodemailer';
import config from '../../config.js';

let transporter = null;
let isInitialized = false;

export function initEmail() {
  const cfg = config();
  
  if (!cfg.SMTP_HOST || !cfg.SMTP_PORT || !cfg.SMTP_USER || !cfg.SMTP_PASS) {
    console.log('📧 Email alerts not configured (SMTP settings missing)');
    return false;
  }
  
  try {
    transporter = nodemailer.createTransport({
      host: cfg.SMTP_HOST,
      port: cfg.SMTP_PORT,
      secure: cfg.SMTP_PORT === 465, // true for 465, false for other ports
      auth: {
        user: cfg.SMTP_USER,
        pass: cfg.SMTP_PASS
      },
      tls: {
        rejectUnauthorized: false // For self-signed certs
      }
    });
    
    // Verify connection
    transporter.verify()
      .then(() => {
        console.log('📧 Email transporter ready');
        isInitialized = true;
      })
      .catch(err => {
        console.error('❌ Email transporter verification failed:', err.message);
        isInitialized = false;
      });
    
    return true;
  } catch (error) {
    console.error('❌ Failed to create email transporter:', error.message);
    return false;
  }
}

export async function sendEmailAlert(monitor, result, alertRule) {
  if (!transporter || !isInitialized) {
    return { status: 'failed', error: 'Email not initialized' };
  }
  
  const cfg = config();
  const to = cfg.ALERT_EMAIL_TO;
  
  if (!to) {
    return { status: 'failed', error: 'No recipient email configured' };
  }
  
  const isDown = result.status === 'down';
  const statusText = isDown ? 'DOWN' : result.status === 'degraded' ? 'DEGRADED' : 'UP';
  const statusColor = isDown ? '#dc3545' : result.status === 'degraded' ? '#ffc107' : '#28a745';
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: ${statusColor}; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="margin: 0;">${monitor.name} is ${statusText}</h1>
      </div>
      
      <div style="background: #f8f9fa; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #dee2e6; border-top: none;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; font-weight: bold; width: 120px;">Target:</td>
            <td style="padding: 8px 0; font-family: monospace; background: #e9ecef; padding: 4px 8px; border-radius: 4px;">${monitor.target}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Type:</td>
            <td style="padding: 8px 0;">${monitor.type.toUpperCase()}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Response Time:</td>
            <td style="padding: 8px 0;">${result.response_time_ms}ms</td>
          </tr>
          ${result.status_code ? `
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Status Code:</td>
            <td style="padding: 8px 0;">${result.status_code}</td>
          </tr>
          ` : ''}
          ${result.error_message ? `
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #dc3545;">Error:</td>
            <td style="padding: 8px 0; color: #dc3545;">${escapeHtml(result.error_message)}</td>
          </tr>
          ` : ''}
        </table>
        
        <div style="margin-top: 20px; text-align: center;">
          <a href="${cfg.DASHBOARD_URL || 'http://localhost:3000'}/monitor/${monitor.id}" 
             style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
            View Dashboard
          </a>
        </div>
        
        <hr style="margin: 20px 0; border-color: #dee2e6;">
        <p style="font-size: 12px; color: #6c757d; text-align: center; margin: 0;">
          Alert triggered by rule: <strong>${alertRule?.name || 'Unknown'}</strong><br>
          ${new Date().toLocaleString()}
        </p>
      </div>
    </body>
    </html>
  `;
  
  const text = `
${monitor.name} is ${statusText}

Target: ${monitor.target}
Type: ${monitor.type.toUpperCase()}
Response Time: ${result.response_time_ms}ms
${result.status_code ? `Status Code: ${result.status_code}` : ''}
${result.error_message ? `Error: ${result.error_message}` : ''}

View Dashboard: ${cfg.DASHBOARD_URL || 'http://localhost:3000'}/monitor/${monitor.id}

Alert Rule: ${alertRule?.name || 'Unknown'}
Time: ${new Date().toLocaleString()}
  `.trim();
  
  try {
    const recipients = to.split(',').map(e => e.trim()).filter(Boolean);
    
    const results = [];
    for (const recipient of recipients) {
      await transporter.sendMail({
        from: cfg.SMTP_FROM || cfg.SMTP_USER,
        to: recipient,
        subject: `[Uptime Monitor] ${monitor.name} is ${statusText}`,
        text,
        html
      });
      results.push({ to: recipient, status: 'sent' });
    }
    
    return { status: 'sent', details: results };
  } catch (error) {
    return { status: 'failed', error: error.message };
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

export function sendTestEmail(to) {
  if (!transporter || !isInitialized) {
    return Promise.resolve({ status: 'failed', error: 'Email not initialized' });
  }
  
  const cfg = config();
  return transporter.sendMail({
    from: cfg.SMTP_FROM || cfg.SMTP_USER,
    to,
    subject: '[Uptime Monitor] Test Email',
    text: 'This is a test email from Uptime Monitor. If you receive this, email alerts are configured correctly.',
    html: `
      <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #28a745;">✅ Test Email Successful</h2>
        <p>This is a test email from <strong>Uptime Monitor</strong>.</p>
        <p>If you receive this, email alerts are configured correctly.</p>
        <hr>
        <p style="font-size: 12px; color: #6c757d;">${new Date().toLocaleString()}</p>
      </div>
    `
  });
}