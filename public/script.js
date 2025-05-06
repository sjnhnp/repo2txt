// script.js (Overhauled)

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
let fileTreeData = []; // Stores the raw list of file objects { path: '...', sha: '...', ... } from backend
let availableExtensions = new Set();
let generatedContent = ""; // Store combined content for copy/download
let generatedStructure = ""; // Store structure for copy/download
let activeFilters = new Set(); // Store active extension filters

// --- Constants ---
const API_ENDPOINT = '/api/generate'; // Same Pages Function endpoint

// --- Utility Functions ---
function showStatus(message, showSpinner = false) {
    statusArea.style.display = 'block';
    statusText.textContent = message;
    spinner.style.display = showSpinner ? 'inline-block' : 'none';
    errorMessage.textContent = ''; // Clear previous errors
}

function showError(message) {
    errorMessage.textContent = message;
    statusArea.style.display = 'none'; // Hide status when showing error
    // Hide subsequent sections on error
    filterArea.style.display = 'none';
    generationArea.style.display = 'none';
    resultContainer.style.display = 'none';
}

function resetUI() {
    statusArea.style.display = 'none';
    errorMessage.textContent = '';
    filterArea.style.display = 'none';
    generationArea.style.display = 'none';
    resultContainer.style.display = 'none';
    fileTreeContainer.innerHTML = ''; // Clear tree
    extensionFiltersContainer.innerHTML = ''; // Clear filters
    fileTreeData = [];
    availableExtensions = new Set();
    activeFilters = new Set();
    currentRepoUrl = null;
    currentPat = null;
     generatedContent = "";
     generatedStructure = "";
     repoUrlInput.value = ''; // Optionally clear input
     patInput.value = '';
     fetchStructureBtn.disabled = false;
}

// --- Core Logic ---

// 1. Fetch Directory Structure
fetchStructureBtn.addEventListener('click', async () => {
    const repoUrl = repoUrlInput.value.trim();
    const pat = patInput.value.trim();

    if (!repoUrl) {
        showError('Please enter a GitHub repository URL.');
        return;
    }

    // Basic URL validation (optional but good)
    try {
        new URL(repoUrl);
        if (!repoUrl.toLowerCase().includes('github.com')) throw new Error('Not a GitHub URL');
    } catch (e) {
         showError('Please enter a valid GitHub repository URL (e.g., https://github.com/owner/repo).');
         return;
    }


    currentRepoUrl = repoUrl;
    currentPat = pat || null; // Store PAT (or null if empty)
    fetchStructureBtn.disabled = true;
    showStatus('Fetching directory structure...', true);
    filterArea.style.display = 'none'; // Hide previous tree/filters
    generationArea.style.display = 'none';
    resultContainer.style.display = 'none';

    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                repoUrl: currentRepoUrl,
                pat: currentPat, // Send PAT to backend
                action: 'getTree'
            })
        });

        if (!response.ok) {
             const errorData = await response.json().catch(() => ({ error: `HTTP error ${response.status}` }));
             throw new Error(errorData.error || `Failed to fetch structure (Status: ${response.status})`);
        }

        const data = await response.json();
        fileTreeData = data.tree || []; // Expecting { tree: [...] }
        console.log(`Received ${fileTreeData.length} files.`);

        if (data.truncated) {
             showStatus(`Fetched structure (Warning: File list may be incomplete due to large repository). Found ${fileTreeData.length} processable files.`, false);
        } else if (fileTreeData.length === 0) {
             showStatus('Fetched structure. No processable text files found matching default filters.', false);
              // Display message, don't show tree/generate button
              filterArea.style.display = 'none';
              generationArea.style.display = 'none';
              return; // Stop here
        }
         else {
             showStatus(`Fetched structure. Found ${fileTreeData.length} processable files.`, false);
        }


        // Populate Filters and Tree
        populateExtensionFilters(fileTreeData);
        renderFileTree(fileTreeData); // Initial render with all files
        filterArea.style.display = 'block';
        generationArea.style.display = 'block'; // Show generate button
        resultContainer.style.display = 'none'; // Hide previous results

    } catch (error) {
        console.error('Fetch Structure Error:', error);
        showError(`Error fetching structure: ${error.message}`);
         fileTreeData = []; // Clear data on error
    } finally {
        fetchStructureBtn.disabled = false;
         // Ensure spinner is hidden even if status wasn't updated successfully
         spinner.style.display = 'none';
    }
});

