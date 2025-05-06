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
    // 可以选择在这里显示一个用户可见的错误
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
// 这些变量用来存储程序运行过程中的数据
let currentRepoUrl = null; // 当前处理的仓库 URL
let currentPat = null; // 当前使用的 Personal Access Token (如果有的话)
let fileTreeData = []; // 从后端获取的原始文件列表 (包含路径和类型)
let fileHierarchy = null; // 构建好的文件树层级结构对象
let availableExtensions = new Set(); // 在仓库中找到的所有可识别的文件扩展名/类型
let activeFilters = new Set(); // 用户当前选中的文件类型过滤器
let generatedContent = ""; // 生成的合并文件内容
let generatedStructure = ""; // 生成的文件结构文本


// --- 常量 ---
// 这些值在程序运行期间通常不会改变
const API_ENDPOINT = '/api/generate'; // 后端 Cloudflare Worker 的 API 地址

// 在前端定义允许处理的文件扩展名/特殊文件名集合
// 主要用于前端筛选逻辑，让用户可以选择只看某些类型的文件
const ALLOWED_EXTENSIONS_FRONTEND = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.less', '.html', '.htm',
    '.xml', '.yaml', '.yml', '.md', '.markdown', '.txt', '.py', '.java', '.c', '.cpp',
    '.h', '.hpp', '.cs', '.go', '.php', '.rb', '.swift', '.kt', '.kts', '.sh', '.bash',
    '.zsh', '.sql', '.dockerfile', 'dockerfile', '.env', '.gitignore', '.gitattributes',
    '.toml', '.ini', '.cfg', '.conf', '.properties', '.gradle', '.lua', '.rs',
]);


// --- 通用工具函数 ---
// 这些函数提供一些常用的辅助功能

// 显示状态信息 (例如："正在获取...")
function showStatus(message, showSpinner = false) {
    if (errorMessage) errorMessage.style.display = 'none'; // 隐藏错误信息
    if (statusArea) statusArea.style.display = 'block'; // 显示状态区域
    if (statusText) statusText.textContent = message; // 设置状态文本
    if (spinner) spinner.style.display = showSpinner ? 'inline-block' : 'none'; // 控制加载动画的显示
}

// 显示错误信息
function showError(message) {
    if (statusArea) statusArea.style.display = 'none'; // 隐藏状态信息
    if (errorMessage) {
        errorMessage.textContent = `Error: ${message}`; // 设置错误文本
        errorMessage.style.display = 'block'; // 显示错误区域
    }
    // 出错时隐藏后续的操作区域
    if (filterArea) filterArea.style.display = 'none';
    if (generationArea) generationArea.style.display = 'none';
    if (resultContainer) resultContainer.style.display = 'none';
}

// 隐藏状态和错误信息
function hideStatusAndError() {
     if (statusArea) statusArea.style.display = 'none';
     if (errorMessage) errorMessage.style.display = 'none';
}

// 重置获取结构后的界面区域 (用于新的请求或出错后)
function resetSubsequentSections() {
    if (filterArea) filterArea.style.display = 'none';
    if (generationArea) generationArea.style.display = 'none';
    if (resultContainer) resultContainer.style.display = 'none';

    // 重置文件树容器的提示文本
    if (fileTreeContainer) {
        fileTreeContainer.innerHTML = '<div class="placeholder-text">输入仓库 URL 并点击获取，文件树将在此显示。</div>';
    }
    // 重置文件类型筛选器的提示文本
    if (extensionFiltersContainer) {
         extensionFiltersContainer.innerHTML = '<span class="placeholder-text">获取结构后将显示文件类型过滤器。</span>';
    }
    // 重置结果预览区的提示文本
    if (structurePreview) structurePreview.textContent = '(文件结构预览将在此显示)';
    if (contentPreview) contentPreview.textContent = '(合并的文件内容将在此显示)';

    // 清空相关的全局状态
    fileTreeData = [];
    fileHierarchy = null; // 重置文件树层级
    availableExtensions = new Set();
    activeFilters = new Set();
    generatedContent = "";
    generatedStructure = "";
    if (tokenCountArea) tokenCountArea.textContent = ''; // 清空 Token 计数显示
    if (tokenCountArea) tokenCountArea.style.display = 'none'; // 隐藏计数区域
}


// --- 文件树助手函数 ---
// 这些函数专门用于处理文件树的构建、筛选和渲染逻辑

