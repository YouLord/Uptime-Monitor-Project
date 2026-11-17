/**
 * SSL Certificate monitoring
 */

import { connect } from 'tls';
import { createSocket } from 'dgram';
import { promisify } from 'util';

export async function checkSsl(monitor) {
  const startTime = Date.now();
  const timeout = monitor.timeout_seconds * 1000;
  
  try {
    // Parse target - can be hostname:port or just hostname
    let { hostname, port } = parseTarget(monitor.target);
    port = monitor.port || port || 443;
    
    const certInfo = await getCertificate(hostname, port, timeout);
    const responseTime = Date.now() - startTime;
    
    if (!certInfo) {
      return {
        status: 'down',
        response_time_ms: responseTime,
        error_message: 'Failed to retrieve SSL certificate',
        ssl_info: null
      };
    }
    
    const daysRemaining = certInfo.days_remaining;
    let status = 'up';
    let errorMessage = null;
    
    // Check expiration
    if (daysRemaining !== null) {
      if (daysRemaining < 0) {
        status = 'down';
        errorMessage = `Certificate expired ${Math.abs(daysRemaining)} days ago`;
      } else if (daysRemaining <= 7) {
        status = 'degraded';
        errorMessage = `Certificate expires in ${daysRemaining} days`;
      } else if (daysRemaining <= 30) {
        status = 'degraded';
        errorMessage = `Certificate expires in ${daysRemaining} days (warning)`;
      }
    }
    
    // Check for weak signatures
    if (certInfo.signature_algorithm && isWeakAlgorithm(certInfo.signature_algorithm)) {
      status = 'degraded';
      errorMessage = (errorMessage ? errorMessage + '; ' : '') + `Weak signature algorithm: ${certInfo.signature_algorithm}`;
    }
    
    // Check key size
    if (certInfo.key_size && certInfo.key_size < 2048) {
      status = 'degraded';
      errorMessage = (errorMessage ? errorMessage + '; ' : '') + `Weak key size: ${certInfo.key_size} bits`;
    }
    
    return {
      status,
      response_time_ms: responseTime,
      status_code: null,
      error_message: errorMessage,
      ssl_info: certInfo
    };
  } catch (error) {
    return {
      status: 'down',
      response_time_ms: Date.now() - startTime,
      error_message: error.message,
      ssl_info: null
    };
  }
}

function parseTarget(target) {
  // Handle URL format
  try {
    const url = new URL(target.startsWith('http') ? target : `https://${target}`);
    return { hostname: url.hostname, port: url.port ? parseInt(url.port) : null };
  } catch {
    // Handle host:port format
    const parts = target.split(':');
    return { hostname: parts[0], port: parts[1] ? parseInt(parts[1]) : null };
  }
}

function getCertificate(hostname, port, timeout) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, hostname, {
      servername: hostname,
      rejectUnauthorized: false,
      timeout
    }, () => {
      const cert = socket.getPeerCertificate(true);
      socket.destroy();
      if (!cert || Object.keys(cert).length === 0) {
        resolve(null);
        return;
      }
      resolve(parseCertificate(cert, hostname));
    });
    
    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });
    
    socket.setTimeout(timeout, () => {
      socket.destroy();
      reject(new Error('SSL connection timeout'));
    });
  });
}

function parseCertificate(cert, hostname) {
  const validFrom = new Date(cert.valid_from).getTime();
  const validTo = new Date(cert.valid_to).getTime();
  const now = Date.now();
  
  // Extract key size from public key
  let keySize = null;
  try {
    if (cert.pubkey) {
      // This is a rough estimate - in production use crypto module
      const keyType = cert.pubkey.type || 'rsa';
      if (keyType === 'rsa' && cert.pubkey.data) {
        keySize = cert.pubkey.data.length * 8;
      }
    }
  } catch {}
  
  return {
    hostname,
    subject: cert.subject,
    issuer: cert.issuer,
    valid_from: cert.valid_from,
    valid_to: cert.valid_to,
    days_remaining: Math.floor((validTo - now) / (1000 * 60 * 60 * 24)),
    fingerprint: cert.fingerprint,
    fingerprint256: cert.fingerprint256,
    serial_number: cert.serialNumber,
    signature_algorithm: cert.sigalg,
    key_algorithm: cert.pubkey?.type,
    key_size: keySize,
    san: cert.subjectaltname || [],
    is_expired: validTo < now,
    is_expiring_soon: (validTo - now) < 30 * 24 * 60 * 60 * 1000
  };
}

function isWeakAlgorithm(algorithm) {
  const weak = ['sha1', 'md5', 'sha1withrsa', 'md5withrsa', 'sha1withecdsa'];
  return weak.some(w => algorithm.toLowerCase().includes(w));
}

// Batch check multiple hosts
export async function checkMultipleSsl(targets, timeout = 10000) {
  const results = await Promise.allSettled(
    targets.map(target => checkSsl({ target, timeout_seconds: Math.floor(timeout / 1000) }))
  );
  
  return results.map((result, index) => ({
    target: targets[index],
    ...(result.status === 'fulfilled' ? result.value : { status: 'down', error_message: result.reason?.message })
  }));
}