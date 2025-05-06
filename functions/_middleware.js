// functions/_middleware.js
const publicPaths = [
    '/js/sha256.js',
    '/js/password.js',
    // '/js/password-config.js', // This is commented out in your HTML, so optional here
    '/style.css',
    '/favicon.ico',
    '/script.js' // Add your main application script
];

const AUTH_COOKIE_NAME = 'repo2txt_auth_token';
// 您需要在Cloudflare Pages的环境变量中设置 PASSWORD_HASH
// 例如：PASSWORD_HASH = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8" (sha256 of "password")

// 辅助函数：进行SHA256哈希 (如果需要在服务端哈希)
// 注意：我们主要依赖客户端发送哈希值，但此函数备用或用于其他目的
async function sha256Server(message) {
    // 如果 functions/sha256.js 导出了一个异步函数
    // const { sha256 } = await import('./sha256.js'); // 动态导入可能在中间件中有限制
    // 或者如果它是同步的，可以直接导入。
    // 简单起见，假设我们直接比较客户端发送的哈希和环境变量中的哈希。
    // 如果您确实需要在服务器端从明文密码生成哈希，请确保 sha256.js 能正确工作。
    // 对于此流程，我们不需要在服务端对密码本身进行哈希，因为客户端会发送哈希值。
    throw new Error("Server-side hashing from plaintext not implemented in this middleware flow. Client should send hash.");
}


function createAuthCookie(value, env) {
    const cookieParts = [
        `${AUTH_COOKIE_NAME}=${value}`,
        `Path=/`,
       // `HttpOnly`,
        `SameSite=Strict`
    ];
    // 在生产环境中 (当env.CF_ENV === 'production' 或类似检查，或者直接假设https) 添加 Secure
    // Cloudflare Pages 通常在HTTPS下运行
    cookieParts.push(`Secure`);

    // 设置一个有效期，例如1天
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toUTCString();
    cookieParts.push(`Expires=${expires}`);
    
    return cookieParts.join('; ');
}

function createLogoutCookie() {
    const cookieParts = [
        `${AUTH_COOKIE_NAME}=`,
        `Path=/`,
        `HttpOnly`,
        `SameSite=Strict`,
        `Expires=Thu, 01 Jan 1970 00:00:00 GMT` // 设置为过去的时间以删除
    ];
    cookieParts.push(`Secure`);
    return cookieParts.join('; ');
}