// 根据扁平的文件列表构建层级结构
function buildHierarchy(itemList) {
    const hierarchy = {
        name: 'root', // 根节点名称
        path: '',     // 根节点路径
        type: 'tree', // 类型为目录
        children: {}, // 子节点集合
        isVisibleBasedOnFilters: true // 根节点默认可见 (因为它包含所有内容)
    };

    // 先按路径深度排序，再按字母顺序排序，确保父目录先于子目录处理
    itemList.sort((a, b) => {
        const depthA = a.path.split('/').length;
        const depthB = b.path.split('/').length;
        if (depthA !== depthB) { return depthA - depthB; }
        return a.path.localeCompare(b.path);
    })
    .forEach(item => {
        let currentLevel = hierarchy; // 从根节点开始
        const pathParts = item.path.split('/'); // 将路径拆分成部分

        pathParts.forEach((part, index) => {
            const currentPath = pathParts.slice(0, index + 1).join('/'); // 当前部分的完整路径
            const isLastPart = index === pathParts.length - 1; // 是否是路径的最后一部分

            // 如果当前层级还没有这个子节点，则创建它
            if (!currentLevel.children[part]) {
                currentLevel.children[part] = {
                    name: part, // 节点名 (文件名或目录名)
                    path: currentPath, // 完整路径
                    type: isLastPart ? item.type : 'tree', // 如果是最后一部分，类型同原始item，否则是目录
                    children: {}, // 子节点的容器
                    element: null, // 对应的 HTML <li> 元素 (稍后渲染时填充)
                    checkbox: null, // 对应的 HTML <input type="checkbox"> 元素 (稍后渲染时填充)
                    isVisibleBasedOnFilters: false, // 默认先标记为不可见，后续根据筛选条件更新
                    originalItem: isLastPart ? item : null // 如果是叶子节点，保留原始信息
                };
            } else if (isLastPart) {
                // 如果节点已存在 (可能是之前作为目录创建的)，并且现在是路径末端，更新其类型和原始信息
                currentLevel.children[part].type = item.type;
                currentLevel.children[part].originalItem = item;
            }
            // 进入下一层级
            currentLevel = currentLevel.children[part];
        });
    });
    return hierarchy; // 返回构建好的层级结构
}

// 检查单个文件节点是否直接匹配当前激活的过滤器
function isDirectlyVisible(item) {
    if (item.type === 'blob') { // 只对文件进行判断
        const pathLower = item.path.toLowerCase(); // 转小写方便比较
        const parts = pathLower.split('.');
        let filterKey = null; // 用来存储匹配到的过滤器键 (如 '.js', 'dockerfile')

        // 尝试按扩展名匹配
        if (parts.length > 1) {
            const ext = '.' + parts.pop(); // 获取最后一个 '.' 之后的部分作为扩展名
            if (ALLOWED_EXTENSIONS_FRONTEND.has(ext)) { // 检查是否是预定义允许的扩展名
                filterKey = ext;
            }
        }

        // 如果没有通过扩展名匹配到，尝试按完整文件名匹配 (针对无扩展名的特殊文件)
        if (!filterKey) {
            const filename = pathLower.substring(pathLower.lastIndexOf('/') + 1); // 获取文件名
            if (ALLOWED_EXTENSIONS_FRONTEND.has(filename)) { // 检查是否是预定义允许的特殊文件名
                filterKey = filename;
            }
        }

        // 如果找到了匹配的 filterKey，并且该 key 在当前激活的过滤器集合中，则可见
        return filterKey && activeFilters.has(filterKey);
    }
    return false; // 目录本身不直接参与"可见性"判断，其可见性取决于子节点
}

// 递归地为文件树中的每个节点应用可见性标记
function applyVisibility(node) {
    if (node.type === 'blob') { // 如果是文件
        node.isVisibleBasedOnFilters = isDirectlyVisible(node); // 直接判断是否可见
        return node.isVisibleBasedOnFilters; // 返回文件自身的可见性
    } else { // 如果是目录 (或根节点)
        let hasVisibleChild = false; // 标记该目录下是否有可见的子节点
        // 遍历所有子节点
        Object.values(node.children).forEach(child => {
            // 递归调用 applyVisibility 处理子节点，并更新 hasVisibleChild 标记
            if (applyVisibility(child)) { // 注意：这里先递归处理子节点
                hasVisibleChild = true;
            }
        });
        // 目录的可见性取决于它是否包含任何可见的子节点
        node.isVisibleBasedOnFilters = hasVisibleChild;
        return hasVisibleChild; // 返回该目录是否包含可见内容
    }
}

