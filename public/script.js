// public/script.js
// --- 工具函数 ---
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}


// --- DOM 元素获取 ---
// 这里获取了 HTML 页面中所有需要用 JavaScript 操作的元素
// 比如输入框、按钮、显示区域等
console.log('Script loaded. Finding DOM elements...'); // 添加日志帮助调试

// 表单相关
const repoForm = document.getElementById('repoForm');
const repoUrlInput = document.getElementById('repoUrl');
const patInput = document.getElementById('patInput');
const fetchStructureBtn = document.getElementById('fetchStructureBtn');

// 状态显示相关
const statusArea = document.getElementById('statusArea');
const statusText = document.getElementById('statusText');
const spinner = document.getElementById('spinner');
const errorMessage = document.getElementById('errorMessage');

// 筛选和文件树相关
const filterArea = document.getElementById('filterArea');
const extensionFiltersContainer = document.getElementById('extensionFilters');
const fileTreeContainer = document.getElementById('fileTreeContainer');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');

// 生成操作相关
const generationArea = document.getElementById('generationArea');
const generateTextBtn = document.getElementById('generateTextBtn');
const tokenCountArea = document.getElementById('tokenCountArea'); // 用于显示 Token 数量

// 结果展示和操作相关
const resultContainer = document.getElementById('resultContainer');
const structurePreview = document.getElementById('structurePreview'); // 显示文件结构预览
const contentPreview = document.getElementById('contentPreview'); // 显示合并后的文件内容
const outputActions = document.getElementById('outputActions');
const copyBtn = document.getElementById('copyBtn'); // 复制按钮
const downloadTxtBtn = document.getElementById('downloadTxtBtn'); // 下载按钮

// 检查是否所有元素都获取成功 (可选，用于调试)
if (!repoForm || !repoUrlInput || !fetchStructureBtn || !statusArea || !statusText || !spinner || !errorMessage || !filterArea || !extensionFiltersContainer || !fileTreeContainer || !selectAllBtn || !deselectAllBtn || !generationArea || !generateTextBtn || !tokenCountArea || !resultContainer || !structurePreview || !contentPreview || !outputActions || !copyBtn || !downloadTxtBtn) {
    console.error("Error: One or more essential DOM elements could not be found. Check the HTML structure and element IDs.");
    const body = document.querySelector('body');
    if (body) {
        const errorDiv = document.createElement('div');
        errorDiv.textContent = "Page Initialization Error: Could not find essential page elements. Please reload or contact support.";
        errorDiv.style.color = 'red';
        errorDiv.style.padding = '10px';
        errorDiv.style.border = '1px solid red';
        errorDiv.style.margin = '10px';
        body.prepend(errorDiv);
    }
} else {
    console.log('All essential DOM elements found successfully.');
}


// --- 全局状态变量 ---
let currentRepoUrl = null;
let currentPat = null;
let fileTreeData = [];
let fileHierarchy = null;
let availableExtensions = new Set();
let activeFilters = new Set(); // 用户当前选中的文件类型过滤器
let generatedContent = "";
let generatedStructure = "";


// --- 常量 ---
const API_ENDPOINT = '/api/generate';
const ALLOWED_EXTENSIONS_FRONTEND = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.less', '.html', '.htm',
    '.xml', '.yaml', '.yml', '.md', '.markdown', '.txt', '.py', '.java', '.c', '.cpp',
    '.h', '.hpp', '.cs', '.go', '.php', '.rb', '.swift', '.kt', '.kts', '.sh', '.bash',
    '.zsh', '.sql', '.dockerfile', 'dockerfile', '.env', '.gitignore', '.gitattributes',
    '.toml', '.ini', '.cfg', '.conf', '.properties', '.gradle', '.lua', '.rs',
]);


// --- 通用工具函数 ---
function showStatus(message, showSpinner = false) {
    if (errorMessage) errorMessage.style.display = 'none';
    if (statusArea) statusArea.style.display = 'block';
    if (statusText) statusText.textContent = message;
    if (spinner) spinner.style.display = showSpinner ? 'inline-block' : 'none';
}

function showError(message) {
    if (statusArea) statusArea.style.display = 'none';
    if (errorMessage) {
        errorMessage.textContent = `Error: ${message}`;
        errorMessage.style.display = 'block';
    }
    if (filterArea) filterArea.style.display = 'none';
    if (generationArea) generationArea.style.display = 'none';
    if (resultContainer) resultContainer.style.display = 'none';
}

