// script.js (完整代码)

// 定义后端 API 的相对路径 (指向 /functions/api/generate.js)
const API_ENDPOINT = '/api/generate';

// 获取页面上的 HTML 元素
const repoForm = document.getElementById('repoForm'); // 表单
const repoUrlInput = document.getElementById('repoUrl'); // 输入框
const submitBtn = document.getElementById('submitBtn'); // 提交按钮
const statusArea = document.getElementById('statusArea'); // 显示状态的区域
const statusText = document.getElementById('statusText'); // 显示状态文本
const spinner = document.getElementById('spinner'); // 加载动画
const resultArea = document.getElementById('resultArea'); // 显示结果的区域
const downloadLink = document.getElementById('downloadLink'); // 下载链接
const errorMessage = document.getElementById('errorMessage'); // 显示错误信息

// --- 当用户提交表单时执行的函数 ---
repoForm.addEventListener('submit', async (event) => {
    // 1. 阻止表单的默认提交行为（防止页面刷新）
    event.preventDefault();

    // 2. 获取用户在输入框中输入的 GitHub 仓库 URL，并去除前后空格
    const repoUrl = repoUrlInput.value.trim();

    // 3. 检查 URL 是否为空
    if (!repoUrl) {
        alert('Please enter a GitHub repository URL.'); // 提示用户输入
        return; // 结束函数执行
    }

    // --- 4. 更新界面，告知用户处理已开始 ---
    submitBtn.disabled = true; // 禁用提交按钮，防止重复点击
    spinner.style.display = 'inline-block'; // 显示加载动画
    statusText.textContent = 'Processing request... (This might take a while for large repos)'; // 显示处理中信息
    resultArea.style.display = 'none'; // 隐藏上一次的结果区域
    errorMessage.textContent = ''; // 清空上一次的错误信息
    downloadLink.style.display = 'inline-block'; // 确保下载链接初始可见（如果上次出错了会被隐藏）
    // ---

    // 5. 使用 try...catch...finally 来处理可能发生的错误
    try {
        // --- 6. 向后端 API 发送请求 ---
        console.log(`Sending request to function: ${API_ENDPOINT}`); // 在浏览器控制台打印日志，方便调试

        const response = await fetch(API_ENDPOINT, {
            method: 'POST', // 使用 POST 方法
            headers: {
                'Content-Type': 'application/json', // 告诉后端我们发送的是 JSON 数据
            },
            // 将仓库 URL 包装成 JSON 字符串作为请求体发送
            body: JSON.stringify({ repoUrl: repoUrl }),
        });

        console.log('Function response status:', response.status); // 在控制台打印后端响应状态码

        // --- 7. 处理后端的响应 ---
        if (response.ok) {
            // 7.1 如果响应状态码表示成功 (例如 200 OK)
            console.log('Function returned success.');

            // 获取响应体作为 Blob 对象 (二进制大对象)，适合处理文件下载
            const blob = await response.blob();

            // 为这个 Blob 创建一个临时的 URL，可以用在 <a> 标签的 href 上
            const downloadUrl = URL.createObjectURL(blob);

            // 尝试从响应头获取后端建议的文件名
            const disposition = response.headers.get('content-disposition');
            let filename = "repository_content.txt"; // 设置一个默认文件名
            if (disposition && disposition.includes('attachment')) {
                // 正则表达式尝试匹配 filename="some_name.txt"
                const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                const matches = filenameRegex.exec(disposition);
                if (matches != null && matches[1]) {
                  filename = matches[1].replace(/['"]/g, ''); // 去除可能存在的引号
                }
            }
            console.log(`Suggested filename: ${filename}`);

            // --- 更新界面，显示成功结果 ---
            downloadLink.href = downloadUrl; // 设置下载链接的 URL
            downloadLink.download = filename; // 设置点击链接时下载的文件名
            resultArea.style.display = 'block'; // 显示结果区域
            statusText.textContent = 'Processing complete!'; // 更新状态文本
            // ---

        } else {
            // 7.2 如果响应状态码表示失败 (例如 400, 404, 500)
            console.error('Function returned an error.');

            // 尝试将响应体解析为 JSON，获取后端返回的错误信息
            let errorData = null;
            try {
                errorData = await response.json();
                 console.error('Error details:', errorData);
            } catch (e) {
                // 如果响应体不是有效的 JSON，记录原始文本
                const errorText = await response.text();
                console.error('Non-JSON error response:', errorText);
            }


            // --- 更新界面，显示错误信息 ---
            // 优先使用 JSON 中的 error 字段，否则显示通用错误信息
            errorMessage.textContent = `Error: ${errorData?.error || `Request failed with status ${response.status}`}`;
            resultArea.style.display = 'block'; // 显示结果区域（为了展示错误信息）
            downloadLink.style.display = 'none'; // 隐藏下载链接，因为没有成功的文件
            statusText.textContent = 'Processing failed.'; // 更新状态文本
            // ---
        }

    } catch (error) {
        // --- 8. 处理网络错误或其他意外的前端 JavaScript 错误 ---
        console.error('Fetch error or other script error:', error);

        // --- 更新界面，显示捕获到的错误 ---
        errorMessage.textContent = `An unexpected error occurred: ${error.message}`;
        resultArea.style.display = 'block';
        downloadLink.style.display = 'none';
        statusText.textContent = 'An unexpected error occurred.';
        // ---

    } finally {
        // --- 9. 无论成功还是失败，最后都要执行的代码 ---
        submitBtn.disabled = false; // 重新启用提交按钮
        spinner.style.display = 'none'; // 隐藏加载动画
        console.log('Request processing finished.');
        // 注意：我们不在这里清除 statusText，让用户能看到最终的状态（成功或失败）
        // ---
    }
});

// --- 10. 为下载链接添加点击事件监听器，用于清理临时的 Blob URL ---
downloadLink.addEventListener('click', () => {
    // 使用 setTimeout 稍微延迟一下，确保浏览器有时间开始下载
    setTimeout(() => {
        // 检查 href 是否仍然是 blob: URL (用户可能右键复制链接等)
        if (downloadLink.href.startsWith('blob:')) {
            // 释放之前通过 URL.createObjectURL 创建的内存对象
            URL.revokeObjectURL(downloadLink.href);
            console.log('Revoked temporary blob URL:', downloadLink.href);
        }
    }, 150); // 延迟 150 毫秒

     // 点击下载链接后，可以考虑清除错误信息（如果之前有的话）
    errorMessage.textContent = '';
     // 确保链接再次可见（以防万一）
    downloadLink.style.display = 'inline-block';
});
