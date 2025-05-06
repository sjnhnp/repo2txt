// script.js (修改部分)

// 不再需要完整的 Worker URL
// const WORKER_URL = 'YOUR_WORKER_URL_HERE'; // <-- 删除或注释掉这行

const repoForm = document.getElementById('repoForm');
// ... (其他元素获取不变) ...

repoForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const repoUrl = repoUrlInput.value.trim();
    if (!repoUrl) { /* ... */ return; }

    // --- UI 更新：开始处理 ---
    // ... (不变) ...

    try {
        // !!! 重要修改：使用相对路径调用 Pages Function !!!
        const API_ENDPOINT = '/api/generate'; // 指向 /functions/api/generate.js
        console.log(`Sending request to function: ${API_ENDPOINT}`);

        const response = await fetch(API_ENDPOINT, { // <-- 使用相对路径
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ repoUrl: repoUrl }),
        });

        console.log('Function response status:', response.status);

        if (response.ok) {
            // --- 成功处理 (代码不变) ---
            const blob = await response.blob();
            const downloadUrl = URL.createObjectURL(blob);
            // ... 获取文件名 ...
            downloadLink.href = downloadUrl;
            downloadLink.download = filename;
            resultArea.style.display = 'block';
            statusText.textContent = 'Processing complete!';
            // ...
        } else {
            // --- Function 返回错误 (代码不变) ---
            const errorData = await response.json();
            console.error('Function error:', errorData);
            errorMessage.textContent = `Error: ${errorData.error || `Request failed with status ${response.status}`}`;
            // ...
        }

    } catch (error) {
        // --- 网络错误或其他前端错误 (代码不变) ---
        console.error('Fetch error:', error);
        // ...
    } finally {
        // --- UI 更新：处理结束 (代码不变) ---
        // ...
    }
});

// 清理临时 URL 的代码 (不变)
// ...