// 渲染文件树中的单个节点 (一个 <li> 元素)
function renderNode(node, parentUl, isRootLevel = false) {
    // 如果节点本身和其所有子节点都不可见 (根据过滤器)，并且不是根目录下的第一层，则不渲染
    if (!node.isVisibleBasedOnFilters && !isRootLevel) { return; }

    const li = document.createElement('li'); // 创建列表项
    li.className = node.type; // 添加类型作为 CSS 类 (e.g., 'tree', 'blob')
    // 如果是目录但其内容被过滤掉了，添加特殊样式标明
    if (!node.isVisibleBasedOnFilters && node.type === 'tree') {
        li.classList.add('filtered-out-dir');
    }
    node.element = li; // 在节点数据中保存对其 HTML 元素的引用

    const nodeContent = document.createElement('div'); // 创建用于容纳节点内容 (图标、复选框、名称) 的容器
    nodeContent.className = 'node-content';

    // 判断是否有需要渲染的子节点 (用于决定是否显示展开/折叠图标)
    const hasRenderableChildren = Object.values(node.children).some(child => child.isVisibleBasedOnFilters);

    // 如果是目录且有子节点，创建展开/折叠图标 (▼/▶)
    if (node.type === 'tree' && Object.keys(node.children).length > 0) {
        const toggle = document.createElement('span');
        toggle.className = 'toggle expanded'; // 默认展开

        if (hasRenderableChildren) { // 只有当有可见子节点时，图标才可点击
            toggle.onclick = (e) => {
                e.stopPropagation(); // 阻止事件冒泡到父元素
                const subUl = li.querySelector(':scope > ul'); // 找到直接子级 <ul>
                if (subUl) {
                    const isExpanded = subUl.style.display !== 'none'; // 判断当前是否展开
                    subUl.style.display = isExpanded ? 'none' : 'block'; // 切换显示状态
                    toggle.classList.toggle('expanded', !isExpanded); // 切换 CSS 类
                    toggle.classList.toggle('collapsed', isExpanded);
                }
            };
        } else { // 如果目录没有可见子节点，显示一个不可点击的占位符或禁用状态
            toggle.classList.add('empty'); // 添加 'empty' 类用于样式
        }
        nodeContent.appendChild(toggle); // 将图标添加到节点内容容器
    } else {
        // 如果不是目录或没有子节点，添加一个占位符，保持对齐
        const placeholder = document.createElement('span');
        placeholder.className = 'toggle-placeholder';
        nodeContent.appendChild(placeholder);
    }

    // 创建复选框
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = node.path; // 使用节点路径作为值
    // 初始化选中状态：如果是可见的文件，则默认选中；目录默认不选中
    checkbox.checked = node.type === 'blob' && node.isVisibleBasedOnFilters;
    checkbox.className = 'file-tree-checkbox'; // CSS 类
    // 创建一个基于路径的唯一 ID，替换特殊字符
    checkbox.id = `cb-${node.path.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    node.checkbox = checkbox; // 在节点数据中保存对其复选框的引用
    nodeContent.appendChild(checkbox); // 添加到节点内容容器
    
    // 创建标签 (Label)，关联到复选框，并包含图标和名称
    const label = document.createElement('label');
    label.htmlFor = checkbox.id; // 关联到复选框 ID，点击标签也能触​​发复选框

    const icon = document.createElement('span'); // 创建图标元素
    icon.className = 'node-icon'; // CSS 类
    icon.textContent = node.type === 'tree' ? '📁' : '📄'; // 根据类型设置图标
    label.appendChild(icon); // 添加图标到标签

    label.appendChild(document.createTextNode(` ${node.name || '.'}`)); // 添加节点名称 (根节点可能没有 name)
    nodeContent.appendChild(label); // 添加标签到节点内容容器

    li.appendChild(nodeContent); // 将节点内容容器添加到列表项 <li>

    // 如果是目录且有子节点，递归渲染子节点
    if (node.type === 'tree' && Object.keys(node.children).length > 0) {
        const subUl = document.createElement('ul'); // 创建子列表 <ul>
        // 对子节点进行排序 (目录在前，文件在后，同类型按名称排序)
        Object.values(node.children)
            .sort((a, b) => {
                if (a.type !== b.type) { return a.type === 'tree' ? -1 : 1; } // 类型不同，目录优先
                return a.name.localeCompare(b.name); // 类型相同，按名称排序
            })
            .forEach(child => renderNode(child, subUl)); // 递归调用 renderNode 渲染每个子节点

        // 只有当子列表 <ul> 中实际渲染了内容时才添加到 DOM
        if (subUl.children.length > 0) {
            li.appendChild(subUl);
            // 确保子列表初始可见状态与展开图标一致 (默认展开)
            subUl.style.display = 'block';
        }
    }
    parentUl.appendChild(li); // 将当前节点 <li> 添加到父列表 <ul>
}

// 根据路径在文件树层级结构中查找节点
function findNodeByPath(root, path) {
    if (!root || !path) return null; // 无效输入
    let currentLevel = root; // 从根节点开始
    const parts = path.split('/'); // 拆分路径
    for (const part of parts) {
        // 检查当前层级是否存在且有子节点，并且子节点中有对应的部分
        if (currentLevel && currentLevel.children && currentLevel.children[part]) {
            currentLevel = currentLevel.children[part]; // 进入下一层
        } else {
            return null; // 未找到
        }
    }
    return currentLevel; // 返回找到的节点
}

// 更新复选框状态 (处理子节点和父节点的联动)
function updateCheckStatus(node, checked) {
    if (!node || !node.checkbox || node.checkbox.disabled) return; // 节点或复选框无效或被禁用

    // 1. 更新当前节点的选中状态，并清除不确定状态
    node.checkbox.checked = checked;
    node.checkbox.indeterminate = false;

    // 2. 如果是目录，递归更新所有可见子节点的选中状态
    if (node.type === 'tree') {
        Object.values(node.children).forEach(child => {
            // 只更新当前可见的子节点，以匹配筛选逻辑
            if (child.isVisibleBasedOnFilters) {
                updateCheckStatus(child, checked); // 递归向下传递状态
            }
        });
    }

    // 3. 更新所有父级节点的选中状态 (递归向上)
    updateParentCheckbox(node);
}

// 根据子节点的选中状态，递归更新父节点的复选框状态 (checked, indeterminate, or unchecked)
function updateParentCheckbox(node) {
    const pathParts = node.path.split('/');
    if (pathParts.length <= 1) return; // 如果是根节点的直接子项，没有父节点需要更新

    const parentPath = pathParts.slice(0, -1).join('/'); // 获取父节点的路径
    const parentNode = findNodeByPath(fileHierarchy, parentPath); // 找到父节点

    if (!parentNode || !parentNode.checkbox || parentNode.checkbox.disabled) return; // 父节点无效或复选框无效/禁用

    let allChildrenChecked = true; // 标记：所有可见子节点是否都已选中
    let someChildrenChecked = false; // 标记：是否有任何可见子节点被选中或处于不确定状态
    let hasVisibleChildren = false; // 标记：是否存在可见的子节点

    // 遍历父节点的所有子节点
    Object.values(parentNode.children).forEach(child => {
        // 只考虑当前可见的子节点
        if (child.isVisibleBasedOnFilters && child.checkbox) {
            hasVisibleChildren = true; // 确实有可见子节点
            // 如果有一个可见子节点未选中且不是不确定状态，则不能算"全部选中"
            if (!child.checkbox.checked && !child.checkbox.indeterminate) {
                allChildrenChecked = false;
            }
            // 如果有一个可见子节点被选中或是父节点（处于不确定状态），则算"部分选中"
            if (child.checkbox.checked || child.checkbox.indeterminate) {
                someChildrenChecked = true;
            }
        }
    });

    // 根据子节点状态更新父节点复选框
    if (!hasVisibleChildren) { // 如果没有可见的子节点
        parentNode.checkbox.checked = false;
        parentNode.checkbox.indeterminate = false;
    } else if (allChildrenChecked) { // 如果所有可见子节点都选中了
        parentNode.checkbox.checked = true;
        parentNode.checkbox.indeterminate = false; // 清除不确定状态
    } else if (someChildrenChecked) { // 如果只有部分可见子节点被选中 (或子目录处于不确定状态)
        parentNode.checkbox.checked = false; // 不算完全选中
        parentNode.checkbox.indeterminate = true; // 设置为不确定状态 (中间态)
    } else { // 如果所有可见子节点都未选中
        parentNode.checkbox.checked = false;
        parentNode.checkbox.indeterminate = false; // 清除不确定状态
    }

    // 继续递归向上更新父节点的父节点
    updateParentCheckbox(parentNode);
}

// 初始化文件树中所有复选框的状态 (通常在渲染后调用，确保父目录状态正确)
function initializeCheckboxStates(node) {
    if (!node) return; // 无效节点

    let allChecked = true; // 标记：所有可见子节点是否默认选中
    let someChecked = false; // 标记：是否有任何可见子节点默认选中或不确定
    let hasVisibleChildren = false; // 标记：是否有可见子节点

    // 如果是目录，先递归初始化子节点状态，然后根据子节点状态决定自身状态
    if (node.type === 'tree') {
        Object.values(node.children).forEach(child => {
            if(child.isVisibleBasedOnFilters) { // 只考虑可见子节点
                hasVisibleChildren = true;
                initializeCheckboxStates(child); // 先递归处理子节点

                // 检查子节点的初始状态 (renderNode中文件是根据可见性初始化的)
                if (child.checkbox) {
                    if (!child.checkbox.checked && !child.checkbox.indeterminate) { allChecked = false; }
                    if (child.checkbox.checked || child.checkbox.indeterminate) { someChecked = true; }
                } else {
                    // 理论上可见节点应该有复选框，但做个安全检查
                    allChecked = false;
                }
            }
        });
    }

    // 更新当前目录节点的复选框状态 (仅当它是目录、有复选框且未被禁用时)
    if (node.type === 'tree' && node.checkbox && !node.checkbox.disabled) {
        if (!hasVisibleChildren) { // 没有可见子节点，目录本身不选中
            node.checkbox.checked = false;
            node.checkbox.indeterminate = false;
        } else if (allChecked) { // 所有可见子项初始都选中 (理论上只有文件，所以如果可见就都选中了)
            node.checkbox.checked = true;
            node.checkbox.indeterminate = false;
        } else if (someChecked) { // 部分可见子项初始选中 (如果混合了目录和文件，或未来逻辑变化)
            node.checkbox.checked = false;
            node.checkbox.indeterminate = true; // 设为不确定状态
        } else { // 所有可见子项初始都未选中 (不太可能发生，除非逻辑改动)
            node.checkbox.checked = false;
            node.checkbox.indeterminate = false;
        }
    }
    // 文件节点的初始选中状态在 renderNode 中已根据 isVisibleBasedOnFilters 设置，此处无需处理
}

// 统一的全选/全不选函数 (供 Select All / Deselect All 按钮使用)
function setAllVisibleCheckboxes(node, isChecked) {
    // 只处理可见的节点、有复选框且未被禁用的节点
    if (!node.isVisibleBasedOnFilters || !node.checkbox || node.checkbox.disabled) return;

    // 设置当前节点的选中状态，清除不确定状态
    node.checkbox.checked = isChecked;
    node.checkbox.indeterminate = false;

    // 如果是目录，递归对其所有子节点调用此函数 (注意：这里是递归调用自身)
    if (node.type === 'tree') {
        Object.values(node.children).forEach(child =>
            setAllVisibleCheckboxes(child, isChecked)
        );
    }
    // 不需要在这里调用 updateParentCheckbox，因为是全局操作，最后状态是一致的
}


// --- 核心逻辑 ---
// 这部分包含主要的事件处理函数，如按钮点击等

// 1. "获取结构" 按钮点击事件处理
if (fetchStructureBtn) {
    fetchStructureBtn.addEventListener('click', async () => {
        // 检查 URL 输入框是否存在且有值
        if (!repoUrlInput) {
            console.error("repoUrlInput element not found!");
            showError("初始化错误：无法找到 URL 输入框。");
            return;
        }
        const repoUrl = repoUrlInput.value.trim(); // 获取并去除首尾空格
        const pat = patInput ? patInput.value.trim() : null; // 获取 PAT (如果输入框存在)

        // 基础的 URL 验证
        if (!repoUrl) {
            showError('请输入 GitHub 仓库 URL。');
            return;
        }
        // 简单检查是否包含 'github.com/'
        if (!repoUrl.toLowerCase().includes('github.com/')) {
            showError('请输入有效的 GitHub 仓库 URL (例如：https://github.com/owner/repo)。');
            return;
        }

        // 保存当前 URL 和 PAT 到全局变量
        currentRepoUrl = repoUrl;
        currentPat = pat || null; // 如果 pat 是空字符串，也设为 null

        fetchStructureBtn.disabled = true; // 禁用按钮防止重复点击
        showStatus('正在获取仓库结构...', true); // 显示加载状态
        resetSubsequentSections(); // 重置界面后续部分

        try {
            console.log(`正在为 ${currentRepoUrl} 获取文件树 ${currentPat ? '使用' : '不使用'} PAT。`);
            // 发送 POST 请求到后端 API
            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    repoUrl: currentRepoUrl,
                    pat: currentPat,
                    action: 'getTree' // 指定请求的操作是获取文件树
                })
            });

            // 检查响应状态码
            if (!response.ok) {
                let errorData = { error: `请求失败，状态码: ${response.status}` };
                try {
                    // 尝试解析 JSON 格式的错误信息
                    errorData = await response.json();
                 } catch (e) {
                    // 如果响应体不是 JSON 或解析失败
                    errorData.error += `: ${response.statusText}`;
                 }
                // 抛出错误，优先使用后端返回的错误信息
                throw new Error(errorData.error || `获取结构失败 (Status: ${response.status})`);
            }

            // 解析成功的 JSON 响应
            const data = await response.json();
            fileTreeData = data.tree || []; // 获取文件列表，如果不存在则设为空数组
            console.log(`从后端收到 ${fileTreeData.length} 个项目 (文件+目录)。是否被截断: ${data.truncated}`);

            // 计算文件和目录数量
            const fileCount = fileTreeData.filter(i => i.type === 'blob').length;
            const dirCount = fileTreeData.filter(i => i.type === 'tree').length;

            // 准备状态消息
            let statusMsg = `获取结构成功。找到 ${fileCount} 个可处理文件和 ${dirCount} 个目录。`;
            if (data.truncated) { // 如果后端返回列表被截断，添加警告
                 statusMsg += ' (警告：由于仓库过大，文件列表可能不完整)';
            }
            if (fileTreeData.length === 0 && !data.truncated) { // 如果列表为空且未被截断
                 statusMsg = '获取结构成功，但未找到匹配过滤条件的文件或目录。';
            }
            showStatus(statusMsg, false); // 显示最终状态 (不带旋转图标)


            // 如果获取到了文件数据
            if (fileTreeData.length > 0) {
                // 1. 根据文件列表填充文件类型过滤器
                populateExtensionFilters(fileTreeData.filter(item => item.type === 'blob'));
                // 2. 渲染文件树
                renderFileTree(fileTreeData);
                // 3. 显示筛选区域和生成区域
                if (filterArea) filterArea.style.display = 'block';
                if (generationArea) generationArea.style.display = 'block';
                if (resultContainer) resultContainer.style.display = 'none'; // 确保结果区先隐藏
            } else {
                // 如果没有获取到文件数据，隐藏筛选和生成区域
                if (filterArea) filterArea.style.display = 'none';
                if (generationArea) generationArea.style.display = 'none';
            }

        } catch (error) {
            console.error('获取结构时出错:', error);
            showError(`获取结构失败: ${error.message}`); // 显示错误信息给用户
            resetSubsequentSections(); // 出错时重置界面
        } finally {
            // 无论成功或失败，最后都重新启用按钮，并隐藏加载动画
            if (fetchStructureBtn) fetchStructureBtn.disabled = false;
            if (spinner) spinner.style.display = 'none';
        }
    });
} else {
    console.warn("Warning: fetchStructureBtn element not found. 'Fetch Structure' functionality will not work.");
}


// 2. 填充文件类型过滤器 (基于获取到的文件列表)
function populateExtensionFilters(files) { // 参数 files 应该是只包含 blob 类型的文件列表
    if (!extensionFiltersContainer) {
        console.error("extensionFiltersContainer not found, cannot populate filters.");
        return;
    }
    availableExtensions.clear(); // 清空之前的可用扩展名集合

    // 遍历文件，提取可识别的扩展名或特殊文件名
    files.forEach(file => {
        const pathLower = file.path.toLowerCase();
        const parts = pathLower.split('.');
        let filterKey = null;
        // 尝试提取扩展名
        if (parts.length > 1) {
            const ext = '.' + parts.pop();
            if (ALLOWED_EXTENSIONS_FRONTEND.has(ext)) {
                filterKey = ext;
            }
        }
        // 如果没有扩展名或扩展名不匹配，尝试匹配特殊文件名
        if (!filterKey) {
            const filename = pathLower.substring(pathLower.lastIndexOf('/') + 1);
            if (ALLOWED_EXTENSIONS_FRONTEND.has(filename)) {
                filterKey = filename;
            }
        }
        // 如果找到了有效的 filterKey，添加到集合中
        if (filterKey) availableExtensions.add(filterKey);
    });

    extensionFiltersContainer.innerHTML = ''; // 清空现有的过滤器元素
    activeFilters = new Set(availableExtensions); // 默认所有找到的类型都激活
    const sortedExtensions = Array.from(availableExtensions).sort(); // 排序以获得一致的显示顺序

    // 如果没有找到任何可识别的文件类型
    if (sortedExtensions.length === 0) {
        extensionFiltersContainer.innerHTML = '<span class="placeholder-text">未找到可供筛选的已知文件类型。</span>';
        return;
    }

    // 为每个找到的文件类型创建复选框和标签
    sortedExtensions.forEach(extOrType => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = extOrType;
        checkbox.checked = true; // 默认选中
        checkbox.addEventListener('change', handleFilterChange); // 添加事件监听器
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${extOrType}`)); // 显示类型名称
        extensionFiltersContainer.appendChild(label); // 添加到容器中
    });
}


