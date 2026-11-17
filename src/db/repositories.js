/**
 * Repository layer for database operations
 */

import { getDb, sql, transaction, generateId, now } from './index.js';
import { randomUUID } from 'crypto';

// User Repository
export const userRepo = {
  create: async (username, email, passwordHash, role = 'viewer') => {
    const { db, pgPool, isPostgres } = getDb();
    const id = generateId();
    const timestamp = now();
    
    if (isPostgres) {
      await pgPool.query(
        'INSERT INTO users (id, username, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, username, email, passwordHash, role, timestamp]
      );
    } else {
      db.prepare('INSERT INTO users (id, username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, username, email, passwordHash, role, timestamp);
    }
    return { id, username, email, role, created_at: timestamp };
  },
  
  findByUsername: async (username) => {
    const { pgPool, isPostgres } = getDb();
    if (isPostgres) {
      const res = await pgPool.query('SELECT * FROM users WHERE username = $1', [username]);
      return res.rows[0] || null;
    }
    return getDb().db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },
  
  findById: async (id) => {
    const { pgPool, isPostgres } = getDb();
    if (isPostgres) {
      const res = await pgPool.query('SELECT id, username, email, role, created_at, last_login, settings FROM users WHERE id = $1', [id]);
      return res.rows[0] || null;
    }
    return getDb().db.prepare('SELECT id, username, email, role, created_at, last_login, settings FROM users WHERE id = ?').get(id);
  },
  
  updateLastLogin: async (id) => {
    const timestamp = now();
    const { pgPool, isPostgres } = getDb();
    if (isPostgres) {
      await pgPool.query('UPDATE users SET last_login = $1 WHERE id = $2', [timestamp, id]);
    } else {
      getDb().db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(timestamp, id);
    }
  },
  
  list: async (limit = 50, offset = 0) => {
    const { pgPool, isPostgres } = getDb();
    if (isPostgres) {
      const res = await pgPool.query(
        'SELECT id, username, email, role, created_at, last_login FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );
      return res.rows;
    }
    return getDb().db.prepare('SELECT id, username, email, role, created_at, last_login FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  }
};

// Monitor Repository
export const monitorRepo = {
  create: async (data) => {
    const { db, pgPool, isPostgres } = getDb();
    const id = generateId();
    const timestamp = now();
    
    const monitor = {
      id,
      name: data.name,
      type: data.type,
      target: data.target,
      interval_seconds: data.interval_seconds || 60,
      timeout_seconds: data.timeout_seconds || 10,
      retries: data.retries || 3,
      method: data.method || 'GET',
      headers: JSON.stringify(data.headers || {}),
      body: data.body || null,
      expected_status_codes: JSON.stringify(data.expected_status_codes || [200]),
      keyword: data.keyword || null,
      ignore_ssl: data.ignore_ssl ? 1 : 0,
      follow_redirects: data.follow_redirects ? 1 : 0,
      max_redirects: data.max_redirects || 10,
      dns_record_type: data.dns_record_type || 'A',
      dns_expected_ip: data.dns_expected_ip || null,
      port: data.port || null,
      is_active: data.is_active !== false ? 1 : 0,
      tags: JSON.stringify(data.tags || []),
      created_by: data.created_by || null,
      created_at: timestamp,
      updated_at: timestamp
    };
    
    if (isPostgres) {
      await pgPool.query(
        `INSERT INTO monitors (id, name, type, target, interval_seconds, timeout_seconds, retries, method, headers, body, expected_status_codes, keyword, ignore_ssl, follow_redirects, max_redirects, dns_record_type, dns_expected_ip, port, is_active, tags, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        Object.values(monitor)
      );
    } else {
      const stmt = db.prepare(`
        INSERT INTO monitors (id, name, type, target, interval_seconds, timeout_seconds, retries, method, headers, body, expected_status_codes, keyword, ignore_ssl, follow_redirects, max_redirects, dns_record_type, dns_expected_ip, port, is_active, tags, created_by, created_at, updated_at)
        VALUES (@id, @name, @type, @target, @interval_seconds, @timeout_seconds, @retries, @method, @headers, @body, @expected_status_codes, @keyword, @ignore_ssl, @follow_redirects, @max_redirects, @dns_record_type, @dns_expected_ip, @port, @is_active, @tags, @created_by, @created_at, @updated_at)
      `);
      stmt.run(monitor);
    }
    return monitor;
  },
  
  findById: async (id) => {
    const { pgPool, isPostgres } = getDb();
    if (isPostgres) {
      const res = await pgPool.query('SELECT * FROM monitors WHERE id = $1', [id]);
      return res.rows[0] || null;
    }
    return getDb().db.prepare('SELECT * FROM monitors WHERE id = ?').get(id);
  },
  
  findAll: async (filters = {}) => {
    const { pgPool, isPostgres } = getDb();
    let query = 'SELECT * FROM monitors WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (filters.is_active !== undefined) {
      query += isPostgres ? ` AND is_active = $${paramIndex++}` : ' AND is_active = ?';
      params.push(filters.is_active ? 1 : 0);
    }
    if (filters.type) {
      query += isPostgres ? ` AND type = $${paramIndex++}` : ' AND type = ?';
      params.push(filters.type);
    }
    if (filters.created_by) {
      query += isPostgres ? ` AND created_by = $${paramIndex++}` : ' AND created_by = ?';
      params.push(filters.created_by);
    }
    if (filters.search) {
      query += isPostgres ? ` AND (name LIKE $${paramIndex++} OR target LIKE $${paramIndex++})` : ' AND (name LIKE ? OR target LIKE ?)';
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm);
    }
    
    query += ' ORDER BY created_at DESC';
    
    if (filters.limit) {
      query += isPostgres ? ` LIMIT $${paramIndex++}` : ' LIMIT ?';
      params.push(filters.limit);
    }
    if (filters.offset) {
      query += isPostgres ? ` OFFSET $${paramIndex++}` : ' OFFSET ?';
      params.push(filters.offset);
    }
    
    if (isPostgres) {
      const res = await pgPool.query(query, params);
      return res.rows;
    }
    return getDb().db.prepare(query).all(...params);
  },
  
  update: async (id, data) => {
    const { db, pgPool, isPostgres } = getDb();
    const timestamp = now();
    const allowedFields = [
      'name', 'type', 'target', 'interval_seconds', 'timeout_seconds', 'retries',
      'method', 'headers', 'body', 'expected_status_codes', 'keyword',
      'ignore_ssl', 'follow_redirects', 'max_redirects', 'dns_record_type',
      'dns_expected_ip', 'port', 'is_active', 'tags'
    ];
    
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updates.push(isPostgres ? `${field} = $${paramIndex++}` : `${field} = ?`);
        let value = data[field];
        if (['headers', 'expected_status_codes', 'tags'].includes(field)) {
          value = JSON.stringify(value);
        }
        if (['ignore_ssl', 'follow_redirects', 'is_active'].includes(field)) {
          value = value ? 1 : 0;
        }
        values.push(value);
      }
    }
    
    if (updates.length === 0) return monitorRepo.findById(id);
    
    updates.push(isPostgres ? `updated_at = $${paramIndex++}` : 'updated_at = ?');
    values.push(timestamp);
    values.push(id);
    
    const query = `UPDATE monitors SET ${updates.join(', ')} WHERE id = ${isPostgres ? `$${paramIndex}` : '?'}`;
    
    if (isPostgres) {
      await pgPool.query(query, values);
    } else {
      db.prepare(query).run(...values);
    }
    
    return monitorRepo.findById(id);
  },
  
  delete: async (id) => {
    const { db, pgPool, isPostgres } = getDb();
    if (isPostgres) {
      await pgPool.query('DELETE FROM monitors WHERE id = $1', [id]);
    } else {
      db.prepare('DELETE FROM monitors WHERE id = ?').run(id);
    }
    return true;
  },
  
  getActiveMonitors: async () => {
    return monitorRepo.findAll({ is_active: true });
  }
};

// Check Results Repository
export const checkResultRepo = {
  create: async (data) => {
    const { db, pgPool, isPostgres } = getDb();
    const id = generateId();
    const timestamp = now();
    
    const result = {
      id,
      monitor_id: data.monitor_id,
      timestamp: data.timestamp || timestamp,
      status: data.status,
      response_time_ms: data.response_time_ms || null,
      status_code: data.status_code || null,
      response_body: data.response_body || null,
      error_message: data.error_message || null,
      ssl_info: data.ssl_info ? JSON.stringify(data.ssl_info) : null,
      dns_info: data.dns_info ? JSON.stringify(data.dns_info) : null,
      region: data.region || 'primary',
      created_at: timestamp
    };
    
    if (isPostgres) {
      await pgPool.query(
        `INSERT INTO check_results (id, monitor_id, timestamp, status, response_time_ms, status_code, response_body, error_message, ssl_info, dns_info, region, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        Object.values(result)
      );
    } else {
      const stmt = db.prepare(`
        INSERT INTO check_results (id, monitor_id, timestamp, status, response_time_ms, status_code, response_body, error_message, ssl_info, dns_info, region, created_at)
        VALUES (@id, @monitor_id, @timestamp, @status, @response_time_ms, @status_code, @response_body, @error_message, @ssl_info, @dns_info, @region, @created_at)
      `);
      stmt.run(result);
    }
    return result;
  },
  
  findByMonitor: async (monitorId, limit = 100, before = null) => {
    const { pgPool, isPostgres } = getDb();
    let query = 'SELECT * FROM check_results WHERE monitor_id = ' + (isPostgres ? '$1' : '?');
    const params = [monitorId];
    let paramIndex = 2;
    
    if (before) {
      query += isPostgres ? ` AND timestamp < $${paramIndex++}` : ' AND timestamp < ?';
      params.push(before);
    }
    
    query += ' ORDER BY timestamp DESC';
    
    if (limit) {
      query += isPostgres ? ` LIMIT $${paramIndex++}` : ' LIMIT ?';
      params.push(limit);
    }
    
    if (isPostgres) {
      const res = await pgPool.query(query, params);
      return res.rows;
    }
    return getDb().db.prepare(query).all(...params);
  },
  
  getLatest: async (monitorId) => {
    const { pgPool, isPostgres } = getDb();
    if (isPostgres) {
      const res = await pgPool.query(
        'SELECT * FROM check_results WHERE monitor_id = $1 ORDER BY timestamp DESC LIMIT 1',
        [monitorId]
      );
      return res.rows[0] || null;
    }
    return getDb().db.prepare('SELECT * FROM check_results WHERE monitor_id = ? ORDER BY timestamp DESC LIMIT 1').get(monitorId);
  },
  
  getLatestForAllMonitors: async () => {
    const { pgPool, isPostgres } = getDb();
    const query = `
      SELECT DISTINCT ON (monitor_id) * FROM check_results
      ORDER BY monitor_id, timestamp DESC
    `;
    if (isPostgres) {
      const res = await pgPool.query(query);
      return res.rows;
    }
    return getDb().db.prepare(query).all();
  },
  
  cleanup: async (olderThanTimestamp) => {
    const { db, pgPool, isPostgres } = getDb();
    if (isPostgres) {
      await pgPool.query('DELETE FROM check_results WHERE timestamp < $1', [olderThanTimestamp]);
    } else {
      db.prepare('DELETE FROM check_results WHERE timestamp < ?').run(olderThanTimestamp);
    }
  }
};

// Stats Repository
export const statsRepo = {
  upsertHourly: async (monitorId, hourTimestamp, stats) => {
    const { db, pgPool, isPostgres } = getDb();
    const id = generateId();
    const timestamp = now();
    
    if (isPostgres) {
      await pgPool.query(
        `INSERT INTO monitor_stats_hourly (id, monitor_id, hour_timestamp, total_checks, successful_checks, failed_checks, avg_response_time_ms, min_response_time_ms, max_response_time_ms, uptime_percentage, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (monitor_id, hour_timestamp) DO UPDATE SET
           total_checks = EXCLUDED.total_checks,
           successful_checks = EXCLUDED.successful_checks,
           failed_checks = EXCLUDED.failed_checks,
           avg_response_time_ms = EXCLUDED.avg_response_time_ms,
           min_response_time_ms = EXCLUDED.min_response_time_ms,
           max_response_time_ms = EXCLUDED.max_response_time_ms,
           uptime_percentage = EXCLUDED.uptime_percentage`,
        [id, monitorId, hourTimestamp, stats.total, stats.successful, stats.failed, stats.avg, stats.min, stats.max, stats.uptime, timestamp]
      );
    } else {
      db.prepare(`
        INSERT INTO monitor_stats_hourly (id, monitor_id, hour_timestamp, total_checks, successful_checks, failed_checks, avg_response_time_ms, min_response_time_ms, max_response_time_ms, uptime_percentage, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(monitor_id, hour_timestamp) DO UPDATE SET
          total_checks = excluded.total_checks,
          successful_checks = excluded.successful_checks,
          failed_checks = excluded.failed_checks,
          avg_response_time_ms = excluded.avg_response_time_ms,
          min_response_time_ms = excluded.min_response_time_ms,
          max_response_time_ms = excluded.max_response_time_ms,
          uptime_percentage = excluded.uptime_percentage
      `).run(id, monitorId, hourTimestamp, stats.total, stats.successful, stats.failed, stats.avg, stats.min, stats.max, stats.uptime, timestamp);
    }
  },
  
  getHourly: async (monitorId, hours = 24) => {
    const { pgPool, isPostgres } = getDb();
    const since = now() - hours * 3600 * 1000;
    
    if (isPostgres) {
      const res = await pgPool.query(
        'SELECT * FROM monitor_stats_hourly WHERE monitor_id = $1 AND hour_timestamp >= $2 ORDER BY hour_timestamp ASC',
        [monitorId, since]
      );
      return res.rows;
    }
    return getDb().db.prepare('SELECT * FROM monitor_stats_hourly WHERE monitor_id = ? AND hour_timestamp >= ? ORDER BY hour_timestamp ASC').all(monitorId, since);
  },
  
  getDaily: async (monitorId, days = 30) => {
    const { pgPool, isPostgres } = getDb();
    const since = now() - days * 86400 * 1000;
    
    if (isPostgres) {
      const res = await pgPool.query(
        'SELECT * FROM monitor_stats_daily WHERE monitor_id = $1 AND day_timestamp >= $2 ORDER BY day_timestamp ASC',
        [monitorId, since]
      );
      return res.rows;
    }
    return getDb().db.prepare('SELECT * FROM monitor_stats_daily WHERE monitor_id = ? AND day_timestamp >= ? ORDER BY day_timestamp ASC').all(monitorId, since);
  }
};

// Incident Repository
export const incidentRepo = {
  create: async (monitorId) => {
    const { db, pgPool, isPostgres } = getDb();
    const id = generateId();
    const timestamp = now();
    
    const incident = {
      id,
      monitor_id: monitorId,
      started_at: timestamp,
      ended_at: null,
      duration_seconds: null,
      status: 'open',
      cause: null,
      acknowledged_by: null,
      acknowledged_at: null,
      resolved_by: null,
      resolved_at: null,
      created_at: timestamp
    };
    
    if (isPostgres) {
      await pgPool.query(
        `INSERT INTO incidents (id, monitor_id, started_at, ended_at, duration_seconds, status, cause, acknowledged_by, acknowledged_at, resolved_by, resolved_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        Object.values(incident)
      );
    } else {
      db.prepare(`
        INSERT INTO incidents (id, monitor_id, started_at, ended_at, duration_seconds, status, cause, acknowledged_by, acknowledged_at, resolved_by, resolved_at, created_at)
        VALUES (@id, @monitor_id, @started_at, @ended_at, @duration_seconds, @status, @cause, @acknowledged_by, @acknowledged_at, @resolved_by, @resolved_at, @created_at)
      `).run(incident);
    }
    return incident;
  },
  
  findOpenByMonitor: async (monitorId) => {
    const { pgPool, isPostgres } = getDb();
    if (isPostgres) {
      const res = await pgPool.query(
        'SELECT * FROM incidents WHERE monitor_id = $1 AND status = $2 ORDER BY started_at DESC LIMIT 1',
        [monitorId, 'open']
      );
      return res.rows[0] || null;
    }
    return getDb().db.prepare('SELECT * FROM incidents WHERE monitor_id = ? AND status = ? ORDER BY started_at DESC LIMIT 1').get(monitorId, 'open');
  },
  
  resolve: async (id, userId, cause = null) => {
    const { db, pgPool, isPostgres } = getDb();
    const timestamp = now();
    
    // Get incident to calculate duration
    const incident = await incidentRepo.findById(id);
    if (!incident) return null;
    
    const duration = Math.floor((timestamp - incident.started_at) / 1000);
    
    if (isPostgres) {
      await pgPool.query(
        `UPDATE incidents SET ended_at = $1, duration_seconds = $2, status = $3, cause = $4, resolved_by = $5, resolved_at = $6 WHERE id = $7`,
        [timestamp, duration, 'resolved', cause, userId, timestamp, id]
      );
    } else {
      db.prepare(`
        UPDATE incidents SET ended_at = ?, duration_seconds = ?, status = ?, cause = ?, resolved_by = ?, resolved_at = ? WHERE id = ?
      `).run(timestamp, duration, 'resolved', cause, userId, timestamp, id);
    }
    return incidentRepo.findById(id);
  },
  
  findById: async (id) => {
    const { pgPool, isPostgres } = getDb();
    if (isPostgres) {
      const res = await pgPool.query('SELECT * FROM incidents WHERE id = $1', [id]);
      return res.rows[0] || null;
    }
    return getDb().db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
  },
  
  list: async (filters = {}) => {
    const { pgPool, isPostgres } = getDb();
    let query = 'SELECT * FROM incidents WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (filters.monitor_id) {
      query += isPostgres ? ` AND monitor_id = $${paramIndex++}` : ' AND monitor_id = ?';
      params.push(filters.monitor_id);
    }
    if (filters.status) {
      query += isPostgres ? ` AND status = $${paramIndex++}` : ' AND status = ?';
      params.push(filters.status);
    }
    
    query += ' ORDER BY started_at DESC';
    
    if (filters.limit) {
      query += isPostgres ? ` LIMIT $${paramIndex++}` : ' LIMIT ?';
      params.push(filters.limit);
    }
    
    if (isPostgres) {
      const res = await pgPool.query(query, params);
      return res.rows;
    }
    return getDb().db.prepare(query).all(...params);
  }
};

// Alert Rule Repository
export const alertRuleRepo = {
  create: async (data) => {
    const { db, pgPool, isPostgres } = getDb();
    const id = generateId();
    const timestamp = now();
    
    const rule = {
      id,
      name: data.name,
      monitor_id: data.monitor_id || null,
      condition: data.condition,
      threshold: JSON.stringify(data.threshold || {}),
      channels: JSON.stringify(data.channels || ['telegram']),
      is_active: data.is_active !== false ? 1 : 0,
      cooldown_seconds: data.cooldown_seconds || 300,
      created_by: data.created_by || null,
      created_at: timestamp,
      updated_at: timestamp
    };
    
    if (isPostgres) {
      await pgPool.query(
        `INSERT INTO alert_rules (id, name, monitor_id, condition, threshold, channels, is_active, cooldown_seconds, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        Object.values(rule)
      );
    } else {
      db.prepare(`
        INSERT INTO alert_rules (id, name, monitor_id, condition, threshold, channels, is_active, cooldown_seconds, created_by, created_at, updated_at)
        VALUES (@id, @name, @monitor_id, @condition, @threshold, @channels, @is_active, @cooldown_seconds, @created_by, @created_at, @updated_at)
      `).run(rule);
    }
    return rule;
  },
  
  findAll: async (monitorId = null) => {
    const { pgPool, isPostgres } = getDb();
    if (monitorId) {
      if (isPostgres) {
        const res = await pgPool.query('SELECT * FROM alert_rules WHERE monitor_id = $1 OR monitor_id IS NULL ORDER BY created_at DESC', [monitorId]);
        return res.rows;
      }
      return getDb().db.prepare('SELECT * FROM alert_rules WHERE monitor_id = ? OR monitor_id IS NULL ORDER BY created_at DESC').all(monitorId);
    }
    if (isPostgres) {
      const res = await pgPool.query('SELECT * FROM alert_rules ORDER BY created_at DESC');
      return res.rows;
    }
    return getDb().db.prepare('SELECT * FROM alert_rules ORDER BY created_at DESC').all();
  },
  
  findById: async (id) => {
    const { pgPool, isPostgres } = getDb();
    if (isPostgres) {
      const res = await pgPool.query('SELECT * FROM alert_rules WHERE id = $1', [id]);
      return res.rows[0] || null;
    }
    return getDb().db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(id);
  },
  
  update: async (id, data) => {
    const { db, pgPool, isPostgres } = getDb();
    const timestamp = now();
    const allowedFields = ['name', 'condition', 'threshold', 'channels', 'is_active', 'cooldown_seconds'];
    
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updates.push(isPostgres ? `${field} = $${paramIndex++}` : `${field} = ?`);
        let value = data[field];
        if (['threshold', 'channels'].includes(field)) {
          value = JSON.stringify(value);
        }
        if (field === 'is_active') {
          value = value ? 1 : 0;
        }
        values.push(value);
      }
    }
    
    if (updates.length === 0) return alertRuleRepo.findById(id);
    
    updates.push(isPostgres ? `updated_at = $${paramIndex++}` : 'updated_at = ?');
    values.push(timestamp);
    values.push(id);
    
    const query = `UPDATE alert_rules SET ${updates.join(', ')} WHERE id = ${isPostgres ? `$${paramIndex}` : '?'}`;
    
    if (isPostgres) {
      await pgPool.query(query, values);
    } else {
      db.prepare(query).run(...values);
    }
    
    return alertRuleRepo.findById(id);
  },
  
  delete: async (id) => {
    const { db, pgPool, isPostgres } = getDb();
    if (isPostgres) {
      await pgPool.query('DELETE FROM alert_rules WHERE id = $1', [id]);
    } else {
      db.prepare('DELETE FROM alert_rules WHERE id = ?').run(id);
    }
    return true;
  }
};

// Alert History Repository
export const alertHistoryRepo = {
  create: async (data) => {
    const { db, pgPool, isPostgres } = getDb();
    const id = generateId();
    const timestamp = now();
    
    const record = {
      id,
      alert_rule_id: data.alert_rule_id || null,
      monitor_id: data.monitor_id,
      channel: data.channel,
      status: data.status,
      message: data.message || null,
      error: data.error || null,
      sent_at: timestamp
    };
    
    if (isPostgres) {
      await pgPool.query(
        `INSERT INTO alert_history (id, alert_rule_id, monitor_id, channel, status, message, error, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        Object.values(record)
      );
    } else {
      db.prepare(`
        INSERT INTO alert_history (id, alert_rule_id, monitor_id, channel, status, message, error, sent_at)
        VALUES (@id, @alert_rule_id, @monitor_id, @channel, @status, @message, @error, @sent_at)
      `).run(record);
    }
    return record;
  },
  
  findByMonitor: async (monitorId, limit = 50) => {
    const { pgPool, isPostgres } = getDb();
    if (isPostgres) {
      const res = await pgPool.query(
        'SELECT * FROM alert_history WHERE monitor_id = $1 ORDER BY sent_at DESC LIMIT $2',
        [monitorId, limit]
      );
      return res.rows;
    }
    return getDb().db.prepare('SELECT * FROM alert_history WHERE monitor_id = ? ORDER BY sent_at DESC LIMIT ?').all(monitorId, limit);
  }
};

// Maintenance Window Repository
export const maintenanceRepo = {
  create: async (data) => {
    const { db, pgPool, isPostgres } = getDb();
    const id = generateId();
    const timestamp = now();
    
    const window = {
      id,
      name: data.name,
      monitor_id: data.monitor_id || null,
      start_time: data.start_time,
      end_time: data.end_time,
      recurrence: data.recurrence || null,
      timezone: data.timezone || 'UTC',
      created_by: data.created_by || null,
      created_at: timestamp
    };
    
    if (isPostgres) {
      await pgPool.query(
        `INSERT INTO maintenance_windows (id, name, monitor_id, start_time, end_time, recurrence, timezone, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        Object.values(window)
      );
    } else {
      db.prepare(`
        INSERT INTO maintenance_windows (id, name, monitor_id, start_time, end_time, recurrence, timezone, created_by, created_at)
        VALUES (@id, @name, @monitor_id, @start_time, @end_time, @recurrence, @timezone, @created_by, @created_at)
      `).run(window);
    }
    return window;
  },
  
  findActive: async (monitorId = null, atTime = null) => {
    const { pgPool, isPostgres } = getDb();
    const time = atTime || now();
    
    let query = `
      SELECT * FROM maintenance_windows 
      WHERE start_time <= ${isPostgres ? '$1' : '?'} 
      AND end_time >= ${isPostgres ? '$2' : '?'}
    `;
    const params = [time, time];
    let paramIndex = 3;
    
    if (monitorId) {
      query += isPostgres ? ` AND (monitor_id = $${paramIndex++} OR monitor_id IS NULL)` : ' AND (monitor_id = ? OR monitor_id IS NULL)';
      params.push(monitorId);
    }
    
    if (isPostgres) {
      const res = await pgPool.query(query, params);
      return res.rows;
    }
    return getDb().db.prepare(query).all(...params);
  }
};

// Settings Repository
export const settingsRepo = {
  get: async (key) => {
    const { pgPool, isPostgres } = getDb();
    if (isPostgres) {
      const res = await pgPool.query('SELECT value FROM settings WHERE key = $1', [key]);
      return res.rows[0]?.value || null;
    }
    const row = getDb().db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row?.value || null;
  },
  
  set: async (key, value) => {
    const { db, pgPool, isPostgres } = getDb();
    const timestamp = now();
    if (isPostgres) {
      await pgPool.query(
        'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3',
        [key, value, timestamp]
      );
    } else {
      db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?').run(key, value, timestamp, value, timestamp);
    }
  },
  
  getAll: async () => {
    const { pgPool, isPostgres } = getDb();
    if (isPostgres) {
      const res = await pgPool.query('SELECT * FROM settings');
      return res.rows;
    }
    return getDb().db.prepare('SELECT * FROM settings').all();
  }
};

// Status Page Repository
export const statusPageRepo = {
  create: async (data) => {
    const { db, pgPool, isPostgres } = getDb();
    const id = generateId();
    const timestamp = now();
    
    const page = {
      id,
      slug: data.slug,
      title: data.title,
      description: data.description || '',
      monitor_ids: JSON.stringify(data.monitor_ids || []),
      is_public: data.is_public !== false ? 1 : 0,
      custom_domain: data.custom_domain || null,
      theme: data.theme || 'light',
      created_by: data.created_by || null,
      created_at: timestamp,
      updated_at: timestamp
    };
    
    if (isPostgres) {
      await pgPool.query(
        `INSERT INTO status_pages (id, slug, title, description, monitor_ids, is_public, custom_domain, theme, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        Object.values(page)
      );
    } else {
      db.prepare(`
        INSERT INTO status_pages (id, slug, title, description, monitor_ids, is_public, custom_domain, theme, created_by, created_at, updated_at)
        VALUES (@id, @slug, @title, @description, @monitor_ids, @is_public, @custom_domain, @theme, @created_by, @created_at, @updated_at)
      `).run(page);
    }
    return page;
  },
  
  findBySlug: async (slug) => {
    const { pgPool, isPostgres } = getDb();
    if (isPostgres) {
      const res = await pgPool.query('SELECT * FROM status_pages WHERE slug = $1', [slug]);
      return res.rows[0] || null;
    }
    return getDb().db.prepare('SELECT * FROM status_pages WHERE slug = ?').get(slug);
  },
  
  findAll: async () => {
    const { pgPool, isPostgres } = getDb();
    if (isPostgres) {
      const res = await pgPool.query('SELECT * FROM status_pages ORDER BY created_at DESC');
      return res.rows;
    }
    return getDb().db.prepare('SELECT * FROM status_pages ORDER BY created_at DESC').all();
  }
};