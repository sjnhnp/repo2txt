// /functions/api/generate.js

// --- Configuration --- (保持不变)
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
const MAX_FILES_TO_PROCESS = 500;
const MAX_TOTAL_SIZE_MB = 10;

// --- Helper Functions ---

// parseGitHubUrl (保持不变)
function parseGitHubUrl(url) {
    // ... (代码同上一版，保持不变) ...
    console.log(`Attempting to parse URL: "${url}"`);
    if (!url || typeof url !== 'string') {
         console.log("Parsing failed: URL is null or not a string.");
         return null;
    }
    const match = url.trim().match(/^(?:https?:\/\/)?github\.com\/([^\/]+)\/([^\/]+?)(?:\/tree\/([^\/]+?))?\/?$/i);
    if (match) {
        const parsed = {
            owner: match[1],
            repo: match[2],
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
            nodes.add(currentPath + '/'); // Add directory path (ensure trailing slash for distinction if needed)
        }
    });

    // 2. Convert set to array and sort for proper tree order
    const sortedNodes = Array.from(nodes).sort();

    // 3. Build the tree structure (nested object representation)
    const tree = {};
    sortedNodes.forEach(path => {
        let currentLevel = tree;
        const parts = path.replace(/\/$/, '').split('/'); // Remove trailing slash for splitting
        parts.forEach((part, index) => {
            if (!currentLevel[part]) {
                currentLevel[part] = {}; // Create node if it doesn't exist
            }
            // Move to the next level only if it's not the last part (filename)
            // Or if the path originally ended with '/', indicating it's a directory explicitly added
            if (index < parts.length - 1 || path.endsWith('/')) {
                 currentLevel = currentLevel[part];
            } else {
                // Mark the file node distinctly if needed, e.g., with a special property or null value
                currentLevel[part] = null; // Indicate this is a file leaf node in our structure
            }

        });
    });

    // 4. Recursive function to generate the text tree lines
    let output = "Selected Files Structure:\n./\n"; // Start with root
    function buildTreeLines(subtree, prefix = '', isRoot = true) {
        const keys = Object.keys(subtree).sort(); // Sort keys alphabetically at each level
        keys.forEach((key, index) => {
            const isLast = index === keys.length - 1;
            const connector = isLast ? '└── ' : '├── ';
            const nodeName = key;
            output += `${prefix}${connector}${nodeName}\n`;

            // If the value is an object (directory), recurse
            if (subtree[key] !== null && typeof subtree[key] === 'object') {
                const newPrefix = prefix + (isLast ? '    ' : '│   ');
                buildTreeLines(subtree[key], newPrefix, false);
            }
        });
    }

    buildTreeLines(tree); // Start generation from the root
    return output + '\n'; // Add a final newline
}


