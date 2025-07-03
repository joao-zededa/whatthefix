// Global variables
let searchTimeout;
let currentResults = [];

// DOM elements - Fixed to match actual HTML structure
const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const loadingIndicator = document.getElementById('loadingIndicator');
const errorMessage = document.getElementById('errorMessage');
const errorText = document.getElementById('errorText');
const resultsContainer = document.getElementById('resultsContainer');
const resultsList = document.getElementById('resultsList');
const resultsTitle = document.getElementById('resultsTitle');
const resultsCount = document.getElementById('resultsCount');
const emptyState = document.getElementById('emptyState');
const commitModal = document.getElementById('commitModal');
const exampleTags = document.querySelectorAll('.example-tag');

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
    checkCacheStatus();
});

function initializeEventListeners() {
    // Search functionality
    searchButton.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    // Auto-search as user types
    searchInput.addEventListener('input', function() {
        const query = this.value.trim();
        
        // Clear previous timeout
        clearTimeout(searchTimeout);
        
        if (query.length === 0) {
            showEmptyState();
            return;
        }
        
        // Visual feedback for SHA vs message
        if (isCommitSHA(query)) {
            this.style.fontFamily = 'Monaco, monospace';
            this.style.backgroundColor = '#f8f9fa';
            // Search immediately for SHA
            searchTimeout = setTimeout(() => performSearch(), 300);
        } else {
            this.style.fontFamily = '';
            this.style.backgroundColor = '';
            // Wait longer for message searches
            if (query.length >= 3) {
                searchTimeout = setTimeout(() => performSearch(), 800);
            }
        }
    });

    // Example tags
    exampleTags.forEach(tag => {
        tag.addEventListener('click', function() {
            const example = this.getAttribute('data-example');
            searchInput.value = example;
            performSearch();
        });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        if (e.key === '/' && e.target !== searchInput) {
            e.preventDefault();
            searchInput.focus();
        }
        if (e.key === 'Escape') {
            hideModal();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            clearSearch();
        }
    });

    // Modal functionality - Fixed to work with actual HTML structure
    commitModal.addEventListener('click', function(e) {
        if (e.target === commitModal) {
            hideModal();
        }
        // Handle close button clicks
        if (e.target.classList.contains('close')) {
            hideModal();
        }
    });
}

// Check cache status on startup
async function checkCacheStatus() {
    try {
        const response = await fetch('/api/cache/status');
        const status = await response.json();
        
        if (status.tags.cached) {
            console.log(`✅ Cache ready: ${status.tags.count} tags loaded`);
        } else {
            console.log('🔄 Cache warming up in background...');
        }
    } catch (error) {
        console.warn('Could not check cache status:', error);
    }
}

// Function to detect if input is a commit SHA
function isCommitSHA(input) {
    const trimmed = input.trim();
    if (trimmed.length >= 7 && trimmed.length <= 40) {
        return /^[a-fA-F0-9]+$/.test(trimmed);
    }
    return false;
}

// Function to determine search type automatically
function detectSearchType(query) {
    return isCommitSHA(query) ? 'sha' : 'message';
}

async function performSearch() {
    const query = searchInput.value.trim();
    
    if (!query) {
        showError('Please enter a search query');
        return;
    }

    // Automatically detect search type
    const searchType = detectSearchType(query);
    
    // Update UI state
    showLoading();
    searchButton.disabled = true;
    
    try {
        const response = await fetch(`/api/search/commits?query=${encodeURIComponent(query)}&type=${searchType}`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Search failed');
        }
        
        displayResults(data, searchType);
        
        // If searching for SHA and found exactly one commit, automatically show details with tags
        if (searchType === 'sha' && data.commits.length === 1) {
            setTimeout(() => showCommitDetailsWithTags(data.commits[0]), 100);
        }
        
    } catch (error) {
        console.error('Search error:', error);
        showError(error.message || 'Failed to search commits. Please try again.');
    } finally {
        hideLoading();
        searchButton.disabled = false;
    }
}

