// ========================================
// Uptime Monitor - Dashboard App
// ========================================

const API_BASE = '';
const WS_PATH = '/socket.io';

// ─── State ───
let socket = null;
let token = localStorage.getItem('uptime_token') || null;
let currentUser = null;
let monitors = [];
let currentMonitor = null;
let currentView = 'dashboard';
let currentFilter = 'all';
let uptimeChart = null;
let responseChart = null;
let detailUptimeChart = null;
let detailResponseChart = null;
let timeRange = '24h';

// ─── DOM Elements ───
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const authScreen = $('#auth-screen');
const mainScreen = $('#main-screen');
const loginForm = $('#login-form');
const registerForm = $('#register-form');
const authError = $('#auth-error');
const tabLogin = $('#tab-login');
const tabRegister = $('#tab-register');
const panelLogin = $('#panel-login');
const panelRegister = $('#panel-register');

const sidebar = $('#sidebar');
const sidebarToggle = $('#sidebar-toggle');
const sidebarOverlay = $('#sidebar-overlay');
const monitorList = $('#monitor-list');
const monitorCount = $('#monitor-count');
const filterBtns = $$('.filter-btn');
const mainContent = $('#main-content');
const userNameEl = $('#user-name');
const userAvatarEl = $('#user-avatar');
const userMenuTrigger = $('#user-menu-trigger');
const userDropdown = $('#user-dropdown');
const dropdownUserName = $('#dropdown-user-name');
const dropdownUserRole = $('#dropdown-user-role');
const logoutBtn = $('#logout-btn');
const addMonitorBtn = $('#add-monitor-btn');
const globalSearch = $('#global-search');

const dashboardView = $('#dashboard-view');
const monitorDetailView = $('#monitor-detail-view');
const statUp = $('#stat-up');
const statDown = $('#stat-down');
const statDegraded = $('#stat-degraded');
const statUptime = $('#stat-uptime');
const recentIncidentsList = $('#recent-incidents-list');
const timeRangeSelect = $('#time-range');

const monitorDetailTitle = $('#monitor-detail-title');
const monitorDetailTarget = $('#monitor-detail-target');
const monitorDetailStatus = $('#monitor-detail-status');
const monitorDetailStatusText = $('#monitor-detail-status-text');
const detailStatusLarge = $('#detail-status-large');
const detailStatusText = $('#detail-status-text');
const detailResponseTime = $('#detail-response-time');
const detailStatusCode = $('#detail-status-code');
const detailLastCheck = $('#detail-last-check');
const checksTbody = $('#checks-tbody');
const monitorInfoList = $('#monitor-info-list');
const monitorIncidentsList = $('#monitor-incidents-list');
const monitorAlertRules = $('#monitor-alert-rules');

const monitorModal = $('#monitor-modal');
const monitorForm = $('#monitor-form');
const monitorFormTitle = $('#modal-title');
const monitorIdInput = $('#monitor-id');
const formType = $('#form-type');
const httpFields = $('#http-fields');
const keywordFields = $('#keyword-fields');
const dnsFields = $('#dns-fields');
const tcpFields = $('#tcp-fields');
const sslFields = $('#ssl-fields');

const settingsModal = $('#settings-modal');
const settingsTabs = $$('.settings-tab');
const settingsPanels = $$('.settings-panel');
const generalSettingsForm = $('#general-settings-form');

const toastContainer = $('#toast-container');

// ─── Init ───
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupAuthTabs();
  setupForms();
  setupSidebar();
  setupUserMenu();
  setupMonitorModal();
  setupSettingsModal();
  setupSearch();
  setupCharts();
  setupKeyboardShortcuts();
  
  if (token) {
    try {
      await apiGet('/api/auth/me');
      showMainScreen();
    } catch (e) {
      logout();
    }
  }
}

// ─── Auth ───
function setupAuthTabs() {
  tabLogin.addEventListener('click', () => switchAuthTab('login'));
  tabRegister.addEventListener('click', () => switchAuthTab('register'));
}

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  tabLogin.classList.toggle('active', isLogin);
  tabRegister.classList.toggle('active', !isLogin);
  panelLogin.classList.toggle('active', isLogin);
  panelRegister.classList.toggle('active', !isLogin);
  tabLogin.setAttribute('aria-selected', isLogin);
  tabRegister.setAttribute('aria-selected', !isLogin);
  authError.textContent = '';
}