// 2. Populate Extension Filters
function populateExtensionFilters(files) {
    availableExtensions.clear();
    files.forEach(file => {
        const parts = file.path.split('.');
        if (parts.length > 1) {
            const ext = '.' + parts.pop().toLowerCase();
            availableExtensions.add(ext);
        } else {
             // Handle files with no extension? Maybe add a specific filter like "(no extension)"
             // Or based on ALLOWED_EXTENSIONS check if filename itself matches like 'Dockerfile'
             const filename = file.path.substring(file.path.lastIndexOf('/') + 1);
             if (ALLOWED_EXTENSIONS.has(filename.toLowerCase())) {
                 availableExtensions.add(filename); // Add filename itself as filter category
             }
        }
    });

    extensionFiltersContainer.innerHTML = ''; // Clear previous
    activeFilters = new Set(availableExtensions); // Initially all are active

    // Sort extensions for display
    const sortedExtensions = Array.from(availableExtensions).sort();

    sortedExtensions.forEach(ext => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = ext;
        checkbox.checked = true; // Initially check all
        checkbox.addEventListener('change', handleFilterChange);
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(ext));
        extensionFiltersContainer.appendChild(label);
    });
}

// 3. Handle Filter Change
function handleFilterChange() {
    activeFilters.clear();
    const checkboxes = extensionFiltersContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        if (cb.checked) {
            activeFilters.add(cb.value);
        }
    });
    // Re-render the tree with active filters
    renderFileTree(fileTreeData);
}


// 4. Render File Tree (Needs Improvement for Hierarchy)
// This version renders a flat list with checkboxes based on filters
function renderFileTree(files) {
    fileTreeContainer.innerHTML = ''; // Clear previous tree

    const filteredFiles = files.filter(file => {
        const parts = file.path.split('.');
         let fileExtOrName = null;
         if (parts.length > 1) {
             fileExtOrName = '.' + parts.pop().toLowerCase();
         } else {
              const filename = file.path.substring(file.path.lastIndexOf('/') + 1);
              if (ALLOWED_EXTENSIONS.has(filename.toLowerCase())) {
                  fileExtOrName = filename; // Use filename if it's in allowed list (e.g., Dockerfile)
              }
         }
        return fileExtOrName && activeFilters.has(fileExtOrName);
    });

    if (filteredFiles.length === 0) {
        fileTreeContainer.innerHTML = '<li>No files match the current filters.</li>';
        return;
    }

    const ul = document.createElement('ul');
    filteredFiles.forEach(file => {
        const li = document.createElement('li');
        li.className = 'file'; // Mark as file node

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = file.path; // Use path as value
        checkbox.checked = true; // Default check filtered files
        checkbox.classList.add('file-tree-checkbox');

        const nodeSpan = document.createElement('span');
        nodeSpan.className = 'tree-node';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'node-icon';
        nodeSpan.appendChild(iconSpan); // Placeholder for icon

        nodeSpan.appendChild(document.createTextNode(file.path)); // Display full path for now

        li.appendChild(checkbox);
        li.appendChild(nodeSpan);
        ul.appendChild(li);
    });
    fileTreeContainer.appendChild(ul);

    // Add event listener to parent container for delegation (optional optimization)
}

// --- Select/Deselect All ---
selectAllBtn.addEventListener('click', () => {
    const checkboxes = fileTreeContainer.querySelectorAll('.file-tree-checkbox');
    checkboxes.forEach(cb => cb.checked = true);
});

deselectAllBtn.addEventListener('click', () => {
    const checkboxes = fileTreeContainer.querySelectorAll('.file-tree-checkbox');
    checkboxes.forEach(cb => cb.checked = false);
});


