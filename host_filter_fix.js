// Host filtering logic without "all" option
const hostFilters = {};

function populateHostMenu(hosts) {
  const hostMenu = document.getElementById('hostMenu');
  
  // Clear existing checkboxes
  hostMenu.innerHTML = '';
  
  hosts.forEach(host => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.setAttribute("data-host", host.name);
    checkbox.checked = hostFilters[host.name] !== false; // Default to true if not set
    
    // Initialize host filter if not exists
    if (!(host.name in hostFilters)) {
      hostFilters[host.name] = true;
    }
    
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(` ${host.name}`));
    hostMenu.appendChild(label);
  });
  
  availableHosts = hosts;
}

async function fetchNodes() {
  const res = await fetch('api/nodes');
  if (!res.ok) throw new Error(`Failed to fetch nodes: ${res.status}`);
  const data = await res.json();
  
  // Filter nodes client-side based on hostFilters
  console.log("fetchNodes called with hostFilters:", hostFilters);
  
  // Filter to only show selected hosts
  const enabledHosts = Object.entries(hostFilters).filter(([key, value]) => value);
  
  console.log("Enabled individual hosts:", enabledHosts);
  
  if (enabledHosts.length === 0) {
    console.log("No hosts selected, returning empty result");
    return { nodes: [] };
  } else {
    const selectedHostNames = enabledHosts.map(([hostName, enabled]) => hostName);
    const filteredNodes = data.nodes.filter(node => selectedHostNames.includes(node.name));
    
    console.log(`Filtered ${data.nodes.length} nodes to ${filteredNodes.length} nodes`);
    return { ...data, nodes: filteredNodes };
  }
}

// Host menu event listener
hostMenu.addEventListener('change', async (e) => {
  if (e.target.type === 'checkbox') {
    const hostName = e.target.getAttribute('data-host');
    hostFilters[hostName] = e.target.checked;
    
    console.log('Updated hostFilters:', hostFilters);
    updateHostButtonText();
    
    // Refresh data
    try {
      await refresh();
      const nodes = await fetchNodes();
      render(nodes);
    } catch (error) {
      console.error('Error refreshing after host filter change:', error);
    }
  }
});

function updateHostButtonText() {
  const enabledFilters = Object.entries(hostFilters).filter(([key, value]) => value);
  
  if (enabledFilters.length === 0) {
    toggleHostsBtn.textContent = 'Filter Hosts (None)';
    toggleHostsBtn.classList.add('excluded');
  } else if (enabledFilters.length === 1) {
    const filterName = enabledFilters[0][0];
    toggleHostsBtn.textContent = `Filter Hosts (${filterName})`;
    toggleHostsBtn.classList.remove('excluded');
  } else {
    toggleHostsBtn.textContent = `Filter Hosts (${enabledFilters.length} hosts)`;
    toggleHostsBtn.classList.remove('excluded');
  }
}