function setupForms() {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(loginForm);
    await login(data.get('username'), data.get('password'));
  });
  
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(registerForm);
    if (data.get('password') !== data.get('password2')) return showAuthError('Passwords do not match');
    await register(data.get('username'), data.get('email'), data.get('password'));
  });
}

async function login(username, password) {
  setAuthLoading(true);
  try {
    const res = await apiPost('/api/auth/login', { username, password });
    token = res.token;
    currentUser = res.user;
    localStorage.setItem('uptime_token', token);
    showMainScreen();
  } catch (e) {
    showAuthError(e.message || 'Login failed');
  } finally {
    setAuthLoading(false);
  }
}

async function register(username, email, password) {
  setAuthLoading(true);
  try {
    const res = await apiPost('/api/auth/register', { username, email, password });
    token = res.token;
    currentUser = res.user;
    localStorage.setItem('uptime_token', token);
    showMainScreen();
  } catch (e) {
    showAuthError(e.message || 'Registration failed');
  } finally {
    setAuthLoading(false);
  }
}

function setAuthLoading(loading) {
  $$('button[type="submit"]', authScreen).forEach(b => b.disabled = loading);
}

function showAuthError(msg) {
  authError.textContent = msg;
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('uptime_token');
  if (socket) socket.disconnect();
  showAuthScreen();
}

async function showMainScreen() {
  authScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  initSocket();
  await loadMonitors();
  await loadDashboardStats();
  await loadRecentIncidents();
  updateUserUI();
  connectSocketEvents();
}

// ─── API ───
async function apiRequest(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const apiGet = (endpoint) => apiRequest(endpoint, { method: 'GET' });
const apiPost = (endpoint, body) => apiRequest(endpoint, { method: 'POST', body: JSON.stringify(body) });
const apiPatch = (endpoint, body) => apiRequest(endpoint, { method: 'PATCH', body: JSON.stringify(body) });
const apiDelete = (endpoint) => apiRequest(endpoint, { method: 'DELETE' });

// ─── Socket.io ───
function initSocket() {
  socket = io(WS_PATH, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  });
  
  socket.on('connect', () => {
    console.log('🔌 Socket connected');
    if (currentView === 'dashboard') {
      socket.emit('subscribe:all');
    } else if (currentView === 'monitor' && currentMonitor) {
      socket.emit('subscribe:monitor', currentMonitor.id);
    }
    socket.emit('subscribe:incidents');
  });
  
  socket.on('disconnect', (reason) => {
    console.log('🔌 Socket disconnected:', reason);
  });
  
  socket.on('connect_error', (err) => {
    console.error('Socket error:', err.message);
    if (err.message === 'Invalid token') logout();
  });
}

function connectSocketEvents() {
  socket.on('monitor:update', ({ monitorId, result }) => {
    handleMonitorUpdate(monitorId, result);
  });
  
  socket.on('incident:update', ({ action, incident, monitor }) => {
    handleIncidentUpdate(action, incident, monitor);
  });
}

function handleMonitorUpdate(monitorId, result) {
  // Update monitor in list
  const monitor = monitors.find(m => m.id === monitorId);
  if (monitor) {
    monitor.last_check = result;
    renderMonitorList();
  }
  
  // Update detail view if open
  if (currentMonitor && currentMonitor.id === monitorId) {
    updateMonitorDetail(monitorId, result);
  }
  
  // Update dashboard stats
  updateDashboardStatsFromMonitors();
}

function handleIncidentUpdate(action, incident, monitor) {
  if (currentView === 'dashboard') {
    loadRecentIncidents();
  }
  if (currentMonitor && currentMonitor.id === monitor.id) {
    loadMonitorIncidents(monitor.id);
  }
  showToast(`Incident ${action}: ${monitor.name}`, action === 'created' ? 'warning' : 'success');
}

// ─── Monitors ───
async function loadMonitors() {
  try {
    const res = await apiGet('/api/monitors');
    monitors = res.monitors;
    renderMonitorList();
  } catch (e) {
    console.error('Failed to load monitors:', e);
    showToast('Failed to load monitors', 'error');
  }
}

