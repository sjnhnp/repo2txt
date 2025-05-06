// script.js

// --- DOM Elements (VERIFIED COMPLETE LIST) ---
const repoForm = document.getElementById('repoForm');
const repoUrlInput = document.getElementById('repoUrl');
const patInput = document.getElementById('patInput');
const fetchStructureBtn = document.getElementById('fetchStructureBtn');

const statusArea = document.getElementById('statusArea');
const statusText = document.getElementById('statusText');
const spinner = document.getElementById('spinner');
const errorMessage = document.getElementById('errorMessage');

const filterArea = document.getElementById('filterArea');
const extensionFiltersContainer = document.getElementById('extensionFilters');
const fileTreeContainer = document.getElementById('fileTreeContainer');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');

const generationArea = document.getElementById('generationArea');
const generateTextBtn = document.getElementById('generateTextBtn');
const tokenCountArea = document.getElementById('tokenCountArea');

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
let fileHierarchy = null; // CORRECTED: Stores the built hierarchy object globally (Removed 'window.')
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
    if (fileTreeContainer) { // Check if element exists before accessing
        fileTreeContainer.innerHTML = '<div class="placeholder-text">Enter URL and fetch structure to see the file tree.</div>';
    }
    // Ensure extensionFiltersContainer exists before trying to set innerHTML
    if (extensionFiltersContainer) {
         extensionFiltersContainer.innerHTML = '<span class="placeholder-text">Filters appear after fetching.</span>';
    }
    if (structurePreview) structurePreview.textContent = '(Structure will appear here)';
    if (contentPreview) contentPreview.textContent = '(Content will appear here)';

    fileTreeData = [];
    fileHierarchy = null; // Reset hierarchy
    availableExtensions = new Set();
    activeFilters = new Set();
    generatedContent = "";
    generatedStructure = "";
    if (tokenCountArea) tokenCountArea.textContent = ''; // Clear token count
}

// --- File Tree Helper Functions (提取自renderFileTree) ---

// 构建文件层次结构
function buildHierarchy(itemList) {
    const hierarchy = { 
        name: 'root', 
        path: '', 
        type: 'tree', 
        children: {}, 
        isVisibleBasedOnFilters: true 
    }; // Root node

    itemList.sort((a, b) => {
        const depthA = a.path.split('/').length;
        const depthB = b.path.split('/').length;
        if (depthA !== depthB) { return depthA - depthB; }
        return a.path.localeCompare(b.path);
    })
    .forEach(item => {
        let currentLevel = hierarchy;
        const pathParts = item.path.split('/');

        pathParts.forEach((part, index) => {
            const currentPath = pathParts.slice(0, index + 1).join('/');
            const isLastPart = index === pathParts.length - 1;

            if (!currentLevel.children[part]) {
                currentLevel.children[part] = {
                    name: part, path: currentPath,
                    type: isLastPart ? item.type : 'tree',
                    children: {}, element: null, checkbox: null,
                    isVisibleBasedOnFilters: false,
                    originalItem: isLastPart ? item : null
                };
            } else if (isLastPart) {
                currentLevel.children[part].type = item.type;
                currentLevel.children[part].originalItem = item;
            }
            currentLevel = currentLevel.children[part];
        });
    });
    return hierarchy;
}

// 检查文件是否应该基于筛选条件显示
function isDirectlyVisible(item) {
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
    return false;
}

// 递归应用可见性标记
function applyVisibility(node) {
    if (node.type === 'blob') {
        node.isVisibleBasedOnFilters = isDirectlyVisible(node);
        return node.isVisibleBasedOnFilters;
    } else { // Directory or root
        let hasVisibleChild = false;
        Object.values(node.children).forEach(child => {
            if (applyVisibility(child)) { // Recurse first
                hasVisibleChild = true;
            }
        });
        node.isVisibleBasedOnFilters = hasVisibleChild;
        return hasVisibleChild;
    }
}