function hideStatusAndError() {
     if (statusArea) statusArea.style.display = 'none';
     if (errorMessage) errorMessage.style.display = 'none';
}

function resetSubsequentSections() {
    if (filterArea) filterArea.style.display = 'none';
    if (generationArea) generationArea.style.display = 'none';
    if (resultContainer) resultContainer.style.display = 'none';
    if (fileTreeContainer) {
        fileTreeContainer.innerHTML = '<div class="placeholder-text">输入仓库 URL 并点击获取，文件树将在此显示。</div>';
    }
    if (extensionFiltersContainer) {
         extensionFiltersContainer.innerHTML = '<span class="placeholder-text">获取结构后将显示文件类型过滤器。</span>';
    }
    if (structurePreview) structurePreview.textContent = '(文件结构预览将在此显示)';
    if (contentPreview) contentPreview.textContent = '(合并的文件内容将在此显示)';
    fileTreeData = [];
    fileHierarchy = null;
    availableExtensions = new Set();
    activeFilters = new Set();
    generatedContent = "";
    generatedStructure = "";
    if (tokenCountArea) tokenCountArea.textContent = '';
    if (tokenCountArea) tokenCountArea.style.display = 'none';
}


// --- 文件树助手函数 ---
function buildHierarchy(itemList) {
    const hierarchy = {
        name: 'root',
        path: '',
        type: 'tree',
        children: {},
        isVisibleBasedOnFilters: true // Root is always "visible" in terms of structure
    };

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
                    name: part,
                    path: currentPath,
                    type: isLastPart ? item.type : 'tree',
                    children: {},
                    element: null,
                    checkbox: null,
                    // isVisibleBasedOnFilters will be determined by applyVisibility
                    // For now, assume it might be visible until filters are applied
                    isVisibleBasedOnFilters: true, // Default to true, applyVisibility will refine this
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

// Helper function to get the filter key for a file node
function getFilterKeyForNode(item) {
    if (item.type === 'blob') {
        const pathLower = item.path.toLowerCase();
        const parts = pathLower.split('.');
        let filterKey = null;

        if (parts.length > 1) {
            const ext = '.' + parts.pop();
            if (ALLOWED_EXTENSIONS_FRONTEND.has(ext)) {
                filterKey = ext;
            }
        }
        if (!filterKey) {
            const filename = pathLower.substring(pathLower.lastIndexOf('/') + 1);
            if (ALLOWED_EXTENSIONS_FRONTEND.has(filename)) {
                filterKey = filename;
            }
        }
        return filterKey;
    }
    return null;
}


// 递归地为文件树中的每个节点应用可见性标记
// MODIFIED: Files are always "visible" in structure. Their checked state handles filtering.
// Directories are visible if they contain any visible children (files or subdirs).
function applyVisibility(node) {
    if (node.type === 'blob') {
        // Files are always structurally visible; filtering is handled by checkbox state.
        node.isVisibleBasedOnFilters = true;
        return true; // Files themselves contribute to parent visibility
    } else { // If directory or root
        let hasVisibleChild = false;
        Object.values(node.children).forEach(child => {
            if (applyVisibility(child)) { // Recursively apply to children
                hasVisibleChild = true;
            }
        });
        // A directory is visible if it has any visible children
        node.isVisibleBasedOnFilters = hasVisibleChild;
        return hasVisibleChild;
    }
}


function renderNode(node, parentUl, isRootLevel = false) {
    // Only render if the node itself is marked as structurally visible
    if (!node.isVisibleBasedOnFilters && !isRootLevel) { // Root level items always try to render if they exist
         // For non-root, if a directory has no visible children, it won't be rendered.
        if (node.type === 'tree' && Object.keys(node.children).length > 0) {
            // Check if any child is visible, if not, this dir might be skipped
            // This logic is now mostly handled by applyVisibility setting node.isVisibleBasedOnFilters
        } else if (node.type === 'blob') {
            // Files are now always isVisibleBasedOnFilters = true from applyVisibility
        } else {
            return;
        }
    }
    if (!node.isVisibleBasedOnFilters && node.type === 'tree' && !isRootLevel) return;


    const li = document.createElement('li');
    li.className = node.type;
    // if (!node.isVisibleBasedOnFilters && node.type === 'tree') { //This might still be useful for styling empty filtered dirs
    //     li.classList.add('filtered-out-dir');
    // }
    node.element = li;

    const nodeContent = document.createElement('div');
    nodeContent.className = 'node-content';

    // Check for renderable children for toggle icon
    const hasRenderableChildren = node.type === 'tree' && Object.values(node.children).some(child => child.isVisibleBasedOnFilters);

    if (node.type === 'tree' && Object.keys(node.children).length > 0) {
        const toggle = document.createElement('span');
        toggle.className = 'toggle expanded'; // Default expanded

        if (hasRenderableChildren) {
            toggle.onclick = (e) => {
                e.stopPropagation();
                const subUl = li.querySelector(':scope > ul');
                if (subUl) {
                    const isExpanded = subUl.style.display !== 'none';
                    subUl.style.display = isExpanded ? 'none' : 'block';
                    toggle.classList.toggle('expanded', !isExpanded);
                    toggle.classList.toggle('collapsed', isExpanded);
                }
            };
        } else {
            toggle.classList.add('empty'); // Mark as empty if no visible children
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
    // Initial checked state:
    // If it's a file, check if its type is in activeFilters
    // Directories are initially unchecked, their state comes from children.
    if (node.type === 'blob') {
        const filterKey = getFilterKeyForNode(node);
        checkbox.checked = filterKey ? activeFilters.has(filterKey) : false;
    } else {
        checkbox.checked = false; // Directories start unchecked
    }
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
            .forEach(child => renderNode(child, subUl)); // Pass false for isRootLevel

        if (subUl.children.length > 0) {
            li.appendChild(subUl);
            subUl.style.display = 'block'; // Default expanded
        } else if (!hasRenderableChildren) {
            // If no renderable children, ensure toggle reflects this if it wasn't marked 'empty' before
            const toggle = nodeContent.querySelector('.toggle');
            if (toggle && !toggle.classList.contains('empty')) {
                toggle.classList.remove('expanded', 'collapsed');
                toggle.classList.add('empty');
                toggle.onclick = null; // Disable click
            }
        }
    }
    parentUl.appendChild(li);
}


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

function updateCheckStatus(node, checked) {
    if (!node || !node.checkbox || node.checkbox.disabled) return;

    node.checkbox.checked = checked;
    node.checkbox.indeterminate = false;

    if (node.type === 'tree') {
        Object.values(node.children).forEach(child => {
            // Only propagate to children that are structurally visible
             if (child.isVisibleBasedOnFilters) { // Or simply always if files are always rendered
                updateCheckStatus(child, checked);
            }
        });
    }
    updateParentCheckbox(node);
}

function updateParentCheckbox(node) {
    const pathParts = node.path.split('/');
    if (pathParts.length <= 1 && node.path !== '') return; // Stop if root or root's direct child processing its own parent (the root)

    let parentNode;
    if (node.path === '') { // Should not happen if called from a child
        return;
    }
    
    // Find parent node
    // If node is a direct child of root, parent is fileHierarchy (the root object)
    if (pathParts.length === 1 || (pathParts.length === 2 && pathParts[0] === '')) { // e.g. "file.js" or "/file.js"
        parentNode = fileHierarchy; // The root object
    } else {
        const parentPath = pathParts.slice(0, -1).join('/');
        parentNode = findNodeByPath(fileHierarchy, parentPath);
    }


    if (!parentNode || !parentNode.checkbox || (parentNode.checkbox && parentNode.checkbox.disabled)) return;

    let allChildrenChecked = true;
    let someChildrenChecked = false;
    let hasConsideredChildren = false; // Tracks if any children were even considered for state

    Object.values(parentNode.children).forEach(child => {
        // IMPORTANT: Consider ALL children that have a checkbox for parent state,
        // not just isVisibleBasedOnFilters, as filtering now means unchecking, not hiding.
        if (child.checkbox) { // Only consider nodes that have checkboxes (rendered nodes)
            hasConsideredChildren = true;
            if (!child.checkbox.checked && !child.checkbox.indeterminate) {
                allChildrenChecked = false;
            }
            if (child.checkbox.checked || child.checkbox.indeterminate) {
                someChildrenChecked = true;
            }
        }
    });

    if (!hasConsideredChildren && parentNode !== fileHierarchy) { // If a directory has no renderable children with checkboxes
        parentNode.checkbox.checked = false;
        parentNode.checkbox.indeterminate = false;
    } else if (allChildrenChecked && hasConsideredChildren) { // Ensure there were children to check
        parentNode.checkbox.checked = true;
        parentNode.checkbox.indeterminate = false;
    } else if (someChildrenChecked) {
        parentNode.checkbox.checked = false;
        parentNode.checkbox.indeterminate = true;
    } else { // No children checked, and none indeterminate
        parentNode.checkbox.checked = false;
        parentNode.checkbox.indeterminate = false;
    }

    // If the parentNode is not the absolute root, recurse upwards
    if (parentNode !== fileHierarchy) {
        updateParentCheckbox(parentNode);
    }
}


function initializeCheckboxStates(node) {
    if (!node) return;

    let allChecked = true;
    let someChecked = false;
    let hasRenderableChildren = false;

    if (node.type === 'tree') {
        Object.values(node.children).forEach(child => {
            // We only care about children that would be rendered and have checkboxes
            if (child.isVisibleBasedOnFilters && child.checkbox) {
                hasRenderableChildren = true;
                initializeCheckboxStates(child); // Recurse first

                if (!child.checkbox.checked && !child.checkbox.indeterminate) { allChecked = false; }
                if (child.checkbox.checked || child.checkbox.indeterminate) { someChecked = true; }
            } else if (child.isVisibleBasedOnFilters && child.type === 'tree') {
                // If a child dir is visible but has no checkbox (e.g. it's empty of further visible items)
                // it shouldn't prevent parent from being fully checked if other children are.
                // However, initializeCheckboxStates should be called on it too.
                initializeCheckboxStates(child);
            }
        });
    }

    // Update current directory node's checkbox state
    if (node.type === 'tree' && node.checkbox && !node.checkbox.disabled) {
        if (!hasRenderableChildren) { // No children with checkboxes that influence state
            // The state of an empty dir checkbox can be debated. Usually unchecked.
            // But if it had files initially checked by filter, then filter unchecks them, it should be unchecked.
            // This is tricky because initial state is also based on activeFilters for files.
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
    // Files' initial checked state is set in renderNode based on activeFilters
}


function setAllVisibleCheckboxes(node, isChecked) {
    // This function's "visible" now means structurally visible + matching current filter idea
    // However, for select/deselect all, it should probably apply to ALL rendered checkboxes
    // if (!node.isVisibleBasedOnFilters || !node.checkbox || node.checkbox.disabled) return;

    // We will select/deselect all items that HAVE a checkbox, regardless of their filter state,
    // because they are part of the rendered tree.
    if (!node.checkbox || node.checkbox.disabled) {
        // If it's a directory without a checkbox (e.g. root), recurse
        if (node.type === 'tree') {
             Object.values(node.children).forEach(child => setAllVisibleCheckboxes(child, isChecked));
        }
        return;
    }


    node.checkbox.checked = isChecked;
    node.checkbox.indeterminate = false;

    if (node.type === 'tree') {
        Object.values(node.children).forEach(child =>
            setAllVisibleCheckboxes(child, isChecked)
        );
    }
}


// --- 核心逻辑 ---
if (fetchStructureBtn) {
    fetchStructureBtn.addEventListener('click', async () => {
        if (!repoUrlInput) {
            console.error("repoUrlInput element not found!");
            showError("初始化错误：无法找到 URL 输入框。");
            return;
        }
        const repoUrl = repoUrlInput.value.trim();
        const pat = patInput ? patInput.value.trim() : null;

        if (!repoUrl) {
            showError('请输入 GitHub 仓库 URL。');
            return;
        }
        if (!repoUrl.toLowerCase().includes('github.com/')) {
            showError('请输入有效的 GitHub 仓库 URL (例如：https://github.com/owner/repo)。');
            return;
        }

        currentRepoUrl = repoUrl;
        currentPat = pat || null;

        fetchStructureBtn.disabled = true;
        showStatus('正在获取仓库结构...', true);
        resetSubsequentSections();

        try {
            console.log(`正在为 ${currentRepoUrl} 获取文件树 ${currentPat ? '使用' : '不使用'} PAT。`);
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
                let errorData = { error: `请求失败，状态码: ${response.status}` };
                try {
                    errorData = await response.json();
                 } catch (e) {
                    errorData.error += `: ${response.statusText}`;
                 }
                throw new Error(errorData.error || `获取结构失败 (Status: ${response.status})`);
            }

            const data = await response.json();
            fileTreeData = data.tree || [];
            console.log(`从后端收到 ${fileTreeData.length} 个项目 (文件+目录)。是否被截断: ${data.truncated}`);

            const fileCount = fileTreeData.filter(i => i.type === 'blob').length;
            const dirCount = fileTreeData.filter(i => i.type === 'tree').length;

            let statusMsg = `获取结构成功。找到 ${fileCount} 个可处理文件和 ${dirCount} 个目录。`;
            if (data.truncated) {
                 statusMsg += ' (警告：由于仓库过大，文件列表可能不完整)';
            }
            if (fileTreeData.length === 0 && !data.truncated) {
                 statusMsg = '获取结构成功，但未找到匹配过滤条件的文件或目录。';
            }
            showStatus(statusMsg, false);


            if (fileTreeData.length > 0) {
                populateExtensionFilters(fileTreeData.filter(item => item.type === 'blob'));
                // Initial activeFilters are set in populateExtensionFilters (all available)
                renderFileTree(fileTreeData); // This will use current activeFilters for initial check states
                if (filterArea) filterArea.style.display = 'block';
                if (generationArea) generationArea.style.display = 'block';
                if (resultContainer) resultContainer.style.display = 'none';
            } else {
                if (filterArea) filterArea.style.display = 'none';
                if (generationArea) generationArea.style.display = 'none';
            }

        } catch (error) {
            console.error('获取结构时出错:', error);
            showError(`获取结构失败: ${error.message}`);
            resetSubsequentSections();
        } finally {
            if (fetchStructureBtn) fetchStructureBtn.disabled = false;
            if (spinner) spinner.style.display = 'none';
        }
    });
} else {
    console.warn("Warning: fetchStructureBtn element not found. 'Fetch Structure' functionality will not work.");
}


function populateExtensionFilters(files) {
    if (!extensionFiltersContainer) {
        console.error("extensionFiltersContainer not found, cannot populate filters.");
        return;
    }
    availableExtensions.clear();

    files.forEach(file => {
        const filterKey = getFilterKeyForNode(file);
        if (filterKey) availableExtensions.add(filterKey);
    });

    extensionFiltersContainer.innerHTML = '';
    activeFilters = new Set(availableExtensions); // By default, all found types are active
    const sortedExtensions = Array.from(availableExtensions).sort();

    if (sortedExtensions.length === 0) {
        extensionFiltersContainer.innerHTML = '<span class="placeholder-text">未找到可供筛选的已知文件类型。</span>';
        return;
    }

    sortedExtensions.forEach(extOrType => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = extOrType;
        checkbox.checked = true; // Default checked as activeFilters contains all initially
        checkbox.addEventListener('change', handleFilterChange);
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${extOrType}`));
        extensionFiltersContainer.appendChild(label);
    });
}

// MODIFIED handleFilterChange
const debouncedRenderFileTree = debounce((data) => {
    renderFileTree(data);
}, 250); // Keep debounce for rendering

// MODIFIED handleFilterChange
function handleFilterChange() {
    activeFilters.clear();
    if (!extensionFiltersContainer) return;

    const checkboxes = extensionFiltersContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        if (cb.checked) {
            activeFilters.add(cb.value);
        }
    });
    
    // Instead of just re-rendering and relying on visibility,
    // we will now update the checked state of files based on the new activeFilters,
    // then re-render the tree to reflect these changes.
    if (fileHierarchy) {
        // Apply new filter logic to existing hierarchy's checkboxes
        function updateChecksRecursively(node) {
            if (!node) return;
            if (node.type === 'blob' && node.checkbox) {
                const filterKey = getFilterKeyForNode(node);
                const shouldBeChecked = filterKey ? activeFilters.has(filterKey) : false;
                if (node.checkbox.checked !== shouldBeChecked) {
                    node.checkbox.checked = shouldBeChecked;
                    // updateParentCheckbox will be called by initializeCheckboxStates or during tree traversal
                }
            }
            if (node.type === 'tree') {
                Object.values(node.children).forEach(updateChecksRecursively);
            }
        }
        updateChecksRecursively(fileHierarchy); // Start from root
    }

    // Now, re-render. renderFileTree will use applyVisibility (files always visible)
    // and renderNode will set initial checkbox states based on the (now potentially modified) activeFilters
    // and the node's actual checked status if it was already rendered.
    // The initializeCheckboxStates at the end of renderFileTree will fix parent states.
    debouncedRenderFileTree(fileTreeData);
}


function renderFileTree(items) {
    if (!fileTreeContainer) {
        console.error("fileTreeContainer not found, cannot render tree.");
        return;
    }
    fileTreeContainer.innerHTML = '';

    // 1. Build hierarchy (or use existing if items haven't changed, though usually they do on new fetch)
    // For filter changes, we operate on the existing fileHierarchy if available.
    // For initial load or new repo fetch, we build it.
    if (!fileHierarchy || items !== fileTreeData) { // A bit of a simplification, ideally compare items deeply
        fileHierarchy = buildHierarchy(items);
    }


    // 2. Apply visibility (files are always visible, dirs depend on children)
    // This needs to be done before checking rootHasVisibleContent
    applyVisibility(fileHierarchy); // Apply to the global fileHierarchy

    const rootUl = document.createElement('ul');
    rootUl.className = 'file-tree-root';

    // Check if root itself has any visible content to render.
    // This uses the isVisibleBasedOnFilters flag set by applyVisibility.
    const rootHasVisibleContent = Object.values(fileHierarchy.children).some(child => child.isVisibleBasedOnFilters);

    if (!rootHasVisibleContent && items.length > 0) {
         fileTreeContainer.innerHTML = '<div class="placeholder-text">没有文件匹配当前的筛选条件或所有文件均未选中。</div>'; // Modified message
         // Still, some UI for select all/deselect all might be desired, or filter checkboxes.
         // For now, if nothing to show in tree, we stop.
         return;
    } else if (items.length === 0) {
         fileTreeContainer.innerHTML = '<div class="placeholder-text">仓库中未找到任何文件或目录。</div>';
         return;
    }


    Object.values(fileHierarchy.children)
        .sort((a, b) => {
            if (a.type !== b.type) { return a.type === 'tree' ? -1 : 1; }
            return a.name.localeCompare(b.name);
        })
        .forEach(node => renderNode(node, rootUl, true));

    fileTreeContainer.appendChild(rootUl);

    const allCheckboxes = fileTreeContainer.querySelectorAll('.file-tree-checkbox');
    allCheckboxes.forEach(cb => {
        // Remove old listener before adding new one to prevent duplicates if re-rendering frequently
        // cb.removeEventListener('change', handleCheckboxChange); // Requires handleCheckboxChange to be a named function
        // Or, ensure elements are fully new on re-render (which innerHTML = '' does)
        cb.addEventListener('change', () => { // Simpler for now
            const node = findNodeByPath(fileHierarchy, cb.value);
            if (node) {
                updateCheckStatus(node, cb.checked);
            }
        });
    });

    initializeCheckboxStates(fileHierarchy); // Crucial to set parent states correctly after rendering
}


if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
        if (!fileHierarchy) return;
        // 直接批量勾选所有节点
        setAllVisibleCheckboxes(fileHierarchy, true);
        // 更新所有父节点的 indeterminate/checked 状态
        initializeCheckboxStates(fileHierarchy);
    });
} else {
    console.warn("Warning: selectAllBtn element not found. 'Select All' functionality will not work.");
}

if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', () => {
        if (!fileHierarchy) return;
        // 直接批量取消勾选所有节点
        setAllVisibleCheckboxes(fileHierarchy, false);
        // 更新所有父节点的 indeterminate/checked 状态
        initializeCheckboxStates(fileHierarchy);
    });
} else {
    console.warn("Warning: deselectAllBtn element not found. 'Deselect All' functionality will not work.");
}

if (generateTextBtn) {
    generateTextBtn.addEventListener('click', async () => {
        const selectedFiles = [];
        if (!fileHierarchy) {
            showError("文件树数据不可用。");
            return;
        }

        function collectCheckedFiles(node) {
            // Files are always "visible" structurally. We just check their checkbox.
            // if (!node.isVisibleBasedOnFilters) return; // This might no longer be needed for files

            if (node.type === 'blob' && node.checkbox && node.checkbox.checked) {
                selectedFiles.push(node.path);
            }
            else if (node.type === 'tree' && node.children) {
                 // A directory being checked or indeterminate means it contains selected files
                 if(node.checkbox && (node.checkbox.checked || node.checkbox.indeterminate)) {
                    Object.values(node.children).forEach(collectCheckedFiles);
                 }
            }
        }
        Object.values(fileHierarchy.children).forEach(collectCheckedFiles);
        const uniqueSelectedFiles = [...new Set(selectedFiles)];

        if (uniqueSelectedFiles.length === 0) {
            showError('请至少在文件树中选择一个文件来生成文本。');
            if (resultContainer) resultContainer.style.display = 'none';
            return;
        }

        console.log(`正在为 ${uniqueSelectedFiles.length} 个选定文件生成文本。`);
        generateTextBtn.disabled = true;
        showStatus('正在生成合并后的文本内容...', true);
        if (resultContainer) resultContainer.style.display = 'none';

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
                let errorData = { error: `请求失败，状态码: ${response.status}` };
                try { errorData = await response.json(); } catch (e) { errorData.error += `: ${response.statusText}`; }
                throw new Error(errorData.error || `生成文本失败 (Status: ${response.status})`);
            }

            const data = await response.json();
            generatedContent = data.content || "";
            generatedStructure = data.structure || "";

            if (structurePreview) structurePreview.textContent = generatedStructure || "(未能生成文件结构)";
            if (contentPreview) contentPreview.textContent = generatedContent || "(未能生成文件内容或所有文件被跳过)";
            if (resultContainer) resultContainer.style.display = 'block';
            hideStatusAndError();
            showStatus(`已从 ${uniqueSelectedFiles.length} 个选定文件生成文本。请在下方预览。`, false);

            calculateAndDisplayTokenCount(generatedStructure + "\n" + generatedContent);

        } catch (error) {
            console.error('生成文本时出错:', error);
            showError(`生成文本时出错: ${error.message}`);
            if (resultContainer) resultContainer.style.display = 'none';
        } finally {
            if (generateTextBtn) generateTextBtn.disabled = false;
            if (spinner) spinner.style.display = 'none';
        }
    });
} else {
    console.warn("Warning: generateTextBtn element not found. 'Generate Text' functionality will not work.");
}

function calculateTokenCount(text) {
    if (!text) return 0;
    const words = text.split(/[\s\n\t\r.,!?;:(){}\[\]<>"'`~|\\/@#$%^&*+=_-]+/)
                     .filter(word => word.length > 0);
    const totalChars = words.reduce((sum, word) => sum + word.length, 0);
    const estimatedTokens = Math.ceil(words.length * 1.3 + (text.length - totalChars) * 0.5);
    return estimatedTokens;
}

function calculateAndDisplayTokenCount(text) {
    if (!tokenCountArea) return;
    const count = calculateTokenCount(text);
    tokenCountArea.style.display = 'block';
    tokenCountArea.textContent = `预估 Token 数量: ${count.toLocaleString()}`;
    if (count > 6000) {
        tokenCountArea.style.color = '#dc3545';
    } else if (count > 4000) {
        tokenCountArea.style.color = '#ffc107';
    } else {
        tokenCountArea.style.color = '#28a745';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const elements = {
        fetchStructureBtn, selectAllBtn, deselectAllBtn, generateTextBtn,
        copyBtn, downloadTxtBtn, extensionFiltersContainer, repoForm
    };
    const missingElements = Object.entries(elements)
        .filter(([key, element]) => !element)
        .map(([key]) => key);
    if (missingElements.length > 0) {
        console.warn('Warning: The following elements were not found:', missingElements);
    }

    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            try {
                const textToCopy = [generatedStructure, '', generatedContent].join('\n');
                await navigator.clipboard.writeText(textToCopy);
                const originalText = copyBtn.textContent;
                copyBtn.textContent = '已复制!';
                copyBtn.style.backgroundColor = '#28a745';
                setTimeout(() => {
                    copyBtn.textContent = originalText;
                    copyBtn.style.backgroundColor = '';
                }, 2000);
            } catch (err) {
                console.error('Copy to clipboard failed:', err);
                showError('复制到剪贴板失败。请手动复制文本。');
            }
        });
    }

    if (downloadTxtBtn) {
        downloadTxtBtn.addEventListener('click', () => {
            try {
                const textToDownload = [generatedStructure, '', generatedContent].join('\n');
                const blob = new Blob([textToDownload], { type: 'text/plain;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                const repoName = currentRepoUrl ? currentRepoUrl.split('/').pop() || 'repo' : 'repo';
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                a.download = `${repoName}-files-${timestamp}.txt`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(a.href);
                }, 100);
            } catch (err) {
                console.error('Download failed:', err);
                showError('创建下载文件失败。请手动复制文本。');
            }
        });
    }
});
// END OF script.js