function renderMonitorList() {
  let filtered = monitors;
  
  if (currentFilter !== 'all') {
    filtered = monitors.filter(m => m.last_check?.status === currentFilter);
  }
  
  // Sort: down first, then degraded, then up, then by name
  filtered.sort((a, b) => {
    const statusOrder = { down: 0, degraded: 1, up: 2, unknown: 3 };
    const aStatus = a.last_check?.status || 'unknown';
    const bStatus = b.last_check?.status || 'unknown';
    if (statusOrder[aStatus] !== statusOrder[bStatus]) {
      return statusOrder[aStatus] - statusOrder[bStatus];
    }
    return a.name.localeCompare(b.name);
  });
  
  monitorCount.textContent = `${filtered.length} / ${monitors.length}`;
  
  monitorList.innerHTML = filtered.map(monitor => {
    const status = monitor.last_check?.status || 'unknown';
    const lastCheck = monitor.last_check ? formatRelativeTime(monitor.last_check.timestamp) : 'Never';
    const statusIcon = getStatusIcon(status);
    
    return `
      <li class="monitor-item" data-monitor-id="${monitor.id}">
        <a href="#" class="monitor-link ${currentMonitor?.id === monitor.id ? 'active' : ''}" data-monitor-id="${monitor.id}">
          <span class="monitor-status ${status}"></span>
          <div class="monitor-info">
            <span class="monitor-name">${escapeHtml(monitor.name)}</span>
            <span class="monitor-type">${monitor.type.toUpperCase()}</span>
          </div>
          <span class="monitor-last-check">${lastCheck}</span>
          ${statusIcon}
        </a>
      </li>
    `;
  }).join('');
  
  // Add click handlers
  $$('.monitor-link', monitorList).forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      selectMonitor(link.dataset.monitorId);
    });
  });
}

function getStatusIcon(status) {
  const icons = {
    up: '<svg class="status-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4fd1c5" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    down: '<svg class="status-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f7768e" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    degraded: '<svg class="status-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e0af68" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    unknown: '<svg class="status-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#565f89" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
  };
  return icons[status] || icons.unknown;
}

function selectMonitor(monitorId) {
  const monitor = monitors.find(m => m.id === monitorId);
  if (!monitor) return;
  
  currentMonitor = monitor;
  currentView = 'monitor';
  
  // Update UI
  $$('.monitor-link').forEach(l => l.classList.toggle('active', l.dataset.monitorId === monitorId));
  dashboardView.classList.add('hidden');
  monitorDetailView.classList.remove('hidden');
  
  // Update detail view
  loadMonitorDetail(monitor);
  
  // Socket subscription
  socket.emit('unsubscribe:all');
  socket.emit('subscribe:monitor', monitorId);
  
  // Update URL hash
  window.location.hash = `monitor/${monitorId}`;
  
  closeSidebarOnMobile();
}

function loadMonitorDetail(monitor) {
  monitorDetailTitle.textContent = monitor.name;
  monitorDetailTarget.textContent = `${monitor.type.toUpperCase()} • ${monitor.target}`;
  
  const status = monitor.last_check?.status || 'unknown';
  monitorDetailStatus.className = `monitor-status-badge ${status}`;
  monitorDetailStatusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  
  updateMonitorDetail(monitor.id, monitor.last_check);
  loadMonitorIncidents(monitor.id);
  loadMonitorAlertRules(monitor.id);
  renderMonitorInfo(monitor);
  
  // Load charts
  loadDetailCharts(monitor.id);
}

function updateMonitorDetail(monitorId, result) {
  if (!result) return;
  
  const status = result.status || 'unknown';
  
  detailStatusLarge.className = `status-large ${status}`;
  detailStatusLarge.querySelector('.status-dot').className = `status-dot large ${status}`;
  detailStatusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  detailStatusText.style.color = getStatusColor(status);
  
  detailResponseTime.textContent = result.response_time_ms ? `${result.response_time_ms}ms` : '-';
  detailStatusCode.textContent = result.status_code || '-';
  detailLastCheck.textContent = formatRelativeTime(result.timestamp);
  
  // Update status badge
  monitorDetailStatus.className = `monitor-status-badge ${status}`;
  monitorDetailStatusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  
  // Add to checks table
  addCheckToTable(result);
}

