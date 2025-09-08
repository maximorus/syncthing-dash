import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Load instances configuration
// Priority: ENV var SYNC_INSTANCES (JSON) > config/instances.json > config/instances.example.json
function loadInstancesConfig() {
  const envJson = process.env.SYNC_INSTANCES;
  if (envJson) {
    try {
      const parsed = JSON.parse(envJson);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {
      console.warn('SYNC_INSTANCES env var is not valid JSON. Falling back to files.');
    }
  }

  const configDir = path.join(__dirname, '..', 'config');
  const primaryPath = path.join(configDir, 'instances.json');
  const examplePath = path.join(configDir, 'instances.example.json');

  if (fs.existsSync(primaryPath)) {
    try {
      return JSON.parse(fs.readFileSync(primaryPath, 'utf8'));
    } catch (error) {
      console.error('Failed to parse config/instances.json:', error);
    }
  }
  if (fs.existsSync(examplePath)) {
    try {
      return JSON.parse(fs.readFileSync(examplePath, 'utf8'));
    } catch (error) {
      console.error('Failed to parse config/instances.example.json:', error);
    }
  }
  return [];
}

/**
 * Fetch helper with timeout and X-API-Key header
 */
async function fetchFromSyncthing(baseUrl, apiKey, endpointPath, options = {}) {
  const url = new URL(endpointPath, baseUrl).toString();
  const fetchOptions = {
    headers: {
      'X-API-Key': apiKey,
      ...options.headers,
    },
    signal: options.signal || options.abortSignal,
    ...options,
  };
  
  const response = await fetch(url, fetchOptions);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  
  // For PUT/POST requests, return the response object instead of JSON
  if (options.method === 'PUT' || options.method === 'POST') {
    return response;
  }
  
  return response.json();
}

function toBytesPerSecond(totalBytes, uptimeSeconds) {
  if (!uptimeSeconds || uptimeSeconds <= 0) return 0;
  return totalBytes / uptimeSeconds;
}

// API endpoint to aggregate data from multiple instances
app.get('/api/nodes', async (req, res) => {
  const instances = loadInstancesConfig();
  if (!instances.length) {
    return res.status(200).json({ nodes: [], error: 'No instances configured' });
  }

  // Filter instances based on host filter parameters
  let filteredInstances = instances;
  const originalCount = instances.length;
  
  if (req.query.includeAllHosts === 'false') {
    // Only include localhost instances (127.0.0.1, localhost, or IPs starting with 192.168, 10., 172.)
    filteredInstances = instances.filter(instance => {
      const url = new URL(instance.baseUrl);
      const hostname = url.hostname;
      return hostname === 'localhost' || 
             hostname === '127.0.0.1' || 
             hostname.startsWith('192.168.') ||
             hostname.startsWith('10.') ||
             (hostname.startsWith('172.') && parseInt(hostname.split('.')[1]) >= 16 && parseInt(hostname.split('.')[1]) <= 31);
    });
    
    // Log filtering results for debugging
    console.log(`Host filtering (local only): ${originalCount} total instances, ${filteredInstances.length} local instances`);
    if (originalCount === filteredInstances.length) {
      console.log('All configured instances are on local networks');
    }
  } else if (req.query.includeRemoteOnly === 'true') {
    // Only include remote instances (not localhost or private networks)
    filteredInstances = instances.filter(instance => {
      const url = new URL(instance.baseUrl);
      const hostname = url.hostname;
      return !(hostname === 'localhost' || 
               hostname === '127.0.0.1' || 
               hostname.startsWith('192.168.') ||
               hostname.startsWith('10.') ||
               (hostname.startsWith('172.') && parseInt(hostname.split('.')[1]) >= 16 && parseInt(hostname.split('.')[1]) <= 31));
    });
    
    // Log filtering results for debugging
    console.log(`Host filtering (remote only): ${originalCount} total instances, ${filteredInstances.length} remote instances`);
    if (filteredInstances.length === 0) {
      console.log('No remote instances found - all configured instances are on local networks');
    }
  } else if (req.query.localhostOnly === 'true') {
    // Only include localhost instances (127.0.0.1 or localhost)
    filteredInstances = instances.filter(instance => {
      const url = new URL(instance.baseUrl);
      const hostname = url.hostname;
      return hostname === 'localhost' || hostname === '127.0.0.1';
    });
    
    // Log filtering results for debugging
    console.log(`Host filtering (localhost only): ${originalCount} total instances, ${filteredInstances.length} localhost instances`);
    if (filteredInstances.length === 0) {
      console.log('No localhost instances found');
    }
  }

  // Concurrently query instances
  const controller = new AbortController();
  const timeoutMs = Number(process.env.SYNC_TIMEOUT_MS || 10000); // Increased to 10 seconds
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const results = await Promise.all(filteredInstances.map(async (instance) => {
      const { name, baseUrl, apiKey } = instance;
      const node = {
        name: name || baseUrl,
        ok: false,
        stats: null,
        errors: [],
        error: null,
        baseUrl,
      };

      try {
        // system/status: for uptime
        const status = await fetchFromSyncthing(baseUrl, apiKey, '/rest/system/status', { signal: controller.signal });

        // system/connections: for bytes sent/received totals
        const connections = await fetchFromSyncthing(baseUrl, apiKey, '/rest/system/connections', { signal: controller.signal });

        // stats/device: for device last seen information
        const deviceStats = await fetchFromSyncthing(baseUrl, apiKey, '/rest/stats/device', { signal: controller.signal }).catch(error => {
          console.warn(`Failed to fetch device stats for ${instance.name}:`, error.message);
          return null;
        });

        // config: folders and devices (shares / shared-with)
        let config = null;
        try {
          config = await fetchFromSyncthing(baseUrl, apiKey, '/rest/config', { signal: controller.signal });
        } catch (_) {
          // If fetching full config fails, attempt targeted endpoints (older versions)
          try {
            const [cfgFolders, cfgDevices] = await Promise.all([
              fetchFromSyncthing(baseUrl, apiKey, '/rest/config/folders', { signal: controller.signal }),
              fetchFromSyncthing(baseUrl, apiKey, '/rest/config/devices', { signal: controller.signal }),
            ]);
            config = { folders: cfgFolders, devices: cfgDevices };
          } catch (e) {
            // Ignore shares if config endpoints not available
          }
        }

        // system/error: recent errors
        let errorItems = [];
        try {
          const errorsResp = await fetchFromSyncthing(baseUrl, apiKey, '/rest/system/error', { signal: controller.signal });
          if (errorsResp && Array.isArray(errorsResp.errors)) {
            errorItems = errorsResp.errors;
          } else if (Array.isArray(errorsResp)) {
            // Some versions may return the array directly
            errorItems = errorsResp;
          }
        } catch (err) {
          // error endpoint not critical; continue
        }

        const uptimeSeconds = Number(status?.uptime || 0);
        const total = connections?.total || {};
        const bytesSent = Number(total.bytesSent || 0);
        const bytesReceived = Number(total.bytesReceived || 0);

        // Determine fastest connection by sum of in/out Bps
        let fastestPeerDeviceId = null;
        let fastestPeerTotalBps = 0;
        const connectionMap = connections?.connections || {};
        const onlineDeviceIds = new Set(Object.entries(connectionMap)
          .filter(([, c]) => Boolean(c?.connected))
          .map(([deviceId]) => deviceId));
        for (const [peerId, conn] of Object.entries(connectionMap)) {
          const inBps = Number(conn?.inBytesPerSecond || 0);
          const outBps = Number(conn?.outBytesPerSecond || 0);
          const total = inBps + outBps;
          if (total > fastestPeerTotalBps) {
            fastestPeerTotalBps = total;
            fastestPeerDeviceId = peerId;
          }
        }

        node.stats = {
          uptimeSeconds,
          bytesSent,
          bytesReceived,
          avgSendBps: toBytesPerSecond(bytesSent, uptimeSeconds),
          avgRecvBps: toBytesPerSecond(bytesReceived, uptimeSeconds),
          fastestPeerDeviceId,
          fastestPeerTotalBps,
        };
        // Per-device status and speeds
        node.devices = Object.entries(connectionMap).map(([peerId, conn]) => {
          // Get device stats for this device
          let deviceStatsInfo = null;
          if (deviceStats && deviceStats[peerId]) {
            const stats = deviceStats[peerId];
            if (stats.lastSeen) {
              deviceStatsInfo = {
                lastSeen: stats.lastSeen,
                // Include additional stats if available
                lastConnectionDurationS: stats.lastConnectionDurationS || null,
                lastConnectionStartedAt: stats.lastConnectionStartedAt || null
              };
            }
          }
          
          return {
            deviceId: peerId,
            online: Boolean(conn?.connected),
            inBps: Number(conn?.inBytesPerSecond || 0),
            outBps: Number(conn?.outBytesPerSecond || 0),
            address: conn?.address || null,
            paused: Boolean(conn?.paused),
            uptime: conn?.connectedAt ? Math.floor((Date.now() - new Date(conn.connectedAt).getTime()) / 1000) : null,
            deviceStats: deviceStatsInfo,
          };
        });
        node.errors = errorItems.map((e) => ({ when: e?.when || null, message: e?.message || String(e) })).slice(0, 5);

        // Shares and peers
        if (config) {
          const deviceIdToName = new Map();
          const devices = Array.isArray(config?.devices) ? config.devices : [];
          devices.forEach((d) => {
            if (d?.deviceID) deviceIdToName.set(d.deviceID, d?.name || d.deviceID);
          });
          const myId = status?.myID || status?.myID6 || null;
          // Prefer Syncthing-derived local device name if available
          const localName = (myId && deviceIdToName.get(myId)) || status?.myName;
          if (localName) node.name = localName;
          const folders = Array.isArray(config?.folders) ? config.folders : [];
          const peerNamesSet = new Set();
          const perDeviceFolders = new Map();
          const pausedFolders = [];
          folders.forEach((f) => {
            const members = Array.isArray(f?.devices) ? f.devices : [];
            if (f?.paused) pausedFolders.push(f?.label || f?.id || f?.ID || '');
            members.forEach((m) => {
              const id = m?.deviceID || m?.deviceId || null;
              if (id && id !== myId) {
                const name = deviceIdToName.get(id) || id;
                peerNamesSet.add(name);
                const list = perDeviceFolders.get(name) || [];
                list.push(f?.label || f?.id || f?.ID || '');
                perDeviceFolders.set(name, list);
              }
            });
          });
          node.shares = {
            count: folders.length,
            peers: Array.from(peerNamesSet).sort(),
          };
          // Attach device names to node.devices if available
          if (Array.isArray(node.devices)) {
            node.devices = node.devices.map((d) => ({
              ...d,
              name: d.deviceId === myId ? (deviceIdToName.get(myId) || 'Local') : (deviceIdToName.get(d.deviceId) || d.deviceId),
            }));
          }
          node.pausedFolders = pausedFolders.filter(Boolean).sort();

          // Last synced file, file in progress, and latest change per folder from recent events
          let lastSyncedByFolder = {};
          let fileInProgressByFolder = {};
          let latestChangeByFolder = {};
          let events = []; // Declare events in broader scope
          
          // Try to fetch events with Promise.race for better timeout handling
          try {
            const since = Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000); // 2 hours
            
            const eventsPromise = fetchFromSyncthing(
              baseUrl,
              apiKey,
              `/rest/events?since=${since}&limit=50`,
              { signal: controller.signal }
            );
            
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Events timeout')), 100); // 100ms timeout
            });
            
            events = await Promise.race([eventsPromise, timeoutPromise]);
          
            if (Array.isArray(events)) {
              console.log(`Found ${events.length} events for ${instance.name}`);
              
              // Process events to get latest changes per folder
              const folderLatestEvents = {};
              
              events
                .filter(ev => ev?.type === 'ItemFinished' && ev?.data?.folder)
                .forEach(ev => {
                  const fid = ev.data.folder;
                  const eventTime = ev.time;
                  
                  // Keep only the latest event per folder
                  if (!folderLatestEvents[fid] || eventTime > folderLatestEvents[fid].time) {
                    folderLatestEvents[fid] = {
                      file: ev.data.item,
                      time: eventTime,
                      action: ev.data.action || 'unknown'
                    };
                  }
                });
              
              // Store the latest events
              Object.assign(lastSyncedByFolder, folderLatestEvents);
              console.log(`Latest events by folder:`, folderLatestEvents);
            }
          } catch (error) {
            console.warn(`Events fetch failed for ${instance.name}:`, error.message);
          }

          // Per-folder status and completion for the local node
          const folderStatuses = await Promise.all(folders.map(async (f) => {
            const folderId = f?.id || f?.ID || f?.folder || '';
            const folderLabel = f?.label || folderId;
            if (!folderId) return null;
            try {
              const [dbStatus, dbCompletion, folderStats] = await Promise.all([
                fetchFromSyncthing(baseUrl, apiKey, `/rest/db/status?folder=${encodeURIComponent(folderId)}`, { signal: controller.signal }),
                myId ? fetchFromSyncthing(baseUrl, apiKey, `/rest/db/completion?device=${encodeURIComponent(myId)}&folder=${encodeURIComponent(folderId)}`, { signal: controller.signal }) : Promise.resolve(null),
                fetchFromSyncthing(baseUrl, apiKey, `/rest/stats/folder?folder=${encodeURIComponent(folderId)}`, { signal: controller.signal }).catch(error => {
                  console.warn(`Failed to fetch folder stats for ${folderId} on ${instance.name}:`, error.message);
                  return null;
                }),
              ]);
              
              // Get latest changed file from audit log for this folder
              let latestChangedFile = lastSyncedByFolder[folderId] || null;
              
              // Get ItemFinished event information for this folder
              let itemFinishedInfo = null;
              if (Array.isArray(events) && events.length > 0) {
                const folderItemFinishedEvents = events
                  .filter(ev => ev?.type === 'ItemFinished' && ev?.data?.folder === folderId)
                  .sort((a, b) => (b.time || 0) - (a.time || 0));
                
                if (folderItemFinishedEvents.length > 0) {
                  const latestItemFinished = folderItemFinishedEvents[0];
                  itemFinishedInfo = {
                    type: 'ItemFinished',
                    time: latestItemFinished.time,
                    action: latestItemFinished.data.action || 'unknown',
                    item: latestItemFinished.data.item || 'unknown',
                    folder: latestItemFinished.data.folder || folderId,
                    totalEvents: folderItemFinishedEvents.length
                  };
                }
              }
              
              // If events API failed, use stateChanged as fallback
              if (!latestChangedFile && dbStatus?.stateChanged) {
                latestChangedFile = {
                  file: 'State changed',
                  time: dbStatus.stateChanged,
                  action: 'state change'
                };
              }
              
              // Debug logging
              if (!dbStatus) {
                console.warn(`No dbStatus for folder ${folderId} on ${instance.name}`);
              }
              
              const state = dbStatus?.state || 'unknown';
              const needBytes = Number(dbStatus?.needBytes || 0);
              const needItems = Number(dbStatus?.needItems || 0);
              const completionPct = Number(dbCompletion?.completion || dbCompletion?.completionPct || 0);
              // peers for this folder including self with item completion per peer
              const memberDevices = Array.isArray(f?.devices) ? f.devices : [];
              const allIds = Array.from(new Set(memberDevices.map((m) => m?.deviceID || m?.deviceId).filter(Boolean)));
              const peers = (await Promise.all(allIds.map(async (peerId) => {
                try {
                  const comp = await fetchFromSyncthing(
                    baseUrl,
                    apiKey,
                    `/rest/db/completion?device=${encodeURIComponent(peerId)}&folder=${encodeURIComponent(folderId)}`,
                    { signal: controller.signal }
                  );
                  const globalItems = Number(comp?.globalItems || comp?.globalFiles || 0);
                  const needPeerItems = Number(comp?.needItems || comp?.needFiles || 0);
                  const syncedItems = Math.max(0, globalItems - needPeerItems);
                  const pct = Number(comp?.completion || comp?.completionPct || (globalItems ? (syncedItems / globalItems) * 100 : 0));
                  return {
                    id: peerId,
                    name: deviceIdToName.get(peerId) || (peerId === myId ? 'Local' : String(peerId)),
                    online: peerId === myId ? true : onlineDeviceIds.has(peerId),
                    items: { globalItems, needItems: needPeerItems, syncedItems, completionPct: pct },
                  };
                } catch (_) {
                  return {
                    id: peerId,
                    name: deviceIdToName.get(peerId) || (peerId === myId ? 'Local' : String(peerId)),
                    online: peerId === myId ? true : onlineDeviceIds.has(peerId),
                    items: { globalItems: null, needItems: null, syncedItems: null, completionPct: null },
                  };
                }
              }))).sort((a, b) => a.name.localeCompare(b.name));
              const isPaused = dbStatus?.paused || false;
              
              // Process folder stats data
              let folderStatsInfo = null;
              if (folderStats && typeof folderStats === 'object' && folderStats[folderId]) {
                const folderStat = folderStats[folderId];
                if (folderStat && folderStat.lastFile && folderStat.lastFile.filename && folderStat.lastFile.at) {
                  folderStatsInfo = {
                    filename: folderStat.lastFile.filename,
                    at: folderStat.lastFile.at,
                    deleted: folderStat.lastFile.deleted || false,
                    lastScan: folderStat.lastScan || null
                  };
                }
              }
              
              return { 
                id: folderId, 
                label: folderLabel, 
                description: f?.description || null,
                state, 
                needBytes, 
                needItems, 
                completionPct, 
                peers, 
                lastSyncedFile: lastSyncedByFolder[folderId] || null, 
                fileInProgress: fileInProgressByFolder[folderId] || null,
                latestChange: latestChangeByFolder[folderId] || null,
                latestChangedFile: latestChangedFile,
                itemFinishedInfo: itemFinishedInfo,
                stateChanged: dbStatus?.stateChanged || null,
                folderStats: folderStatsInfo,
                paused: isPaused 
              };
            } catch (error) {
              console.warn(`Failed to fetch folder status for ${folderId} on ${instance.name}:`, error.message);
              // best-effort peers from config even on failure
              const memberDevices = Array.isArray(f?.devices) ? f.devices : [];
              const peers = Array.from(new Set(memberDevices
                .map((m) => m?.deviceID || m?.deviceId)
                .filter((id) => id && id !== myId)))
                .map((id) => ({
                  id,
                  name: deviceIdToName.get(id) || String(id),
                  online: onlineDeviceIds.has(id),
                }))
                .sort((a, b) => a.name.localeCompare(b.name));
              return { 
                id: folderId, 
                label: folderLabel, 
                description: f?.description || null,
                state: 'unknown', 
                needBytes: null, 
                needItems: null, 
                completionPct: null, 
                peers, 
                lastSyncedFile: lastSyncedByFolder[folderId] || null, 
                fileInProgress: fileInProgressByFolder[folderId] || null,
                latestChange: latestChangeByFolder[folderId] || null,
                latestChangedFile: null,
                itemFinishedInfo: null,
                stateChanged: null,
                paused: false 
              };
            }
          }));
          node.folders = folderStatuses.filter(Boolean);

          // Aggregate out-of-sync items
          node.outOfSyncItems = node.folders.reduce((sum, f) => sum + (Number.isFinite(f.needItems) ? f.needItems : 0), 0);

          // Per-device folders as object
          const perDevice = {};
          for (const [devName, list] of perDeviceFolders.entries()) {
            perDevice[devName] = list.sort();
          }
          node.perDeviceFolders = perDevice;
        } else {
          node.shares = { count: 0, peers: [] };
          node.folders = [];
          node.pausedFolders = [];
          node.outOfSyncItems = 0;
          node.perDeviceFolders = {};
        }
        node.ok = true;
      } catch (innerErr) {
        node.error = innerErr?.message || String(innerErr);
      }

      return node;
    }));

    res.json({ nodes: results });
  } catch (e) {
    const isAbort = e?.name === 'AbortError';
    res.status(504).json({ nodes: [], error: isAbort ? 'Request timed out' : (e?.message || 'Unknown error') });
  } finally {
    clearTimeout(timeout);
  }
});

