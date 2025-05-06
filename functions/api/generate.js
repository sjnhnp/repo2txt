// --- Configuration ---
const ALLOWED_EXTENSIONS = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.less', '.html', '.htm',
    '.xml', '.yaml', '.yml', '.md', '.markdown', '.txt', '.py', '.java', '.c', '.cpp',
    '.h', '.hpp', '.cs', '.go', '.php', '.rb', '.swift', '.kt', '.kts', '.sh', '.bash',
    '.zsh', '.sql', '.dockerfile', 'dockerfile', '.env', '.gitignore', '.gitattributes',
    '.toml', '.ini', '.cfg', '.conf', '.properties', '.gradle', '.lua', '.rs',
]);

const DEFAULT_EXCLUDES = [
    'node_modules/',
    'dist/',
    'build/',
    'out/',
    '.git/',
    '.github/',
    'package-lock.json',
    'yarn.lock',
    '.DS_Store',
    '.vscode/',
    '.idea/',
    'venv/',
    '.env',
    '*.log',
    '*.lock',
    '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.svg',
    '*.mp3', '*.mp4', '*.avi', '*.mov',
    '*.pdf', '*.doc', '*.docx', '*.xls', '*.xlsx', '*.ppt', '*.pptx',
    '*.zip', '*.gz', '*.rar', '*.7z', '*.tar',
    '*.exe', '*.dll', '*.so', '*.dylib', '*.bin',
    '*.pyc', '*.class', '*.o',
];

const MAX_FILES_TO_PROCESS = 500; // 限制选择的文件数量
const MAX_TOTAL_SIZE_MB = 10; // 限制总内容大小(MB)
const DEBUG_MODE = false; // 调试模式开关

// --- Helper Functions ---

/**
 * 记录日志，可根据DEBUG_MODE决定是否记录详细信息
 * @param {string} message 日志消息
 * @param {string} level 日志级别 ('info', 'error', 'warn', 'debug')
 */
function log(message, level = 'info') {
    if (level === 'debug' && !DEBUG_MODE) return;
    
    switch(level) {
        case 'error':
            console.error(message);
            break;
        case 'warn':
            console.warn(message);
            break;
        case 'debug':
            console.log(`[DEBUG] ${message}`);
            break;
        default:
            console.log(message);
    }
}

/**
 * 解析GitHub URL以提取所有者、仓库和分支信息
 * @param {string} url GitHub URL字符串
 * @returns {object|null} 包含 { owner, repo, branch } 的对象,无效则返回null
 */
function parseGitHubUrl(url) {
    log(`尝试解析URL: "${url}"`, 'debug');
    if (!url || typeof url !== 'string') {
        log("解析失败: URL为空或不是字符串", 'debug');
        return null;
    }
    
    const match = url.trim().match(/^(?:https?:\/\/)?github\.com\/([^\/]+)\/([^\/]+?)(?:\/tree\/([^\/]+?))?\/?$/i);
    
    if (match) {
        const parsed = {
            owner: match[1],
            repo: match[2],
            branch: match[3] || 'HEAD', // 使用HEAD作为默认值
        };
        log("URL解析成功:", 'debug');
        log(parsed, 'debug');
        return parsed;
    }
    
    log("解析失败: URL格式不匹配", 'debug');
    return null;
}

/**
 * 从选定路径中准备节点列表
 * @param {Array<string>} selectedPaths 选定的文件路径数组
 * @returns {Array<string>} 排序后的所有节点路径(包括父目录)
 */
function _prepareNodeList(selectedPaths) {
    const nodes = new Set();
    
    selectedPaths.forEach(path => {
        // 添加文件本身
        nodes.add(path);
        
        // 添加所有父目录路径
        let currentPath = '';
        const parts = path.split('/');
        for (let i = 0; i < parts.length - 1; i++) {
            currentPath += (currentPath ? '/' : '') + parts[i];
            nodes.add(currentPath + '/'); // 为目录添加尾部斜杠以区分
        }
    });

    // 转换为数组并排序
    return Array.from(nodes).sort();
}

/**
 * 从排序的节点列表构建树形对象
 * @param {Array<string>} sortedNodes 排序后的节点路径数组
 * @returns {Object} 嵌套的树形对象
 */