function addCheckToTable(result) {
  const row = document.createElement('tr');
  row.innerHTML = `
    <td>${formatTime(result.timestamp)}</td>
    <td><span class="status-badge ${result.status}"><span class="status-dot"></span>${result.status}</span></td>
    <td>${result.response_time_ms ? result.response_time_ms + 'ms' : '-'}</td>
    <td>${result.status_code || '-'}</td>
    <td class="error-cell">${escapeHtml(result.error_message || '-')}</td>
  `;
  
  // Add to top
  if (checksTbody.firstChild) {
    checksTbody.insertBefore(row, checksTbody.firstChild);
  } else {
    checksTbody.appendChild(row);
  }
  
  // Keep only last 50
  while (checksTbody.children.length > 50) {
    checksTbody.removeChild(checksTbody.lastChild);
  }
}

function renderMonitorInfo(monitor) {
  const intervalMs = monitor.interval_seconds * 1000;
  const nextCheck = monitor.last_check ? monitor.last_check.timestamp + intervalMs : Date.now();
  
  monitorInfoList.innerHTML = `
    <dt>ID</dt><dd>${monitor.id}</dd>
    <dt>Type</dt><dd>${monitor.type.toUpperCase()}</dd>
    <dt>Target</dt><dd>${escapeHtml(monitor.target)}</dd>
    <dt>Interval</dt><dd>${monitor.interval_seconds}s</dd>
    <dt>Timeout</dt><dd>${monitor.timeout_seconds}s</dd>
    <dt>Retries</dt><dd>${monitor.retries}</dd>
    <dt>Method</dt><dd>${monitor.method || 'GET'}</dd>
    <dt>Expected Codes</dt><dd>${JSON.parse(monitor.expected_status_codes || '[200]').join(', ')}</dd>
    <dt>Ignore SSL</dt><dd>${monitor.ignore_ssl ? 'Yes' : 'No'}</dd>
    <dt>Follow Redirects</dt><dd>${monitor.follow_redirects ? 'Yes' : 'No'}</dd>
    <dt>Created</dt><dd>${formatDateTime(monitor.created_at)}</dd>
    <dt>Next Check</dt><dd>${formatRelativeTime(nextCheck)}</dd>
    <dt>Tags</dt><dd>${JSON.parse(monitor.tags || '[]').join(', ') || 'None'}</dd>
  `;
}

async function loadMonitorIncidents(monitorId) {
  try {
    const res = await apiGet(`/api/incidents?monitor_id=${monitorId}&limit=20`);
    const incidents = res.incidents;
    
    if (incidents.length === 0) {
      monitorIncidentsList.innerHTML = '<p class="empty-state">No incidents</p>';
      return;
    }
    
    monitorIncidentsList.innerHTML = incidents.map(inc => `
      <div class="incident-small">
        <div class="incident-small-header">
          <span class="incident-small-status ${inc.status}">${inc.status}</span>
          <span class="incident-small-time">${formatDateTime(inc.started_at)}</span>
        </div>
        <div class="incident-small-duration">${formatDuration(inc.duration_seconds ? inc.duration_seconds * 1000 : Date.now() - inc.started_at)}</div>
      </div>
    `).join('');
  } catch (e) {
    console.error('Failed to load incidents:', e);
  }
}