function showLoading() {
    hideAllStates();
    loadingIndicator.classList.remove('hidden');
}

function hideLoading() {
    loadingIndicator.classList.add('hidden');
}

function showError(message) {
    hideAllStates();
    errorText.textContent = message;
    errorMessage.classList.remove('hidden');
}

function hideError() {
    errorMessage.classList.add('hidden');
}

function showResults() {
    hideAllStates();
    resultsContainer.classList.remove('hidden');
}

function showEmptyState() {
    hideAllStates();
    emptyState.classList.remove('hidden');
}

function hideAllStates() {
    loadingIndicator.classList.add('hidden');
    errorMessage.classList.add('hidden');
    resultsContainer.classList.add('hidden');
    emptyState.classList.add('hidden');
}

function displayResults(data, searchType) {
    if (data.commits.length === 0) {
        const searchTypeText = searchType === 'sha' ? 'commit ID' : 'search terms';
        showError(`No commits found for ${searchTypeText}: "${data.query}"`);
        return;
    }

    // Update results header with search type indication
    const searchTypeText = searchType === 'sha' ? 'Commit ID' : 'Message Search';
    resultsTitle.textContent = `${searchTypeText} Results for "${data.query}"`;
    resultsCount.textContent = `${data.count} commit${data.count !== 1 ? 's' : ''} found`;
    
    // Clear previous results
    resultsList.innerHTML = '';
    
    // Create commit items
    data.commits.forEach(commit => {
        const commitItem = createCommitItem(commit);
        resultsList.appendChild(commitItem);
    });
    
    showResults();
}