function _buildTreeObject(sortedNodes) {
    const tree = {};
    
    sortedNodes.forEach(path => {
        let currentLevel = tree;
        const isDir = path.endsWith('/');
        const parts = path.replace(/\/$/, '').split('/');

        parts.forEach((part, index) => {
            if (!currentLevel[part]) {
                currentLevel[part] = {};
            }
            
            if (index < parts.length - 1 || isDir) {
                currentLevel = currentLevel[part];
            } else {
                currentLevel[part] = null; // 标记为文件节点
            }
        });
    });

    return tree;
}

/**
 * 将树形对象格式化为文本树字符串
 * @param {Object} treeObject 树形对象
 * @returns {string} 格式化的文本树
 */
function _formatTreeToString(treeObject) {
    let output = "Selected Files Structure:\n./\n";

    function buildTreeLines(subtree, prefix = '') {
        const keys = Object.keys(subtree).sort();
        keys.forEach((key, index) => {
            const isLast = index === keys.length - 1;
            const connector = isLast ? '└── ' : '├── ';
            const nodeName = key;
            output += `${prefix}${connector}${nodeName}\n`;

            if (subtree[key] !== null && typeof subtree[key] === 'object') {
                const newPrefix = prefix + (isLast ? '    ' : '│   ');
                buildTreeLines(subtree[key], newPrefix);
            }
        });
    }

    buildTreeLines(treeObject);
    return output + '\n';
}

/**
 * 生成选定文件的树形结构字符串表示
 * @param {Array<string>} selectedPaths 选定的文件路径数组
 * @returns {string} 格式化的文本树
 */
function generateStructureString(selectedPaths) {
    if (!selectedPaths || selectedPaths.length === 0) {
        return "Selected Files Structure:\n(No files selected)\n";
    }

    // 1. 准备节点列表
    const sortedNodes = _prepareNodeList(selectedPaths);

    // 2. 构建树形对象
    const treeObject = _buildTreeObject(sortedNodes);

    // 3. 格式化为文本树
    return _formatTreeToString(treeObject);
}

/**
 * 创建统一错误响应
 * @param {string} message 错误消息
 * @param {number} status HTTP状态码
 * @param {object} corsHeaders CORS头信息
 * @returns {Response} 格式化的响应对象
 */