// 3. 处理文件类型过滤器复选框的变化
// 创建防抖版本的渲染函数
const debouncedRenderFileTree = debounce((data) => {
    renderFileTree(data);
}, 200); // 200ms 延迟

// 替换原有的 handleFilterChange 函数
function handleFilterChange() {
    activeFilters.clear();
    if (!extensionFiltersContainer) return;

    const checkboxes = extensionFiltersContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        if (cb.checked) {
            activeFilters.add(cb.value);
        }
    });
    
    // 使用防抖处理的渲染函数
    debouncedRenderFileTree(fileTreeData);
}



// 4. 渲染文件树 (主函数，调用多个助手函数)
function renderFileTree(items) { // items 是从后端获取的原始文件列表
    if (!fileTreeContainer) {
        console.error("fileTreeContainer not found, cannot render tree.");
        return;
    }
    fileTreeContainer.innerHTML = ''; // 清空之前的文件树

    // 1. 构建文件层级结构
    const hierarchy = buildHierarchy(items);
    fileHierarchy = hierarchy; // 将构建好的层级结构保存到全局变量

    // 2. 应用当前的过滤器，标记节点的可见性
    applyVisibility(hierarchy);

    // 3. 创建文件树的根 <ul> 元素
    const rootUl = document.createElement('ul');
    rootUl.className = 'file-tree-root';

    // 检查根目录下是否有任何可见内容
    const rootHasVisibleContent = Object.values(hierarchy.children).some(child => child.isVisibleBasedOnFilters);

    // 根据是否有可见内容显示不同的提示
    if (!rootHasVisibleContent && items.length > 0) {
         fileTreeContainer.innerHTML = '<div class="placeholder-text">没有文件匹配当前的筛选条件。</div>';
         return; // 不再继续渲染空的树
    } else if (items.length === 0) {
         fileTreeContainer.innerHTML = '<div class="placeholder-text">仓库中未找到任何文件或目录。</div>';
         return; // 仓库本身为空
    }

    // 4. 渲染文件树的顶层节点
    Object.values(hierarchy.children) // 获取根节点的所有子节点
        .sort((a, b) => { // 排序：目录在前，文件在后，同类型按名称
            if (a.type !== b.type) { return a.type === 'tree' ? -1 : 1; }
            return a.name.localeCompare(b.name);
        })
        .forEach(node => renderNode(node, rootUl, true)); // 调用 renderNode 渲染每个顶层节点

    // 5. 将渲染好的根 <ul> 添加到容器中
    fileTreeContainer.appendChild(rootUl);

    // 6. 为所有新渲染的复选框添加事件监听器
    const allCheckboxes = fileTreeContainer.querySelectorAll('.file-tree-checkbox');
    allCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            // 当复选框状态改变时，找到对应的节点数据
            const node = findNodeByPath(fileHierarchy, cb.value);
            if (node) {
                // 调用 updateCheckStatus 处理状态联动 (向下和向上更新)
                updateCheckStatus(node, cb.checked);
            }
        });
    });

    // 7. 初始化所有复选框的状态 (尤其是父目录的 indeterminate 状态)
    initializeCheckboxStates(fileHierarchy);
}


