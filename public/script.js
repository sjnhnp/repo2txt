// script.js

// --- DOM Elements ---
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
let fileTreeData = []; // Stores the raw list of file objects { path: '...', sha: '...', ... } from backend
let availableExtensions = new Set(); // All extensions/types found in fetched files
let activeFilters = new Set(); // Currently selected filters
let generatedContent = ""; // Store combined content for copy/download
let generatedStructure = ""; // Store structure for copy/download

// --- Constants ---
const API_ENDPOINT = '/api/generate'; // Cloudflare Pages Function endpoint

// Define allowed extensions/filenames here primarily for frontend filtering logic.
// The backend *also* filters, this provides consistency and potentially faster UI updates.
const ALLOWED_EXTENSIONS_FRONTEND = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.less', '.html', '.htm',
    '.xml', '.yaml', '.yml', '.md', '.markdown', '.txt', '.py', '.java', '.c', '.cpp',
    '.h', '.hpp', '.cs', '.go', '.php', '.rb', '.swift', '.kt', '.kts', '.sh', '.bash',
    '.zsh', '.sql', '.dockerfile', 'dockerfile', '.env', '.gitignore', '.gitattributes',
    '.toml', '.ini', '.cfg', '.conf', '.properties', '.gradle', '.lua', '.rs',
]);

// --- Utility Functions ---

function showStatus(message, showSpinner = false) {
    errorMessage.style.display = 'none'; // Hide error message
    statusArea.style.display = 'block';
    statusText.textContent = message;
    spinner.style.display = showSpinner ? 'inline-block' : 'none';
}

function showError(message) {
    statusArea.style.display = 'none'; // Hide status message
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
    fileTreeContainer.innerHTML = '<span class="placeholder-text">Enter URL and fetch structure.</span>'; // Clear tree
    extensionFiltersContainer.innerHTML = '<span class="placeholder-text">Filters appear after fetching.</span>'; // Clear filters
    structurePreview.textContent = '(Structure will appear here)';
    contentPreview.textContent = '(Content will appear here)';
    fileTreeData = [];
    availableExtensions = new Set();
    activeFilters = new Set();
    generatedContent = "";
    generatedStructure = "";
    tokenCountArea.textContent = ''; // Clear token count
}

// --- Core Logic ---

// 1. Fetch Directory Structure Button Click
fetchStructureBtn.addEventListener('click', async () => {
    const repoUrl = repoUrlInput.value.trim();
    const pat = patInput.value.trim();

    if (!repoUrl) {
        showError('Please enter a GitHub repository URL.');
        return;
    }

    // Basic URL check (less strict than backend, backend does final validation)
    if (!repoUrl.toLowerCase().includes('github.com/')) {
         showError('Please enter a valid GitHub repository URL (e.g., https://github.com/owner/repo).');
         return;
    }

    currentRepoUrl = repoUrl;
    currentPat = pat || null; // Store PAT (or null if empty)
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
                pat: currentPat, // Send PAT (or null) to backend
                action: 'getTree' // Specify the action
            })
        });

        // Handle non-OK HTTP responses (like 4xx, 5xx)
        if (!response.ok) {
             let errorData = { error: `Request failed with status ${response.status}` };
             try {
                // Try to parse error message from backend JSON response
                errorData = await response.json();
             } catch (e) {
                 // If response is not JSON, use the status text
                 errorData.error = errorData.error + `: ${response.statusText}`;
                 console.warn("Could not parse error response as JSON.");
             }
             // Use the error message from backend if available, otherwise use the generic one
             throw new Error(errorData.error || `Failed to fetch structure (Status: ${response.status})`);
        }

        // Process successful response
        const data = await response.json(); // Should contain { tree: [...], truncated: Boolean, message: String|null }
        fileTreeData = data.tree || []; // Store the received file list
        console.log(`Received ${fileTreeData.length} files from backend. Truncated: ${data.truncated}`);

        // Update status message based on results
        let statusMsg = `Fetched structure. Found ${fileTreeData.length} processable files.`;
        if (data.truncated) {
             statusMsg += ' (Warning: File list may be incomplete due to large repository)';
        }
        if (fileTreeData.length === 0 && !data.truncated) {
             statusMsg = 'Fetched structure, but no processable text files found matching filters in this repository/branch.';
        }
        showStatus(statusMsg, false);


        // If files found, populate Filters and Tree
        if (fileTreeData.length > 0) {
            populateExtensionFilters(fileTreeData);
            renderFileTree(fileTreeData); // Initial render with all files checked
            filterArea.style.display = 'block'; // Show filter/tree section
            generationArea.style.display = 'block'; // Show generate button
            resultContainer.style.display = 'none'; // Ensure result area is hidden
        } else {
            // If no files, hide filter/generate sections
            filterArea.style.display = 'none';
            generationArea.style.display = 'none';
        }

    } catch (error) {
        console.error('Fetch Structure Error:', error);
        showError(`Failed to fetch structure: ${error.message}`);
        resetSubsequentSections(); // Clear sections on error
    } finally {
        fetchStructureBtn.disabled = false; // Re-enable button
        // Ensure spinner is hidden if status wasn't updated (e.g., error before showStatus)
        spinner.style.display = 'none';
    }
});

