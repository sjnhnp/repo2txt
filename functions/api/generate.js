// /functions/api/generate.js

// --- Configuration ---
const ALLOWED_EXTENSIONS = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.less', '.html', '.htm',
    '.xml', '.yaml', '.yml', '.md', '.markdown', '.txt', '.py', '.java', '.c', '.cpp',
    '.h', '.hpp', '.cs', '.go', '.php', '.rb', '.swift', '.kt', '.kts', '.sh', '.bash',
    '.zsh', '.sql', '.dockerfile', 'dockerfile', '.env', '.gitignore', '.gitattributes',
    '.toml', '.ini', '.cfg', '.conf', '.properties', '.gradle', '.lua', '.rs',
    // Add other extensions or specific filenames (like Dockerfile) as needed
]);

// Files/directories to exclude entirely (lowercase)
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
 * Generates a simple text representation of the selected file structure.
 * @param {Array<object>} files Array of file objects (must have 'path' property).
 * @returns {string} A string representing the structure.
 */
function generateStructureString(files) {
    // Basic text representation of the tree structure for *selected* files
    let structure = "Selected Files Structure:";
    if (!files || files.length === 0) {
        return structure + "\n(No files selected or processed)\n";
    }

    // Sort files by path for a consistent output
    const sortedFiles = files.slice().sort((a, b) => a.path.localeCompare(b.path));

    // Simple list format
    structure += "\n";
    sortedFiles.forEach(file => {
      structure += `- ${file.path}\n`; // Just list the path
    });

    return structure + '\n'; // Add a newline at the end
}


