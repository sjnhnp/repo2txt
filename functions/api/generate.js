// /functions/api/generate.js
// THIS IS THE COMPLETE CODE FOR THIS FILE - NO OMISSIONS

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
    '.env', // Exclude .env files by default for security, unless explicitly needed
    '*.log',
    '*.lock',
    // Add binary file extensions or other patterns if necessary
    '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.svg',
    '*.mp3', '*.mp4', '*.avi', '*.mov',
    '*.pdf', '*.doc', '*.docx', '*.xls', '*.xlsx', '*.ppt', '*.pptx',
    '*.zip', '*.gz', '*.rar', '*.7z', '*.tar',
    '*.exe', '*.dll', '*.so', '*.dylib', '*.bin',
    '*.pyc', '*.class', '*.o',
];
const MAX_FILES_TO_PROCESS = 500; // Limit number of files selected for generation
const MAX_TOTAL_SIZE_MB = 10; // Limit total size of content fetched (in MB)

// --- Helper Functions ---

/**
 * Parses a GitHub URL to extract owner, repo, and branch.
 * @param {string} url The GitHub URL string.
 * @returns {object|null} An object with { owner, repo, branch } or null if invalid.
 */
function parseGitHubUrl(url) {
    console.log(`Attempting to parse URL: "${url}"`); // Keep for debugging
    if (!url || typeof url !== 'string') {
        console.log("Parsing failed: URL is null or not a string.");
        return null;
    }
    // Matches: https://github.com/owner/repo OR https://github.com/owner/repo/tree/branch (optional trailing slash)
    // Allows http or https
    const match = url.trim().match(/^(?:https?:\/\/)?github\.com\/([^\/]+)\/([^\/]+?)(?:\/tree\/([^\/]+?))?\/?$/i);
    if (match) {
        const parsed = {
            owner: match[1],
            repo: match[2],
            // Use 'HEAD' as default. The GitHub API uses HEAD to refer to the default branch.
            branch: match[3] || 'HEAD',
        };
        console.log("URL parsed successfully:", parsed);
        return parsed;
    }
    console.log("Parsing failed: URL regex did not match.");
    return null;
}


/**
 * NEW: Generates a text tree representation of the selected file structure.
 * @param {Array<string>} selectedPaths Array of selected file paths.
 * @returns {string} A string representing the text tree.
 */
function generateStructureString(selectedPaths) {
    if (!selectedPaths || selectedPaths.length === 0) {
        return "Selected Files Structure:\n(No files selected)\n";
    }

    // 1. Build a set of all nodes (files and directories) needed for the tree
    const nodes = new Set();
    selectedPaths.forEach(path => {
        nodes.add(path); // Add the file itself
        let currentPath = '';
        const parts = path.split('/');
        // Add all parent directory paths
        for (let i = 0; i < parts.length - 1; i++) {
            currentPath += (currentPath ? '/' : '') + parts[i];
            nodes.add(currentPath + '/'); // Add directory path (ensure trailing slash for distinction)
        }
    });

    // 2. Convert set to array and sort for proper tree order
    const sortedNodes = Array.from(nodes).sort();

    // 3. Build the tree structure (nested object representation)
    const tree = {};
    sortedNodes.forEach(path => {
        let currentLevel = tree;
        const isDir = path.endsWith('/');
        const parts = path.replace(/\/$/, '').split('/'); // Remove trailing slash for splitting

        parts.forEach((part, index) => {
            if (!currentLevel[part]) {
                currentLevel[part] = {}; // Create node if it doesn't exist
            }
            // Move to the next level only if it's not the last part
            // Or if the path originally ended with '/', indicating it's a directory explicitly added
            if (index < parts.length - 1 || isDir) {
                 currentLevel = currentLevel[part];
            } else {
                // Mark the file node distinctly by setting value to null
                currentLevel[part] = null; // Indicate this is a file leaf node in our structure
            }
        });
    });

    // 4. Recursive function to generate the text tree lines
    let output = "Selected Files Structure:\n./\n"; // Start with root
    function buildTreeLines(subtree, prefix = '') {
        const keys = Object.keys(subtree).sort(); // Sort keys alphabetically at each level
        keys.forEach((key, index) => {
            const isLast = index === keys.length - 1;
            const connector = isLast ? '└── ' : '├── ';
            const nodeName = key;
            output += `${prefix}${connector}${nodeName}\n`;

            // If the value is an object (directory), recurse
            if (subtree[key] !== null && typeof subtree[key] === 'object') {
                const newPrefix = prefix + (isLast ? '    ' : '│   ');
                buildTreeLines(subtree[key], newPrefix);
            }
        });
    }

    buildTreeLines(tree); // Start generation from the root
    return output + '\n'; // Add a final newline
}


