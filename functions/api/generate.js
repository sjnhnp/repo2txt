// /functions/api/generate.js (Modified)

// --- Configuration (Keep ALLOWED_EXTENSIONS, DEFAULT_EXCLUDES, MAX_FILES for filtering/limits) ---
const ALLOWED_EXTENSIONS = new Set([ /* ... same as before ... */ ]);
const DEFAULT_EXCLUDES = [ /* ... same as before ... */ ];
const MAX_FILES_TO_PROCESS = 500;
const MAX_TOTAL_SIZE_MB = 10; // Add a total size limit (e.g., 10MB)

// --- Helper Functions (Keep parseGitHubUrl) ---
function parseGitHubUrl(url) { /* ... same as before ... */ }

function generateStructureString(files) {
    // Basic text representation of the tree structure
    let structure = ".";
    const sortedFiles = files.slice().sort((a, b) => a.path.localeCompare(b.path)); // Sort for consistent structure
    const buildTree = (items, prefix = "", level = 0) => {
        let output = "";
        const indent = "  ".repeat(level);
        const connector = level > 0 ? "└─ " : ""; // Simple connector

        const directChildren = new Map(); // path -> type ('blob' or 'tree')

        items.forEach(item => {
             // Get the part of the path relative to the current prefix
            let relativePath = item.path;
            if (prefix) {
                if (!relativePath.startsWith(prefix + '/')) return; // Should not happen if filtered correctly
                relativePath = relativePath.substring(prefix.length + 1);
            }

            const parts = relativePath.split('/');
            const childName = parts[0];

            if (!directChildren.has(childName)) {
                // If it's the last part, it's the item itself (file or could be an empty dir marker if we had 'tree' types)
                 if (parts.length === 1) {
                     directChildren.set(childName, item.type); // Store type ('blob')
                 } else {
                    // Otherwise, it represents a directory containing this item
                    directChildren.set(childName, 'tree');
                 }
            }
        });

        // Sort children alphabetically, maybe directories first
        const sortedChildren = Array.from(directChildren.keys()).sort((a, b) => {
            const typeA = directChildren.get(a);
            const typeB = directChildren.get(b);
            if (typeA === 'tree' && typeB !== 'tree') return -1;
            if (typeA !== 'tree' && typeB === 'tree') return 1;
            return a.localeCompare(b);
        });

        sortedChildren.forEach((name, index) => {
             const isLast = index === sortedChildren.length - 1;
            const currentConnector = isLast ? "└─ " : "├─ ";
            const childType = directChildren.get(name);
            output += `\n${indent}${currentConnector}${name}`;

            if (childType === 'tree') {
                // Find all items that are descendants of this directory
                 const descendants = items.filter(item => item.path.startsWith((prefix ? prefix + '/' : '') + name + '/'));
                 // Recursive call for the subdirectory
                output += buildTree(descendants, (prefix ? prefix + '/' : '') + name, level + 1);
            }
        });
        return output;
    }
    // We only receive selected 'blob' items, so buildTree needs adapting or a simpler list format
    // Simpler approach for now: just list selected files
    structure = "Selected Files Structure:\n";
    sortedFiles.forEach(file => {
      structure += `- ${file.path}\n`;
    });
    return structure + '\n';
}


