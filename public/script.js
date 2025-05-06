// script.js
// THIS IS THE COMPLETE CODE FOR THIS FILE - NO OMISSIONS - FIXED ReferenceErrors

// --- DOM Elements (VERIFIED COMPLETE LIST) ---
const repoForm = document.getElementById('repoForm');
const repoUrlInput = document.getElementById('repoUrl'); // Added missing declaration
const patInput = document.getElementById('patInput');
const fetchStructureBtn = document.getElementById('fetchStructureBtn');

const statusArea = document.getElementById('statusArea');
const statusText = document.getElementById('statusText');
const spinner = document.getElementById('spinner');
const errorMessage = document.getElementById('errorMessage');

const filterArea = document.getElementById('filterArea');
const extensionFiltersContainer = document.getElementById('extensionFilters'); // Added missing declaration
const fileTreeContainer = document.getElementById('fileTreeContainer');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');

const generationArea = document.getElementById('generationArea');
const generateTextBtn = document.getElementById('generateTextBtn');
const tokenCountArea = document.getElementById('tokenCountArea'); // Optional token count display

const resultContainer = document.getElementById('resultContainer');
const structurePreview = document.getElementById('structurePreview');
const contentPreview = document.getElementById('contentPreview');
const outputActions = document.getElementById('outputActions');
const copyBtn = document.getElementById('copyBtn');
const downloadTxtBtn = document.getElementById('downloadTxtBtn');


// --- Global State ---
let currentRepoUrl = null;
let currentPat = null;
let fileTreeData = []; // Stores the raw list including { type: 'tree'/'blob', path: '...' }
let window.fileHierarchy = null; // Stores the built hierarchy object globally
let availableExtensions = new Set(); // All extensions/types found in fetched files
let activeFilters = new Set(); // Currently selected filters
let generatedContent = ""; // Store combined content for copy/download
let generatedStructure = ""; // Store text tree structure for copy/download

// --- Constants ---
const API_ENDPOINT = '/api/generate'; // Cloudflare Pages Function endpoint

// Define allowed extensions/filenames here primarily for frontend filtering logic.
const ALLOWED_EXTENSIONS_FRONTEND = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.less', '.html', '.htm',
    '.xml', '.yaml', '.yml', '.md', '.markdown', '.txt', '.py', '.java', '.c', '.cpp',
    '.h', '.hpp', '.cs', '.go', '.php', '.rb', '.swift', '.kt', '.kts', '.sh', '.bash',
    '.zsh', '.sql', '.dockerfile', 'dockerfile', '.env', '.gitignore', '.gitattributes',
    '.toml', '.ini', '.cfg', '.conf', '.properties', '.gradle', '.lua', '.rs',
]);

// --- Utility Functions ---

function showStatus(message, showSpinner = false) {
    errorMessage.style.display = 'none';
    statusArea.style.display = 'block';
    statusText.textContent = message;
    spinner.style.display = showSpinner ? 'inline-block' : 'none';
}

function showError(message) {
    statusArea.style.display = 'none';
    errorMessage.textContent = `Error: ${message}`;
    errorMessage.style.display = 'block';
    // Hide subsequent sections on error
    filterArea.style.display = 'none';
    generationArea.style.display = 'none';
    resultContainer.style.display = 'none';
}

function hideStatusAndError() {
     statusArea.style.display = 'none';
     errorMessage.style.display = 'none';
}

// Resets the UI for a new request or after an error
function resetSubsequentSections() {
    filterArea.style.display = 'none';
    generationArea.style.display = 'none';
    resultContainer.style.display = 'none';
    // Update placeholder text for the tree
    fileTreeContainer.innerHTML = '<div class="placeholder-text">Enter URL and fetch structure to see the file tree.</div>';
    // Ensure extensionFiltersContainer exists before trying to set innerHTML
    if (extensionFiltersContainer) {
         extensionFiltersContainer.innerHTML = '<span class="placeholder-text">Filters appear after fetching.</span>';
    }
    structurePreview.textContent = '(Structure will appear here)';
    contentPreview.textContent = '(Content will appear here)';
    fileTreeData = [];
    window.fileHierarchy = null; // Reset hierarchy
    availableExtensions = new Set();
    activeFilters = new Set();
    generatedContent = "";
    generatedStructure = "";
    tokenCountArea.textContent = ''; // Clear token count
}


