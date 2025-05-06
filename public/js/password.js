// public/js/password.js

document.addEventListener('DOMContentLoaded', () => {
    const passwordContainer = document.getElementById('password-container');
    const appContainer = document.getElementById('app-container');
    const passwordForm = document.getElementById('password-form');
    const passwordInput = document.getElementById('password-input');
    const passwordErrorMessage = document.getElementById('password-error-message');
    const passwordSubmitBtn = document.getElementById('password-submit-btn');
    const logoutBtn = document.getElementById('logoutBtn');

    const AUTH_COOKIE_NAME = 'repo2txt_auth_token'; // Must match middleware

    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    function isAuthenticated() {
        // Simple check for the presence and value of the auth cookie
        // Middleware is the source of truth for auth.
        return getCookie(AUTH_COOKIE_NAME) === "authenticated";
    }

    function showPasswordForm() {
        if (passwordContainer) passwordContainer.style.display = 'block';
        if (appContainer) appContainer.style.display = 'none';
    }

    function showApp() {
        if (passwordContainer) passwordContainer.style.display = 'none';
        if (appContainer) appContainer.style.display = 'block';
    }

    async function handlePasswordSubmit(event) {
        event.preventDefault();
        if (!passwordInput || !passwordErrorMessage || !passwordSubmitBtn) return;

        const password = passwordInput.value;
        if (!password) {
            passwordErrorMessage.textContent = 'Password cannot be empty.';
            passwordErrorMessage.style.display = 'block';
            return;
        }

        passwordErrorMessage.style.display = 'none';
        passwordSubmitBtn.disabled = true;
        passwordSubmitBtn.innerHTML = '<span class="spinner"></span> Unlocking...';


        try {
            // Hash the password using the sha256 function from sha256.js
            // Assuming sha256.js provides `async function sha256(message)`
            if (typeof window.sha256 !== 'function') {
                console.error('SHA256 function not found. Make sure sha256.js is loaded.');
                passwordErrorMessage.textContent = 'Client-side error: Hashing utility not available.';
                passwordErrorMessage.style.display = 'block';
                passwordSubmitBtn.disabled = false;
                passwordSubmitBtn.innerHTML = '<i class="gg-log-in"></i> Unlock';
                return;
            }
            
            const hashedPassword = await window.sha256(password);

            const response = await fetch('/auth', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ passwordHash: hashedPassword }),
            });

            const result = await response.json();

            if (response.ok && result.success) {
                // Authentication successful, server has set the cookie.
                // Reload the page to let middleware serve the main app.
                document.location.reload();
            } else {
                passwordErrorMessage.textContent = result.message || 'Authentication failed. Please try again.';
                passwordErrorMessage.style.display = 'block';
                passwordInput.value = ''; // Clear password field
            }
        } catch (error) {
            console.error('Error during password submission:', error);
            passwordErrorMessage.textContent = 'An error occurred. Please try again.';
            passwordErrorMessage.style.display = 'block';
        } finally {
            passwordSubmitBtn.disabled = false;
            // Restore button text based on outcome in success/fail blocks or after reload
             passwordSubmitBtn.innerHTML = '<i class="gg-log-in"></i> Unlock';
        }
    }
    
    async function handleLogout() {
        try {
            const response = await fetch('/logout', { method: 'POST'});
            if (response.ok) {
                document.location.reload(); // Reload, middleware will show password page
            } else {
                console.error("Logout failed:", await response.text());
                alert("Logout failed. Please try clearing your cookies.");
            }
        } catch(error) {
            console.error("Error during logout:", error);
            alert("An error occurred during logout.");
        }
    }


    // Initial check on page load
    if (isAuthenticated()) {
        showApp();
    } else {
        // If PASSWORD_HASH is not set in env, middleware shows 503.
        // If it is set, and user not authenticated, middleware serves password page.
        // So, if this script runs, it means we should show the password form.
        showPasswordForm();
    }

    if (passwordForm) {
        passwordForm.addEventListener('submit', handlePasswordSubmit);
    } else {
        console.warn('Password form not found.');
    }
    
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    } else {
        console.warn('Logout button not found (logoutBtn).');
    }
});