async function handleAuthRequest(request, context) {
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { passwordHash } = await request.json();
        const expectedHash = context.env.PASSWORD_HASH;

        if (!expectedHash) {
            console.error("CRITICAL: PASSWORD_HASH environment variable is not set.");
            return new Response(JSON.stringify({ success: false, message: 'Server configuration error.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }

        if (passwordHash && passwordHash === expectedHash) {
            // 密码正确，设置认证cookie
            const authToken = crypto.randomUUID(); // 生成一个简单的会话令牌
            // 理论上，可以将authToken与用户的某些信息（如IP的哈希）关联存储起来进行更严格的验证，但对于简单场景，UUID即可
            // 此处我们仅用它作为已认证的标志，不进行服务端存储和验证，依赖cookie本身的安全性。
            // 更安全的做法是服务端存储这个authToken，并在每次请求时验证它。
            // 但对于Cloudflare Pages的简单密码保护，设置一个标记cookie也可以接受。

            // 为了简单起见，这里的 authToken 只是一个象征性的值，我们实际上是验证了密码哈希。
            // 一个更标准的做法是后端生成一个session token，存储它，然后把session id放到cookie里。
            // 但对于此场景，我们用一个固定的字符串或一个随机生成的但服务端不存储的字符串也可以。
            const cookieValue = "authenticated"; // 或者使用一个更复杂的值
            
            const responseBody = JSON.stringify({ success: true, message: 'Authentication successful.' });
            return new Response(responseBody, {
                status: 200,
                headers: {
                    'Set-Cookie': createAuthCookie(cookieValue, context.env),
                    'Content-Type': 'application/json'
                }
            });
        } else {
            return new Response(JSON.stringify({ success: false, message: 'Invalid password.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }
    } catch (e) {
        console.error("Error processing auth request:", e);
        return new Response(JSON.stringify({ success: false, message: 'Error processing request.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
}

async function handleLogoutRequest(request, context) {
     return new Response(JSON.stringify({ success: true, message: 'Logged out' }), {
         status: 200,
         headers: {
             'Set-Cookie': createLogoutCookie(),
             'Content-Type': 'application/json'
         }
     });
}


export async function onRequest(context) {
    const { request, next, env } = context;
    const url = new URL(request.url);

    // 0. 检查环境变量
    if (!env.PASSWORD_HASH) {
        // 如果没有设置密码哈希，直接阻止所有请求或显示配置错误页面
        // 这里为了演示，我们返回一个503错误，说明服务未配置
        // 在实际部署前，确保 PASSWORD_HASH 已在 Cloudflare Pages 的环境变量中设置
        console.error("CRITICAL: functions/_middleware.js: PASSWORD_HASH environment variable is not set in Cloudflare Pages settings.");
        return new Response("Service Unavailable: Password protection is not configured correctly. Administrator: Please set the PASSWORD_HASH environment variable.", { status: 503 });
    }
    
    // 1. 允许访问密码验证相关JS文件, CSS文件和特定API端点
    const publicPaths = ['/js/sha256.js', '/js/password.js', '/js/password-config.js', '/style.css', '/favicon.ico'];
    if (publicPaths.includes(url.pathname)) {
        return next(); // 由Cloudflare Pages的静态资源处理器提供服务
    }

    // 2. 处理认证请求
    if (url.pathname === '/auth') {
        return handleAuthRequest(request, context);
    }
    // 2.1 处理登出请求
    if (url.pathname === '/logout') {
        return handleLogoutRequest(request, context);
    }


    // 3. 检查用户是否已认证
    const cookie = request.headers.get('Cookie');
    let isAuthorized = false;
    if (cookie) {
        const cookies = cookie.split(';');
        if (cookies.some(c => c.trim().startsWith(`${AUTH_COOKIE_NAME}=authenticated`))) {
             // 简单验证cookie值，更安全的方式是验证服务端签名的token
            isAuthorized = true;
        }
    }

    if (isAuthorized) {
        // 如果已认证，继续处理请求 (例如，提供实际的应用文件或调用其他API)
        // 如果是API请求 (如 /api/generate), 让它通过
        if (url.pathname.startsWith('/api/')) {
            return next(); // API请求由其自身的function处理
        }
        // 对于其他路径 (如 /index.html 或 /), 提供主应用 (未修改的 index.html)
        // Cloudflare Pages 会自动提供 public 目录下的静态文件
        return next();
    }

    // 4. 如果未认证，并且不是API或公共路径，则提供密码输入页面
    // 我们将修改并提供 public/index.html 作为密码页面
    
    // 获取原始的 index.html (主应用HTML)
    // 注意：这里我们不能直接用 next() 然后修改响应，因为 next() 可能返回非HTML内容
    // 我们需要明确地获取 /index.html 的内容
    const assetUrl = new URL(request.url);
    assetUrl.pathname = '/index.html'; // 总是获取根index.html
    
    let response;
    try {
        response = await env.ASSETS.fetch(assetUrl); // 获取 public/index.html
        if (!response.ok) throw new Error(`Failed to fetch /index.html: ${response.status}`);
    } catch (e) {
        console.error("Error fetching /index.html asset for password page:", e);
        return new Response("Error loading application shell.", {status: 500});
    }

    let html = await response.text();

    // 注入一个标志，让客户端 password.js 知道这是密码页面模式
    // 同时确保主应用的 <div id="app-container"> 是隐藏的
    // 并且密码表单 <div id="password-container"> 是可见的
    // 这是通过 password.js 脚本根据 cookie 状态来控制的，但我们可以确保初始状态
    // 最简单的方法是让 password.js 处理显示/隐藏逻辑

    // 确保占位符与 public/index.html 中的一致
    // 这个 PASSWORD_HASH_PLACEHOLDER 实际上不会被 password.js 用来做客户端哈希比较
    // 而是由 password.js 将用户输入的密码哈希后发送给 /auth 端点
    // 此处注入主要是为了完整性或如果 password.js 有其他用途。
    // 对于纯粹的密码输入页面，这个注入可能不是必需的，
    // 因为验证完全在服务器端 /auth 进行。
    // 但如果 password.js 需要知道它在“密码模式”，可以注入一个不同的标志。
    // html = html.replace(
    //     '<!-- APP_CONFIG_PLACEHOLDER -->',
    //     `<script>window.__APP_CONFIG__ = { isPasswordProtected: true, expectedHash: "${env.PASSWORD_HASH}" };</script>`
    // );
    // 为了与原计划一致，我们用 {{PASSWORD_HASH_PLACEHOLDER}}
    // 但请注意其用途，客户端不应直接用它来验证。
     html = html.replace(
         "{{PASSWORD_HASH_PLACEHOLDER}}", // 在index.html中确保有这个占位符
         env.PASSWORD_HASH // 将实际的哈希注入（尽管客户端JS不应该用它直接比较）
     );


    return new Response(html, {
        headers: { 'Content-Type': 'text/html' },
    });
}