// --- 全选 / 全不选按钮事件监听 ---
if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
        if (!fileHierarchy) return; // 确保文件树已构建
        // 对根节点的每个直接子节点调用 setAllVisibleCheckboxes 设置为 true (选中)
        Object.values(fileHierarchy.children).forEach(rootChild =>
            setAllVisibleCheckboxes(rootChild, true)
        );
    });
} else {
     console.warn("Warning: selectAllBtn element not found. 'Select All' functionality will not work.");
}

if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', () => {
        if (!fileHierarchy) return; // 确保文件树已构建
        // 对根节点的每个直接子节点调用 setAllVisibleCheckboxes 设置为 false (取消选中)
        Object.values(fileHierarchy.children).forEach(rootChild =>
            setAllVisibleCheckboxes(rootChild, false)
        );
    });
} else {
    console.warn("Warning: deselectAllBtn element not found. 'Deselect All' functionality will not work.");
}


// 5. "生成文本" 按钮点击事件处理
if (generateTextBtn) {
    generateTextBtn.addEventListener('click', async () => {
        const selectedFiles = []; // 用于存储选中的文件路径
        if (!fileHierarchy) {
            showError("文件树数据不可用。");
            return;
        }

        // 定义一个递归函数来收集所有选中的文件路径
        function collectCheckedFiles(node) {
            if (!node.isVisibleBasedOnFilters) return; // 跳过不可见的节点

            // 如果是文件且被选中
            if (node.type === 'blob' && node.checkbox && node.checkbox.checked) {
                selectedFiles.push(node.path);
            }
            // 如果是目录且其复选框被选中或处于不确定状态 (表示其下有选中的文件)
            else if (node.type === 'tree' && node.children) {
                 if(node.checkbox && (node.checkbox.checked || node.checkbox.indeterminate)) {
                    // 递归遍历其子节点
                    Object.values(node.children).forEach(collectCheckedFiles);
                 }
            }
        }
        // 从根节点的子节点开始收集
        Object.values(fileHierarchy.children).forEach(collectCheckedFiles);
        // 使用 Set 去重，以防万一有重复路径被添加
        const uniqueSelectedFiles = [...new Set(selectedFiles)];

        // 如果没有选中任何文件
        if (uniqueSelectedFiles.length === 0) {
            showError('请至少在文件树中选择一个文件来生成文本。');
            if (resultContainer) resultContainer.style.display = 'none'; // 隐藏结果区域
            return;
        }

        console.log(`正在为 ${uniqueSelectedFiles.length} 个选定文件生成文本。`);
        generateTextBtn.disabled = true; // 禁用按钮
        showStatus('正在生成合并后的文本内容...', true); // 显示加载状态
        if (resultContainer) resultContainer.style.display = 'none'; // 生成前先隐藏旧结果

        try {
            // 发送请求到后端执行 'generateText' 操作
            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    repoUrl: currentRepoUrl,
                    pat: currentPat,
                    action: 'generateText', // 指定操作
                    selectedFiles: uniqueSelectedFiles // 发送选中的文件列表
                })
            });

            // 检查响应状态
            if (!response.ok) {
                let errorData = { error: `请求失败，状态码: ${response.status}` };
                try { errorData = await response.json(); } catch (e) { errorData.error += `: ${response.statusText}`; }
                throw new Error(errorData.error || `生成文本失败 (Status: ${response.status})`);
            }

            // 解析成功的响应
            const data = await response.json();
            // 保存生成的结构和内容到全局变量
            generatedContent = data.content || "";
            generatedStructure = data.structure || "";

            // 在预览区域显示结果
            if (structurePreview) structurePreview.textContent = generatedStructure || "(未能生成文件结构)";
            if (contentPreview) contentPreview.textContent = generatedContent || "(未能生成文件内容或所有文件被跳过)";
            if (resultContainer) resultContainer.style.display = 'block'; // 显示结果区域
            hideStatusAndError(); // 隐藏之前的状态或错误信息
            showStatus(`已从 ${uniqueSelectedFiles.length} 个选定文件生成文本。请在下方预览。`, false); // 显示成功状态

            // !!! 调用计算并显示 Token 数量的函数 !!!
            calculateAndDisplayTokenCount(generatedStructure + "\n" + generatedContent);

        } catch (error) {
            console.error('生成文本时出错:', error);
            showError(`生成文本时出错: ${error.message}`);
            if (resultContainer) resultContainer.style.display = 'none';
        } finally {
            // 无论成功失败，最后都恢复按钮状态并隐藏加载动画
            if (generateTextBtn) generateTextBtn.disabled = false;
            if (spinner) spinner.style.display = 'none';
        }
    });
} else {
    console.warn("Warning: generateTextBtn element not found. 'Generate Text' functionality will not work.");
}