// --- Main Request Handler ---
export async function onRequestPost(context) {
    const { request, env } = context;
    const corsHeaders = { /* ... */ }; // Keep CORS Headers
    if (request.method === 'OPTIONS') { /* ... */ } // Keep OPTIONS handling
    if (request.method !== 'POST') { /* ... */ } // Keep POST check

    try {
        const requestData = await request.json();
        const { repoUrl, action, selectedFiles, pat } = requestData;

        console.log("Backend received:", { repoUrl, action, patProvided: !!pat, selectedFilesCount: selectedFiles?.length });

        // --- Input Validation (保持不变) ---
        if (!repoUrl) { /* ... */ }
        if (!action) { /* ... */ }
        const repoInfo = parseGitHubUrl(repoUrl);
        if (!repoInfo) { /* ... */ }
        const { owner, repo, branch } = repoInfo;
        const GITHUB_TOKEN = pat || env.GITHUB_TOKEN;
        if (!GITHUB_TOKEN) { /* ... */ }
        const authHeader = `Bearer ${GITHUB_TOKEN}`;
        const baseHeaders = { /* ... */ };

        // --- Action: Get Tree (MODIFIED) ---
        if (action === 'getTree') {
            console.log(`Action: getTree for ${owner}/${repo}/${branch}`);
            const treeApiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

            const treeResponse = await fetch(treeApiUrl, { headers: baseHeaders });

             // --- Handle GitHub API Errors (保持不变) ---
            if (!treeResponse.ok) {
                 // ... (Error handling 401, 403, 404, etc. as before) ...
                 const status = treeResponse.status;
                 let errorBodyText = "Could not read error body.";
                 try { errorBodyText = await treeResponse.text(); } catch (e) { console.error("Failed to read error body:", e); }
                 console.error(`Failed to fetch tree: ${status} ${treeResponse.statusText}. Body: ${errorBodyText}`);
                 if (status === 401) { return new Response(JSON.stringify({ error: 'Authentication failed...' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}); }
                 if (status === 403) { /* Rate limit or permissions check */ return new Response(JSON.stringify({ error: 'Access forbidden...' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}); }
                 if (status === 404) { return new Response(JSON.stringify({ error: 'Repository, branch, or tree not found...' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}); }
                 return new Response(JSON.stringify({ error: `Failed to fetch repository tree from GitHub (Status: ${status}).` }), { status: status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            // --- Process Successful Tree Response (MODIFIED) ---
            const treeData = await treeResponse.json();
            let isTruncated = treeData.truncated || false;

            if (isTruncated) {
                console.warn(`Repository tree is truncated by GitHub API.`);
            }

            // Filter items: Keep all 'tree' (directory) nodes unless explicitly excluded by path.
            // Keep 'blob' (file) nodes only if they are allowed by extension AND not excluded by path.
            const filteredTree = treeData.tree.filter(item => {
                const pathLower = item.path.toLowerCase();
                const filename = pathLower.substring(pathLower.lastIndexOf('/') + 1);

                // Check general path exclusions first (affects both files and dirs)
                const isExcludedByPath = DEFAULT_EXCLUDES.some(excludeRule => {
                     if (excludeRule.endsWith('/')) { // Directory exclusion
                         return pathLower.startsWith(excludeRule) || item.path + '/' === excludeRule; // Check if item path starts with or exactly matches dir rule
                     } else if (excludeRule.startsWith('*.')) { // Extension wildcard (applies to files)
                          return item.type === 'blob' && pathLower.endsWith(excludeRule.substring(1));
                     } else { // Exact file match or filename match (applies to files)
                         return item.type === 'blob' && (pathLower === excludeRule || filename === excludeRule);
                     }
                 });

                if (isExcludedByPath) {
                    return false; // Exclude if path matches rule
                }

                // If it's a directory ('tree') and not excluded by path, keep it.
                if (item.type === 'tree') {
                    return true;
                }

                // If it's a file ('blob'), check extension allowlist.
                if (item.type === 'blob') {
                    const extension = pathLower.includes('.') ? pathLower.substring(pathLower.lastIndexOf('.')) : filename;
                    const isAllowed = ALLOWED_EXTENSIONS.has(extension) || ALLOWED_EXTENSIONS.has(filename); // Allow extension or specific filenames
                    return isAllowed; // Keep if allowed and not excluded by path
                }

                return false; // Should not happen, but exclude unknown types
            });

            console.log(`Returning ${filteredTree.length} items (files and dirs) to frontend after filtering.`);

            // Send the filtered list (blobs and trees) to the frontend
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

            // Validate selectedFiles input (保持不变)
            if (!selectedFiles || !Array.isArray(selectedFiles)) { /* ... */ }
            if (selectedFiles.length === 0) { /* ... */ }
            if (selectedFiles.length > MAX_FILES_TO_PROCESS) { /* ... */ }

            // Generate the TEXT TREE structure string for the *selected* files (Feature 6 - NEW FORMAT)
            const structureString = generateStructureString(selectedFiles); // Use the new function

            let combinedContent = "";
            let fetchedFileCount = 0;
            let totalSize = 0;
            const sizeLimitBytes = MAX_TOTAL_SIZE_MB * 1024 * 1024;
            let sizeLimitReached = false;

            // Fetch content logic (保持不变)
            const fetchPromises = selectedFiles.map(async (filePath) => {
                // ... (fetch logic including size checks, retries etc. as before) ...
                 if (sizeLimitReached) { return { path: filePath, content: null, error: `Skipped: Total size limit (${MAX_TOTAL_SIZE_MB}MB) already reached.` }; }
                 const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodeURI(filePath)}`;
                 try {
                     const contentResponse = await fetch(rawUrl, { headers: { 'Authorization': authHeader } });
                     if (contentResponse.ok) {
                         const fileContent = await contentResponse.text();
                         const fileSize = new Blob([fileContent]).size;
                         if (totalSize + fileSize > sizeLimitBytes) {
                             console.warn(`Skipping ${filePath}: Exceeds size limit.`);
                             sizeLimitReached = true;
                             return { path: filePath, content: null, error: `Skipped: Exceeds total size limit (${MAX_TOTAL_SIZE_MB}MB).` };
                         }
                         totalSize += fileSize;
                         return { path: filePath, content: fileContent, error: null };
                     } else {
                         console.warn(`Skipping file ${filePath}: Failed fetch (Status: ${contentResponse.status})`);
                         return { path: filePath, content: null, error: `Error fetching: HTTP ${contentResponse.status}` };
                     }
                 } catch (fetchError) {
                     console.warn(`Skipping file ${filePath}: Network error: ${fetchError.message}`);
                     return { path: filePath, content: null, error: `Network error: ${fetchError.message}` };
                 }
            });

            const results = await Promise.all(fetchPromises);

            // Combine results into the final text output (保持不变)
            results.forEach(result => {
                 if (result.content !== null) {
                     combinedContent += `--- File: ${result.path} ---\n\n${result.content}\n\n`;
                     fetchedFileCount++;
                 } else {
                     combinedContent += `--- Skipped File: ${result.path} (${result.error || 'Unknown reason'}) ---\n\n`;
                 }
            });

            console.log(`Successfully processed ${fetchedFileCount} out of ${selectedFiles.length} selected files. Total fetched size: ${(totalSize / (1024*1024)).toFixed(2)} MB.`);
            if (sizeLimitReached) { combinedContent += `\n\n--- WARNING: Reached total size limit (${MAX_TOTAL_SIZE_MB}MB). Output may be incomplete. ---\n`; }

            // Return structure (new format) and combined content
            return new Response(JSON.stringify({
                 content: combinedContent,
                 structure: structureString // Include the generated text tree string
             }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // --- Unknown Action (保持不变) ---
        else { /* ... */ }

    } catch (error) {
        // --- Error Handling (保持不变) ---
        console.error('Unhandled error:', error);
        return new Response(JSON.stringify({ error: `An unexpected server error occurred.` }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
}