// Pause/Resume API endpoint
app.post('/api/pause-resume', async (req, res) => {
  try {
    const { node, folder, device, action } = req.body;
    
    if (!node || !action || (!folder && !device)) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    const instances = loadInstancesConfig();
    const instance = instances.find(inst => inst.name === node);
    if (!instance) {
      return res.status(404).json({ error: 'Node not found' });
    }
    
    if (folder) {
      // Pause/resume folder through configuration API
      try {
        // Get current folder config
        const folderConfig = await fetchFromSyncthing(instance.baseUrl, instance.apiKey, `/rest/config/folders/${encodeURIComponent(folder)}`, {});
        if (!folderConfig) {
          return res.status(404).json({ error: 'Folder not found' });
        }
        
        // Update paused state
        folderConfig.paused = action === 'pause';
        
        // Update folder configuration
        const updateResponse = await fetchFromSyncthing(instance.baseUrl, instance.apiKey, `/rest/config/folders/${encodeURIComponent(folder)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(folderConfig)
        });
        
        if (updateResponse) {
          res.json({ success: true });
        } else {
          res.status(500).json({ error: 'Failed to update folder configuration' });
        }
      } catch (error) {
        res.status(500).json({ error: `Failed to ${action} folder: ${error.message}` });
      }
    } else if (device) {
      // Device pause/resume through system pause API
      try {
        const endpoint = `/rest/system/pause?device=${encodeURIComponent(device)}&pause=${action === 'pause'}`;
        const response = await fetchFromSyncthing(instance.baseUrl, instance.apiKey, endpoint, {
          method: 'POST'
        });
        
        if (response) {
          res.json({ success: true });
        } else {
          res.status(500).json({ error: 'Failed to execute pause/resume operation' });
        }
      } catch (error) {
        res.status(500).json({ error: `Failed to ${action} device: ${error.message}` });
      }
    }
  } catch (error) {
    console.error('Error in pause/resume:', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve static frontend
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

app.listen(PORT, HOST, () => {
  console.log(`Syncthing dashboard running at http://${HOST}:${PORT}`);
});