// 5. Generate Text File Content
generateTextBtn.addEventListener('click', async () => {
    const selectedCheckboxes = fileTreeContainer.querySelectorAll('.file-tree-checkbox:checked');
    const selectedFiles = Array.from(selectedCheckboxes).map(cb => cb.value);

    if (selectedFiles.length === 0) {
        showError('Please select at least one file to generate the text.');
        return;
    }

    console.log(`Generating text for ${selectedFiles.length} files.`);
    generateTextBtn.disabled = true;
    showStatus('Generating combined text content...', true);
    resultContainer.style.display = 'none'; // Hide previous result

    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                repoUrl: currentRepoUrl,
                pat: currentPat,
                action: 'generateText',
                selectedFiles: selectedFiles // Send the list of selected paths
            })
        });

         if (!response.ok) {
             const errorData = await response.json().catch(() => ({ error: `HTTP error ${response.status}` }));
             throw new Error(errorData.error || `Failed to generate text (Status: ${response.status})`);
        }

        const data = await response.json(); // Expecting { content: "...", structure: "..." }
        generatedContent = data.content || "";
        generatedStructure = data.structure || "";

        // Display Preview (6 & 7)
        structurePreview.textContent = generatedStructure;
        contentPreview.textContent = generatedContent;
        resultContainer.style.display = 'block';
        showStatus(`Generated text from ${selectedFiles.length} files. Preview below.`, false);

        // Optional: Calculate and display token count (Needs a tokenizer library)
        // if (typeof GPT3Tokenizer !== 'undefined') {
        //     const tokenizer = new GPT3Tokenizer({ type: 'gpt3' }); // or 'codex'
        //     const encoded = tokenizer.encode(generatedContent);
        //     tokenCountArea.textContent = `Approximate Token Count: ${encoded.bpe.length}`;
        // } else {
             tokenCountArea.textContent = '';
        // }


    } catch (error) {
        console.error('Generate Text Error:', error);
        showError(`Error generating text: ${error.message}`);
    } finally {
        generateTextBtn.disabled = false;
        spinner.style.display = 'none'; // Ensure spinner is hidden
    }
});

// 6. Copy to Clipboard (8)
copyBtn.addEventListener('click', async () => {
    const fullContentToCopy = `${generatedStructure}\n${generatedContent}`; // Combine structure and content
    if (!navigator.clipboard) {
        showError('Clipboard API not available in this browser.');
        return;
    }
    try {
        await navigator.clipboard.writeText(fullContentToCopy);
        copyBtn.textContent = 'Copied!'; // Provide feedback
        setTimeout(() => { copyBtn.innerHTML = '<i class="gg-copy"></i> Copy to Clipboard'; }, 2000); // Reset button text
    } catch (err) {
        console.error('Failed to copy text: ', err);
        showError('Failed to copy text to clipboard.');
    }
});

// 7. Download Text File (9)
downloadTxtBtn.addEventListener('click', () => {
    if (!generatedContent && !generatedStructure) {
        showError("No content generated to download.");
        return;
    }

    const fullContentToDownload = `${generatedStructure}\n${generatedContent}`;
    const blob = new Blob([fullContentToDownload], { type: 'text/plain;charset=utf-8' });
    const downloadUrl = URL.createObjectURL(blob);

    // Create filename
    let filename = "repository_content.txt";
    if (currentRepoUrl) {
        try {
            const url = new URL(currentRepoUrl);
            const pathParts = url.pathname.split('/').filter(Boolean);
            if (pathParts.length >= 2) {
                 const repoName = pathParts[1];
                 // Try to get branch name (simple guess for now)
                  let branch = 'main';
                  if (pathParts.length >= 4 && pathParts[2] === 'tree') {
                       branch = pathParts[3];
                  }
                 filename = `${repoName}_${branch}_content.txt`;
            }
        } catch (e) { /* Keep default filename */ }
    }


    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a); // Append anchor to body
    a.click(); // Programmatically click the anchor to trigger download
    document.body.removeChild(a); // Remove anchor from body
    URL.revokeObjectURL(downloadUrl); // Clean up the object URL
});


// --- Initial Setup ---
// Add any setup logic needed when the page loads
// resetUI(); // Call reset on load? Or leave fields populated?

// Add reference to tokenizer library ALLOWED_EXTENSIONS
const ALLOWED_EXTENSIONS = new Set([ '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.less', '.html', '.htm', '.xml', '.yaml', '.yml', '.md', '.markdown', '.txt', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.php', '.rb', '.swift', '.kt', '.kts', '.sh', '.bash', '.zsh', '.sql', '.dockerfile', 'dockerfile', '.env', '.gitignore', '.gitattributes', '.toml', '.ini', '.cfg', '.conf', '.properties', '.gradle', '.lua', '.rs']); // Keep this in sync with backend
