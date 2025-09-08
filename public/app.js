function formatBytes(bytes) {
  const thresh = 1024;
  if (Math.abs(bytes) < thresh) {
    return `${bytes} B`;
  }
  const units = ['KB','MB','GB','TB','PB','EB','ZB','YB'];
  let u = -1;
  do {
    bytes /= thresh;
    ++u;
  } while (Math.abs(bytes) >= thresh && u < units.length - 1);
  return `${bytes.toFixed(2)} ${units[u]}`;
}

function formatBps(bps) {
  return `${formatBytes(bps)}/s`;
}

function formatUptime(seconds) {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function getTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch (_) {
    return false;
  }
}

function showToast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.position = 'fixed';
    el.style.left = '50%';
    el.style.bottom = '24px';
    el.style.transform = 'translateX(-50%)';
    el.style.background = 'rgba(0,0,0,0.85)';
    el.style.color = '#fff';
    el.style.padding = '8px 12px';
    el.style.borderRadius = '6px';
    el.style.fontSize = '14px';
    el.style.opacity = '0';
    el.style.transition = 'opacity 200ms ease-in-out';
    el.style.zIndex = '9999';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.opacity = '1';
  if (window._toastTimer) clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    el.style.opacity = '0';
  }, 1200);
}

async function fetchNodes() {
  // Build query parameters based on enabled filters
  const params = new URLSearchParams();
  
  console.log('fetchNodes called with hostFilters:', hostFilters);
  
  // If "all" is checked, show all hosts regardless of other settings
  if (hostFilters.all) {
    console.log('Showing all hosts (all filter is true)');
    // No additional parameters needed - show all
  } else {
    // Build specific filter parameters based on what's selected
    const enabledFilters = Object.entries(hostFilters).filter(([key, value]) => value && key !== 'all');
    console.log('Enabled filters (excluding all):', enabledFilters);
    
    if (enabledFilters.length === 0) {
      // No filters selected - show nothing (empty result)
      console.log('No filters selected, returning empty result');
      return { nodes: [] };
    } else if (enabledFilters.length === 1) {
      // Single filter selected
      const filterType = enabledFilters[0][0];
      console.log('Single filter selected:', filterType);
      if (filterType === 'local') {
        params.set('includeAllHosts', 'false');
      } else if (filterType === 'remote') {
        params.set('includeRemoteOnly', 'true');
      } else if (filterType === 'localhost') {
        params.set('localhostOnly', 'true');
      }
    } else {
      // Multiple filters selected - for now, show all
      // TODO: Implement server-side multi-filtering
      console.log('Multiple filters selected, showing all hosts');
    }
  }
  
  const url = params.toString() ? `/api/nodes?${params.toString()}` : '/api/nodes';
  console.log('Fetching URL:', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch nodes: ${res.status}`);
  return res.json();
}

function render(nodes) {
  const tbody = document.getElementById('nodesBody');
  tbody.innerHTML = '';
  nodes.forEach((n) => {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.textContent = n.name;
    tr.appendChild(nameTd);

    const statusTd = document.createElement('td');
    statusTd.innerHTML = n.ok
      ? `<span class=\"status-ok\">OK</span><div class=\"muted\">Uptime: ${formatUptime(n.stats?.uptimeSeconds)}</div>`
      : `<span class=\"status-bad\">Down</span><div class=\"muted mono\">${n.error || ''}</div>`;
    tr.appendChild(statusTd);

    // Removed Transfer Stats column

    const errorsTd = document.createElement('td');
    if (n.ok && n.errors && n.errors.length) {
      const ul = document.createElement('ul');
      ul.className = 'error-list';
      n.errors.forEach((e) => {
        const li = document.createElement('li');
        const whenSpan = document.createElement('span');
        whenSpan.className = 'mono';
        whenSpan.textContent = e.when ? new Date(e.when).toLocaleString() + ' ' : '';
        const link = document.createElement('a');
        link.href = `/errors.html?node=${encodeURIComponent(n.name)}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = e.message;
        li.appendChild(whenSpan);
        li.appendChild(link);
        ul.appendChild(li);
      });
      errorsTd.appendChild(ul);
    } else {
      errorsTd.textContent = 'None';
    }
    tr.appendChild(errorsTd);

    const sharesTd = document.createElement('td');
    if (n.ok && n.shares) {
      sharesTd.textContent = String(n.shares.count ?? 0);
    } else {
      sharesTd.textContent = '—';
    }
    tr.appendChild(sharesTd);

    const foldersTd = document.createElement('td');
    if (n.ok && Array.isArray(n.folders) && n.folders.length) {
      const ul = document.createElement('ul');
      ul.className = 'list-reset folder-list';
      n.folders.forEach((f) => {
        const li = document.createElement('li');
        const pct = Math.max(0, Math.min(100, Number(f.completionPct ?? 0))).toFixed(0);
        const last = f.lastSyncedFile ? `Last: ${f.lastSyncedFile}` : '';
        
        // Determine progress bar color based on folder state
        let progressClass = '';
        if (f.state === 'waiting') progressClass = ' waiting';
        else if (f.state === 'scanning') progressClass = ' scanning';
        else if (f.state === 'syncing') progressClass = ' syncing';
        else if (f.state && /error/i.test(f.state)) progressClass = ' error';
        else if (f.state === 'idle' || f.state === 'up to date') progressClass = ''; // default green
        
        // Add folder stats information after completion percentage
        let folderStatsDisplay = '';
        if (dataFilters.folderStats && f.folderStats && f.folderStats.filename && f.folderStats.at) {
          const statsTime = new Date(f.folderStats.at);
          const statsDateFormatted = statsTime.toLocaleDateString('en-GB', { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric' 
          }); // Format: DD/MM/YYYY
          const statsFilename = f.folderStats.filename.split('/').pop() || f.folderStats.filename;
          folderStatsDisplay = ` <span class="mono" style="color: #17a2b8;" title="Folder Stats: ${f.folderStats.filename} at ${statsTime.toLocaleString()}">${statsFilename} (${statsDateFormatted})</span>`;
        }
        
        const progress = `<span class=\"progress\" title=\"${last}\"><span class=\"fill${progressClass}\" style=\"width:${pct}%\"></span></span><span class=\"mono\" title=\"${last}\">${pct}%</span>${folderStatsDisplay}`;
        
        const peersList = document.createElement('ul');
        peersList.className = 'list-reset peer-list';
        (f.peers || []).forEach((p) => {
          const pli = document.createElement('li');
          const synced = p.items && Number.isFinite(p.items.syncedItems) ? p.items.syncedItems : null;
          const total = p.items && Number.isFinite(p.items.globalItems) ? p.items.globalItems : null;
          const needItems = p.items && Number.isFinite(p.items.needItems) ? p.items.needItems : null;
          const pctPeer = p.items && Number.isFinite(p.items.completionPct) ? Math.round(p.items.completionPct) : null;
          // Determine status color per rules
          let colorClass = 'gray';
          if (!p.online) colorClass = 'red';
          else if (f.state && /error/i.test(f.state)) colorClass = 'red';
          else if (f.state === 'waiting') colorClass = 'darkyellow';
          else if (f.state === 'scanning') colorClass = 'blue';
          else if (f.state === 'syncing') colorClass = 'violetgreen';
          else if (f.state === 'idle' || f.state === 'up to date') {
            // Only show green if not waiting and peer is 100% synced
            if (f.state !== 'waiting' && pctPeer === 100) colorClass = 'green';
            else colorClass = 'gray';
          }
          const label = (synced != null && total != null) ? `${synced}/${total}${pctPeer != null ? ` (${pctPeer}%)` : ''}` : '';
          
          pli.innerHTML = `<span class=\"dot ${colorClass}\"></span><span class=\"mono folder-peer\" data-id=\"${p.id}\" title=\"${p.id}\">${p.name}${label ? ` ${label}` : ''}</span>`;
          const peerEl = pli.querySelector('.folder-peer');
          if (peerEl) {
            peerEl.addEventListener('contextmenu', async (e) => {
              e.preventDefault();
              const deviceId = peerEl.getAttribute('data-id') || '';
              const ok = await copyTextToClipboard(deviceId);
              if (ok) showToast('Device ID copied');
            });
          }
          peersList.appendChild(pli);
        });
        // Add folder description after folder name
        let folderDescriptionDisplay = '';
        if (dataFilters.folderDescription && f.description) {
          folderDescriptionDisplay = ` <span class="mono" style="color: #6c757d; font-style: italic;" title="Folder Description">${f.description}</span>`;
        }
        
        li.innerHTML = `<span class=\"mono\">${f.label}</span>${folderDescriptionDisplay} ${progress}`;
        li.appendChild(peersList);
        ul.appendChild(li);
      });
      foldersTd.appendChild(ul);
    } else {
      foldersTd.textContent = '—';
    }
    tr.appendChild(foldersTd);

    const latestChangeTd = document.createElement('td');
    if (n.ok && Array.isArray(n.folders) && n.folders.length) {
      const ul = document.createElement('ul');
      ul.className = 'list-reset folder-list';
      n.folders.forEach((f) => {
        const li = document.createElement('li');
        if (f.latestChange) {
          const time = new Date(f.latestChange.time);
          const timeStr = time.toLocaleString();
          const timeAgo = getTimeAgo(time);
          const description = f.latestChange.description;
          const type = f.latestChange.type;
          
          // Extract filename if it's a file-related event
          let filename = '';
          if (description.includes(' ')) {
            const parts = description.split(' ');
            if (parts.length > 1) {
              filename = parts[parts.length - 1]; // Last part is usually the filename
            }
          }
          
          const displayText = filename ? `${filename} (${timeAgo})` : `${description} (${timeAgo})`;
          li.innerHTML = `<span class="mono" title="${type} at ${timeStr}">${displayText}</span>`;
        } else {
          // Show folder state and file count as latest change when no events are available
          const state = f.state || 'unknown';
          const stateDisplay = state === 'idle' ? 'up to date' : state;
          const needItems = f.needItems || 0;
          const completionPct = f.completionPct || 0;
          
          let displayText = stateDisplay;
          if (needItems > 0) {
            displayText += ` (${needItems} pending)`;
          } else if (completionPct === 100) {
            displayText += ' (complete)';
          }
          
          li.innerHTML = `<span class="muted" title="No recent events available - showing current status">${displayText}</span>`;
        }
        ul.appendChild(li);
      });
      latestChangeTd.appendChild(ul);
    } else {
      latestChangeTd.textContent = '—';
    }
    tr.appendChild(latestChangeTd);

    const perDeviceTd = document.createElement('td');
    if (n.ok && n.perDeviceFolders && Object.keys(n.perDeviceFolders).length) {
      const ul = document.createElement('ul');
      ul.className = 'error-list';
      Object.entries(n.perDeviceFolders).forEach(([dev, folders]) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class=\"mono\">${dev}</span>: ${folders.map(f => `<span class=\\\"mono\\\">${f}</span>`).join(', ')}`;
        ul.appendChild(li);
      });
      perDeviceTd.appendChild(ul);
    } else {
      perDeviceTd.textContent = '—';
    }
    tr.appendChild(perDeviceTd);

    const devicesTd = document.createElement('td');
    if (n.ok && Array.isArray(n.devices) && n.devices.length) {
      const ul = document.createElement('ul');
      ul.className = 'error-list';
      n.devices.forEach((d) => {
        const li = document.createElement('li');
        const dot = `<span class=\"dot ${d.online ? 'green' : 'gray'}\"></span>`;
        const idSpan = `<span class=\"mono device-name\" data-id=\"${d.deviceId}\" title=\"${d.deviceId}\">${d.name || d.deviceId}</span>`;
        const speeds = `<span class=\"muted\">in ${formatBps(d.inBps)}, out ${formatBps(d.outBps)}</span>`;
        const uptime = d.uptime ? `<span class=\"muted\">uptime: ${formatUptime(d.uptime)}</span>` : '';
        
        // Add device stats information
        let deviceStatsDisplay = '';
        if (dataFilters.deviceStats && d.deviceStats && d.deviceStats.lastSeen) {
          const lastSeenTime = new Date(d.deviceStats.lastSeen);
          const lastSeenAgo = getTimeAgo(lastSeenTime);
          deviceStatsDisplay = ` <span class="mono" style="color: #6f42c1;" title="Device Stats: Last seen at ${lastSeenTime.toLocaleString()}">last seen: ${lastSeenAgo}</span>`;
        }
        
        li.innerHTML = `${dot}${idSpan} ${speeds} ${uptime}${deviceStatsDisplay}`;
        const target = li.querySelector('.device-name');
        if (target) {
          target.addEventListener('contextmenu', async (e) => {
            e.preventDefault();
            const deviceId = target.getAttribute('data-id') || '';
            const ok = await copyTextToClipboard(deviceId);
            if (ok) showToast('Device ID copied');
          });
        }
        ul.appendChild(li);
      });
      devicesTd.appendChild(ul);
    } else {
      devicesTd.textContent = '—';
    }
    tr.appendChild(devicesTd);

    const pausedTd = document.createElement('td');
    if (n.ok && Array.isArray(n.pausedFolders) && n.pausedFolders.length) {
      pausedTd.innerHTML = n.pausedFolders.map(f => `<span class=\"mono\">${f}</span>`).join(', ');
    } else {
      pausedTd.textContent = 'None';
    }
    tr.appendChild(pausedTd);

    const oosTd = document.createElement('td');
    if (n.ok) {
      oosTd.textContent = String(n.outOfSyncItems ?? 0);
    } else {
      oosTd.textContent = '—';
    }
    tr.appendChild(oosTd);

    // Removed Fastest Connection column

    tbody.appendChild(tr);
  });
  
  // Reapply column visibility after rendering
  reapplyColumnVisibility();
  
  // Add event listeners for pause/resume buttons
  setupPauseResumeButtons();
}