// --- Core Logic ---

// 1. Fetch Directory Structure Button Click
fetchStructureBtn.addEventListener('click', async () => {
    // Check if repoUrlInput exists before accessing its value
    if (!repoUrlInput) {
        console.error("repoUrlInput element not found!");
        showError("Initialization error: Cannot find URL input field.");
        return;
    }
    const repoUrl = repoUrlInput.value.trim();
    const pat = patInput ? patInput.value.trim() : null; // Handle case where patInput might be missing

    if (!repoUrl) {
        showError('Please enter a GitHub repository URL.');
        return;
    }
    if (!repoUrl.toLowerCase().includes('github.com/')) {
         showError('Please enter a valid GitHub repository URL (e.g., https://github.com/owner/repo).');
         return;
    }

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
            body: JSON.stringify({
                repoUrl: currentRepoUrl,
                pat: currentPat,
                action: 'getTree'
            })
        });

        if (!response.ok) {
             let errorData = { error: `Request failed with status ${response.status}` };
             try { errorData = await response.json(); } catch (e) { errorData.error += `: ${response.statusText}`; }
             throw new Error(errorData.error || `Failed to fetch structure (Status: ${response.status})`);
        }

        const data = await response.json();
        fileTreeData = data.tree || [];
        console.log(`Received ${fileTreeData.length} items (files+dirs) from backend. Truncated: ${data.truncated}`);

        const fileCount = fileTreeData.filter(i => i.type === 'blob').length;
        const dirCount = fileTreeData.filter(i => i.type === 'tree').length;
        let statusMsg = `Fetched structure. Found ${fileCount} processable files and ${dirCount} directories.`;
        if (data.truncated) statusMsg += ' (Warning: List may be incomplete due to large repository size)';
        if (fileTreeData.length === 0 && !data.truncated) statusMsg = 'Fetched structure, but no files or directories found matching filters.';
        showStatus(statusMsg, false);


        if (fileTreeData.length > 0) {
            // Pass only blobs to populateExtensionFilters
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

// 2. Populate Extension Filters
function populateExtensionFilters(files) { // Expects only blobs
    if (!extensionFiltersContainer) {
        console.error("extensionFiltersContainer not found, cannot populate filters.");
        return;
    }
    availableExtensions.clear();
    files.forEach(file => {
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
        checkbox.addEventListener('change', handleFilterChange);
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${extOrType}`));
        extensionFiltersContainer.appendChild(label);
    });
}


// 3. Handle Filter Checkbox Change
function handleFilterChange() {
    activeFilters.clear();
    if (!extensionFiltersContainer) return; // Safety check
    const checkboxes = extensionFiltersContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        if (cb.checked) {
            activeFilters.add(cb.value);
        }
    });
    // Re-render the entire file tree based on the new active filters for files
    renderFileTree(fileTreeData); // Re-render with original full data
}


// 4. Render File Tree (Hierarchical structure)
function renderFileTree(items) {
    if (!fileTreeContainer) {
        console.error("fileTreeContainer not found, cannot render tree.");
        return;
    }
    fileTreeContainer.innerHTML = ''; // Clear previous tree

    // --- Helper: Build Nested Structure ---
    function buildHierarchy(itemList) {
        const hierarchy = { name: 'root', path: '', type: 'tree', children: {}, isVisibleBasedOnFilters: true }; // Root node

        // Sort items by path depth first, then alphabetically for consistent parent creation
        itemList.sort((a, b) => {
             const depthA = a.path.split('/').length;
             const depthB = b.path.split('/').length;
             if (depthA !== depthB) {
                 return depthA - depthB;
             }
             return a.path.localeCompare(b.path);
         })
        .forEach(item => {
            let currentLevel = hierarchy;
            const pathParts = item.path.split('/');

            pathParts.forEach((part, index) => {
                const currentPath = pathParts.slice(0, index + 1).join('/');
                const isLastPart = index === pathParts.length - 1;

                if (!currentLevel.children[part]) {
                     // Create node if it doesn't exist
                     currentLevel.children[part] = {
                         name: part,
                         path: currentPath, // Full path to this node
                         type: isLastPart ? item.type : 'tree', // Assume 'tree' unless it's the last part matching the item
                         children: {},
                         element: null, // Will hold the LI element
                         checkbox: null, // Will hold the checkbox element
                         isVisibleBasedOnFilters: false, // Default to not visible until checked
                         originalItem: isLastPart ? item : null // Store original item only for the actual node
                     };
                 } else if (isLastPart) {
                     // If node exists and this is the last part, update its type and originalItem
                     currentLevel.children[part].type = item.type;
                     currentLevel.children[part].originalItem = item;
                 }

                 // Move down the hierarchy for the next part
                 currentLevel = currentLevel.children[part];
            });
        });
        return hierarchy; // Return the root
    }

     // --- Helper: Should Item Be Visible Based on Filters? ---
     function isDirectlyVisible(item) { // Checks if this specific item matches filters
         if (item.type === 'blob') {
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
         // Directories are not directly visible based on *file* filters
         return false;
     }

     // --- Helper: Recursively Apply Visibility (Post-order traversal) ---
     function applyVisibility(node) {
         if (node.type === 'blob') {
             node.isVisibleBasedOnFilters = isDirectlyVisible(node);
             return node.isVisibleBasedOnFilters;
         } else { // It's a directory ('tree' or the root)
             let hasVisibleChild = false;
             Object.values(node.children).forEach(child => {
                 if (applyVisibility(child)) { // Recurse first
                     hasVisibleChild = true;
                 }
             });
             // A directory is visible if it contains any visible children
             node.isVisibleBasedOnFilters = hasVisibleChild;
             return hasVisibleChild;
         }
     }

    // --- Helper: Render the actual HTML Tree ---
    function renderNode(node, parentUl, isRootLevel = false) {
        if (!node.isVisibleBasedOnFilters && !isRootLevel) { // Only render visible nodes (skip root check)
            return;
        }

        const li = document.createElement('li');
        li.className = node.type; // Add 'tree' or 'blob' class
        if (!node.isVisibleBasedOnFilters && node.type === 'tree') {
             li.classList.add('filtered-out-dir'); // Optional: style directories differently if they only contain filtered items
        }
        node.element = li; // Store element reference

        const nodeContent = document.createElement('div');
        nodeContent.className = 'node-content';

        // Add toggle button for directories with children
        const hasRenderableChildren = Object.values(node.children).some(child => child.isVisibleBasedOnFilters);
        if (node.type === 'tree' && Object.keys(node.children).length > 0) {
            const toggle = document.createElement('span');
            toggle.className = 'toggle expanded'; // Start expanded
            toggle.textContent = '▼';
             // Only make toggle clickable if there are visible children to show/hide
            if (hasRenderableChildren) {
                 toggle.onclick = (e) => {
                    e.stopPropagation();
                    const subUl = li.querySelector(':scope > ul'); // Select direct child UL
                    if (subUl) {
                        const isExpanded = subUl.style.display !== 'none';
                        subUl.style.display = isExpanded ? 'none' : 'block';
                        toggle.textContent = isExpanded ? '▶' : '▼';
                        toggle.classList.toggle('expanded', !isExpanded);
                        toggle.classList.toggle('collapsed', isExpanded);
                    }
                 };
             } else {
                 toggle.classList.add('empty'); // Mark as empty for styling
                 toggle.textContent = ' '; // Can use empty or a different symbol
             }
            nodeContent.appendChild(toggle);
        } else {
            // Add placeholder for alignment if not a directory or is empty blob
            const placeholder = document.createElement('span');
            placeholder.className = 'toggle-placeholder';
            nodeContent.appendChild(placeholder);
        }

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = node.path; // Path used as value
        checkbox.checked = node.type === 'blob' ? node.isVisibleBasedOnFilters : false; // Check files if visible, default dirs unchecked
        checkbox.className = 'file-tree-checkbox';
        checkbox.id = `cb-${node.path.replace(/[^a-zA-Z0-9_-]/g, '-')}`; // Create safe ID
        // Disable checkbox for directories that have no visible children? Maybe not, allow selecting structure.
        // checkbox.disabled = node.type === 'tree' && !hasRenderableChildren;
        node.checkbox = checkbox; // Store checkbox reference
        nodeContent.appendChild(checkbox);

        const label = document.createElement('label');
        label.htmlFor = checkbox.id;

        const icon = document.createElement('span');
        icon.className = 'node-icon';
        icon.textContent = node.type === 'tree' ? '📁' : '📄'; // Basic icons
        label.appendChild(icon);

        label.appendChild(document.createTextNode(` ${node.name || '.'}`));
        nodeContent.appendChild(label);

        li.appendChild(nodeContent);

        // If it's a directory and has potentially visible children, create a sub-UL and recurse
        if (node.type === 'tree' && Object.keys(node.children).length > 0) {
            const subUl = document.createElement('ul');
            Object.values(node.children)
                .sort((a, b) => {
                     // Sort directories first, then files, then alphabetically
                     if (a.type !== b.type) { return a.type === 'tree' ? -1 : 1; }
                     return a.name.localeCompare(b.name);
                 })
                .forEach(child => renderNode(child, subUl)); // Recurse

            // Only append the sub-UL if it actually contains list items (rendered nodes)
            if (subUl.children.length > 0) {
               li.appendChild(subUl);
            } else if (li.classList.contains('filtered-out-dir')) {
                // Optional: Maybe hide the LI completely if dir has no renderable children AND was filtered out itself
                // li.style.display = 'none';
            }
        }

        parentUl.appendChild(li);
    }

    // --- Main Tree Rendering Steps ---
    const hierarchy = buildHierarchy(items);
    window.fileHierarchy = hierarchy; // Store globally AFTER building
    applyVisibility(hierarchy); // Apply visibility recursively

    const rootUl = document.createElement('ul');
    rootUl.className = 'file-tree-root';

    // Check if root has any visible children before rendering
    const rootHasVisibleContent = Object.values(hierarchy.children).some(child => child.isVisibleBasedOnFilters);

    if (!rootHasVisibleContent && items.length > 0) { // Items exist, but none match filter
         fileTreeContainer.innerHTML = '<div class="placeholder-text">No files match the current filters.</div>';
         return;
    } else if (items.length === 0) { // No items fetched at all
         fileTreeContainer.innerHTML = '<div class="placeholder-text">No files or directories found in the repository.</div>';
         return;
    }


    // Render starting from the children of the virtual root
    Object.values(hierarchy.children)
           .sort((a, b) => {
             if (a.type !== b.type) { return a.type === 'tree' ? -1 : 1; }
             return a.name.localeCompare(b.name);
            })
           .forEach(node => renderNode(node, rootUl, true)); // Pass true for root level

    fileTreeContainer.appendChild(rootUl);

    // --- Add Checkbox Synchronization Logic ---
    const allCheckboxes = fileTreeContainer.querySelectorAll('.file-tree-checkbox');
    allCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            const node = findNodeByPath(window.fileHierarchy, cb.value);
            if (node) {
                updateCheckStatus(node, cb.checked);
            }
        });
    });

    // Initialize parent states after initial render
    initializeCheckboxStates(window.fileHierarchy);
}


// --- Checkbox Helper Functions ---

function findNodeByPath(root, path) {
    if (!root || !path) return null;
    let currentLevel = root;
    const parts = path.split('/');
    for (const part of parts) {
        if (currentLevel && currentLevel.children && currentLevel.children[part]) {
            currentLevel = currentLevel.children[part];
        } else {
            return null; // Path segment not found
        }
    }
    return currentLevel; // Node found
}


// Update checkbox states downwards and upwards
function updateCheckStatus(node, checked) {
    if (!node || !node.checkbox || node.checkbox.disabled) return; // Ignore if no node/checkbox or disabled

    // Update self (if not already correct)
    node.checkbox.checked = checked;
    node.checkbox.indeterminate = false;

    // Update children recursively (if directory)
    if (node.type === 'tree') {
        Object.values(node.children).forEach(child => {
             // Only update children that are visible based on filters
             if (child.isVisibleBasedOnFilters) {
                  updateCheckStatus(child, checked);
             }
        });
    }

    // Update parents recursively
    updateParentCheckbox(node);
}

// Update a single parent's state based on its children
function updateParentCheckbox(node) {
    const pathParts = node.path.split('/');
    if (pathParts.length <= 1) return; // Root item, no parent

    const parentPath = pathParts.slice(0, -1).join('/');
    const parentNode = findNodeByPath(window.fileHierarchy, parentPath);

    if (!parentNode || !parentNode.checkbox || parentNode.checkbox.disabled) return; // No parent node or checkbox

    let allChildrenChecked = true;
    let someChildrenChecked = false;
    let hasVisibleChildren = false;

    Object.values(parentNode.children).forEach(child => {
         // Consider only visible children
         if (child.isVisibleBasedOnFilters && child.checkbox) {
             hasVisibleChildren = true;
             if (!child.checkbox.checked && !child.checkbox.indeterminate) {
                 allChildrenChecked = false;
             }
             if (child.checkbox.checked || child.checkbox.indeterminate) {
                 someChildrenChecked = true;
             }
         }
    });

     // Determine parent state
     if (!hasVisibleChildren) { // Should not happen if parent is rendered, but safety check
        parentNode.checkbox.checked = false;
        parentNode.checkbox.indeterminate = false;
     } else if (allChildrenChecked) {
        parentNode.checkbox.checked = true;
        parentNode.checkbox.indeterminate = false;
    } else if (someChildrenChecked) {
        parentNode.checkbox.checked = false; // Uncheck parent...
        parentNode.checkbox.indeterminate = true; // ...but mark as indeterminate
    } else { // No children checked or indeterminate
        parentNode.checkbox.checked = false;
        parentNode.checkbox.indeterminate = false;
    }

    // Recurse up to the next parent
    updateParentCheckbox(parentNode);
}

// Initialize checkbox states after rendering (needed for indeterminate dirs)
function initializeCheckboxStates(node) {
    if (!node) return;
    let allChecked = true;
    let someChecked = false;
    let hasVisibleChildren = false;

    // Recurse to children first (post-order)
    if (node.type === 'tree') {
        Object.values(node.children).forEach(child => {
             if(child.isVisibleBasedOnFilters) {
                 hasVisibleChildren = true;
                 initializeCheckboxStates(child); // Recurse first
                 // After child is initialized, check its state
                 if (child.checkbox) {
                     if (!child.checkbox.checked && !child.checkbox.indeterminate) {
                         allChecked = false;
                     }
                     if (child.checkbox.checked || child.checkbox.indeterminate) {
                         someChecked = true;
                     }
                 } else {
                      allChecked = false; // If a visible child has no checkbox, parent can't be fully checked
                 }
             }
        });
    }

    // Now update the current node's checkbox based on children states
    if (node.type === 'tree' && node.checkbox && !node.checkbox.disabled) {
         if (!hasVisibleChildren) { // No visible children
             node.checkbox.checked = false;
             node.checkbox.indeterminate = false;
             // Optionally disable checkbox if dir is empty after filtering
             // node.checkbox.disabled = true;
         } else if (allChecked) {
            node.checkbox.checked = true;
            node.checkbox.indeterminate = false;
        } else if (someChecked) {
            node.checkbox.checked = false;
            node.checkbox.indeterminate = true;
        } else {
            node.checkbox.checked = false;
            node.checkbox.indeterminate = false;
        }
    }
     // Base case: file checkboxes are already set correctly during render based on isVisibleBasedOnFilters
}


// --- Select/Deselect All Visible Files ---
selectAllBtn.addEventListener('click', () => {
    if (!window.fileHierarchy) return;
    // Iterate through hierarchy instead of querying DOM for better logic control
    function setCheckRecursively(node, checked) {
        if (!node.isVisibleBasedOnFilters || !node.checkbox || node.checkbox.disabled) return;
        node.checkbox.checked = checked;
        node.checkbox.indeterminate = false;
        if (node.type === 'tree') {
            Object.values(node.children).forEach(child => setCheckRecursively(child, checked));
        }
    }
    Object.values(window.fileHierarchy.children).forEach(rootChild => setCheckRecursively(rootChild, true));
});

deselectAllBtn.addEventListener('click', () => {
    if (!window.fileHierarchy) return;
     function setCheckRecursively(node, checked) {
         if (!node.isVisibleBasedOnFilters || !node.checkbox || node.checkbox.disabled) return;
         node.checkbox.checked = checked;
         node.checkbox.indeterminate = false;
         if (node.type === 'tree') {
             Object.values(node.children).forEach(child => setCheckRecursively(child, checked));
         }
     }
    Object.values(window.fileHierarchy.children).forEach(rootChild => setCheckRecursively(rootChild, false));
});


// 5. Generate Text File Content Button Click
generateTextBtn.addEventListener('click', async () => {
    const selectedFiles = [];
    if (!window.fileHierarchy) {
        showError("File tree data is not available.");
        return;
    }

    // Helper to collect checked files from the hierarchy
    function collectCheckedFiles(node) {
        if (!node.isVisibleBasedOnFilters) return; // Skip non-visible branches/files

        if (node.type === 'blob' && node.checkbox && node.checkbox.checked) {
            selectedFiles.push(node.path);
        } else if (node.type === 'tree' && node.children) {
             // Recurse only if directory is checked or indeterminate
             if(node.checkbox && (node.checkbox.checked || node.checkbox.indeterminate)) {
                Object.values(node.children).forEach(collectCheckedFiles);
             }
        }
    }

    // Start collection from root's children
    Object.values(window.fileHierarchy.children).forEach(collectCheckedFiles);

    // Deduplicate just in case (shouldn't be necessary with correct logic, but safe)
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
        // Fetch call remains the same
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

        // Display Preview
        structurePreview.textContent = generatedStructure || "(No structure generated)";
        contentPreview.textContent = generatedContent || "(No content generated or files skipped)";
        resultContainer.style.display = 'block';
        hideStatusAndError();
        showStatus(`Generated text from ${uniqueSelectedFiles.length} selected files. Preview below.`, false);

        calculateAndDisplayTokenCount(generatedStructure + "\n" + generatedContent);

    } catch (error) {
        console.error('Generate Text Error:', error);
        showError(`Error generating text: ${error.message}`);
        resultContainer.style.display = 'none';
    } finally {
        generateTextBtn.disabled = false;
        spinner.style.display = 'none';
    }
});

// 6. Copy to Clipboard Button Click
copyBtn.addEventListener('click', async () => {
    const fullContentToCopy = `${generatedStructure}\n${generatedContent}`;
    if (!fullContentToCopy || fullContentToCopy.trim() === "\n") { // Check if effectively empty
        showError("Nothing to copy.");
        return;
    }
    if (!navigator.clipboard) {
        showError('Clipboard API not available in this browser (requires HTTPS).');
        return;
    }
    try {
        await navigator.clipboard.writeText(fullContentToCopy);
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="gg-copy"></i> Copied!';
        copyBtn.style.backgroundColor = '#28a745';
        setTimeout(() => {
            copyBtn.innerHTML = originalText;
            copyBtn.style.backgroundColor = '';
        }, 2000);
    } catch (err) {
        console.error('Failed to copy text: ', err);
        showError('Failed to copy text to clipboard. Check browser permissions.');
    }
});

// 7. Download Text File Button Click
downloadTxtBtn.addEventListener('click', () => {
    const fullContentToDownload = `${generatedStructure}\n${generatedContent}`;
    if (!fullContentToDownload || fullContentToDownload.trim() === "\n") {
        showError("No content generated to download.");
        return;
    }

    const blob = new Blob([fullContentToDownload], { type: 'text/plain;charset=utf-8' });
    const downloadUrl = URL.createObjectURL(blob);
    let filename = "repository_content.txt";
    if (currentRepoUrl) {
        try {
            const url = new URL(currentRepoUrl);
            const pathParts = url.pathname.split('/').filter(Boolean);
            if (pathParts.length >= 2) {
                 const owner = pathParts[0];
                 const repoName = pathParts[1];
                 let branch = 'main';
                 if (pathParts.length >= 4 && pathParts[2] === 'tree') { branch = pathParts[3]; }
                 const safeRepoName = repoName.replace(/[^a-z0-9_-]/gi, '_');
                 const safeBranch = branch.replace(/[^a-z0-9_-]/gi, '_');
                 filename = `${safeRepoName}_${safeBranch}_content.txt`;
            }
        } catch (e) { console.warn("Could not generate dynamic filename, using default.", e); }
    }

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);

    const originalText = downloadTxtBtn.innerHTML;
    downloadTxtBtn.innerHTML = '<i class="gg-software-download"></i> Downloaded!';
    setTimeout(() => { downloadTxtBtn.innerHTML = originalText; }, 2000);
});


// Optional: Token Counting Function (Requires gpt-3-tokenizer library)
function calculateAndDisplayTokenCount(text) {
     // Check if the tokenizer library is loaded (assuming it's loaded globally)
     // Example using hypothetical 'GPT3Tokenizer' class
     if (typeof GPT3Tokenizer !== 'undefined') {
         try {
            const tokenizer = new GPT3Tokenizer({ type: 'gpt3' }); // or 'codex'
            const encoded = tokenizer.encode(text);
            tokenCountArea.textContent = `Approx. Token Count: ${encoded.bpe.length}`;
            tokenCountArea.style.display = 'inline';
         } catch (e) {
              console.error("Token calculation failed:", e);
              tokenCountArea.textContent = '';
              tokenCountArea.style.display = 'none';
         }
     } else {
         tokenCountArea.textContent = '';
         tokenCountArea.style.display = 'none';
         // console.log("GPT3Tokenizer library not found. Skipping token count.");
     }
}


// --- Initial Setup ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Repo2Txt Enhanced (Tree View - Fixed) Initialized");
    // Perform initial reset only if elements are found
    if(repoForm && fileTreeContainer && extensionFiltersContainer) {
        resetSubsequentSections();
        hideStatusAndError();
    } else {
         console.error("Initial setup failed: Essential DOM elements not found.");
         // Optionally display a critical error to the user on the page itself
         document.body.innerHTML = '<p style="color: red; font-weight: bold;">Error: Application failed to initialize. Essential page elements are missing.</p>';
    }
});
// END OF script.js
