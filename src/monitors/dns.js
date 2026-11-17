/**
 * DNS monitoring
 */

import { resolve, resolveAny, resolveNs, resolveMx, resolveTxt, resolveCname } from 'dns/promises';

export async function checkDns(monitor) {
  const startTime = Date.now();
  const timeout = monitor.timeout_seconds * 1000;
  
  try {
    const hostname = extractHostname(monitor.target);
    const recordType = monitor.dns_record_type || 'A';
    const expectedIp = monitor.dns_expected_ip;
    
    let records = [];
    let resolvedIps = [];
    
    switch (recordType.toUpperCase()) {
      case 'A':
        records = await resolve(hostname, 'A');
        resolvedIps = records;
        break;
      case 'AAAA':
        records = await resolve(hostname, 'AAAA');
        resolvedIps = records;
        break;
      case 'CNAME':
        records = await resolveCname(hostname);
        resolvedIps = records;
        break;
      case 'MX':
        records = await resolveMx(hostname);
        resolvedIps = records.map(r => r.exchange);
        break;
      case 'TXT':
        records = await resolveTxt(hostname);
        resolvedIps = records.flat();
        break;
      case 'NS':
        records = await resolveNs(hostname);
        resolvedIps = records;
        break;
      case 'ANY':
        records = await resolveAny(hostname);
        resolvedIps = records.flatMap(r => r.value || r);
        break;
      default:
        records = await resolve(hostname, 'A');
        resolvedIps = records;
    }
    
    const responseTime = Date.now() - startTime;
    
    // Check if expected IP is in results
    let status = 'up';
    let errorMessage = null;
    
    if (expectedIp) {
      const found = resolvedIps.some(ip => ip === expectedIp || ip.includes(expectedIp));
      if (!found) {
        status = 'down';
        errorMessage = `Expected IP ${expectedIp} not found in ${recordType} records: ${resolvedIps.join(', ')}`;
      }
    }
    
    if (resolvedIps.length === 0) {
      status = 'down';
      errorMessage = `No ${recordType} records found for ${hostname}`;
    }
    
    return {
      status,
      response_time_ms: responseTime,
      status_code: null,
      response_body: `DNS ${recordType} for ${hostname}: ${resolvedIps.join(', ')}`,
      error_message: errorMessage,
      dns_info: {
        hostname,
        record_type: recordType,
        records: records,
        resolved_ips: resolvedIps,
        expected_ip: expectedIp,
        expected_found: expectedIp ? resolvedIps.includes(expectedIp) : null
      }
    };
  } catch (error) {
    return {
      status: 'down',
      response_time_ms: Date.now() - startTime,
      error_message: error.message,
      dns_info: { hostname: extractHostname(monitor.target), error: error.message }
    };
  }
}

function extractHostname(target) {
  try {
    const url = new URL(target.startsWith('http') ? target : `http://${target}`);
    return url.hostname;
  } catch {
    return target.split(':')[0];
  }
}

// Multi-record DNS check
export async function checkDnsAllRecords(monitor) {
  const startTime = Date.now();
  const timeout = monitor.timeout_seconds * 1000;
  
  try {
    const hostname = extractHostname(monitor.target);
    const results = {};
    const recordTypes = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT'];
    
    await Promise.all(
      recordTypes.map(async (type) => {
        try {
          let records;
          switch (type) {
            case 'A': records = await resolve(hostname, 'A'); break;
            case 'AAAA': records = await resolve(hostname, 'AAAA'); break;
            case 'CNAME': records = await resolveCname(hostname); break;
            case 'MX': records = await resolveMx(hostname); break;
            case 'NS': records = await resolveNs(hostname); break;
            case 'TXT': records = await resolveTxt(hostname); break;
          }
          results[type] = records;
        } catch {
          results[type] = [];
        }
      })
    );
    
    const responseTime = Date.now() - startTime;
    const hasRecords = Object.values(results).some(r => r.length > 0);
    
    return {
      status: hasRecords ? 'up' : 'down',
      response_time_ms: responseTime,
      status_code: null,
      response_body: `DNS records for ${hostname}: ${JSON.stringify(results)}`,
      error_message: hasRecords ? null : `No DNS records found for ${hostname}`,
      dns_info: {
        hostname,
        all_records: results
      }
    };
  } catch (error) {
    return {
      status: 'down',
      response_time_ms: Date.now() - startTime,
      error_message: error.message,
      dns_info: { hostname: extractHostname(monitor.target), error: error.message }
    };
  }
}