// Settings page functionality
document.addEventListener('DOMContentLoaded', function() {
    initializeSettings();
    fetchProfile();
});

function initializeSettings() {
    const githubTokenInput = document.getElementById('githubToken');
    const toggleVisibilityBtn = document.getElementById('toggleTokenVisibility');
    const saveTokenBtn = document.getElementById('saveToken');
    const clearTokenBtn = document.getElementById('clearToken');
    const testTokenBtn = document.getElementById('testToken');
    const tokenStatus = document.getElementById('tokenStatus');

    // Load existing token
    loadGitHubToken();

    // Toggle token visibility
    toggleVisibilityBtn.addEventListener('click', function() {
        const isPassword = githubTokenInput.type === 'password';
        githubTokenInput.type = isPassword ? 'text' : 'password';
        const icon = toggleVisibilityBtn.querySelector('i');
        icon.className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
    });

    // Save token
    saveTokenBtn.addEventListener('click', async function() {
        const token = githubTokenInput.value.trim();
        
        if (!token) {
            showError('Please enter a GitHub token');
            return;
        }

        if (!isValidGitHubToken(token)) {
            showError('Please enter a valid GitHub token (starts with ghp_, gho_, ghu_, ghs_, or ghr_)');
            return;
        }

        try {
            saveTokenBtn.disabled = true;
            saveTokenBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

            const response = await fetch('/api/settings/github-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({ token })
            });

            if (!response.ok) {
                throw new Error('Failed to save token');
            }

            showSuccess('GitHub token saved successfully');
            localStorage.setItem('github_token_saved', 'true');
            
        } catch (error) {
            console.error('Error saving token:', error);
            showError('Failed to save token. Please try again.');
        } finally {
            saveTokenBtn.disabled = false;
            saveTokenBtn.innerHTML = '<i class="fas fa-save"></i> Save Token';
        }
    });

    // Clear token
    clearTokenBtn.addEventListener('click', async function() {
        if (!confirm('Are you sure you want to clear your GitHub token? This will reduce your API rate limit to 60 requests per hour.')) {
            return;
        }

        try {
            clearTokenBtn.disabled = true;
            clearTokenBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Clearing...';

            const response = await fetch('/api/settings/github-token', {
                method: 'DELETE',
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('Failed to clear token');
            }

            githubTokenInput.value = '';
            showSuccess('GitHub token cleared successfully');
            localStorage.removeItem('github_token_saved');
            
        } catch (error) {
            console.error('Error clearing token:', error);
            showError('Failed to clear token. Please try again.');
        } finally {
            clearTokenBtn.disabled = false;
            clearTokenBtn.innerHTML = '<i class="fas fa-trash"></i> Clear Token';
        }
    });

    // Test token
    testTokenBtn.addEventListener('click', async function() {
        const token = githubTokenInput.value.trim();
        
        if (!token) {
            showError('Please enter a GitHub token to test');
            return;
        }

        try {
            testTokenBtn.disabled = true;
            testTokenBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';

            const response = await fetch('/api/settings/test-github-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({ token })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Token test failed');
            }

            showSuccess(`Token is valid! Rate limit: ${result.rateLimit} requests per hour`);
            
        } catch (error) {
            console.error('Error testing token:', error);
            showError(`Token test failed: ${error.message}`);
        } finally {
            testTokenBtn.disabled = false;
            testTokenBtn.innerHTML = '<i class="fas fa-check"></i> Test Token';
        }
    });

    // Auto-save on blur (with debounce)
    let saveTimeout;
    githubTokenInput.addEventListener('blur', function() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            const token = this.value.trim();
            if (token && isValidGitHubToken(token)) {
                // Auto-save valid tokens
                saveTokenBtn.click();
            }
        }, 1000);
    });
}

function isValidGitHubToken(token) {
    // GitHub token patterns: ghp_, gho_, ghu_, ghs_, ghr_
    const tokenPattern = /^(ghp_|gho_|ghu_|ghs_|ghr_)[a-zA-Z0-9_]+$/;
    return tokenPattern.test(token);
}

async function loadGitHubToken() {
    try {
        const response = await fetch('/api/settings/github-token', {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            if (data.token) {
                const githubTokenInput = document.getElementById('githubToken');
                githubTokenInput.value = data.token;
                showSuccess('GitHub token loaded');
            }
        }
    } catch (error) {
        console.warn('Could not load GitHub token:', error);
    }
}

function showSuccess(message) {
    showStatus(message, 'success');
}

function showError(message) {
    showStatus(message, 'error');
}

function showStatus(message, type) {
    const tokenStatus = document.getElementById('tokenStatus');
    const statusIndicator = tokenStatus.querySelector('.status-indicator');
    const icon = statusIndicator.querySelector('i');
    const text = statusIndicator.querySelector('span');

    // Update icon and text
    if (type === 'success') {
        icon.className = 'fas fa-check-circle';
        statusIndicator.style.color = '#2AFFDF';
        tokenStatus.style.background = 'rgba(42,255,223,0.1)';
        tokenStatus.style.borderColor = '#2AFFDF';
    } else {
        icon.className = 'fas fa-exclamation-circle';
        statusIndicator.style.color = '#ef4444';
        tokenStatus.style.background = 'rgba(239,68,68,0.1)';
        tokenStatus.style.borderColor = '#ef4444';
    }

    text.textContent = message;
    tokenStatus.style.display = 'block';

    // Auto-hide after 5 seconds
    setTimeout(() => {
        tokenStatus.style.display = 'none';
    }, 5000);
}

function goHome() {
    window.location.href = '/';
}
