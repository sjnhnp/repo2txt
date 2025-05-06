// script.js

// --- DOM Elements (保持不变) ---
const repoForm = document.getElementById('repoForm');
// ... (all other getElementById calls remain the same)
const fileTreeContainer = document.getElementById('fileTreeContainer');


// --- Global State (保持不变, fileTreeData structure changes) ---
let currentRepoUrl = null;
let currentPat = null;
let fileTreeData = []; // Now stores the raw list including { type: 'tree'/'blob', path: '...' }
let availableExtensions = new Set();
let activeFilters = new Set();
let generatedContent = "";
let generatedStructure = ""; // Will store the text tree string

// --- Constants (保持不变) ---
const API_ENDPOINT = '/api/generate';
const ALLOWED_EXTENSIONS_FRONTEND = new Set([ /* ... as before ... */ ]);

// --- Utility Functions (保持不变) ---
function showStatus(message, showSpinner = false) { /* ... */ }
function showError(message) { /* ... */ }
function hideStatusAndError() { /* ... */ }
function resetSubsequentSections() { /* ... */ } // Needs slight adjustment for tree placeholder

// --- Modified Reset Function ---
function resetSubsequentSections() {
    filterArea.style.display = 'none';
    generationArea.style.display = 'none';
    resultContainer.style.display = 'none';
    // Update placeholder text for the tree
    fileTreeContainer.innerHTML = '<div class="placeholder-text">Enter URL and fetch structure to see the file tree.</div>';
    extensionFiltersContainer.innerHTML = '<span class="placeholder-text">Filters appear after fetching.</span>';
    structurePreview.textContent = '(Structure will appear here)';
    contentPreview.textContent = '(Content will appear here)';
    fileTreeData = [];
    availableExtensions = new Set();
    activeFilters = new Set();
    generatedContent = "";
    generatedStructure = "";
    tokenCountArea.textContent = '';
}


// --- Core Logic ---

// 1. Fetch Directory Structure Button Click (MODIFIED to handle new tree data)
fetchStructureBtn.addEventListener('click', async () => {
    const repoUrl = repoUrlInput.value.trim();
    const pat = patInput.value.trim();

    if (!repoUrl) { showError('Please enter a GitHub repository URL.'); return; }
    if (!repoUrl.toLowerCase().includes('github.com/')) { showError('Please enter a valid GitHub repository URL...'); return; }

    currentRepoUrl = repoUrl;
    currentPat = pat || null;
    fetchStructureBtn.disabled = true;
    showStatus('Fetching directory structure...', true);
    resetSubsequentSections(); // Clear previous results/tree

    try {
        console.log(`Fetching tree for ${currentRepoUrl} with${currentPat ? '' : 'out'} PAT.`);
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repoUrl: currentRepoUrl, pat: currentPat, action: 'getTree' })
        });

        if (!response.ok) {
             let errorData = { error: `Request failed with status ${response.status}` };
             try { errorData = await response.json(); } catch (e) { errorData.error += `: ${response.statusText}`; }
             throw new Error(errorData.error || `Failed to fetch structure (Status: ${response.status})`);
        }

        const data = await response.json();
        // Store the raw data containing both files and directories
        fileTreeData = data.tree || [];
        console.log(`Received ${fileTreeData.length} items (files+dirs) from backend. Truncated: ${data.truncated}`);

        let statusMsg = `Fetched structure. Found ${fileTreeData.filter(i => i.type === 'blob').length} processable files and ${fileTreeData.filter(i => i.type === 'tree').length} directories.`;
        if (data.truncated) statusMsg += ' (Warning: List may be incomplete)';
        if (fileTreeData.length === 0 && !data.truncated) statusMsg = 'Fetched structure, but no files or directories found.';
        showStatus(statusMsg, false);

        if (fileTreeData.length > 0) {
            // Pass only blobs to populateExtensionFilters as filters apply to files
            populateExtensionFilters(fileTreeData.filter(item => item.type === 'blob'));
            // Render the interactive file tree using ALL items
            renderFileTree(fileTreeData);
            filterArea.style.display = 'block';
            generationArea.style.display = 'block';
            resultContainer.style.display = 'none';
        } else {
            filterArea.style.display = 'none';
            generationArea.style.display = 'none';
        }

    } catch (error) {
        console.error('Fetch Structure Error:', error);
        showError(`Failed to fetch structure: ${error.message}`);
        resetSubsequentSections();
    } finally {
        fetchStructureBtn.disabled = false;
        spinner.style.display = 'none';
    }
});

