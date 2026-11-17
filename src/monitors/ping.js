/**
 * ICMP Ping monitoring
 */

import { ping } from 'ping';
import { resolve } from 'dns/promises';

export async function checkPing(monitor) {
  const startTime = Date.now();
  const timeout = monitor.timeout_seconds * 1000;
  
  try {
    // Extract hostname/IP from target
    const host = extractHost(monitor.target);
    
    // Resolve if hostname
    let ip = host;
    try {
      const addresses = await resolve(host);
      ip = addresses[0];
    } catch {
      // Use as-is if already IP
    }
    
    const result = await ping.promise.probe(ip, {
      timeout: Math.floor(timeout / 1000),
      deadline: Math.floor(timeout / 1000),
      min_reply: monitor.retries || 3,
      extra: ['-i', '0.2'] // 200ms interval between pings
    });
    
    const responseTime = Date.now() - startTime;
    
    if (result.alive) {
      const avgTime = parseFloat(result.avg || result.time);
      return {
        status: 'up',
        response_time_ms: Math.round(avgTime) || responseTime,
        status_code: null,
        response_body: `Ping to ${ip}: ${result.avg}ms avg, ${result.packetLoss}% loss`,
        error_message: result.packetLoss > 50 ? `High packet loss: ${result.packetLoss}%` : null,
        ping_info: {
          host: ip,
          min: parseFloat(result.min),
          max: parseFloat(result.max),
          avg: parseFloat(result.avg),
          packet_loss: result.packetLoss,
          stddev: parseFloat(result.stddev)
        }
      };
    } else {
      return {
        status: 'down',
        response_time_ms: responseTime,
        error_message: 'Host unreachable',
        ping_info: { host: ip, packet_loss: 100 }
      };
    }
  } catch (error) {
    return {
      status: 'down',
      response_time_ms: Date.now() - startTime,
      error_message: error.message
    };
  }
}

function extractHost(target) {
  try {
    const url = new URL(target.startsWith('http') ? target : `http://${target}`);
    return url.hostname;
  } catch {
    return target.split(':')[0];
  }
}

// TCP Port check
export async function checkTcp(monitor) {
  const startTime = Date.now();
  const timeout = monitor.timeout_seconds * 1000;
  const port = monitor.port;
  const host = extractHost(monitor.target);
  
  if (!port) {
    return {
      status: 'down',
      response_time_ms: Date.now() - startTime,
      error_message: 'No port specified for TCP check'
    };
  }
  
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();
    let settled = false;
    
    const cleanup = () => {
      socket.destroy();
      settled = true;
    };
    
    socket.setTimeout(timeout);
    
    socket.on('connect', () => {
      if (settled) return;
      const responseTime = Date.now() - startTime;
      cleanup();
      resolve({
        status: 'up',
        response_time_ms: responseTime,
        status_code: null,
        response_body: `TCP connection to ${host}:${port} successful`,
        error_message: null,
        tcp_info: { host, port, connected: true }
      });
    });
    
    socket.on('timeout', () => {
      if (settled) return;
      cleanup();
      resolve({
        status: 'down',
        response_time_ms: Date.now() - startTime,
        error_message: `Connection timeout after ${timeout}ms`,
        tcp_info: { host, port, connected: false }
      });
    });
    
    socket.on('error', (err) => {
      if (settled) return;
      cleanup();
      resolve({
        status: 'down',
        response_time_ms: Date.now() - startTime,
        error_message: err.message,
        tcp_info: { host, port, connected: false }
      });
    });
    
    socket.connect(port, host);
  });
}