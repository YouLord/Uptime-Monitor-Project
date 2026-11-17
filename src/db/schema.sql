-- Uptime Monitor Database Schema
-- Compatible with SQLite and PostgreSQL

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
  created_at INTEGER NOT NULL,
  last_login INTEGER,
  settings TEXT DEFAULT '{}' -- JSON
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Monitors
CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('http', 'https', 'ping', 'dns', 'tcp', 'keyword')),
  target TEXT NOT NULL, -- URL, IP, hostname
  interval_seconds INTEGER NOT NULL DEFAULT 60,
  timeout_seconds INTEGER NOT NULL DEFAULT 10,
  retries INTEGER NOT NULL DEFAULT 3,
  method TEXT DEFAULT 'GET',
  headers TEXT DEFAULT '{}', -- JSON
  body TEXT,
  expected_status_codes TEXT DEFAULT '[200]', -- JSON array
  keyword TEXT, -- for keyword monitoring
  ignore_ssl BOOLEAN DEFAULT FALSE,
  follow_redirects BOOLEAN DEFAULT TRUE,
  max_redirects INTEGER DEFAULT 10,
  dns_record_type TEXT DEFAULT 'A', -- for DNS monitoring
  dns_expected_ip TEXT,
  port INTEGER, -- for TCP monitoring
  is_active BOOLEAN DEFAULT TRUE,
  tags TEXT DEFAULT '[]', -- JSON array
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monitors_active ON monitors(is_active);
CREATE INDEX IF NOT EXISTS idx_monitors_type ON monitors(type);
CREATE INDEX IF NOT EXISTS idx_monitors_created_by ON monitors(created_by);

-- Check Results (raw results)
CREATE TABLE IF NOT EXISTS check_results (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  timestamp INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('up', 'down', 'degraded', 'pending')),
  response_time_ms INTEGER,
  status_code INTEGER,
  response_body TEXT,
  error_message TEXT,
  ssl_info TEXT, -- JSON: expiry, issuer, valid
  dns_info TEXT, -- JSON: records, resolved_ips
  region TEXT DEFAULT 'primary',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_check_results_monitor_time ON check_results(monitor_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_check_results_status ON check_results(status);
CREATE INDEX IF NOT EXISTS idx_check_results_timestamp ON check_results(timestamp);

-- Aggregated stats (hourly rollups)
CREATE TABLE IF NOT EXISTS monitor_stats_hourly (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  hour_timestamp INTEGER NOT NULL, -- Unix timestamp rounded to hour
  total_checks INTEGER NOT NULL DEFAULT 0,
  successful_checks INTEGER NOT NULL DEFAULT 0,
  failed_checks INTEGER NOT NULL DEFAULT 0,
  avg_response_time_ms REAL,
  min_response_time_ms INTEGER,
  max_response_time_ms INTEGER,
  uptime_percentage REAL,
  created_at INTEGER NOT NULL,
  UNIQUE(monitor_id, hour_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_stats_monitor_hour ON monitor_stats_hourly(monitor_id, hour_timestamp DESC);

-- Daily stats
CREATE TABLE IF NOT EXISTS monitor_stats_daily (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  day_timestamp INTEGER NOT NULL, -- Unix timestamp rounded to day
  total_checks INTEGER NOT NULL DEFAULT 0,
  successful_checks INTEGER NOT NULL DEFAULT 0,
  failed_checks INTEGER NOT NULL DEFAULT 0,
  avg_response_time_ms REAL,
  min_response_time_ms INTEGER,
  max_response_time_ms INTEGER,
  uptime_percentage REAL,
  incidents_count INTEGER NOT NULL DEFAULT 0,
  total_downtime_seconds INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(monitor_id, day_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_monitor_day ON monitor_stats_daily(monitor_id, day_timestamp DESC);

-- Incidents
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  cause TEXT,
  acknowledged_by TEXT REFERENCES users(id),
  acknowledged_at INTEGER,
  resolved_by TEXT REFERENCES users(id),
  resolved_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incidents_monitor ON incidents(monitor_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);

-- Alert Rules
CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monitor_id TEXT REFERENCES monitors(id) ON DELETE CASCADE, -- NULL = all monitors
  condition TEXT NOT NULL CHECK (condition IN ('down', 'degraded', 'ssl_expiring', 'response_time', 'status_code')),
  threshold TEXT, -- JSON: { value: 5000, unit: 'ms' } or { days: 30 }
  channels TEXT NOT NULL DEFAULT '[]', -- JSON array: ['telegram', 'email', 'webhook']
  is_active BOOLEAN DEFAULT TRUE,
  cooldown_seconds INTEGER DEFAULT 300,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_monitor ON alert_rules(monitor_id);

-- Alert History
CREATE TABLE IF NOT EXISTS alert_history (
  id TEXT PRIMARY KEY,
  alert_rule_id TEXT REFERENCES alert_rules(id) ON DELETE SET NULL,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'email', 'webhook')),
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'pending')),
  message TEXT,
  error TEXT,
  sent_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_history_monitor ON alert_history(monitor_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_history_channel ON alert_history(channel);

-- Maintenance Windows
CREATE TABLE IF NOT EXISTS maintenance_windows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monitor_id TEXT REFERENCES monitors(id) ON DELETE CASCADE, -- NULL = all monitors
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  recurrence TEXT, -- cron expression for recurring
  timezone TEXT DEFAULT 'UTC',
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_maintenance_monitor ON maintenance_windows(monitor_id);

-- Status Pages (public)
CREATE TABLE IF NOT EXISTS status_pages (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  monitor_ids TEXT NOT NULL DEFAULT '[]', -- JSON array
  is_public BOOLEAN DEFAULT TRUE,
  custom_domain TEXT,
  theme TEXT DEFAULT 'light',
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_status_pages_slug ON status_pages(slug);

-- Settings (key-value)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at INTEGER NOT NULL
);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  old_value TEXT,
  new_value TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);