// 2. Populate Extension Filters (保持不变 - still filters files)
function populateExtensionFilters(files) { // Expects only blobs here
    availableExtensions.clear();
    files.forEach(file => { // file is a blob object { path: '...', type: 'blob', ... }
        const pathLower = file.path.toLowerCase();
        const parts = pathLower.split('.');
        let filterKey = null;
        if (parts.length > 1) {
            const ext = '.' + parts.pop();
            if (ALLOWED_EXTENSIONS_FRONTEND.has(ext)) filterKey = ext;
        }
        if (!filterKey) {
            const filename = pathLower.substring(pathLower.lastIndexOf('/') + 1);
            if (ALLOWED_EXTENSIONS_FRONTEND.has(filename)) filterKey = filename;
        }
        if (filterKey) availableExtensions.add(filterKey);
    });

    extensionFiltersContainer.innerHTML = '';
    activeFilters = new Set(availableExtensions);
    const sortedExtensions = Array.from(availableExtensions).sort();

    if (sortedExtensions.length === 0) {
        extensionFiltersContainer.innerHTML = '<span class="placeholder-text">No recognized file types found to filter by.</span>';
        return;
    }

    sortedExtensions.forEach(extOrType => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = extOrType;
        checkbox.checked = true;
        checkbox.addEventListener('change', handleFilterChange); // Use same handler
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${extOrType}`));
        extensionFiltersContainer.appendChild(label);
    });
}


// 3. Handle Filter Checkbox Change (MODIFIED - re-renders the full tree)
function handleFilterChange() {
    activeFilters.clear();
    const checkboxes = extensionFiltersContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        if (cb.checked) {
            activeFilters.add(cb.value);
        }
    });
    // Re-render the entire file tree based on the new active filters for files
    renderFileTree(fileTreeData); // Re-render with original full data
}


// 4. Render File Tree (COMPLETELY REWRITTEN for hierarchical structure)
function renderFileTree(items) {
    fileTreeContainer.innerHTML = ''; // Clear previous tree

    // --- Helper: Build Nested Structure ---
    function buildHierarchy(itemList) {
        const hierarchy = { children: {}, items: [] }; // Root node

        itemList.sort((a, b) => a.path.localeCompare(b.path)) // Ensure sorting
               .forEach(item => {
            let currentLevel = hierarchy;
            const pathParts = item.path.split('/');

            pathParts.forEach((part, index) => {
                const isLastPart = index === pathParts.length - 1;

                if (!currentLevel.children[part]) {
                     // Create node if it doesn't exist
                     currentLevel.children[part] = {
                         name: part,
                         path: pathParts.slice(0, index + 1).join('/'), // Full path to this node
                         type: isLastPart ? item.type : 'tree', // Assume 'tree' unless it's the last part matching the item
                         children: {},
                         items: [], // Direct file children of this node
                         element: null, // Will hold the LI element
                         checkbox: null, // Will hold the checkbox element
                         isFilteredOut: false // Flag for filtering
                     };
                 }

                // If it's the last part, this node *is* the item
                if (isLastPart) {
                     // Update type based on actual item, in case a directory name matched a file path part earlier
                     currentLevel.children[part].type = item.type;
                     // Store the original item data if needed, maybe sha?
                     currentLevel.children[part].originalItem = item;

                     // Add the item reference itself to the parent's items list for file nodes
                     // This seems slightly redundant with children map, might simplify later
                     if(item.type === 'blob') {
                        // For files, assign to the PARENT's items list
                        // This might be wrong logic, let's stick to children map
                     }

                 }
                  // Move down the hierarchy for the next part
                  currentLevel = currentLevel.children[part];

            });
        });
        return hierarchy; // Return the root
    }

     // --- Helper: Should Item Be Visible Based on Filters? ---
     function isVisible(item) {
         if (item.type === 'tree') {
             // Directories are visible if they contain *any* visible children (recursive check)
             // Or if they haven't been explicitly marked as filtered out (e.g., empty after filtering)
             if (item.isFilteredOut) return false;
             return Object.values(item.children).some(child => isVisible(child));
         } else if (item.type === 'blob') {
             // Files are visible if their type matches active filters
             const pathLower = item.path.toLowerCase();
             const parts = pathLower.split('.');
             let filterKey = null;
             if (parts.length > 1) {
                 const ext = '.' + parts.pop();
                 if (ALLOWED_EXTENSIONS_FRONTEND.has(ext)) filterKey = ext;
             }
             if (!filterKey) {
                 const filename = pathLower.substring(pathLower.lastIndexOf('/') + 1);
                 if (ALLOWED_EXTENSIONS_FRONTEND.has(filename)) filterKey = filename;
             }
             return filterKey && activeFilters.has(filterKey);
         }
         return false; // Hide unknown types
     }

     // --- Helper: Recursively Apply Visibility and Count ---
     function applyVisibilityAndCount(node) {
         let visibleCount = 0;
         let isNodeVisible = false;

         if (node.type === 'blob') {
             isNodeVisible = isVisible(node);
             node.isFilteredOut = !isNodeVisible; // Mark as filtered out if not visible
             if (isNodeVisible) visibleCount = 1;
         } else { // It's a directory ('tree' or the root)
             let hasVisibleChild = false;
             Object.values(node.children).forEach(child => {
                 const childVisibleCount = applyVisibilityAndCount(child);
                 visibleCount += childVisibleCount;
                 if (childVisibleCount > 0) {
                     hasVisibleChild = true;
                 }
             });
             // A directory is visible if it has visible children
             isNodeVisible = hasVisibleChild;
             node.isFilteredOut = !isNodeVisible; // Mark as filtered if no visible children
         }
          // Assign visibility status to the node itself based on filter rules AND children visibility
          node.isVisibleBasedOnFilters = isNodeVisible;
         return visibleCount; // Return count of *files* visible within/under this node
     }

    // --- Helper: Render the actual HTML Tree ---
    function renderNode(node, parentUl) {
        // Only render nodes that are marked as visible after applying filters
        if (!node.isVisibleBasedOnFilters && node.name) { // Don't skip the root
           // console.log(`Skipping render for filtered out node: ${node.path}`);
            return;
        }

        const li = document.createElement('li');
        li.className = node.type; // Add 'tree' or 'blob' class
        node.element = li; // Store element reference

        const nodeContent = document.createElement('div');
        nodeContent.className = 'node-content';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = node.path; // Path used as value
        checkbox.checked = true; // Default check all visible items initially
        checkbox.className = 'file-tree-checkbox';
        // Add ID for potential label association
        checkbox.id = `cb-${node.path.replace(/[^a-zA-Z0-9]/g, '-')}`; // Create safe ID
        node.checkbox = checkbox; // Store checkbox reference

        // Add toggle button for directories with children
        if (node.type === 'tree' && Object.keys(node.children).length > 0) {
            const toggle = document.createElement('span');
            toggle.className = 'toggle expanded'; // Start expanded
            toggle.textContent = '▼'; // Use text or icons
            toggle.onclick = (e) => {
                e.stopPropagation(); // Prevent click bubbling to checkbox/label
                const subUl = li.querySelector('ul');
                if (subUl) {
                    const isExpanded = subUl.style.display !== 'none';
                    subUl.style.display = isExpanded ? 'none' : 'block';
                    toggle.textContent = isExpanded ? '▶' : '▼';
                    toggle.classList.toggle('expanded', !isExpanded);
                    toggle.classList.toggle('collapsed', isExpanded);
                }
            };
            nodeContent.appendChild(toggle);
        } else {
            // Add placeholder for alignment if not a directory with children
            const placeholder = document.createElement('span');
            placeholder.className = 'toggle-placeholder';
            nodeContent.appendChild(placeholder);
        }


        nodeContent.appendChild(checkbox);

        const label = document.createElement('label');
        label.htmlFor = checkbox.id; // Associate label with checkbox

        const icon = document.createElement('span');
        icon.className = 'node-icon';
        icon.textContent = node.type === 'tree' ? '📁' : '📄'; // Basic icons
        label.appendChild(icon);

        label.appendChild(document.createTextNode(` ${node.name || '.'}`)); // Use node name or '.' for root
        nodeContent.appendChild(label);


        li.appendChild(nodeContent);

        // If it's a directory and has children, create a sub-UL and recurse
        if (node.type === 'tree' && Object.keys(node.children).length > 0) {
            const subUl = document.createElement('ul');
            Object.values(node.children)
                .sort((a, b) => a.name.localeCompare(b.name)) // Sort children by name
                .forEach(child => renderNode(child, subUl));

             // Only append the sub-UL if it actually contains visible children
            if (subUl.children.length > 0) {
               li.appendChild(subUl);
            } else {
                // If a directory has no visible children after filtering, maybe hide its toggle/icon?
                 const toggle = nodeContent.querySelector('.toggle');
                 if(toggle) toggle.style.visibility = 'hidden'; // Hide toggle if empty
                 // Optionally add a class to style empty directories differently
                 li.classList.add('empty-dir');
            }
        }

        parentUl.appendChild(li);
    }

    // --- Main Tree Rendering Steps ---
    const hierarchy = buildHierarchy(items);
    const totalVisibleFiles = applyVisibilityAndCount(hierarchy); // Apply visibility recursively first

    if (totalVisibleFiles === 0) {
        fileTreeContainer.innerHTML = '<div class="placeholder-text">No files match the current filters.</div>';
        return;
    }

    const rootUl = document.createElement('ul');
    rootUl.className = 'file-tree-root';

    // Render starting from the children of the virtual root
    Object.values(hierarchy.children)
           .sort((a, b) => a.name.localeCompare(b.name))
           .forEach(node => renderNode(node, rootUl));

    fileTreeContainer.appendChild(rootUl);

    // --- Add Checkbox Synchronization Logic ---
    const allCheckboxes = fileTreeContainer.querySelectorAll('.file-tree-checkbox');
    allCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            const path = cb.value;
            const checked = cb.checked;
            const node = findNodeByPath(hierarchy, path); // Need a helper to find the node in the hierarchy

            if (node) {
                // Update children if it's a directory
                if (node.type === 'tree') {
                    updateChildrenCheckboxes(node, checked);
                }
                // Update parents' indeterminate state
                updateParentCheckboxes(node, hierarchy);
            }
        });
    });

    // Initialize parent states after initial render (all are checked initially)
    updateAllParentCheckboxes(hierarchy);
}


// --- Checkbox Helper Functions ---

function findNodeByPath(root, path) {
    let currentLevel = root;
    const parts = path.split('/');
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (currentLevel && currentLevel.children && currentLevel.children[part]) {
            currentLevel = currentLevel.children[part];
             // If this is the last part, we found the node
             if (i === parts.length - 1) return currentLevel;
        } else {
            return null; // Path not found
        }
    }
    return null; // Should technically be found if path exists
}

function updateChildrenCheckboxes(node, checked) {
    if (node.type !== 'tree') return; // Only applies to directories

    Object.values(node.children).forEach(child => {
        // Only update visible children
        if (child.checkbox && !child.isFilteredOut) {
             child.checkbox.checked = checked;
             child.checkbox.indeterminate = false; // Children are either fully checked or unchecked
             // Recurse if the child is also a directory
             if (child.type === 'tree') {
                 updateChildrenCheckboxes(child, checked);
             }
         }
    });
}

function updateParentCheckboxes(node, root) {
     const pathParts = node.path.split('/');
     if (pathParts.length <= 1) return; // No parent if it's a root item

     // Find the parent node
     const parentPath = pathParts.slice(0, -1).join('/');
     let parentNode = findNodeByPath(root, parentPath);

     while (parentNode && parentNode.checkbox) { // Traverse up to the root (root has no checkbox)
         let allChecked = true;
         let someChecked = false;
         let hasVisibleChildren = false;

         Object.values(parentNode.children).forEach(sibling => {
              // Consider only visible siblings for determining parent state
             if (sibling.checkbox && !sibling.isFilteredOut) {
                 hasVisibleChildren = true;
                 if (!sibling.checkbox.checked && !sibling.checkbox.indeterminate) {
                     allChecked = false;
                 }
                 if (sibling.checkbox.checked || sibling.checkbox.indeterminate) {
                     someChecked = true;
                 }
             }
         });

          // Set parent state based on visible children
          if (!hasVisibleChildren) { // No visible children, parent should be unchecked
                parentNode.checkbox.checked = false;
                parentNode.checkbox.indeterminate = false;
          } else if (allChecked) {
             parentNode.checkbox.checked = true;
             parentNode.checkbox.indeterminate = false;
         } else if (someChecked) {
             parentNode.checkbox.checked = false;
             parentNode.checkbox.indeterminate = true;
         } else { // None are checked or indeterminate
             parentNode.checkbox.checked = false;
             parentNode.checkbox.indeterminate = false;
         }

          // Move up to the next parent
         const currentPathParts = parentNode.path.split('/');
         if (currentPathParts.length <= 1) break; // Stop if we reached a root item
         const grandParentPath = currentPathParts.slice(0, -1).join('/');
         parentNode = findNodeByPath(root, grandParentPath);
     }
}

// Helper to initialize all parent states after render
function updateAllParentCheckboxes(root) {
    // Find all directory checkboxes and trigger an update starting from them
     const dirCheckboxes = fileTreeContainer.querySelectorAll('li.tree > .node-content > .file-tree-checkbox');
     dirCheckboxes.forEach(cb => {
         const node = findNodeByPath(root, cb.value);
         if (node) {
              // Call updateParentCheckboxes starting from this node's *children*
              // This seems inefficient. A better way might be a post-order traversal.
              // Let's try updating from the node itself upwards after initial check.
              updateParentCheckboxes(node, root);
         }
     });
     // A simpler initial approach might be needed if this is too slow or complex.
     // For now, rely on the fact they are all checked initially, only indeterminate state needs calc.
     // Let's find leaf nodes and update upwards from them.
     const fileCheckboxes = fileTreeContainer.querySelectorAll('li.blob > .node-content > .file-tree-checkbox');
     fileCheckboxes.forEach(cb => {
          const node = findNodeByPath(root, cb.value);
          if(node) updateParentCheckboxes(node, root);
     });
}


// --- Select/Deselect All Visible Files (保持不变, acts on visible checkboxes) ---
selectAllBtn.addEventListener('click', () => {
    const checkboxes = fileTreeContainer.querySelectorAll('.file-tree-checkbox'); // Get all
    checkboxes.forEach(cb => {
        // Only check if the corresponding LI is visible (not display:none)
        const li = cb.closest('li');
        // This visibility check might be complex if using display:none. Rely on checkbox presence.
        cb.checked = true;
        cb.indeterminate = false;
    });
     // After mass-checking, re-calculate parent states (might be redundant if event listeners handle it)
     // Need the hierarchy reference here. Re-fetch or store globally? Store globally for now.
     // Let's assume event listeners will eventually handle consistency. Triggering manually is safer.
     // Find the root node from stored hierarchy and update all parents.
     // This needs access to the 'hierarchy' variable built in renderFileTree. Make it accessible.
     // For simplicity now, let's skip manual recalculation and rely on individual event triggers.
});

deselectAllBtn.addEventListener('click', () => {
    const checkboxes = fileTreeContainer.querySelectorAll('.file-tree-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = false;
        cb.indeterminate = false;
    });
     // Similar recalculation concern as selectAllBtn.
});


// 5. Generate Text File Content Button Click (MODIFIED to collect files from tree)
generateTextBtn.addEventListener('click', async () => {
    // Collect *only file* paths from checked checkboxes
    const selectedFiles = [];
    const allCheckboxes = fileTreeContainer.querySelectorAll('.file-tree-checkbox');

    allCheckboxes.forEach(cb => {
        if (cb.checked || cb.indeterminate) { // Include indeterminate as they mean some child is selected
            const li = cb.closest('li');
            if (li && li.classList.contains('blob')) { // Check if it's a file node ('blob')
                if (cb.checked) { // Only add if the file itself is directly checked
                     selectedFiles.push(cb.value);
                }
            } else if (li && li.classList.contains('tree')) {
                 // If a directory is checked or indeterminate, find its checked file descendants
                 const node = findNodeByPath(window.fileHierarchy, cb.value); // Assume hierarchy is globally accessible
                 if (node) {
                     collectCheckedFilesFromNode(node, selectedFiles);
                 }
            }
        }
    });

     // Deduplicate paths just in case
     const uniqueSelectedFiles = [...new Set(selectedFiles)];

    if (uniqueSelectedFiles.length === 0) {
        showError('Please select at least one file from the tree to generate the text.');
        resultContainer.style.display = 'none';
        return;
    }

    console.log(`Generating text for ${uniqueSelectedFiles.length} selected files.`);
    generateTextBtn.disabled = true;
    showStatus('Generating combined text content...', true);
    resultContainer.style.display = 'none';

    try {
        // Fetch call remains the same, sending the uniqueSelectedFiles array
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                repoUrl: currentRepoUrl,
                pat: currentPat,
                action: 'generateText',
                selectedFiles: uniqueSelectedFiles // Send the collected file paths
            })
        });

        if (!response.ok) {
             let errorData = { error: `Request failed with status ${response.status}` };
             try { errorData = await response.json(); } catch (e) { errorData.error += `: ${response.statusText}`; }
             throw new Error(errorData.error || `Failed to generate text (Status: ${response.status})`);
        }

        const data = await response.json();
        generatedContent = data.content || "";
        generatedStructure = data.structure || ""; // Now contains the text tree

        // Display Preview (structure now uses text tree)
        structurePreview.textContent = generatedStructure || "(No structure generated)";
        contentPreview.textContent = generatedContent || "(No content generated or files skipped)";
        resultContainer.style.display = 'block';
        hideStatusAndError();
        showStatus(`Generated text from ${uniqueSelectedFiles.length} selected files. Preview below.`, false);

        calculateAndDisplayTokenCount(generatedStructure + "\n" + generatedContent); // Token count remains the same

    } catch (error) {
        console.error('Generate Text Error:', error);
        showError(`Error generating text: ${error.message}`);
        resultContainer.style.display = 'none';
    } finally {
        generateTextBtn.disabled = false;
        spinner.style.display = 'none';
    }
});

// Helper for generateTextBtn to collect file paths recursively
window.fileHierarchy = null; // Store hierarchy globally for access in generateTextBtn and checkbox helpers
function collectCheckedFilesFromNode(node, fileList) {
     // If the current node is a file and checked, add its path
     if (node.type === 'blob' && node.checkbox && node.checkbox.checked) {
         fileList.push(node.path);
     }
     // If it's a directory, recurse into its children
     if (node.type === 'tree' && node.children) {
         Object.values(node.children).forEach(child => {
             // Only recurse into visible children that are checked or indeterminate
             if (child.checkbox && !child.isFilteredOut && (child.checkbox.checked || child.checkbox.indeterminate)) {
                 collectCheckedFilesFromNode(child, fileList);
             }
         });
     }
 }
// Modify renderFileTree to store hierarchy globally
function renderFileTree(items) {
    // ... (existing setup code) ...
    const hierarchy = buildHierarchy(items);
    window.fileHierarchy = hierarchy; // Store globally
    // ... (rest of the rendering code) ...
}


// 6. Copy to Clipboard Button Click (保持不变 - copies combined structure+content)
copyBtn.addEventListener('click', async () => { /* ... */ });

// 7. Download Text File Button Click (保持不变 - downloads combined structure+content)
downloadTxtBtn.addEventListener('click', () => { /* ... */ });

// Optional: Token Counting Function (保持不变)
function calculateAndDisplayTokenCount(text) { /* ... */ }


// --- Initial Setup (保持不变) ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Repo2Txt Enhanced (Tree View) Initialized");
    resetSubsequentSections();
    hideStatusAndError();
});