async function loadMonitorAlertRules(monitorId) {
  try {
    const res = await apiGet(`/api/alert-rules?monitor_id=${monitorId}`);
    const rules = res.rules;
    
    if (rules.length === 0) {
      monitorAlertRules.innerHTML = '<p class="empty-state">No alert rules</p>';
      return;
    }
    
    monitorAlertRules.innerHTML = rules.map(rule => `
      <div class="alert-rule-item">
        <div class="alert-rule-header">
          <span class="alert-rule-name">${escapeHtml(rule.name)}</span>
          <span class="alert-rule-condition">${rule.condition.replace('_', ' ')}</span>
        </div>
        <div class="alert-rule-channels">
          ${(JSON.parse(rule.channels || '[]')).map(c => `<span class="alert-rule-channel">${c}</span>`).join('')}
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.error('Failed to load alert rules:', e);
  }
}

// ─── Dashboard ───
async function loadDashboardStats() {
  try {
    const res = await apiGet('/api/dashboard/stats');
    const stats = res;
    
    statUp.textContent = stats.up;
    statDown.textContent = stats.down;
    statDegraded.textContent = stats.degraded;
    statUptime.textContent = stats.uptime_percentage + '%';
    
    // Load charts
    loadDashboardCharts();
  } catch (e) {
    console.error('Failed to load dashboard stats:', e);
  }
}

function updateDashboardStatsFromMonitors() {
  const up = monitors.filter(m => m.last_check?.status === 'up').length;
  const down = monitors.filter(m => m.last_check?.status === 'down').length;
  const degraded = monitors.filter(m => m.last_check?.status === 'degraded').length;
  const total = monitors.length;
  const uptime = total > 0 ? ((up + degraded) / total * 100).toFixed(2) : 100;
  
  statUp.textContent = up;
  statDown.textContent = down;
  statDegraded.textContent = degraded;
  statUptime.textContent = uptime + '%';
}

async function loadRecentIncidents() {
  try {
    const res = await apiGet('/api/incidents?limit=5');
    const incidents = res.incidents;
    
    if (incidents.length === 0) {
      recentIncidentsList.innerHTML = '<p class="empty-state">No recent incidents</p>';
      return;
    }
    
    recentIncidentsList.innerHTML = incidents.map(inc => `
      <div class="incident-item">
        <div class="incident-icon ${inc.status}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${inc.status === 'created' ? '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' : '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'}
          </svg>
        </div>
        <div class="incident-info">
          <div class="incident-monitor">${escapeHtml(inc.monitor_id)}</div>
          <div class="incident-meta">
            <span>${formatRelativeTime(inc.started_at)}</span>
            <span>${formatDuration(inc.duration_seconds ? inc.duration_seconds * 1000 : Date.now() - inc.started_at)}</span>
          </div>
        </div>
        <span class="incident-status ${inc.status}">${inc.status}</span>
      </div>
    `).join('');
  } catch (e) {
    console.error('Failed to load incidents:', e);
  }
}

// ─── Charts ───
function setupCharts() {
  // Chart.js defaults
  Chart.defaults.font.family = 'Inter, sans-serif';
  Chart.defaults.color = '#737aa2';
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.elements.line.tension = 0.3;
  Chart.defaults.elements.point.radius = 0;
  Chart.defaults.elements.point.hoverRadius = 4;
  Chart.defaults.scales.x.grid.color = 'rgba(41, 46, 66, 0.5)';
  Chart.defaults.scales.y.grid.color = 'rgba(41, 46, 66, 0.5)';
  Chart.defaults.scales.x.ticks.color = '#565f89';
  Chart.defaults.scales.y.ticks.color = '#565f89';
}

function createChart(ctx, type, data, options = {}) {
  return new Chart(ctx, {
    type,
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        tooltip: {
          backgroundColor: '#1f2335',
          titleColor: '#c0caf5',
          bodyColor: '#c0caf5',
          borderColor: '#292e42',
          borderWidth: 1,
          padding: 12,
          displayColors: false
        }
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: type === 'line' ? false : true }
      },
      ...options
    }
  });
}

async function loadDashboardCharts() {
  const hours = parseTimeRange(timeRange);
  const endTime = Date.now();
  const startTime = endTime - hours * 60 * 60 * 1000;
  
  // Aggregate data from all monitors
  const allData = [];
  
  for (const monitor of monitors) {
    try {
      const res = await apiGet(`/api/monitors/${monitor.id}/stats?hours=${hours}`);
      if (res.hourly?.length) {
        allData.push(...res.hourly.map(h => ({ ...h, monitor_id: monitor.id })));
      }
    } catch (e) {}
  }
  
  // Aggregate by hour
  const hourlyData = aggregateHourly(allData, hours);
  
  // Uptime Chart
  if (uptimeChart) uptimeChart.destroy();
  const uptimeCtx = $('#uptime-chart').getContext('2d');
  uptimeChart = createChart(uptimeCtx, 'line', {
    labels: hourlyData.map(d => formatChartTime(d.hour)),
    datasets: [{
      label: 'Uptime %',
      data: hourlyData.map(d => d.uptime),
      borderColor: '#4fd1c5',
      backgroundColor: 'rgba(79, 209, 197, 0.1)',
      fill: true,
      tension: 0.3
    }]
  });
  
  // Response Time Chart
  if (responseChart) responseChart.destroy();
  const responseCtx = $('#response-chart').getContext('2d');
  responseChart = createChart(responseCtx, 'line', {
    labels: hourlyData.map(d => formatChartTime(d.hour)),
    datasets: [{
      label: 'Avg Response (ms)',
      data: hourlyData.map(d => d.avg_response),
      borderColor: '#7aa2f7',
      backgroundColor: 'rgba(122, 162, 247, 0.1)',
      fill: true,
      tension: 0.3
    }]
  });
}

async function loadDetailCharts(monitorId) {
  const hours = parseTimeRange(timeRange);
  
  try {
    const res = await apiGet(`/api/monitors/${monitorId}/stats?hours=${hours}`);
    const hourly = res.hourly || [];
    const daily = res.daily || [];
    
    const labels = hourly.map(h => formatChartTime(h.hour));
    const uptimeData = hourly.map(h => h.uptime_percentage);
    const responseData = hourly.map(h => h.avg_response_time_ms);
    
    // Detail Uptime
    if (detailUptimeChart) detailUptimeChart.destroy();
    const uptimeCtx = $('#detail-uptime-chart').getContext('2d');
    detailUptimeChart = createChart(uptimeCtx, 'line', {
      labels,
      datasets: [{
        label: 'Uptime %',
        data: uptimeData,
        borderColor: '#4fd1c5',
        backgroundColor: 'rgba(79, 209, 197, 0.1)',
        fill: true
      }]
    });
    
    // Detail Response
    if (detailResponseChart) detailResponseChart.destroy();
    const responseCtx = $('#detail-response-chart').getContext('2d');
    detailResponseChart = createChart(responseCtx, 'line', {
      labels,
      datasets: [{
        label: 'Avg Response (ms)',
        data: responseData,
        borderColor: '#7aa2f7',
        backgroundColor: 'rgba(122, 162, 247, 0.1)',
        fill: true
      }]
    });
  } catch (e) {
    console.error('Failed to load detail charts:', e);
  }
}

function aggregateHourly(data, hours) {
  const hoursMs = hours * 60 * 60 * 1000;
  const endTime = Date.now();
  const startTime = endTime - hoursMs;
  
  const buckets = new Map();
  
  for (let t = startTime; t < endTime; t += 60 * 60 * 1000) {
    const hourKey = Math.floor(t / (60 * 60 * 1000)) * (60 * 60 * 1000);
    buckets.set(hourKey, { total: 0, successful: 0, failed: 0, responseTimes: [] });
  }
  
  for (const item of data) {
    const hourKey = Math.floor(item.hour_timestamp / (60 * 60 * 1000)) * (60 * 60 * 1000);
    const bucket = buckets.get(hourKey);
    if (!bucket) continue;
    
    bucket.total++;
    if (item.status === 'up' || item.status === 'degraded') {
      bucket.successful++;
    } else {
      bucket.failed++;
    }
    if (item.response_time_ms) bucket.responseTimes.push(item.response_time_ms);
  }
  
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([hour, data]) => ({
      hour,
      uptime: data.total > 0 ? (data.successful / data.total * 100).toFixed(2) : 100,
      avg_response: data.responseTimes.length > 0 ? (data.responseTimes.reduce((a, b) => a + b, 0) / data.responseTimes.length).toFixed(0) : 0
    }));
}

function parseTimeRange(range) {
  const map = { '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720 };
  return map[range] || 24;
}

function formatChartTime(hourTimestamp) {
  return new Date(hourTimestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// ─── Time Range ───
timeRangeSelect.addEventListener('change', (e) => {
  timeRange = e.target.value;
  if (currentView === 'dashboard') {
    loadDashboardCharts();
  } else if (currentView === 'monitor' && currentMonitor) {
    loadDetailCharts(currentMonitor.id);
  }
});

// ─── Monitor Modal ───
function setupMonitorModal() {
  addMonitorBtn.addEventListener('click', () => openMonitorModal());
  
  $('#monitor-modal .modal-close').forEach(btn => btn.addEventListener('click', closeMonitorModal));
  monitorModal.addEventListener('click', (e) => { if (e.target === monitorModal) closeMonitorModal(); });
  
  monitorForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveMonitor();
  });
  
  formType.addEventListener('change', updateFormFields);
  
  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !monitorModal.classList.contains('hidden')) closeMonitorModal();
  });
}

function openMonitorModal(monitor = null) {
  monitorForm.reset();
  monitorFormTitle.textContent = monitor ? 'Edit Monitor' : 'Add Monitor';
  monitorIdInput.value = monitor?.id || '';
  
  if (monitor) {
    populateForm(monitor);
  } else {
    updateFormFields();
  }
  
  monitorModal.classList.remove('hidden');
  $('#form-name').focus();
}

function closeMonitorModal() {
  monitorModal.classList.add('hidden');
}

function updateFormFields() {
  const type = formType.value;
  
  // Hide all conditional fields
  httpFields.classList.add('hidden');
  keywordFields.classList.add('hidden');
  dnsFields.classList.add('hidden');
  tcpFields.classList.add('hidden');
  sslFields.classList.add('hidden');
  
  // Show relevant fields
  if (['http', 'https', 'keyword'].includes(type)) httpFields.classList.remove('hidden');
  if (type === 'keyword') keywordFields.classList.remove('hidden');
  if (type === 'dns') dnsFields.classList.remove('hidden');
  if (type === 'tcp') tcpFields.classList.remove('hidden');
  if (type === 'ssl') sslFields.classList.remove('hidden');
  
  // Update target hint
  const hints = {
    http: 'https://api.example.com/health',
    https: 'https://api.example.com/health',
    ping: 'example.com or 192.168.1.1',
    tcp: 'example.com:8080',
    dns: 'example.com',
    ssl: 'example.com:443',
    keyword: 'https://status.example.com'
  };
  $('#target-hint').textContent = hints[type] || '';
}

function populateForm(monitor) {
  $('#form-name').value = monitor.name;
  formType.value = monitor.type;
  $('#form-target').value = monitor.target;
  $('#form-interval').value = monitor.interval_seconds;
  $('#form-timeout').value = monitor.timeout_seconds;
  $('#form-retries').value = monitor.retries;
  $('#form-method').value = monitor.method || 'GET';
  $('#form-expected-codes').value = JSON.parse(monitor.expected_status_codes || '[200]').join(',');
  $('#form-headers').value = JSON.stringify(JSON.parse(monitor.headers || '{}'), null, 2);
  $('#form-body').value = monitor.body || '';
  $('#form-ignore-ssl').checked = monitor.ignore_ssl;
  $('#form-follow-redirects').checked = monitor.follow_redirects;
  $('#form-keyword').value = monitor.keyword || '';
  $('#form-dns-type').value = monitor.dns_record_type || 'A';
  $('#form-dns-expected').value = monitor.dns_expected_ip || '';
  $('#form-port').value = monitor.port || '';
  $('#form-active').checked = monitor.is_active;
  
  updateFormFields();
}

async function saveMonitor() {
  const formData = new FormData(monitorForm);
  const data = Object.fromEntries(formData);
  
  // Process arrays and objects
  data.interval_seconds = parseInt(data.interval_seconds);
  data.timeout_seconds = parseInt(data.timeout_seconds);
  data.retries = parseInt(data.retries);
  data.expected_status_codes = data.expected_status_codes.split(',').map(c => parseInt(c.trim())).filter(c => !isNaN(c));
  data.headers = data.headers ? JSON.parse(data.headers) : {};
  data.ignore_ssl = !!data.ignore_ssl;
  data.follow_redirects = !!data.follow_redirects;
  data.is_active = !!data.is_active;
  if (data.port) data.port = parseInt(data.port);
  if (data.dns_expected_ip) data.dns_expected_ip = data.dns_expected_ip.trim();
  
  const id = data.id;
  delete data.id;
  
  try {
    if (id) {
      await apiPatch(`/api/monitors/${id}`, data);
      showToast('Monitor updated', 'success');
    } else {
      await apiPost('/api/monitors', data);
      showToast('Monitor created', 'success');
    }
    closeMonitorModal();
    await loadMonitors();
  } catch (e) {
    showToast(e.message || 'Failed to save monitor', 'error');
  }
}

// ─── Settings Modal ───
function setupSettingsModal() {
  userMenuTrigger.addEventListener('click', toggleUserDropdown);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.user-menu')) userDropdown.classList.add('hidden');
  });
  
  logoutBtn.addEventListener('click', logout);
  
  settingsTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      settingsTabs.forEach(t => t.classList.toggle('active', t === tab));
      settingsPanels.forEach(p => p.classList.toggle('active', p.dataset.panel === target));
    });
  });
  
  $('#settings-modal .modal-close').forEach(btn => btn.addEventListener('click', () => settingsModal.classList.add('hidden')));
  settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) settingsModal.classList.add('hidden'); });
  
  generalSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(generalSettingsForm);
    for (const [key, value] of formData) {
      await apiPatch('/api/settings', { key, value });
    }
    showToast('Settings saved', 'success');
  });
  
  // Load settings
  loadSettings();
}

function toggleUserDropdown() {
  const dropdown = $('#user-dropdown');
  const isHidden = dropdown.classList.toggle('hidden');
  userMenuTrigger.setAttribute('aria-expanded', !isHidden);
  
  if (!isHidden) {
    dropdownUserName.textContent = currentUser.username;
    dropdownUserRole.textContent = currentUser.role;
    dropdownUserRole.className = `badge ${currentUser.role}`;
  }
}

async function loadSettings() {
  try {
    const res = await apiGet('/api/settings');
    const settings = res.settings;
    
    for (const setting of settings) {
      const input = $(`#setting-${setting.key.replace(/_/g, '-')}`);
      if (input) {
        if (input.type === 'checkbox') input.checked = value === 'true' || value === true;
        else input.value = setting.value;
      }
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

// ─── Search ───
function setupSearch() {
  let searchTimeout = null;
  globalSearch.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const query = e.target.value.toLowerCase();
      filterMonitors(query);
    }, 150);
  });
}

