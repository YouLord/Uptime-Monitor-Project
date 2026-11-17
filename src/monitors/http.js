/**
 * HTTP/HTTPS monitoring checks
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';

export async function checkHttp(monitor) {
  const startTime = Date.now();
  const timeout = monitor.timeout_seconds * 1000;
  
  try {
    const url = monitor.target;
    const method = monitor.method || 'GET';
    const headers = typeof monitor.headers === 'string' ? JSON.parse(monitor.headers) : (monitor.headers || {});
    const body = monitor.body || undefined;
    const expectedCodes = typeof monitor.expected_status_codes === 'string' 
      ? JSON.parse(monitor.expected_status_codes) 
      : (monitor.expected_status_codes || [200]);
    const keyword = monitor.keyword;
    const ignoreSsl = monitor.ignore_ssl === 1 || monitor.ignore_ssl === true;
    const followRedirects = monitor.follow_redirects !== 0 && monitor.follow_redirects !== false;
    const maxRedirects = monitor.max_redirects || 10;
    
    const axiosConfig = {
      method,
      url,
      timeout,
      headers: {
        'User-Agent': 'UptimeMonitor/1.0 (+https://github.com/YouLord/uptime-monitor)',
        ...headers
      },
      data: body,
      validateStatus: () => true, // Don't throw on non-2xx
      maxRedirects,
      httpsAgent: ignoreSsl ? new (await import('https')).Agent({ rejectUnauthorized: false }) : undefined
    };
    
    const response = await axios(axiosConfig);
    const responseTime = Date.now() - startTime;
    const statusCode = response.status;
    
    // Check status code
    const statusCodeOk = expectedCodes.includes(statusCode);
    
    // Check keyword if specified
    let keywordOk = true;
    if (keyword && typeof response.data === 'string') {
      const $ = cheerio.load(response.data);
      const text = $('body').text() || response.data;
      keywordOk = text.includes(keyword);
    }
    
    const isUp = statusCodeOk && keywordOk;
    
    return {
      status: isUp ? 'up' : 'degraded',
      response_time_ms: responseTime,
      status_code: statusCode,
      response_body: typeof response.data === 'string' ? response.data.slice(0, 10000) : JSON.stringify(response.data).slice(0, 10000),
      error_message: isUp ? null : `Status: ${statusCode} (expected: ${expectedCodes.join(', ')})${keyword && !keywordOk ? `, Keyword "${keyword}" not found` : ''}`,
      ssl_info: response.socket?.getPeerCertificate ? getSslInfo(response.socket.getPeerCertificate()) : null
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    let errorMessage = error.message;
    let status = 'down';
    
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      errorMessage = `Timeout after ${timeout}ms`;
    } else if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      errorMessage = 'DNS resolution failed';
      status = 'down';
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused';
    } else if (error.response) {
      status = 'degraded';
      errorMessage = `Status: ${error.response.status}`;
    }
    
    return {
      status,
      response_time_ms: responseTime,
      status_code: error.response?.status || null,
      response_body: error.response?.data ? (typeof error.response.data === 'string' ? error.response.data.slice(0, 5000) : JSON.stringify(error.response.data).slice(0, 5000)) : null,
      error_message: errorMessage,
      ssl_info: null
    };
  }
}

function getSslInfo(cert) {
  if (!cert) return null;
  try {
    return {
      subject: cert.subject,
      issuer: cert.issuer,
      valid_from: cert.valid_from,
      valid_to: cert.valid_to,
      fingerprint: cert.fingerprint,
      serial_number: cert.serialNumber,
      days_remaining: cert.valid_to ? Math.ceil((new Date(cert.valid_to).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null
    };
  } catch {
    return null;
  }
}

export async function checkKeyword(monitor) {
  // Reuse HTTP check but focus on keyword
  const result = await checkHttp(monitor);
  return result;
}