// --- Token 计数功能 ---
// 使用简单的启发式方法估算 token 数量
function calculateTokenCount(text) {
    if (!text) return 0;
    
    // 1. 将文本分割成单词（考虑各种分隔符）
    const words = text.split(/[\s\n\t\r.,!?;:(){}\[\]<>"'`~|\\/@#$%^&*+=_-]+/)
                     .filter(word => word.length > 0);
    
    // 2. 统计单词中的字符总数
    const totalChars = words.reduce((sum, word) => sum + word.length, 0);
    
    // 3. 使用启发式规则计算预估 token 数：
    // - 每个单词平均约为 1.3 tokens（考虑到一些单词会被分成多个 token）
    // - 加上标点符号和空格等额外 token
    const estimatedTokens = Math.ceil(words.length * 1.3 + (text.length - totalChars) * 0.5);
    
    return estimatedTokens;
}

// 显示 Token 计数的函数
function calculateAndDisplayTokenCount(text) {
    if (!tokenCountArea) return;
    
    const count = calculateTokenCount(text);
    tokenCountArea.style.display = 'block';
    tokenCountArea.textContent = `预估 Token 数量: ${count.toLocaleString()}`;
    
    // 根据数量添加视觉提示
    if (count > 6000) {
        tokenCountArea.style.color = '#dc3545'; // 红色警告
    } else if (count > 4000) {
        tokenCountArea.style.color = '#ffc107'; // 黄色警告
    } else {
        tokenCountArea.style.color = '#28a745'; // 绿色安全
    }
}

// 在文件末尾添加
document.addEventListener('DOMContentLoaded', () => {
    // 获取所有需要添加事件监听的元素
    const elements = {
        fetchStructureBtn,
        selectAllBtn,
        deselectAllBtn,
        generateTextBtn,
        copyBtn,
        downloadTxtBtn,
        extensionFiltersContainer,
        repoForm
    };

    // 检查并记录缺失的元素
    const missingElements = Object.entries(elements)
        .filter(([key, element]) => !element)
        .map(([key]) => key);

    if (missingElements.length > 0) {
        console.warn('Warning: The following elements were not found:', missingElements);
    }

    // 替换现有的复制按钮事件处理器
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

    // 替换现有的下载按钮事件处理器
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