function createErrorResponse(message, status, corsHeaders) {
    return new Response(
        JSON.stringify({ error: message }), 
        { 
            status: status, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
    );
}

// --- Main Request Handler ---
export async function onRequestPost(context) {
    const { request, env } = context;

    // 标准CORS头
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Action, Authorization',
    };

    // 处理CORS预检请求
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    // 只允许POST请求
    if (request.method !== 'POST') {
        return createErrorResponse('Method Not Allowed', 405, corsHeaders);
    }

    try {
        // 解析请求体JSON数据
        const requestData = await request.json();
        const { repoUrl, action, selectedFiles, pat } = requestData;

        log("后端收到请求数据:", 'info');
        log({ 
            repoUrl, 
            action, 
            patProvided: !!pat, 
            selectedFilesCount: selectedFiles?.length 
        }, 'debug');

        // --- 输入验证 ---
        if (!repoUrl) {
            log("后端错误: 请求体中缺少repoUrl", 'error');
            return createErrorResponse('Missing repoUrl', 400, corsHeaders);
        }
        if (!action) {
            log("后端错误: 请求体中缺少action", 'error');
            return createErrorResponse('Missing action parameter (e.g., getTree, generateText)', 400, corsHeaders);
        }

        // 1. 解析URL
        const repoInfo = parseGitHubUrl(repoUrl);
        if (!repoInfo) {
            log(`后端错误: parseGitHubUrl解析失败，输入: "${repoUrl}"`, 'error');
            return createErrorResponse('Invalid GitHub repository URL format', 400, corsHeaders);
        }
        const { owner, repo, branch } = repoInfo;

        // 2. 获取Token
        const GITHUB_TOKEN = pat || env.GITHUB_TOKEN;
        if (!GITHUB_TOKEN) {
            log("未在Cloudflare Pages环境中设置GITHUB_TOKEN密钥且未提供PAT。", 'error');
            return createErrorResponse('Server configuration error or missing token.', 500, corsHeaders);
        }
        const authHeader = `Bearer ${GITHUB_TOKEN}`;
        const baseHeaders = {
             'Accept': 'application/vnd.github.v3+json',
             'Authorization': authHeader,
             'User-Agent': 'Repo2Txt-Cloudflare-Pages-Function-Tree-V1'
        };

        // --- Action: Get Tree ---
        if (action === 'getTree') {
            log(`执行动作: getTree，目标 ${owner}/${repo}/${branch}`, 'debug');
            const treeApiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

            const treeResponse = await fetch(treeApiUrl, { headers: baseHeaders });

            // 处理GitHub API错误
            if (!treeResponse.ok) {
                const status = treeResponse.status;
                let errorBodyText = "无法读取错误响应体。";
                try { 
                    errorBodyText = await treeResponse.text(); 
                } catch (e) { 
                    log("读取错误响应体失败:", 'error');
                    log(e, 'debug');
                }
                
                log(`获取树结构失败: ${status} ${treeResponse.statusText}. Body: ${errorBodyText}`, 'error');
                
                if (status === 401) { 
                    return createErrorResponse('Authentication failed. Invalid GitHub Token or PAT. Check token permissions (repo scope needed for private repos).', 401, corsHeaders);
                }
                
                if (status === 403) {
                    if (errorBodyText.includes("API rate limit exceeded")) { 
                        return createErrorResponse('GitHub API rate limit exceeded. Please try again later or provide a Personal Access Token (PAT).', 429, corsHeaders);
                    }
                    return createErrorResponse('Access forbidden. Check token permissions or repository access rights.', 403, corsHeaders);
                }
                
                if (status === 404) { 
                    return createErrorResponse('Repository, branch, or tree not found. Check the URL and branch name.', 404, corsHeaders);
                }
                
                return createErrorResponse(`Failed to fetch repository tree from GitHub (Status: ${status}).`, status, corsHeaders);
            }

            // 处理成功的树结构响应
            const treeData = await treeResponse.json();
            let isTruncated = treeData.truncated || false;

            if (isTruncated) { 
                log(`仓库树结构被GitHub API截断。`, 'warn'); 
            }

            // 过滤项目
            const filteredTree = treeData.tree.filter(item => {
                const pathLower = item.path.toLowerCase();
                const filename = pathLower.substring(pathLower.lastIndexOf('/') + 1);

                // 首先检查通用路径排除
                const isExcludedByPath = DEFAULT_EXCLUDES.some(excludeRule => {
                     if (excludeRule.endsWith('/')) {
                         return pathLower.startsWith(excludeRule) || item.path + '/' === excludeRule;
                     } else if (excludeRule.startsWith('*.')) {
                          return item.type === 'blob' && pathLower.endsWith(excludeRule.substring(1));
                     } else {
                         return item.type === 'blob' && (pathLower === excludeRule || filename === excludeRule);
                     }
                });

                if (isExcludedByPath) return false;

                // 保留未被排除的目录
                if (item.type === 'tree') return true;

                // 检查文件是否允许
                if (item.type === 'blob') {
                    const extension = pathLower.includes('.') ? 
                        pathLower.substring(pathLower.lastIndexOf('.')) : 
                        filename;
                    const isAllowed = ALLOWED_EXTENSIONS.has(extension) || 
                        ALLOWED_EXTENSIONS.has(filename);
                    return isAllowed;
                }

                return false; // 排除未知类型
            });

            log(`过滤后返回 ${filteredTree.length} 个项目(文件和目录)给前端。`, 'debug');

            // 发送过滤后的列表
            return new Response(
                JSON.stringify({
                     tree: filteredTree,
                     truncated: isTruncated,
                     message: isTruncated ? 
                        'Warning: Repository is large, file list may be incomplete.' : 
                        null
                }), 
                {
                    status: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                }
            );
        }

        // --- Action: Generate Text ---
        else if (action === 'generateText') {
            log(`执行动作: generateText，目标 ${owner}/${repo}/${branch}`, 'debug');

            // 验证selectedFiles输入
            if (!selectedFiles || !Array.isArray(selectedFiles)) {
                return createErrorResponse('Missing or invalid selectedFiles array', 400, corsHeaders);
            }
            
            if (selectedFiles.length === 0) {
                return new Response(
                    JSON.stringify({ 
                        content: "No files selected for processing.", 
                        structure: "" 
                    }), 
                    { 
                        status: 200, 
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
                    }
                );
            }
            
            if (selectedFiles.length > MAX_FILES_TO_PROCESS) {
                log(`选择的文件太多: ${selectedFiles.length}, 限制: ${MAX_FILES_TO_PROCESS}`, 'warn');
                return createErrorResponse(`Too many files selected (${selectedFiles.length}). Please select ${MAX_FILES_TO_PROCESS} or fewer.`, 413, corsHeaders);
            }

            // 生成选定文件的树形结构字符串
            const structureString = generateStructureString(selectedFiles);

            let combinedContent = "";
            let fetchedFileCount = 0;
            let totalSize = 0;
            const sizeLimitBytes = MAX_TOTAL_SIZE_MB * 1024 * 1024;
            let sizeLimitReached = false;

            // 记录文件获取开始
            log(`开始获取 ${selectedFiles.length} 个文件的内容...`, 'info');

            // 获取每个选定文件的内容
            const fetchPromises = selectedFiles.map(async (filePath) => {
                 if (sizeLimitReached) {
                     return { 
                         path: filePath, 
                         content: null, 
                         error: `Skipped: Total size limit (${MAX_TOTAL_SIZE_MB}MB) already reached.` 
                     };
                 }
                
                const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodeURIComponent(filePath)}`;
                log(`获取文件内容: ${filePath}`, 'debug');
                
                try {
                    const contentResponse = await fetch(rawUrl, { 
                        headers: { 'Authorization': authHeader } 
                    });
                    
                    if (contentResponse.ok) {
                        const fileContent = await contentResponse.text();
                        const fileSize = new Blob([fileContent]).size;
                        
                        if (totalSize + fileSize > sizeLimitBytes) {
                            log(`跳过 ${filePath}: 添加此文件(大小约 ${(fileSize/1024).toFixed(1)}KB) 将超过总大小限制 (${MAX_TOTAL_SIZE_MB}MB).`, 'warn');
                            sizeLimitReached = true;
                            return { 
                                path: filePath, 
                                content: null, 
                                error: `Skipped: Exceeds total size limit (${MAX_TOTAL_SIZE_MB}MB).` 
                            };
                        }
                        
                        totalSize += fileSize;
                        return { 
                            path: filePath, 
                            content: fileContent, 
                            error: null 
                        };
                    } else {
                        log(`跳过文件 ${filePath}: 获取失败 (状态: ${contentResponse.status} ${contentResponse.statusText})`, 'warn');
                        const errorReason = contentResponse.status === 404 ? 
                            "File not found at this path/branch" : 
                            `HTTP Error ${contentResponse.status}`;
                        return { 
                            path: filePath, 
                            content: null, 
                            error: `Error fetching: ${errorReason}` 
                        };
                    }
                } catch (fetchError) {
                    log(`跳过文件 ${filePath}: 网络错误: ${fetchError.message}`, 'warn');
                    return { 
                        path: filePath, 
                        content: null, 
                        error: `Network error: ${fetchError.message}` 
                    };
                }
            });

            const results = await Promise.all(fetchPromises);

            // 记录文件获取完成
            log(`文件内容获取完成`, 'info');

            // 组合结果到最终输出文本
            results.forEach(result => {
                 if (result.content !== null) {
                     combinedContent += `--- File: ${result.path} ---\n\n${result.content}\n\n`;
                     fetchedFileCount++;
                 } else {
                     combinedContent += `--- Skipped File: ${result.path} (${result.error || 'Unknown reason'}) ---\n\n`;
                 }
            });

            log(`成功处理 ${fetchedFileCount} / ${selectedFiles.length} 个选定文件。总获取大小: ${(totalSize / (1024*1024)).toFixed(2)} MB.`, 'info');
            
            if (sizeLimitReached) {
                combinedContent += `\n\n--- WARNING: Reached total size limit (${MAX_TOTAL_SIZE_MB}MB). Output may be incomplete. Processed ${fetchedFileCount} files. ---\n`;
            }

            // 返回结构和组合内容
            return new Response(
                JSON.stringify({
                     content: combinedContent,
                     structure: structureString
                }), 
                {
                    status: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                }
            );
        }

        // --- 未知Action ---
        else {
            log(`后端错误: 请求了未知的action: ${action}`, 'error');
            return createErrorResponse(`Unknown action: ${action}`, 400, corsHeaders);
        }

    } catch (error) {
        // 捕获意外错误
        log('Pages Function中的未处理错误:', 'error');
        log(error, 'error');
        return createErrorResponse(`An unexpected server error occurred.`, 500, corsHeaders);
    }
}
