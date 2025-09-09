      function renderOutOfSyncItems(data) {
        const loading = document.getElementById('loading');
        const error = document.getElementById('error');
        const table = document.getElementById('outofsyncTable');
        const summary = document.getElementById('summary');
        const tbody = document.getElementById('outofsyncBody');
        
        loading.style.display = 'none';
        error.style.display = 'none';
        
        if (!data || !data.nodes || Object.keys(data.nodes).length === 0) {
          error.textContent = 'No out-of-sync items found.';
          error.style.display = 'block';
          return;
        }
        
        // Flatten all items from all nodes for summary
        const allItems = [];
        Object.values(data.nodes).forEach(items => {
          allItems.push(...items);
        });
        
        if (allItems.length === 0) {
          error.textContent = 'No out-of-sync items found.';
          error.style.display = 'block';
          return;
        }
        
        outOfSyncData = allItems;
        
        // Show summary
        const totalItems = allItems.length;
        const totalSize = allItems.reduce((sum, item) => sum + (item.size || 0), 0);
        const nodes = Object.keys(data.nodes);
        const folders = [...new Set(allItems.map(item => item.folder))];
        
        document.getElementById('summaryText').innerHTML = `
          <strong>${totalItems}</strong> out-of-sync items across <strong>${nodes.length}</strong> node(s) and <strong>${folders.length}</strong> folder(s)<br>
          Total size: <strong>${formatFileSize(totalSize)}</strong>
        `;
        summary.style.display = 'block';
        
        // Clear and populate table
        tbody.innerHTML = '';
        
        // Group items by node for better organization
        nodes.forEach(nodeName => {
          const nodeItems = data.nodes[nodeName];
          if (nodeItems.length === 0) return;
          
          // Add node header row
          const nodeHeaderRow = document.createElement('tr');
          nodeHeaderRow.style.backgroundColor = '#f0f0f0';
          nodeHeaderRow.style.fontWeight = 'bold';
          
          const nodeHeaderCell = document.createElement('td');
          nodeHeaderCell.colSpan = 6;
          nodeHeaderCell.textContent = `Node: ${nodeName} (${nodeItems.length} items)`;
          nodeHeaderCell.style.padding = '12px 8px';
          nodeHeaderRow.appendChild(nodeHeaderCell);
          tbody.appendChild(nodeHeaderRow);
          
          // Add items for this node
          nodeItems.forEach(item => {
            const tr = document.createElement('tr');
            
            const nodeTd = document.createElement('td');
            nodeTd.className = 'node-name';
            nodeTd.textContent = item.node || '—';
            tr.appendChild(nodeTd);
            
            const folderTd = document.createElement('td');
            folderTd.textContent = item.folder || '—';
            tr.appendChild(folderTd);
            
            const pathTd = document.createElement('td');
            pathTd.className = 'file-path';
            pathTd.textContent = item.path || '—';
            tr.appendChild(pathTd);
            
            const reasonTd = document.createElement('td');
            reasonTd.className = `reason ${getReasonClass(item.reason)}`;
            reasonTd.textContent = item.reason || 'Unknown';
            tr.appendChild(reasonTd);
            
            const sizeTd = document.createElement('td');
            sizeTd.textContent = formatFileSize(item.size);
            tr.appendChild(sizeTd);
            
            const modifiedTd = document.createElement('td');
            modifiedTd.textContent = formatDate(item.modified);
            tr.appendChild(modifiedTd);
            
            tbody.appendChild(tr);
          });
        });
        
        table.style.display = 'table';
        updateLastUpdated();
      }