// --- Main Request Handler ---
export async function onRequestPost(context) {
    const { request, env } = context;

    // Standard CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*', // Allow any origin (adjust if needed for security)
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Action, Authorization', // Allow Content-Type, maybe others if used
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
        const { repoUrl, action, selectedFiles, pat } = requestData; // Expect 'action', 'repoUrl', maybe 'selectedFiles', 'pat'

        console.log("Backend received request data:", { repoUrl, action, patProvided: !!pat, selectedFilesCount: selectedFiles?.length }); // Log received data

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

        // 2. Get Token (Prioritize user PAT, fallback to environment variable)
        const GITHUB_TOKEN = pat || env.GITHUB_TOKEN;
        if (!GITHUB_TOKEN) {
            console.error("GITHUB_TOKEN secret is not set in Cloudflare Pages environment and no PAT provided in request.");
            // Don't expose the exact error in the response for security
            return new Response(JSON.stringify({ error: 'Server configuration error or missing token. Cannot access GitHub API.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const authHeader = `Bearer ${GITHUB_TOKEN}`;
        const baseHeaders = {
             'Accept': 'application/vnd.github.v3+json',
             'Authorization': authHeader,
             'User-Agent': 'Repo2Txt-Cloudflare-Pages-Function-V2' // Identify your app
        };

        // --- Action: Get Tree ---
        if (action === 'getTree') {
            console.log(`Action: getTree for ${owner}/${repo}/${branch}`);
            const treeApiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

            const treeResponse = await fetch(treeApiUrl, { headers: baseHeaders });

            // --- Handle GitHub API Errors ---
            if (!treeResponse.ok) {
                const status = treeResponse.status;
                let errorBodyText = "Could not read error body.";
                try {
                    errorBodyText = await treeResponse.text(); // Try to get specific error from GitHub
                } catch (e) { console.error("Failed to read error body:", e); }

                console.error(`Failed to fetch tree: ${status} ${treeResponse.statusText}. Body: ${errorBodyText}`);

                if (status === 401) { // Unauthorized
                    return new Response(JSON.stringify({ error: 'Authentication failed. Invalid GitHub Token or PAT. Check token permissions (repo scope needed for private repos).' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }
                if (status === 403) { // Forbidden (often rate limit or permissions)
                    if (errorBodyText.includes("API rate limit exceeded")) {
                        return new Response(JSON.stringify({ error: 'GitHub API rate limit exceeded. Please try again later or provide a Personal Access Token (PAT).' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                    }
                    return new Response(JSON.stringify({ error: 'Access forbidden. Check token permissions or repository access rights.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }
                if (status === 404) { // Not Found
                    return new Response(JSON.stringify({ error: 'Repository, branch, or tree not found. Check the URL and branch name.' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }
                // Generic error for other statuses
                return new Response(JSON.stringify({ error: `Failed to fetch repository tree from GitHub (Status: ${status}).` }), { status: status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            // --- Process Successful Tree Response ---
            const treeData = await treeResponse.json();
            let isTruncated = treeData.truncated || false; // Check if GitHub truncated the result

            if (isTruncated) {
                console.warn(`Repository tree is truncated by GitHub API.`);
            }

            // Filter blobs based on extensions/exclusions
            const filteredBlobs = treeData.tree
                .filter(item => item.type === 'blob') // Only process files (blobs)
                .filter(item => {
                    const pathLower = item.path.toLowerCase();
                    const extension = pathLower.includes('.') ? pathLower.substring(pathLower.lastIndexOf('.')) : pathLower.substring(pathLower.lastIndexOf('/') + 1); // Get extension or filename if no extension
                    const filename = pathLower.substring(pathLower.lastIndexOf('/') + 1);

                    // Check if allowed
                    const isAllowed = ALLOWED_EXTENSIONS.has(extension) || ALLOWED_EXTENSIONS.has(filename);
                    if (!isAllowed) return false;

                    // Check if excluded
                    const isExcluded = DEFAULT_EXCLUDES.some(excludeRule => {
                        if (excludeRule.endsWith('/')) { // Directory exclusion
                            return pathLower.startsWith(excludeRule);
                        } else if (excludeRule.startsWith('*.')) { // Extension wildcard
                             return pathLower.endsWith(excludeRule.substring(1));
                        } else { // Exact file match or filename match
                            return pathLower === excludeRule || filename === excludeRule;
                        }
                    });
                    if (isExcluded) return false;

                    return true; // Keep the file if allowed and not excluded
                 });

            console.log(`Found ${filteredBlobs.length} processable files after filtering.`);

            // Send the filtered list (just blobs) and truncation status to the frontend
            return new Response(JSON.stringify({
                 tree: filteredBlobs, // Array of { path: '...', sha: '...', type: 'blob', ... }
                 truncated: isTruncated,
                 message: isTruncated ? 'Warning: Repository is large, file list may be incomplete.' : null
             }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // --- Action: Generate Text ---
        else if (action === 'generateText') {
            console.log(`Action: generateText for ${owner}/${repo}/${branch}`);

            // Validate selectedFiles input
            if (!selectedFiles || !Array.isArray(selectedFiles)) {
                return new Response(JSON.stringify({ error: 'Missing or invalid selectedFiles array' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            if (selectedFiles.length === 0) {
                 // Return empty content if nothing selected, not an error
                 return new Response(JSON.stringify({ content: "No files selected for processing.", structure: "" }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            if (selectedFiles.length > MAX_FILES_TO_PROCESS) {
                console.warn(`Too many files selected: ${selectedFiles.length}, limit: ${MAX_FILES_TO_PROCESS}`);
                return new Response(JSON.stringify({ error: `Too many files selected (${selectedFiles.length}). Please select ${MAX_FILES_TO_PROCESS} or fewer.` }), { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            // Generate structure string for the *selected* files (Feature 6)
            // We only have paths, create temporary objects for the structure generator
            const fileObjectsForStructure = selectedFiles.map(path => ({ path: path, type: 'blob' }));
            const structureString = generateStructureString(fileObjectsForStructure);

            let combinedContent = "";
            let fetchedFileCount = 0;
            let totalSize = 0;
            const sizeLimitBytes = MAX_TOTAL_SIZE_MB * 1024 * 1024;
            let sizeLimitReached = false;

            // Fetch content for each selected file using Promise.all for parallelism
            const fetchPromises = selectedFiles.map(async (filePath) => {
                 // Check total size *before* fetching next file if limit already hit
                 if (sizeLimitReached) {
                     return { path: filePath, content: null, error: `Skipped: Total size limit (${MAX_TOTAL_SIZE_MB}MB) already reached.` };
                 }

                // Construct URL for raw content, ensure path is URI encoded
                const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodeURI(filePath)}`;
                console.log(`Fetching content for: ${filePath}`);

                try {
                    // Use Authorization header for raw content access (needed for private repos)
                    const contentResponse = await fetch(rawUrl, { headers: { 'Authorization': authHeader } });

                    if (contentResponse.ok) {
                        const fileContent = await contentResponse.text();
                        const fileSize = new Blob([fileContent]).size; // Get byte size

                        // Check if *adding* this file exceeds the limit
                        if (totalSize + fileSize > sizeLimitBytes) {
                            console.warn(`Skipping ${filePath}: Adding this file (size ~${(fileSize/1024).toFixed(1)}KB) would exceed the total size limit (${MAX_TOTAL_SIZE_MB}MB).`);
                            sizeLimitReached = true; // Set flag to stop further additions
                            return { path: filePath, content: null, error: `Skipped: Exceeds total size limit (${MAX_TOTAL_SIZE_MB}MB).` };
                        }

                        // If within limits, add size and return content
                        totalSize += fileSize;
                        return { path: filePath, content: fileContent, error: null };

                    } else {
                        // Handle fetch errors for individual files
                        console.warn(`Skipping file ${filePath}: Failed fetch (Status: ${contentResponse.status} ${contentResponse.statusText})`);
                        const errorReason = contentResponse.status === 404 ? "File not found at this path/branch" : `HTTP Error ${contentResponse.status}`;
                        return { path: filePath, content: null, error: `Error fetching: ${errorReason}` };
                    }
                } catch (fetchError) {
                    console.warn(`Skipping file ${filePath}: Network error during fetch: ${fetchError.message}`);
                    return { path: filePath, content: null, error: `Network error: ${fetchError.message}` };
                }
            });

            // Wait for all fetch promises to resolve
            const results = await Promise.all(fetchPromises);

            // Combine results into the final text output
            results.forEach(result => {
                 if (result.content !== null) {
                     // Add file header and content
                     combinedContent += `--- File: ${result.path} ---\n\n${result.content}\n\n`;
                     fetchedFileCount++;
                 } else {
                     // Add a marker for skipped files and the reason
                     combinedContent += `--- Skipped File: ${result.path} (${result.error || 'Unknown reason'}) ---\n\n`;
                 }
            });

            console.log(`Successfully processed ${fetchedFileCount} out of ${selectedFiles.length} selected files. Total fetched size: ${(totalSize / (1024*1024)).toFixed(2)} MB.`);

            // Add warning if size limit was reached during processing
            if (sizeLimitReached) {
                combinedContent += `\n\n--- WARNING: Reached total size limit (${MAX_TOTAL_SIZE_MB}MB). Output may be incomplete. Processed ${fetchedFileCount} files. ---\n`;
             }

            // Return structure and combined content
            return new Response(JSON.stringify({
                 content: combinedContent,
                 structure: structureString // Include the generated structure string
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
        // Catch unexpected errors during processing (e.g., JSON parsing error, network issues)
        console.error('Unhandled error in Pages Function:', error);
        // Avoid leaking sensitive error details in production
        const errorMessage = (error instanceof Error) ? error.message : 'An unexpected server error occurred.';
        // Log the full error server-side, return a generic message
        return new Response(JSON.stringify({ error: `An unexpected server error occurred.` }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
}