function createCommitItem(commit) {
    const item = document.createElement('div');
    item.className = 'commit-item';
    item.addEventListener('click', () => showCommitDetailsWithTags(commit));
    
    const commitMessage = commit.message.split('\n')[0];
    const commitDate = new Date(commit.date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    item.innerHTML = `
        <div class="commit-header">
            <div class="commit-sha">${commit.sha.substring(0, 8)}</div>
            <div class="commit-date">${commitDate}</div>
        </div>
        <div class="commit-message">${escapeHtml(commitMessage)}</div>
        <div class="commit-author">
            <i class="fas fa-user"></i>
            ${escapeHtml(commit.author)}
        </div>
    `;
    
    return item;
}

let currentCommit;

async function showCommitDetails(commit) {
    currentCommit = commit;
    
    // Populate basic commit information
    document.getElementById('commitId').textContent = commit.sha;
    document.getElementById('commitMessage').textContent = commit.message;
    document.getElementById('commitAuthor').textContent = commit.author;
    document.getElementById('commitDate').textContent = new Date(commit.date).toLocaleString();
    document.getElementById('commitUrl').href = commit.url;
    document.getElementById('commitUrl').textContent = commit.url;
    
    // Show modal immediately with basic info
    document.getElementById('commitModal').style.display = 'block';
    
    // Reset tags section
    document.getElementById('tagsSection').style.display = 'none';
    document.getElementById('loadingTags').style.display = 'none';
    document.getElementById('tagsLoaded').style.display = 'none';
}

async function loadTags() {
    if (!currentCommit) return;
    
    // Show loading state
    document.getElementById('tagsSection').style.display = 'block';
    document.getElementById('loadingTags').style.display = 'block';
    document.getElementById('tagsLoaded').style.display = 'none';
    
    try {
        console.log('Loading tags for commit:', currentCommit.sha);
        const startTime = Date.now();
        
        const response = await fetch(`/api/commits/${currentCommit.sha}/tags`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to load tags');
        }
        
        const endTime = Date.now();
        const duration = Math.round((endTime - startTime) / 1000);
        
        console.log(`Found ${data.count} tags in ${duration} seconds`);
        
        // Hide loading and show results
        document.getElementById('loadingTags').style.display = 'none';
        document.getElementById('tagsLoaded').style.display = 'block';
        
        // Update count
        document.getElementById('tagCount').textContent = data.count;
        
        // Display tags
        const tagsContainer = document.getElementById('tagsList');
        if (data.tags.length === 0) {
            tagsContainer.innerHTML = '<p class="no-tags">No tags contain this commit</p>';
        } else {
            tagsContainer.innerHTML = data.tags.map(tag => `
                <div class="tag-item">
                    <span class="tag-name">${tag.name}</span>
                    ${tag.date ? `<span class="tag-date">${new Date(tag.date).toLocaleDateString()}</span>` : ''}
                </div>
            `).join('');
        }
        
    } catch (error) {
        console.error('Failed to load tags:', error);
        document.getElementById('loadingTags').style.display = 'none';
        document.getElementById('tagsLoaded').innerHTML = `
            <div class="error-message">
                <p>Failed to load tags: ${error.message}</p>
                <button onclick="loadTags()" class="retry-button">Retry</button>
            </div>
        `;
        document.getElementById('tagsLoaded').style.display = 'block';
    }
}

function showModal() {
    commitModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function hideModal() {
    const modal = document.getElementById('commitModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Clear search and results
function clearSearch() {
    searchInput.value = '';
    searchInput.style.fontFamily = '';
    searchInput.style.backgroundColor = '';
    clearResults();
    searchInput.focus();
}

// Clear results
function clearResults() {
    showEmptyState();
    currentResults = [];
}

// Show commit details with automatic tag loading
async function showCommitDetailsWithTags(commit) {
    const modal = document.getElementById('commitModal');
    
    // Show beautiful commit details immediately
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2><i class="fas fa-code-branch"></i> Commit Details</h2>
                <span class="close" onclick="hideModal()">&times;</span>
            </div>
            <div class="modal-body">
                <div class="commit-info-card">
                    <div class="commit-field">
                        <div class="field-label"><i class="fas fa-fingerprint"></i> SHA</div>
                        <div class="field-value">
                            <code class="commit-sha-full">${commit.sha}</code>
                        </div>
                    </div>
                    
                    <div class="commit-field">
                        <div class="field-label"><i class="fas fa-user"></i> Author</div>
                        <div class="field-value">${commit.author}</div>
                    </div>
                    
                    <div class="commit-field">
                        <div class="field-label"><i class="fas fa-calendar"></i> Date</div>
                        <div class="field-value">${new Date(commit.date).toLocaleString()}</div>
                    </div>
                    
                    <div class="commit-field">
                        <div class="field-label"><i class="fas fa-comment"></i> Message</div>
                        <div class="field-value">
                            <pre class="commit-message-full">${commit.message}</pre>
                        </div>
                    </div>
                    
                    <div class="commit-links">
                        <a href="https://github.com/${commit.repository}" target="_blank" class="commit-link">
                            <i class="fab fa-github"></i> Repository
                        </a>
                        <a href="${commit.url}" target="_blank" class="commit-link">
                            <i class="fas fa-external-link-alt"></i> View on GitHub
                        </a>
                    </div>
                </div>
                
                <div class="tags-section">
                    <div class="tags-header">
                        <h3><i class="fas fa-tags"></i> Tags Containing This Commit</h3>
                    </div>
                    <div class="tags-loading-state">
                        <div class="loading-spinner">
                            <div class="spinner-circle"></div>
                            <div class="spinner-circle"></div>
                            <div class="spinner-circle"></div>
                        </div>
                        <p class="loading-text">Finding tags containing this commit...</p>
                        <div class="loading-subtitle">This may take a moment</div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    modal.style.display = 'block';
    
    // Start loading tags immediately in background
    try {
        const response = await fetch(`/api/commits/${commit.sha}/tags`);
        
        if (!response.ok) {
            throw new Error('Failed to fetch tags');
        }
        
        const tagData = await response.json();
        
        // Update the modal with beautiful tag results
        const tagsSection = document.querySelector('.tags-section');
        if (tagData.tags && tagData.tags.length > 0) {
            const latest = tagData.summary?.latestVersion || '-';
            const latestLTS = tagData.summary?.latestLTS || '-';
            tagsSection.innerHTML = `
                <div class="tags-header">
                    <h3><i class="fas fa-tags"></i> Tags Containing This Commit</h3>
                    <div class="tags-summary">
                        <span class="pill latest-pill" title="Latest Version">${latest}</span>
                        <span class="pill lts-pill" title="Latest LTS">${latestLTS}</span>
                        <label class="lts-toggle"><input type="checkbox" id="ltsOnlyToggle"> LTS only</label>
                    </div>
                </div>
                <div class="tags-grid" id="tagsGrid">
                    ${tagData.tags.map(tag => `
                        <div class="tag-card${tag.isLTS ? ' lts' : ''}" data-lts="${tag.isLTS}">
                            <div class="tag-name"><i class="fas fa-tag"></i> ${tag.name}</div>
                        </div>
                    `).join('')}
                </div>
            `;
            // Add toggle listener
            document.getElementById('ltsOnlyToggle').addEventListener('change', function() {
                const only = this.checked;
                document.querySelectorAll('#tagsGrid .tag-card').forEach(card => {
                    const isLTS = card.getAttribute('data-lts') === 'true';
                    card.style.display = (only && !isLTS) ? 'none' : 'flex';
                });
            });
        } else {
            tagsSection.innerHTML = `
                <div class="tags-header">
                    <h3><i class="fas fa-tags"></i> Tags Containing This Commit</h3>
                </div>
                <div class="no-tags-found">
                    <i class="fas fa-search"></i>
                    <p>No tags found containing this commit</p>
                    <div class="no-tags-subtitle">This commit may not be included in any released version</div>
                </div>
            `;
        }
        
    } catch (error) {
        const tagsSection = document.querySelector('.tags-section');
        tagsSection.innerHTML = `
            <div class="tags-header">
                <h3><i class="fas fa-tags"></i> Tags Containing This Commit</h3>
            </div>
            <div class="tags-error-state">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Failed to load tags</p>
                <div class="error-message">${error.message}</div>
                <button onclick="retryTagLoad('${commit.sha}')" class="retry-button">
                    <i class="fas fa-redo"></i> Try Again
                </button>
            </div>
        `;
    }
}

// Retry tag loading
async function retryTagLoad(sha) {
    const tagsSection = document.querySelector('.tags-section');
    tagsSection.innerHTML = `
        <h3>Tags Containing This Commit</h3>
        <div class="tags-loading">
            <div class="spinner"></div>
            <p>Retrying tag search...</p>
        </div>
    `;
    
    try {
        const response = await fetch(`/api/commits/${sha}/tags`);
        const tagData = await response.json();
        
        if (tagData.tags && tagData.tags.length > 0) {
            tagsSection.innerHTML = `
                <h3>Tags Containing This Commit (${tagData.count})</h3>
                <div class="tags-container">
                    ${tagData.tags.map(tag => `
                        <div class="tag-item">
                            <div class="tag-name">${tag.name}</div>
                            ${tag.date ? `<div class="tag-date">${new Date(tag.date).toLocaleDateString()}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            tagsSection.innerHTML = `
                <h3>Tags Containing This Commit</h3>
                <div class="no-tags">
                    <p>No tags found containing this commit.</p>
                </div>
            `;
        }
    } catch (error) {
        tagsSection.innerHTML = `
            <h3>Tags Containing This Commit</h3>
            <div class="tags-error">
                <p>Failed to load tags: ${error.message}</p>
                <button onclick="retryTagLoad('${sha}')" class="retry-btn">Retry</button>
            </div>
        `;
    }
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('commitModal');
    if (event.target === modal) {
        hideModal();
    }
} 