async function refresh() {
  try {
    const { nodes, error } = await fetchNodes();
    if (error) console.warn(error);
    render(nodes);
    document.getElementById('lastUpdated').textContent = `Updated: ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    console.error(e);
  }
}

document.getElementById('refreshBtn').addEventListener('click', refresh);

const intervalSlider = document.getElementById('interval');
const intervalLabel = document.getElementById('intervalLabel');
const autoRefresh = document.getElementById('autoRefresh');
const toggleHostsBtn = document.getElementById('toggleHostsBtn');

let hostFilters = {
  all: true,
  local: true,
  remote: true,
  localhost: true
}; // Track which host types are enabled

let dataFilters = {
  folderDescription: true,
  folderStats: true,
  deviceStats: true,
  itemFinished: true,
  stateChanged: true
}; // Track which data types are enabled

intervalSlider.addEventListener('input', () => {
  intervalLabel.textContent = `${intervalSlider.value}s`;
});

let timer = null;
function setupAutoRefresh() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (autoRefresh.checked) {
    timer = setInterval(refresh, Number(intervalSlider.value) * 1000);
  }
}

autoRefresh.addEventListener('change', setupAutoRefresh);
intervalSlider.addEventListener('change', setupAutoRefresh);

// Host filtering functionality with checkboxes
const hostMenu = document.getElementById('hostMenu');

// Data toggle functionality with checkboxes
const toggleDataBtn = document.getElementById('toggleDataBtn');
const dataMenu = document.getElementById('dataMenu');

// Toggle host menu visibility
toggleHostsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isVisible = hostMenu.style.display !== 'none';
  hostMenu.style.display = isVisible ? 'none' : 'block';
  updateHostButtonText();
});

// Close menu when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.host-toggle')) {
    hostMenu.style.display = 'none';
  }
  if (!e.target.closest('.data-toggle')) {
    dataMenu.style.display = 'none';
  }
});

// Handle checkbox changes
hostMenu.addEventListener('change', async (e) => {
  if (e.target.type === 'checkbox') {
    const hostType = e.target.getAttribute('data-host');
    console.log('Checkbox changed:', hostType, 'checked:', e.target.checked);
    
    // Handle "all" checkbox logic
    if (hostType === 'all') {
      if (e.target.checked) {
        // If "all" is checked, uncheck all others
        hostMenu.querySelectorAll('input[type="checkbox"]:not([data-host="all"])').forEach(cb => {
          cb.checked = false;
          hostFilters[cb.getAttribute('data-host')] = false;
        });
        hostFilters.all = true;
      } else {
        // If "all" is unchecked, don't auto-check anything
        hostFilters.all = false;
      }
    } else {
      // If any specific filter is checked, uncheck "all"
      if (e.target.checked) {
        const allCheckbox = hostMenu.querySelector('input[data-host="all"]');
        allCheckbox.checked = false;
        hostFilters.all = false;
      }
      hostFilters[hostType] = e.target.checked;
      
      // If no specific filters are checked, check "all"
      const specificFilters = hostMenu.querySelectorAll('input[type="checkbox"]:not([data-host="all"])');
      const checkedSpecific = Array.from(specificFilters).some(cb => cb.checked);
      if (!checkedSpecific) {
        const allCheckbox = hostMenu.querySelector('input[data-host="all"]');
        allCheckbox.checked = true;
        hostFilters.all = true;
      }
    }
    
    console.log('Updated hostFilters:', hostFilters);
    updateHostButtonText();
    
    // Refresh data
    try {
      await refresh();
      const nodes = await fetchNodes();
      showToast(`Showing ${nodes.length} host(s)`);
    } catch (error) {
      console.error('Failed to refresh after host filter change:', error);
      showToast('Failed to refresh data');
    }
  }
});

function updateHostButtonText() {
  const enabledFilters = Object.entries(hostFilters).filter(([key, value]) => value && key !== 'all');
  
  if (hostFilters.all) {
    toggleHostsBtn.textContent = 'Filter Hosts (All)';
    toggleHostsBtn.classList.remove('excluded');
  } else if (enabledFilters.length === 0) {
    toggleHostsBtn.textContent = 'Filter Hosts (None)';
    toggleHostsBtn.classList.add('excluded');
  } else if (enabledFilters.length === 1) {
    const filterName = enabledFilters[0][0];
    const displayName = filterName === 'local' ? 'Local' : 
                       filterName === 'remote' ? 'Remote' : 
                       filterName === 'localhost' ? 'Localhost' : filterName;
    toggleHostsBtn.textContent = `Filter Hosts (${displayName})`;
    toggleHostsBtn.classList.add('excluded');
  } else {
    toggleHostsBtn.textContent = `Filter Hosts (${enabledFilters.length} types)`;
    toggleHostsBtn.classList.add('excluded');
  }
}

// Toggle data menu visibility
toggleDataBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isVisible = dataMenu.style.display !== 'none';
  dataMenu.style.display = isVisible ? 'none' : 'block';
  updateDataButtonText();
});

// Handle data checkbox changes
dataMenu.addEventListener('change', async (e) => {
  if (e.target.type === 'checkbox') {
    const dataType = e.target.getAttribute('data-data');
    dataFilters[dataType] = e.target.checked;
    
    console.log('Data filter changed:', dataType, 'checked:', e.target.checked);
    console.log('Updated dataFilters:', dataFilters);
    
    updateDataButtonText();
    
    // Refresh data to apply new filters
    try {
      await refresh();
      showToast('Data filters updated');
    } catch (error) {
      console.error('Failed to refresh after data filter change:', error);
      showToast('Failed to refresh data');
    }
  }
});

function updateDataButtonText() {
  const enabledFilters = Object.entries(dataFilters).filter(([key, value]) => value);
  
  if (enabledFilters.length === Object.keys(dataFilters).length) {
    toggleDataBtn.textContent = 'Toggle Data (All)';
    toggleDataBtn.classList.remove('excluded');
  } else if (enabledFilters.length === 0) {
    toggleDataBtn.textContent = 'Toggle Data (None)';
    toggleDataBtn.classList.add('excluded');
  } else {
    toggleDataBtn.textContent = `Toggle Data (${enabledFilters.length})`;
    toggleDataBtn.classList.add('excluded');
  }
}

// Column resizing functionality
function setupColumnResizing() {
  const table = document.getElementById('mainTable');
  const headers = table.querySelectorAll('th');
  let isResizing = false;
  let currentHeader = null;
  let startX = 0;
  let startWidth = 0;

  headers.forEach((header, index) => {
    const handle = header.querySelector('.resize-handle');
    if (!handle) return;

    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      currentHeader = header;
      startX = e.clientX;
      startWidth = header.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing || !currentHeader) return;
    
    const diff = e.clientX - startX;
    const newWidth = Math.max(50, startWidth + diff);
    currentHeader.style.width = newWidth + 'px';
    
    // Update corresponding cells in all rows
    const columnIndex = Array.from(currentHeader.parentNode.children).indexOf(currentHeader);
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
      const cell = row.children[columnIndex];
      if (cell) cell.style.width = newWidth + 'px';
    });
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      currentHeader = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// Setup pause/resume button event listeners
function setupPauseResumeButtons() {
  // Device pause/resume buttons have been removed as they don't work
  // This function is kept for potential future use
}

// Global function to reapply column visibility (called after render)
function reapplyColumnVisibility() {
  const columnMenu = document.getElementById('columnMenu');
  const checkboxes = columnMenu.querySelectorAll('input[type="checkbox"]');
  const table = document.getElementById('mainTable');
  
  checkboxes.forEach(checkbox => {
    const columnIndex = parseInt(checkbox.getAttribute('data-column'));
    const isVisible = checkbox.checked;
    
    // Apply visibility to header
    const header = table.querySelector(`thead th:nth-child(${columnIndex + 1})`);
    if (header) {
      header.classList.toggle('hidden-column', !isVisible);
    }
    
    // Apply visibility to all cells in this column
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
      const cell = row.children[columnIndex];
      if (cell) {
        cell.classList.toggle('hidden-column', !isVisible);
      }
    });
  });
}

// Column visibility functionality
function setupColumnVisibility() {
  const toggleBtn = document.getElementById('toggleColumnsBtn');
  const columnMenu = document.getElementById('columnMenu');
  const checkboxes = columnMenu.querySelectorAll('input[type="checkbox"]');
  const table = document.getElementById('mainTable');
  const STORAGE_KEY = 'syncthing-dashboard-column-visibility';
  
  // Function to save column visibility state to localStorage
  function saveColumnStates() {
    const states = {};
    checkboxes.forEach(checkbox => {
      const columnIndex = parseInt(checkbox.getAttribute('data-column'));
      states[columnIndex] = checkbox.checked;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
  }
  
  // Function to load column visibility state from localStorage
  function loadColumnStates() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load column visibility state:', e);
    }
    return null;
  }
  
  // Function to apply column visibility state
  function applyColumnStates(states) {
    checkboxes.forEach(checkbox => {
      const columnIndex = parseInt(checkbox.getAttribute('data-column'));
      const isVisible = states && states.hasOwnProperty(columnIndex) ? states[columnIndex] : checkbox.checked;
      checkbox.checked = isVisible;
      
      // Apply visibility to table
      const header = table.querySelector(`thead th:nth-child(${columnIndex + 1})`);
      if (header) {
        header.classList.toggle('hidden-column', !isVisible);
      }
      
      const rows = table.querySelectorAll('tbody tr');
      rows.forEach(row => {
        const cell = row.children[columnIndex];
        if (cell) {
          cell.classList.toggle('hidden-column', !isVisible);
        }
      });
    });
  }
  
  // Function to update checkbox states based on current column visibility
  function updateCheckboxStates() {
    checkboxes.forEach(checkbox => {
      const columnIndex = parseInt(checkbox.getAttribute('data-column'));
      const header = table.querySelector(`thead th:nth-child(${columnIndex + 1})`);
      const isVisible = header && !header.classList.contains('hidden-column');
      checkbox.checked = isVisible;
    });
  }
  
  // Load saved column states on initialization
  const savedStates = loadColumnStates();
  if (savedStates) {
    applyColumnStates(savedStates);
  }
  
  // Toggle menu visibility
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isMenuVisible = columnMenu.style.display === 'block';
    columnMenu.style.display = isMenuVisible ? 'none' : 'block';
    
    // Update checkbox states when opening menu
    if (!isMenuVisible) {
      updateCheckboxStates();
    }
  });
  
  // Close menu when clicking outside
  document.addEventListener('click', () => {
    columnMenu.style.display = 'none';
  });
  
  // Handle column visibility changes
  checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      const columnIndex = parseInt(checkbox.getAttribute('data-column'));
      const isVisible = checkbox.checked;
      
      // Toggle header
      const header = table.querySelector(`thead th:nth-child(${columnIndex + 1})`);
      if (header) {
        header.classList.toggle('hidden-column', !isVisible);
      }
      
      // Toggle all cells in this column
      const rows = table.querySelectorAll('tbody tr');
      rows.forEach(row => {
        const cell = row.children[columnIndex];
        if (cell) {
          cell.classList.toggle('hidden-column', !isVisible);
        }
      });
      
      // Save state after each change
      saveColumnStates();
    });
  });
}

// initial load
updateHostButtonText();
updateDataButtonText();
refresh();
setupAutoRefresh();
setupColumnResizing();
setupColumnVisibility();