// --- Main Request Handler ---
export async function onRequestPost(context) {
    const { request, env } = context;
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Action', // Allow custom header if needed
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    try {
        const requestData = await request.json();
        const { repoUrl, action, selectedFiles, pat } = requestData; // Expect 'action' and possibly 'selectedFiles', 'pat'

        if (!repoUrl) {
            return new Response(JSON.stringify({ error: 'Missing repoUrl' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (!action) {
             return new Response(JSON.stringify({ error: 'Missing action parameter (e.g., getTree, generateText)' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 1. Parse URL and Get Token
        const repoInfo = parseGitHubUrl(repoUrl);
        if (!repoInfo) {
            return new Response(JSON.stringify({ error: 'Invalid GitHub repository URL format' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const { owner, repo, branch } = repoInfo;

        // Use provided PAT if available, otherwise use environment variable, otherwise fail
        const GITHUB_TOKEN = pat || env.GITHUB_TOKEN; // Prioritize user-provided PAT
        if (!GITHUB_TOKEN) {
            console.error("GITHUB_TOKEN secret is not set and no PAT provided.");
            return new Response(JSON.stringify({ error: 'Server configuration error: Missing GitHub Token and no PAT provided in request.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const authHeader = `Bearer ${GITHUB_TOKEN}`;
        const baseHeaders = {
             'Accept': 'application/vnd.github.v3+json',
             'Authorization': authHeader,
             'User-Agent': 'Repo2Txt-Cloudflare-Pages-Function-V2'
        };

        // --- Action: Get Tree ---
        if (action === 'getTree') {
            console.log(`Action: getTree for ${owner}/${repo}/${branch}`);
            const treeApiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
            const treeResponse = await fetch(treeApiUrl, { headers: baseHeaders });

            if (!treeResponse.ok) {
                console.error(`Failed to fetch tree: ${treeResponse.status} ${treeResponse.statusText}`);
                const errorBody = await treeResponse.text();
                console.error("GitHub API Error Body:", errorBody);
                 // Check for rate limiting
                 if (treeResponse.status === 403 && errorBody.includes("API rate limit exceeded")) {
                    return new Response(JSON.stringify({ error: 'GitHub API rate limit exceeded. Please try again later or provide a Personal Access Token.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                 }
                 if (treeResponse.status === 401) {
                      return new Response(JSON.stringify({ error: 'Invalid GitHub Token or PAT. Check token permissions (repo scope needed for private repos).' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                 }
                 if (treeResponse.status === 404) {
                      return new Response(JSON.stringify({ error: 'Repository or branch not found. Check the URL.' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                 }
                 return new Response(JSON.stringify({ error: `Failed to fetch repository tree (Status: ${treeResponse.status}).` }), { status: treeResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            const treeData = await treeResponse.json();

            if (treeData.truncated) {
                console.warn(`Repository tree is truncated.`);
                // Return the truncated tree anyway, but include a warning
                 return new Response(JSON.stringify({
                     tree: treeData.tree.filter(item => item.type === 'blob'), // Only return blobs for simplicity now
                     truncated: true,
                     message: 'Warning: Repository is large, file list may be incomplete.'
                 }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            // Filter blobs based on extensions/exclusions *before* sending to frontend
            const filteredBlobs = treeData.tree
                .filter(item => item.type === 'blob')
                .filter(item => {
                    const pathLower = item.path.toLowerCase();
                    const extension = pathLower.substring(pathLower.lastIndexOf('.'));
                    const filename = pathLower.substring(pathLower.lastIndexOf('/') + 1);
                    // Allow if extension matches OR filename itself matches (e.g. Dockerfile)
                    const isAllowedExt = ALLOWED_EXTENSIONS.has(extension) || ALLOWED_EXTENSIONS.has(filename);
                    const isExcluded = DEFAULT_EXCLUDES.some(exclude =>
                         exclude.endsWith('/')
                           ? pathLower.startsWith(exclude.toLowerCase())
                           : pathLower === exclude.toLowerCase() || pathLower.endsWith('/' + exclude.toLowerCase()) // Check full path or end segment
                    );
                    return isAllowedExt && !isExcluded;
                 });

            console.log(`Found ${filteredBlobs.length} potential files.`);

            return new Response(JSON.stringify({ tree: filteredBlobs, truncated: false }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // --- Action: Generate Text ---
        else if (action === 'generateText') {
            console.log(`Action: generateText for ${owner}/${repo}/${branch}`);
            if (!selectedFiles || !Array.isArray(selectedFiles)) {
                return new Response(JSON.stringify({ error: 'Missing or invalid selectedFiles array' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            if (selectedFiles.length === 0) {
                 return new Response(JSON.stringify({ content: "No files selected for processing.", structure: "" }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            if (selectedFiles.length > MAX_FILES_TO_PROCESS) {
                console.warn(`Too many files selected: ${selectedFiles.length}`);
                return new Response(JSON.stringify({ error: `Too many files selected. Please select ${MAX_FILES_TO_PROCESS} or fewer.` }), { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            // Generate structure string (6)
            // Need the file objects (path, type) not just paths for the better generator
            // For now, create dummy file objects for the simple generator
            const fileObjectsForStructure = selectedFiles.map(path => ({ path: path, type: 'blob'}));
            const structureString = generateStructureString(fileObjectsForStructure);

            let combinedContent = "";
            let fetchedFileCount = 0;
            let totalSize = 0;
            const sizeLimitBytes = MAX_TOTAL_SIZE_MB * 1024 * 1024;

             // Fetch content (Consider parallel fetches for performance, but be mindful of rate limits)
             // Using Promise.all for parallel fetches:
             const fetchPromises = selectedFiles.map(async (filePath) => {
                 // Check total size before fetching next file
                 if (totalSize > sizeLimitBytes) {
                     console.warn(`Skipping ${filePath}: Total size limit reached.`);
                     return { path: filePath, content: null, error: `Skipped: Total size limit (${MAX_TOTAL_SIZE_MB}MB) reached.` };
                 }

                const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodeURI(filePath)}`; // Use encodeURI for paths with spaces etc.
                console.log(`Fetching content: ${filePath}`);
                try {
                    // Use token for raw content access for private repos or higher rate limits
                    const contentResponse = await fetch(rawUrl, { headers: { 'Authorization': authHeader }}); // Pass token here too!

                    if (contentResponse.ok) {
                        const fileContent = await contentResponse.text();
                        const fileSize = new Blob([fileContent]).size; // Estimate size

                        if (totalSize + fileSize > sizeLimitBytes) {
                            console.warn(`Skipping ${filePath}: Adding this file would exceed the total size limit.`);
                             return { path: filePath, content: null, error: `Skipped: Adding this file exceeds total size limit (${MAX_TOTAL_SIZE_MB}MB).` };
                        }
                        totalSize += fileSize;
                        return { path: filePath, content: fileContent, error: null };
                    } else {
                        console.warn(`Skipping file ${filePath}: Failed fetch (Status: ${contentResponse.status})`);
                        return { path: filePath, content: null, error: `Error fetching: Status ${contentResponse.status}` };
                    }
                } catch (fetchError) {
                    console.warn(`Skipping file ${filePath}: Network error: ${fetchError.message}`);
                    return { path: filePath, content: null, error: `Network error: ${fetchError.message}` };
                }
            });

            const results = await Promise.all(fetchPromises);

            // Combine results
            results.forEach(result => {
                 if (result.content !== null) {
                     combinedContent += `--- File: ${result.path} ---\n\n${result.content}\n\n`;
                     fetchedFileCount++;
                 } else {
                     combinedContent += `--- Skipped File: ${result.path} (${result.error || 'Unknown reason'}) ---\n\n`;
                 }
            });


            console.log(`Successfully processed ${fetchedFileCount} files. Total size: ${(totalSize / (1024*1024)).toFixed(2)} MB.`);

            if (totalSize > sizeLimitBytes) {
                combinedContent += `\n\n--- WARNING: Reached total size limit (${MAX_TOTAL_SIZE_MB}MB). Output might be incomplete. ---\n`;
             }

            // Return structure and content
            return new Response(JSON.stringify({
                 content: combinedContent,
                 structure: structureString // Include the structure string
             }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // --- Unknown Action ---
        else {
            return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

    } catch (error) {
        console.error('Unhandled error in Pages Function:', error);
        // Attempt to send more detailed error in development? Be cautious in production.
        const errorMessage = (error instanceof Error) ? error.message : 'An unexpected server error occurred.';
        return new Response(JSON.stringify({ error: `An unexpected server error occurred. ${errorMessage}` }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
}