// 2. Populate Extension Filters Checkboxes
function populateExtensionFilters(files) {
    availableExtensions.clear();
    files.forEach(file => {
        const pathLower = file.path.toLowerCase();
        const parts = pathLower.split('.');
        let filterKey = null;

        if (parts.length > 1) {
            const ext = '.' + parts.pop();
            // Use extension if it's in our known list, otherwise check filename
            if (ALLOWED_EXTENSIONS_FRONTEND.has(ext)) {
                filterKey = ext;
            }
        }
        // If no extension or extension not specifically known, check filename itself
        if (!filterKey) {
             const filename = pathLower.substring(pathLower.lastIndexOf('/') + 1);
             if (ALLOWED_EXTENSIONS_FRONTEND.has(filename)) {
                 filterKey = filename; // e.g., 'dockerfile'
             }
        }
        // Fallback or category for unknown but allowed files? (Optional)
        // if (!filterKey) filterKey = 'other';

        if (filterKey) {
            availableExtensions.add(filterKey);
        }
    });

    extensionFiltersContainer.innerHTML = ''; // Clear previous filters/placeholder
    activeFilters = new Set(availableExtensions); // Initially all found extensions are active

    // Sort extensions for display
    const sortedExtensions = Array.from(availableExtensions).sort();

    if (sortedExtensions.length === 0) {
        extensionFiltersContainer.innerHTML = '<span class="placeholder-text">No specific file types found to filter by.</span>';
        return;
    }

    sortedExtensions.forEach(extOrType => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = extOrType;
        checkbox.checked = true; // Initially check all
        checkbox.addEventListener('change', handleFilterChange); // Add listener
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${extOrType}`)); // Add space before text
        extensionFiltersContainer.appendChild(label);
    });
}

// 3. Handle Filter Checkbox Change
function handleFilterChange() {
    activeFilters.clear();
    const checkboxes = extensionFiltersContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        if (cb.checked) {
            activeFilters.add(cb.value);
        }
    });
    // Re-render the file tree based on the new active filters
    renderFileTree(fileTreeData);
    // Reset selection on filter change? Optional. Current keeps existing selections.
}


// 4. Render File Tree (Flat List Version)
function renderFileTree(files) {
    fileTreeContainer.innerHTML = ''; // Clear previous tree/placeholder

    const ul = document.createElement('ul');
    let visibleFileCount = 0;

    // Keep track of currently checked files *before* re-rendering
    const previouslyCheckedPaths = new Set();
    fileTreeContainer.querySelectorAll('.file-tree-checkbox:checked').forEach(cb => {
        previouslyCheckedPaths.add(cb.value);
    });


    files.forEach(file => {
        // Determine the filter key for this file (extension or filename)
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
        // if (!filterKey && availableExtensions.has('other')) filterKey = 'other'; // If using 'other' category

        // Only display if its type is in the active filters
        if (filterKey && activeFilters.has(filterKey)) {
            visibleFileCount++;
            const li = document.createElement('li');
            li.className = 'file'; // Mark as file node

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = file.path; // Use full path as the value
            checkbox.classList.add('file-tree-checkbox');
            // Restore checked state if it was checked before filtering, otherwise default to checked (or unchecked if preferred)
            checkbox.checked = previouslyCheckedPaths.has(file.path) || previouslyCheckedPaths.size === 0; // Default check initially or if state wasn't saved

            const nodeSpan = document.createElement('span');
            nodeSpan.className = 'tree-node';

            const iconSpan = document.createElement('span');
            iconSpan.className = 'node-icon';
            // Add specific icons based on type later if needed
            nodeSpan.appendChild(iconSpan); // Add icon placeholder

            nodeSpan.appendChild(document.createTextNode(file.path)); // Display full path

            li.appendChild(checkbox);
            li.appendChild(nodeSpan);
            ul.appendChild(li);
        }
    });

    if (visibleFileCount === 0) {
        fileTreeContainer.innerHTML = '<li class="placeholder-text">No files match the current filters.</li>';
    } else {
        fileTreeContainer.appendChild(ul);
    }
}

// --- Select/Deselect All Visible Files ---
selectAllBtn.addEventListener('click', () => {
    const checkboxes = fileTreeContainer.querySelectorAll('.file-tree-checkbox');
    checkboxes.forEach(cb => cb.checked = true);
});

deselectAllBtn.addEventListener('click', () => {
    const checkboxes = fileTreeContainer.querySelectorAll('.file-tree-checkbox');
    checkboxes.forEach(cb => cb.checked = false);
});


// 5. Generate Text File Content Button Click
generateTextBtn.addEventListener('click', async () => {
    const selectedCheckboxes = fileTreeContainer.querySelectorAll('.file-tree-checkbox:checked');
    const selectedFiles = Array.from(selectedCheckboxes).map(cb => cb.value); // Get array of paths

    if (selectedFiles.length === 0) {
        showError('Please select at least one file from the list to generate the text.');
        resultContainer.style.display = 'none'; // Hide result area
        return;
    }

    console.log(`Generating text for ${selectedFiles.length} selected files.`);
    generateTextBtn.disabled = true;
    showStatus('Generating combined text content...', true);
    resultContainer.style.display = 'none'; // Hide previous result while generating

    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                repoUrl: currentRepoUrl,
                pat: currentPat,
                action: 'generateText',
                selectedFiles: selectedFiles // Send the array of selected file paths
            })
        });

        // Handle non-OK HTTP responses
         if (!response.ok) {
             let errorData = { error: `Request failed with status ${response.status}` };
             try {
                 errorData = await response.json();
             } catch (e) {
                  errorData.error = errorData.error + `: ${response.statusText}`;
                  console.warn("Could not parse error response as JSON.");
             }
             throw new Error(errorData.error || `Failed to generate text (Status: ${response.status})`);
        }

        // Process successful response
        const data = await response.json(); // Expecting { content: "...", structure: "..." }
        generatedContent = data.content || "";
        generatedStructure = data.structure || "";

        // Display Preview (Features 6 & 7)
        structurePreview.textContent = generatedStructure || "(No structure generated)";
        contentPreview.textContent = generatedContent || "(No content generated or all files skipped)";
        resultContainer.style.display = 'block'; // Show the results area
        hideStatusAndError(); // Hide spinner/status message
        showStatus(`Generated text from ${selectedFiles.length} selected files. Preview below.`, false); // Show final status

        // Optional: Calculate and display token count (Requires a tokenizer library)
        calculateAndDisplayTokenCount(generatedStructure + "\n" + generatedContent);


    } catch (error) {
        console.error('Generate Text Error:', error);
        showError(`Error generating text: ${error.message}`);
        resultContainer.style.display = 'none'; // Hide result area on error
    } finally {
        generateTextBtn.disabled = false; // Re-enable button
        spinner.style.display = 'none'; // Ensure spinner is hidden
    }
});

// Optional: Token Counting Function (requires library like gpt-3-tokenizer)
function calculateAndDisplayTokenCount(text) {
     // Check if the tokenizer library is loaded
     if (typeof GPT3Tokenizer !== 'undefined') {
         try {
            // Use 'gpt3' for models like gpt-3.5-turbo, gpt-4. Use 'codex' for older Codex models.
            const tokenizer = new GPT3Tokenizer({ type: 'gpt3' });
            const encoded = tokenizer.encode(text);
            tokenCountArea.textContent = `Approx. Token Count: ${encoded.bpe.length}`;
            tokenCountArea.style.display = 'inline'; // Show the area
         } catch (e) {
              console.error("Token calculation failed:", e);
              tokenCountArea.textContent = ''; // Clear on error
              tokenCountArea.style.display = 'none';
         }
     } else {
         tokenCountArea.textContent = ''; // Hide if library not present
         tokenCountArea.style.display = 'none';
         // console.log("GPT3Tokenizer library not found. Skipping token count.");
     }
}


// 6. Copy to Clipboard Button Click (Feature 8)
copyBtn.addEventListener('click', async () => {
    const fullContentToCopy = `${generatedStructure}\n${generatedContent}`; // Combine structure and content

    if (!fullContentToCopy || fullContentToCopy.trim() === "") {
        showError("Nothing to copy."); // Or maybe just disable the button?
        return;
    }

    if (!navigator.clipboard) {
        showError('Clipboard API not available in this browser (requires HTTPS).');
        return;
    }
    try {
        await navigator.clipboard.writeText(fullContentToCopy);
        // Provide visual feedback
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="gg-copy"></i> Copied!';
        copyBtn.style.backgroundColor = '#28a745'; // Temporary green feedback
        setTimeout(() => {
            copyBtn.innerHTML = originalText; // Restore original text/icon
             copyBtn.style.backgroundColor = ''; // Restore original color (or set explicitly)
        }, 2000); // Reset button after 2 seconds
    } catch (err) {
        console.error('Failed to copy text: ', err);
        showError('Failed to copy text to clipboard. Check browser permissions.');
    }
});

// 7. Download Text File Button Click (Feature 9)
downloadTxtBtn.addEventListener('click', () => {
    const fullContentToDownload = `${generatedStructure}\n${generatedContent}`;

    if (!fullContentToDownload || fullContentToDownload.trim() === "") {
        showError("No content generated to download.");
        return;
    }

    const blob = new Blob([fullContentToDownload], { type: 'text/plain;charset=utf-8' });
    const downloadUrl = URL.createObjectURL(blob);

    // Create a dynamic filename based on the repo URL
    let filename = "repository_content.txt"; // Default filename
    if (currentRepoUrl) {
        try {
            // Attempt to extract owner, repo, and branch for a better filename
            const url = new URL(currentRepoUrl); // Might throw if URL is invalid, but we checked earlier
            const pathParts = url.pathname.split('/').filter(Boolean); // Filter out empty strings
            if (pathParts.length >= 2) {
                 const owner = pathParts[0];
                 const repoName = pathParts[1];
                 // Try to guess branch name from URL or use default 'main'/'master' (less reliable)
                 let branch = 'main'; // Default guess
                 if (pathParts.length >= 4 && pathParts[2] === 'tree') {
                      branch = pathParts[3];
                 } else {
                    // If parseGitHubUrl result is available, use its branch info (more reliable)
                    // This requires storing repoInfo globally or re-parsing, simpler to just guess for filename
                 }
                 // Sanitize parts for filename (basic example)
                 const safeRepoName = repoName.replace(/[^a-z0-9_-]/gi, '_');
                 const safeBranch = branch.replace(/[^a-z0-9_-]/gi, '_');
                 filename = `${safeRepoName}_${safeBranch}_content.txt`;
            }
        } catch (e) {
            console.warn("Could not generate dynamic filename from URL, using default.", e);
            // Keep default filename if parsing fails
        }
    }

    // Trigger download using a temporary anchor element
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename; // Set the filename for download
    document.body.appendChild(a); // Append anchor to body (needed for Firefox)
    a.click(); // Programmatically click the anchor to trigger download
    document.body.removeChild(a); // Remove anchor from body
    URL.revokeObjectURL(downloadUrl); // Clean up the object URL to free memory

     // Provide visual feedback (optional)
     const originalText = downloadTxtBtn.innerHTML;
     downloadTxtBtn.innerHTML = '<i class="gg-software-download"></i> Downloaded!';
     setTimeout(() => { downloadTxtBtn.innerHTML = originalText; }, 2000);
});


// --- Initial Setup ---
// Run when the page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log("Repo2Txt Enhanced Initialized");
    resetSubsequentSections(); // Start with a clean slate below the form
    hideStatusAndError(); // Ensure status/error areas are hidden initially
});