// --- Main Request Handler ---
export async function onRequestPost(context) {
    const { request, env } = context;

    // Standard CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*', // Adjust if needed
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Action, Authorization',
    };

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    // Only allow POST requests
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    try {
        // Parse the JSON body from the request
        const requestData = await request.json();
        const { repoUrl, action, selectedFiles, pat } = requestData;

        console.log("Backend received request data:", { repoUrl, action, patProvided: !!pat, selectedFilesCount: selectedFiles?.length });

        // --- Input Validation ---
        if (!repoUrl) {
            console.error("Backend Error: Missing repoUrl in request body");
            return new Response(JSON.stringify({ error: 'Missing repoUrl' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (!action) {
            console.error("Backend Error: Missing action in request body");
            return new Response(JSON.stringify({ error: 'Missing action parameter (e.g., getTree, generateText)' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 1. Parse URL
        const repoInfo = parseGitHubUrl(repoUrl);
        if (!repoInfo) {
            console.error(`Backend Error: parseGitHubUrl failed for input: "${repoUrl}"`);
            return new Response(JSON.stringify({ error: 'Invalid GitHub repository URL format' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const { owner, repo, branch } = repoInfo;

        // 2. Get Token
        const GITHUB_TOKEN = pat || env.GITHUB_TOKEN;
        if (!GITHUB_TOKEN) {
            console.error("GITHUB_TOKEN secret is not set in Cloudflare Pages environment and no PAT provided.");
            return new Response(JSON.stringify({ error: 'Server configuration error or missing token.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const authHeader = `Bearer ${GITHUB_TOKEN}`;
        const baseHeaders = {
             'Accept': 'application/vnd.github.v3+json',
             'Authorization': authHeader,
             'User-Agent': 'Repo2Txt-Cloudflare-Pages-Function-Tree-V1' // Update User-Agent
        };

        // --- Action: Get Tree (MODIFIED to return dirs and files) ---
        if (action === 'getTree') {
            console.log(`Action: getTree for ${owner}/${repo}/${branch}`);
            const treeApiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

            const treeResponse = await fetch(treeApiUrl, { headers: baseHeaders });

            // --- Handle GitHub API Errors ---
            if (!treeResponse.ok) {
                const status = treeResponse.status;
                let errorBodyText = "Could not read error body.";
                try { errorBodyText = await treeResponse.text(); } catch (e) { console.error("Failed to read error body:", e); }
                console.error(`Failed to fetch tree: ${status} ${treeResponse.statusText}. Body: ${errorBodyText}`);
                if (status === 401) { return new Response(JSON.stringify({ error: 'Authentication failed. Invalid GitHub Token or PAT. Check token permissions (repo scope needed for private repos).' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}); }
                if (status === 403) {
                     if (errorBodyText.includes("API rate limit exceeded")) { return new Response(JSON.stringify({ error: 'GitHub API rate limit exceeded. Please try again later or provide a Personal Access Token (PAT).' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}); }
                     return new Response(JSON.stringify({ error: 'Access forbidden. Check token permissions or repository access rights.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                 }
                if (status === 404) { return new Response(JSON.stringify({ error: 'Repository, branch, or tree not found. Check the URL and branch name.' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}); }
                return new Response(JSON.stringify({ error: `Failed to fetch repository tree from GitHub (Status: ${status}).` }), { status: status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            // --- Process Successful Tree Response (MODIFIED filtering) ---
            const treeData = await treeResponse.json();
            let isTruncated = treeData.truncated || false;

            if (isTruncated) { console.warn(`Repository tree is truncated by GitHub API.`); }

            // Filter items: Keep all 'tree' (directory) nodes unless explicitly excluded by path.
            // Keep 'blob' (file) nodes only if they are allowed by extension AND not excluded by path.
            const filteredTree = treeData.tree.filter(item => {
                const pathLower = item.path.toLowerCase();
                const filename = pathLower.substring(pathLower.lastIndexOf('/') + 1);

                // Check general path exclusions first
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

                // Keep directories ('tree') if not excluded
                if (item.type === 'tree') return true;

                // Keep files ('blob') if allowed by extension/name and not excluded
                if (item.type === 'blob') {
                    const extension = pathLower.includes('.') ? pathLower.substring(pathLower.lastIndexOf('.')) : filename;
                    const isAllowed = ALLOWED_EXTENSIONS.has(extension) || ALLOWED_EXTENSIONS.has(filename);
                    return isAllowed;
                }

                return false; // Exclude unknown types
            });

            console.log(`Returning ${filteredTree.length} items (files and dirs) to frontend after filtering.`);

            // Send the filtered list (blobs and trees)
            return new Response(JSON.stringify({
                 tree: filteredTree, // Array of { path: '...', sha: '...', type: 'tree'|'blob', ... }
                 truncated: isTruncated,
                 message: isTruncated ? 'Warning: Repository is large, file list may be incomplete.' : null
             }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // --- Action: Generate Text (MODIFIED - uses new generateStructureString) ---
        else if (action === 'generateText') {
            console.log(`Action: generateText for ${owner}/${repo}/${branch}`);

            // Validate selectedFiles input
            if (!selectedFiles || !Array.isArray(selectedFiles)) {
                return new Response(JSON.stringify({ error: 'Missing or invalid selectedFiles array' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            if (selectedFiles.length === 0) {
                 return new Response(JSON.stringify({ content: "No files selected for processing.", structure: "" }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            if (selectedFiles.length > MAX_FILES_TO_PROCESS) {
                console.warn(`Too many files selected: ${selectedFiles.length}, limit: ${MAX_FILES_TO_PROCESS}`);
                return new Response(JSON.stringify({ error: `Too many files selected (${selectedFiles.length}). Please select ${MAX_FILES_TO_PROCESS} or fewer.` }), { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            // Generate the TEXT TREE structure string for the *selected* files
            const structureString = generateStructureString(selectedFiles); // Use the new function

            let combinedContent = "";
            let fetchedFileCount = 0;
            let totalSize = 0;
            const sizeLimitBytes = MAX_TOTAL_SIZE_MB * 1024 * 1024;
            let sizeLimitReached = false;

            // Fetch content for each selected file
            const fetchPromises = selectedFiles.map(async (filePath) => {
                 if (sizeLimitReached) {
                     return { path: filePath, content: null, error: `Skipped: Total size limit (${MAX_TOTAL_SIZE_MB}MB) already reached.` };
                 }
                const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodeURI(filePath)}`;
                console.log(`Fetching content for: ${filePath}`);
                try {
                    const contentResponse = await fetch(rawUrl, { headers: { 'Authorization': authHeader } });
                    if (contentResponse.ok) {
                        const fileContent = await contentResponse.text();
                        const fileSize = new Blob([fileContent]).size;
                        if (totalSize + fileSize > sizeLimitBytes) {
                            console.warn(`Skipping ${filePath}: Adding this file (size ~${(fileSize/1024).toFixed(1)}KB) would exceed the total size limit (${MAX_TOTAL_SIZE_MB}MB).`);
                            sizeLimitReached = true;
                            return { path: filePath, content: null, error: `Skipped: Exceeds total size limit (${MAX_TOTAL_SIZE_MB}MB).` };
                        }
                        totalSize += fileSize;
                        return { path: filePath, content: fileContent, error: null };
                    } else {
                        console.warn(`Skipping file ${filePath}: Failed fetch (Status: ${contentResponse.status} ${contentResponse.statusText})`);
                        const errorReason = contentResponse.status === 404 ? "File not found at this path/branch" : `HTTP Error ${contentResponse.status}`;
                        return { path: filePath, content: null, error: `Error fetching: ${errorReason}` };
                    }
                } catch (fetchError) {
                    console.warn(`Skipping file ${filePath}: Network error during fetch: ${fetchError.message}`);
                    return { path: filePath, content: null, error: `Network error: ${fetchError.message}` };
                }
            });

            const results = await Promise.all(fetchPromises);

            // Combine results into the final text output
            results.forEach(result => {
                 if (result.content !== null) {
                     combinedContent += `--- File: ${result.path} ---\n\n${result.content}\n\n`;
                     fetchedFileCount++;
                 } else {
                     combinedContent += `--- Skipped File: ${result.path} (${result.error || 'Unknown reason'}) ---\n\n`;
                 }
            });

            console.log(`Successfully processed ${fetchedFileCount} out of ${selectedFiles.length} selected files. Total fetched size: ${(totalSize / (1024*1024)).toFixed(2)} MB.`);
            if (sizeLimitReached) {
                combinedContent += `\n\n--- WARNING: Reached total size limit (${MAX_TOTAL_SIZE_MB}MB). Output may be incomplete. Processed ${fetchedFileCount} files. ---\n`;
             }

            // Return structure (text tree) and combined content
            return new Response(JSON.stringify({
                 content: combinedContent,
                 structure: structureString // Include the generated text tree string
             }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // --- Unknown Action ---
        else {
            console.error(`Backend Error: Unknown action requested: ${action}`);
            return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

    } catch (error) {
        // --- Catch unexpected errors ---
        console.error('Unhandled error in Pages Function:', error);
        return new Response(JSON.stringify({ error: `An unexpected server error occurred.` }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
}
// END OF /functions/api/generate.js