function filterMonitors(query) {
  $$('.monitor-link', monitorList).forEach(link => {
    const name = link.querySelector('.monitor-name').textContent.toLowerCase();
    const type = link.querySelector('.monitor-type').textContent.toLowerCase();
    link.style.display = name.includes(query) || type.includes(query) ? 'flex' : 'none';
  });
}

// ─── Keyboard Shortcuts ───
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+K - Search
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      globalSearch.focus();
    }
    // Ctrl+B - Toggle Sidebar
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      toggleSidebar();
    }
    // Escape - Close modals
    if (e.key === 'Escape') {
      closeMonitorModal();
      settingsModal.classList.add('hidden');
      userDropdown.classList.add('hidden');
    }
    // Alt+N - New Monitor
    if (e.altKey && e.key === 'n') {
      e.preventDefault();
      openMonitorModal();
    }
  });
}

// ─── Sidebar ───
function setupSidebar() {
  sidebarToggle.addEventListener('click', toggleSidebar);
  sidebarOverlay.addEventListener('click', toggleSidebar);
  
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      filterBtns.forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-pressed', b === btn);
      });
      renderMonitorList();
    });
  });
}

function toggleSidebar() {
  sidebar.classList.toggle('open');
  sidebarOverlay.classList.toggle('visible');
}

function closeSidebarOnMobile() {
  if (window.innerWidth < 1024) {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('visible');
  }
}

function toggleUserDropdown() {
  const isHidden = userDropdown.classList.toggle('hidden');
  userMenuTrigger.setAttribute('aria-expanded', !isHidden);
  
  if (!isHidden) {
    dropdownUserName.textContent = currentUser.username;
    dropdownUserRole.textContent = currentUser.role;
    dropdownUserRole.className = `badge ${currentUser.role}`;
  }
}

// ─── User UI ───
function updateUserUI() {
  if (!currentUser) return;
  userNameEl.textContent = currentUser.username;
  userAvatarEl.textContent = currentUser.username.charAt(0).toUpperCase();
  userAvatarEl.style.background = stringToColor(currentUser.username);
}

// ─── Toasts ───
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Close">&times;</button>
  `;
  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ─── Utils ───
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString('en-US', { 
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
  });
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

function getStatusColor(status) {
  const colors = { up: '#4fd1c5', down: '#f7768e', degraded: '#e0af68', unknown: '#565f89' };
  return colors[status] || colors.unknown;
}

function getStatusIcon(status) {
  return getStatusIcon(status);
}

function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 50%)`;
}