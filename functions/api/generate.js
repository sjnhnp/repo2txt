// /functions/api/generate.js

// --- 配置项 (和之前 Worker 代码类似) ---
const ALLOWED_EXTENSIONS = new Set([ '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.less', '.html', '.htm', '.xml', '.yaml', '.yml', '.md', '.markdown', '.txt', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.php', '.rb', '.swift', '.kt', '.kts', '.sh', '.bash', '.zsh', '.sql', '.dockerfile', 'dockerfile', '.env', '.gitignore', '.gitattributes', '.toml', '.ini', '.cfg', '.conf', '.properties', '.gradle', '.lua', '.rs']);
const DEFAULT_EXCLUDES = ['.git/', 'node_modules/', 'dist/', 'build/', 'target/', 'vendor/', '.DS_Store', 'package-lock.json', 'yarn.lock', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.ico', '.mp4', '.mov', '.avi', '.wmv', '.mp3', '.wav', '.ogg', '.zip', '.tar', '.gz', '.rar', '.7z', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.exe', '.dll', '.so', '.app', '.dmg'];
const MAX_FILES_TO_PROCESS = 500; // 文件处理上限

/**
 * Pages Function Handler
 * @param {EventContext<Env, Params, Data>} context
 *  - context.request: The incoming request object
 *  - context.env: Environment variables and secrets (like GITHUB_TOKEN)
 *  - context.params: Route parameters (if any)
 *  - context.next: Function to call the next middleware or function
 *  - context.waitUntil: For tasks after the response
 *  - context.data: Data shared between middleware
 */
export async function onRequestPost(context) {
    const { request, env } = context; // 获取请求对象和环境变量

     // 设置 CORS 头 (虽然同源部署可能不需要，但明确设置更健壮)
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*', // 或者更严格地设置为你的 Pages 域名
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    // 处理 CORS 预检请求 (对于 Pages Functions, Cloudflare 可能自动处理，但显式处理无害)
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    // 只允许 POST
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    try {
        const { repoUrl } = await request.json();

        if (!repoUrl) {
            return new Response(JSON.stringify({ error: 'Missing repoUrl in request body' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // 1. 解析 GitHub URL
        const repoInfo = parseGitHubUrl(repoUrl);
        if (!repoInfo) {
            return new Response(JSON.stringify({ error: 'Invalid GitHub repository URL format' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
        const { owner, repo, branch } = repoInfo;
        console.log(`Processing repository: ${owner}/${repo}, branch: ${branch}`);

        // **重要：从环境变量获取 GitHub Token (通过 Pages UI 设置)**
        const GITHUB_TOKEN = env.GITHUB_TOKEN;
        if (!GITHUB_TOKEN) {
           console.error("GITHUB_TOKEN secret is not set in Pages Function environment!");
           return new Response(JSON.stringify({ error: 'Server configuration error: Missing GitHub Token' }), {
               status: 500,
               headers: { ...corsHeaders, 'Content-Type': 'application/json' },
           });
        }
        const authHeader = `Bearer ${GITHUB_TOKEN}`;

        // 2. 获取仓库文件树
        const treeApiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
        console.log(`Fetching tree: ${treeApiUrl}`);
        const treeResponse = await fetch(treeApiUrl, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': authHeader,
                'User-Agent': 'Repo2Txt-Cloudflare-Pages-Function'
            }
        });

        if (!treeResponse.ok) {
            console.error(`Failed to fetch tree: ${treeResponse.status} ${treeResponse.statusText}`);
             const errorBody = await treeResponse.text();
             console.error("GitHub API Error Body:", errorBody);
            return new Response(JSON.stringify({ error: `Failed to fetch repository tree from GitHub (Status: ${treeResponse.status}). Check URL or token permissions.` }), {
                status: treeResponse.status,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const treeData = await treeResponse.json();

        if (treeData.truncated) {
            console.warn(`Repository tree is truncated.`);
            return new Response(JSON.stringify({ error: 'Repository is too large, file tree is truncated by GitHub API.' }), {
                status: 413,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // 3. 筛选文件 (逻辑同前)
        const filesToFetch = treeData.tree
            .filter(item => item.type === 'blob')
            .filter(item => {
                const pathLower = item.path.toLowerCase();
                const extension = pathLower.substring(pathLower.lastIndexOf('.'));
                const isAllowedExt = ALLOWED_EXTENSIONS.has(extension) || ALLOWED_EXTENSIONS.has(pathLower.substring(pathLower.lastIndexOf('/') + 1));
                const isExcluded = DEFAULT_EXCLUDES.some(exclude =>
                    exclude.endsWith('/') ? pathLower.startsWith(exclude) : pathLower.endsWith(exclude)
                );
                return isAllowedExt && !isExcluded;
            });

        console.log(`Found ${filesToFetch.length} text files to process.`);
         if (filesToFetch.length === 0) {
             return new Response(JSON.stringify({ error: 'No processable text files found in the repository based on current filters.' }), {
                status: 404,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // 4. 获取文件内容 (串行，可优化)
        let combinedContent = "";
        let fetchedFileCount = 0;
        for (const file of filesToFetch) {
            if (fetchedFileCount >= MAX_FILES_TO_PROCESS) {
                console.warn(`Reached maximum file processing limit (${MAX_FILES_TO_PROCESS}). Stopping.`);
                combinedContent += `\n\n--- WARNING: Reached file processing limit (${MAX_FILES_TO_PROCESS}). Output might be incomplete. ---\n`;
                break;
             }
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
            console.log(`Fetching content: ${file.path}`);
            try {
                // 注意：raw.githubusercontent.com 通常不需要 Token，但为了以防万一
                 const contentResponse = await fetch(rawUrl, { headers: { 'Authorization': authHeader }});
                if (contentResponse.ok) {
                    const fileContent = await contentResponse.text();
                    combinedContent += `--- File: ${file.path} ---\n\n${fileContent}\n\n`;
                    fetchedFileCount++;
                } else {
                    console.warn(`Skipping file ${file.path}: Failed fetch (Status: ${contentResponse.status})`);
                    combinedContent += `--- Skipped File: ${file.path} (Error: ${contentResponse.status}) ---\n\n`;
                }
            } catch (fetchError) {
                 console.warn(`Skipping file ${file.path}: Network error: ${fetchError.message}`);
                 combinedContent += `--- Skipped File: ${file.path} (Error: Network Issue) ---\n\n`;
            }
            // await new Promise(resolve => setTimeout(resolve, 50)); // 可选延迟
        }
        console.log(`Successfully processed ${fetchedFileCount} files.`);

        // 5. 返回合并后的文本内容
        const outputFilename = `${repo}_${branch}_content.txt`;
        return new Response(combinedContent, {
            status: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/plain; charset=utf-8',
                'Content-Disposition': `attachment; filename="${outputFilename}"`
            }
        });

    } catch (error) {
        console.error('Unhandled error in Pages Function:', error);
        return new Response(JSON.stringify({ error: 'An unexpected server error occurred.' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
}

// 辅助函数：解析 GitHub URL (同前)
function parseGitHubUrl(url) {
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.hostname !== 'github.com') return null;
        const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
        if (pathParts.length < 2) return null;
        const owner = pathParts[0];
        const repo = pathParts[1];
        let branch = 'main'; // Default
        if (pathParts.length >= 4 && pathParts[2] === 'tree') {
            branch = pathParts[3];
        } else {
            console.warn("Branch not specified in URL, defaulting to 'main'.");
        }
        return { owner, repo, branch };
    } catch (e) {
        console.error("URL Parsing Error:", e);
        return null;
    }
}

// 可选：处理 OPTIONS 请求 (虽然可能 Cloudflare 会自动处理)
export async function onRequestOptions(context) {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*', // Or your specific Pages domain
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400', // Cache preflight response for 1 day
      },
    });
}