// 渲染单个节点
function renderNode(node, parentUl, isRootLevel = false) {
    if (!node.isVisibleBasedOnFilters && !isRootLevel) { return; }

    const li = document.createElement('li');
    li.className = node.type;
    if (!node.isVisibleBasedOnFilters && node.type === 'tree') {
        li.classList.add('filtered-out-dir');
    }
    node.element = li;

    const nodeContent = document.createElement('div');
    nodeContent.className = 'node-content';

    const hasRenderableChildren = Object.values(node.children).some(child => child.isVisibleBasedOnFilters);
    if (node.type === 'tree' && Object.keys(node.children).length > 0) {
        const toggle = document.createElement('span');
        toggle.className = 'toggle expanded';
        toggle.textContent = '▼';
        if (hasRenderableChildren) {
            toggle.onclick = (e) => {
                e.stopPropagation();
                const subUl = li.querySelector(':scope > ul');
                if (subUl) {
                    const isExpanded = subUl.style.display !== 'none';
                    subUl.style.display = isExpanded ? 'none' : 'block';
                    toggle.textContent = isExpanded ? '▶' : '▼';
                    toggle.classList.toggle('expanded', !isExpanded);
                    toggle.classList.toggle('collapsed', isExpanded);
                }
            };
        } else {
            toggle.classList.add('empty');
            toggle.textContent = ' ';
        }
        nodeContent.appendChild(toggle);
    } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'toggle-placeholder';
        nodeContent.appendChild(placeholder);
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = node.path;
    // Check files if they are visible, leave directories unchecked initially
    checkbox.checked = node.type === 'blob' && node.isVisibleBasedOnFilters;
    checkbox.className = 'file-tree-checkbox';
    checkbox.id = `cb-${node.path.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    node.checkbox = checkbox;
    nodeContent.appendChild(checkbox);

    const label = document.createElement('label');
    label.htmlFor = checkbox.id;

    const icon = document.createElement('span');
    icon.className = 'node-icon';
    icon.textContent = node.type === 'tree' ? '📁' : '📄';
    label.appendChild(icon);

    label.appendChild(document.createTextNode(` ${node.name || '.'}`));
    nodeContent.appendChild(label);

    li.appendChild(nodeContent);

    if (node.type === 'tree' && Object.keys(node.children).length > 0) {
        const subUl = document.createElement('ul');
        Object.values(node.children)
            .sort((a, b) => {
                if (a.type !== b.type) { return a.type === 'tree' ? -1 : 1; }
                return a.name.localeCompare(b.name);
            })
            .forEach(child => renderNode(child, subUl));

        if (subUl.children.length > 0) {
            li.appendChild(subUl);
            // Ensure subUl is visible initially if toggle is expanded
            subUl.style.display = 'block';
        }
    }
    parentUl.appendChild(li);
}

// 根据路径查找节点
function findNodeByPath(root, path) {
    if (!root || !path) return null;
    let currentLevel = root;
    const parts = path.split('/');
    for (const part of parts) {
        if (currentLevel && currentLevel.children && currentLevel.children[part]) {
            currentLevel = currentLevel.children[part];
        } else {
            return null;
        }
    }
    return currentLevel;
}

// 更新复选框状态（向下和向上）
function updateCheckStatus(node, checked) {
    if (!node || !node.checkbox || node.checkbox.disabled) return;

    node.checkbox.checked = checked;
    node.checkbox.indeterminate = false;

    if (node.type === 'tree') {
        Object.values(node.children).forEach(child => {
            if (child.isVisibleBasedOnFilters) { // Only update visible children
                updateCheckStatus(child, checked);
            }
        });
    }
    updateParentCheckbox(node);
}

// 根据子节点更新父节点复选框状态
function updateParentCheckbox(node) {
    const pathParts = node.path.split('/');
    if (pathParts.length <= 1) return; // Root item, no parent

    const parentPath = pathParts.slice(0, -1).join('/');
    const parentNode = findNodeByPath(fileHierarchy, parentPath);

    if (!parentNode || !parentNode.checkbox || parentNode.checkbox.disabled) return;

    let allChildrenChecked = true;
    let someChildrenChecked = false;
    let hasVisibleChildren = false;

    Object.values(parentNode.children).forEach(child => {
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

    if (!hasVisibleChildren) {
        parentNode.checkbox.checked = false;
        parentNode.checkbox.indeterminate = false;
    } else if (allChildrenChecked) {
        parentNode.checkbox.checked = true;
        parentNode.checkbox.indeterminate = false;
    } else if (someChildrenChecked) {
        parentNode.checkbox.checked = false;
        parentNode.checkbox.indeterminate = true;
    } else {
        parentNode.checkbox.checked = false;
        parentNode.checkbox.indeterminate = false;
    }
    updateParentCheckbox(parentNode); // Recurse upwards
}

// 初始化复选框状态
function initializeCheckboxStates(node) {
    if (!node) return;
    let allChecked = true;
    let someChecked = false;
    let hasVisibleChildren = false;

    if (node.type === 'tree') {
        Object.values(node.children).forEach(child => {
            if(child.isVisibleBasedOnFilters) {
                hasVisibleChildren = true;
                initializeCheckboxStates(child); // Recurse first
                if (child.checkbox) {
                    if (!child.checkbox.checked && !child.checkbox.indeterminate) { allChecked = false; }
                    if (child.checkbox.checked || child.checkbox.indeterminate) { someChecked = true; }
                } else { allChecked = false; } // Should not happen for visible node, but safe check
            }
        });
    }

    if (node.type === 'tree' && node.checkbox && !node.checkbox.disabled) {
        if (!hasVisibleChildren) {
            node.checkbox.checked = false;
            node.checkbox.indeterminate = false;
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
    // File checkboxes are initialized during renderNode based on visibility
}

// 统一的全选/全不选函数 (新增)
function setAllVisibleCheckboxes(node, isChecked) {
    if (!node.isVisibleBasedOnFilters || !node.checkbox || node.checkbox.disabled) return;
    
    node.checkbox.checked = isChecked;
    node.checkbox.indeterminate = false;
    
    if (node.type === 'tree') {
        Object.values(node.children).forEach(child => 
            setAllVisibleCheckboxes(child, isChecked)
        );
    }
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
    const pat = patInput ? patInput.value.trim() : null;

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
    resetSubsequentSections();

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
            populateExtensionFilters(fileTreeData.filter(item => item.type === 'blob'));
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
    renderFileTree(fileTreeData); // Re-render with original full data
}


// 4. Render File Tree (使用提取的辅助函数)
function renderFileTree(items) {
    if (!fileTreeContainer) {
        console.error("fileTreeContainer not found, cannot render tree.");
        return;
    }
    fileTreeContainer.innerHTML = ''; // Clear previous tree

    // 构建层次结构
    const hierarchy = buildHierarchy(items);
    fileHierarchy = hierarchy; // Store globally AFTER building
    
    // 应用过滤器可见性
    applyVisibility(hierarchy);

    const rootUl = document.createElement('ul');
    rootUl.className = 'file-tree-root';

    const rootHasVisibleContent = Object.values(hierarchy.children).some(child => child.isVisibleBasedOnFilters);

    if (!rootHasVisibleContent && items.length > 0) {
         fileTreeContainer.innerHTML = '<div class="placeholder-text">No files match the current filters.</div>';
         return;
    } else if (items.length === 0) {
         fileTreeContainer.innerHTML = '<div class="placeholder-text">No files or directories found in the repository.</div>';
         return;
    }

    // 渲染树形结构
    Object.values(hierarchy.children)
        .sort((a, b) => {
            if (a.type !== b.type) { return a.type === 'tree' ? -1 : 1; }
            return a.name.localeCompare(b.name);
        })
        .forEach(node => renderNode(node, rootUl, true));

    fileTreeContainer.appendChild(rootUl);

    // 添加复选框事件监听
    const allCheckboxes = fileTreeContainer.querySelectorAll('.file-tree-checkbox');
    allCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            const node = findNodeByPath(fileHierarchy, cb.value);
            if (node) {
                updateCheckStatus(node, cb.checked);
            }
        });
    });

    // 初始化父节点状态
    initializeCheckboxStates(fileHierarchy);
}


// --- Select/Deselect All Visible Files (使用共享函数) ---
selectAllBtn.addEventListener('click', () => {
    if (!fileHierarchy) return;
    Object.values(fileHierarchy.children).forEach(rootChild => 
        setAllVisibleCheckboxes(rootChild, true)
    );
});

deselectAllBtn.addEventListener('click', () => {
    if (!fileHierarchy) return;
    Object.values(fileHierarchy.children).forEach(rootChild => 
        setAllVisibleCheckboxes(rootChild, false)
    );
});


// 5. Generate Text File Content Button Click
generateTextBtn.addEventListener('click', async () => {
    const selectedFiles = [];
    if (!fileHierarchy) {
        showError("File tree data is not available.");
        return;
    }

    function collectCheckedFiles(node) {
        if (!node.isVisibleBasedOnFilters) return;
        if (node.type === 'blob' && node.checkbox && node.checkbox.checked) {
            selectedFiles.push(node.path);
        } else if (node.type === 'tree' && node.children) {
             if(node.checkbox && (node.checkbox.checked || node.checkbox.indeterminate)) {
                Object.values(node.children).forEach(collectCheckedFiles);
             }
        }
    }
    Object.values(fileHierarchy.children).forEach(collectCheckedFiles);
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
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                repoUrl: currentRepoUrl,
                pat: currentPat,
                action: 'generateText',
                selectedFiles: uniqueSelectedFiles
            })
        });

        if (!response.ok) {
             let errorData = { error: `Request failed with status ${response.status}` };
             try { errorData = await response.json(); } catch (e) { errorData.error += `: ${response.statusText}`; }
             throw new Error(errorData.error || `Failed to generate text (Status: ${response.status})`);
        }

        const data = await response.json();
        generatedContent = data.content || "";
        generatedStructure = data.structure || "";

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
    if (!fullContentToCopy || fullContentToCopy.trim() === "\n") {
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
                 const owner = pathParts[0]; const repoName = pathParts[1];
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
