// DOM elements
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
const commitDetails = document.getElementById('commitDetails');
const closeModal = document.getElementById('closeModal');
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

    // Example tags
    exampleTags.forEach(tag => {
        tag.addEventListener('click', function() {
            const example = this.getAttribute('data-example');
            searchInput.value = example;
            performSearch();
        });
    });

    // Modal functionality
    closeModal.addEventListener('click', hideModal);
    commitModal.addEventListener('click', function(e) {
        if (e.target === commitModal) {
            hideModal();
        }
    });

    // Escape key to close modal
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && !commitModal.classList.contains('hidden')) {
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
    // Remove whitespace
    const trimmed = input.trim();
    
    // Check if it's a valid hex string with appropriate length
    // Full SHA: 40 characters, partial SHA: typically 7-40 characters
    if (trimmed.length >= 7 && trimmed.length <= 40) {
        // Check if it contains only hexadecimal characters
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
    item.addEventListener('click', () => showCommitDetails(commit.sha));
    
    const commitMessage = commit.message.split('\n')[0]; // First line only
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

async function showCommitDetails(sha) {
    try {
        showModal();
        
        // Show optimized loading message
        commitDetails.innerHTML = `
            <div class="loading-indicator">
                <div class="spinner"></div>
                <p>Loading commit details...</p>
                <div class="loading-progress">
                    <div class="progress-step active">
                        <i class="fas fa-download"></i>
                        <span>Fetching commit info</span>
                    </div>
                    <div class="progress-step" id="quickProgress">
                        <i class="fas fa-lightning"></i>
                        <span>Quick analysis</span>
                    </div>
                    <div class="progress-step" id="detailedProgress">
                        <i class="fas fa-tags"></i>
                        <span>Detailed analysis</span>
                    </div>
                </div>
            </div>
        `;
        
        // Step 1: Fetch commit details first (fastest)
        const commitResponse = await fetch(`/api/commits/${sha}`);
        const commit = await commitResponse.json();
        
        if (!commitResponse.ok) {
            throw new Error(commit.error || 'Failed to load commit details');
        }
        
        // Update progress - mark quick analysis as active
        const quickProgress = document.getElementById('quickProgress');
        if (quickProgress) {
            quickProgress.classList.add('active');
        }
        
        // Step 2: Get quick tag estimation (fast)
        const quickTagResponse = await fetch(`/api/commits/${sha}/quick-tags`);
        const quickTagData = await quickTagResponse.json();
        
        // Show basic commit info with quick estimation immediately
        displayCommitDetailsProgressive(commit, quickTagData, null);
        
        // Update progress - mark detailed analysis as active
        const detailedProgress = document.getElementById('detailedProgress');
        if (detailedProgress) {
            detailedProgress.classList.add('active');
        }
        
        // Step 3: Get detailed tag analysis in background (slower)
        const tagsResponse = await fetch(`/api/commits/${sha}/tags`);
        const tagData = await tagsResponse.json();
        
        if (!tagsResponse.ok) {
            console.warn('Failed to load detailed tags:', tagData.error);
            // Keep the quick estimation
        } else {
            // Update with detailed information
            displayCommitDetails(commit, tagData);
        }
        
    } catch (error) {
        console.error('Error loading commit details:', error);
        commitDetails.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Failed to load commit details: ${error.message}</p>
                <button onclick="showCommitDetails('${sha}')" class="retry-button">
                    <i class="fas fa-redo"></i> Retry
                </button>
            </div>
        `;
    }
}

function displayCommitDetailsProgressive(commit, quickData, detailedData) {
    const commitDate = new Date(commit.date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    // Create quick summary HTML
    let versionSummaryHtml = '';
    
    if (quickData) {
        const estimatedTags = quickData.estimatedTags || 0;
        const branches = quickData.branches || 0;
        const isInMain = quickData.isInMainBranch;
        
        versionSummaryHtml = `
            <div class="commit-detail">
                <h4><i class="fas fa-bolt"></i> Quick Analysis</h4>
                <div class="version-summary quick-summary">
                    <div class="version-stats">
                        <div class="version-stat">
                            <span class="stat-number">${estimatedTags}</span>
                            <span class="stat-label">Est. Versions</span>
                        </div>
                        <div class="version-stat">
                            <span class="stat-number">${branches}</span>
                            <span class="stat-label">Branches</span>
                        </div>
                    </div>
                    
                    <div class="version-highlights">
                        <div class="version-highlight">
                            <span class="highlight-label">Status:</span>
                            <span class="version-tag ${isInMain ? 'latest' : ''}">${isInMain ? 'In Main Branch' : 'Feature Branch'}</span>
                        </div>
                    </div>
                    
                    <div class="quick-note">
                        <i class="fas fa-info-circle"></i>
                        <span>Loading detailed analysis...</span>
                        <div class="quick-spinner"></div>
                    </div>
                </div>
            </div>
        `;
    }
    
    commitDetails.innerHTML = `
        <div class="commit-detail">
            <h4><i class="fas fa-hashtag"></i> Commit ID</h4>
            <p style="font-family: Monaco, monospace; background: #f8f9fa; padding: 10px; border-radius: 6px;">${commit.sha}</p>
        </div>
        
        <div class="commit-detail">
            <h4><i class="fas fa-comment"></i> Message</h4>
            <p style="white-space: pre-wrap; line-height: 1.6;">${escapeHtml(commit.message)}</p>
        </div>
        
        <div class="commit-detail">
            <h4><i class="fas fa-user"></i> Author</h4>
            <p>${escapeHtml(commit.author)}</p>
        </div>
        
        <div class="commit-detail">
            <h4><i class="fas fa-calendar"></i> Date</h4>
            <p>${commitDate}</p>
        </div>
        
        ${versionSummaryHtml}
        
        <div class="commit-detail">
            <h4><i class="fas fa-external-link-alt"></i> View on GitHub</h4>
            <p><a href="${commit.url}" target="_blank" style="color: #667eea; text-decoration: none;">${commit.url}</a></p>
        </div>
    `;
}

function displayCommitDetails(commit, tagData) {
    const commitDate = new Date(commit.date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    // Create version summary HTML
    let versionSummaryHtml = '';
    let tagsHtml = '';
    
    if (tagData && tagData.summary) {
        const { summary } = tagData;
        
        versionSummaryHtml = `
            <div class="commit-detail">
                <h4><i class="fas fa-tag"></i> Version Analysis <span class="analysis-complete">✅ Complete</span></h4>
                <div class="version-summary">
                    <div class="version-stats">
                        <div class="version-stat">
                            <span class="stat-number">${summary.totalTags}</span>
                            <span class="stat-label">Total Versions</span>
                        </div>
                        <div class="version-stat">
                            <span class="stat-number">${summary.ltsCount}</span>
                            <span class="stat-label">LTS Versions</span>
                        </div>
                    </div>
                    
                    <div class="version-highlights">
                        ${summary.latestVersion ? `
                            <div class="version-highlight">
                                <span class="highlight-label">Latest:</span>
                                <span class="version-tag latest">${summary.latestVersion.name}</span>
                            </div>
                        ` : ''}
                        
                        ${summary.latestLTS ? `
                            <div class="version-highlight">
                                <span class="highlight-label">Latest LTS:</span>
                                <span class="version-tag lts">${summary.latestLTS.name}</span>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
        
        // Create tags section
        if (tagData.tags && tagData.tags.length > 0) {
            tagsHtml = `
                <div class="commit-detail">
                    <div class="tags-header">
                        <h4><i class="fas fa-tags"></i> Versions Containing This Fix</h4>
                        <div class="tags-controls">
                            <label class="lts-toggle">
                                <input type="checkbox" id="ltsOnlyToggle">
                                <span class="toggle-label">LTS Only</span>
                            </label>
                        </div>
                    </div>
                    <div class="tags-container" id="tagsContainer">
                        ${createTagsHTML(tagData.tags)}
                    </div>
                </div>
            `;
        }
    }
    
    commitDetails.innerHTML = `
        <div class="commit-detail">
            <h4><i class="fas fa-hashtag"></i> Commit ID</h4>
            <p style="font-family: Monaco, monospace; background: #f8f9fa; padding: 10px; border-radius: 6px;">${commit.sha}</p>
        </div>
        
        <div class="commit-detail">
            <h4><i class="fas fa-comment"></i> Message</h4>
            <p style="white-space: pre-wrap; line-height: 1.6;">${escapeHtml(commit.message)}</p>
        </div>
        
        <div class="commit-detail">
            <h4><i class="fas fa-user"></i> Author</h4>
            <p>${escapeHtml(commit.author)}</p>
        </div>
        
        <div class="commit-detail">
            <h4><i class="fas fa-calendar"></i> Date</h4>
            <p>${commitDate}</p>
        </div>
        
        ${versionSummaryHtml}
        
        ${tagsHtml}
        
        <div class="commit-detail">
            <h4><i class="fas fa-external-link-alt"></i> View on GitHub</h4>
            <p><a href="${commit.url}" target="_blank" style="color: #667eea; text-decoration: none;">${commit.url}</a></p>
        </div>
    `;
    
    // Add event listener for LTS toggle if tags exist
    if (tagData && tagData.tags && tagData.tags.length > 0) {
        const ltsToggle = document.getElementById('ltsOnlyToggle');
        if (ltsToggle) {
            ltsToggle.addEventListener('change', function() {
                toggleLTSFilter(commit.sha, this.checked);
            });
        }
    }
}

function createTagsHTML(tags) {
    return tags.map(tag => {
        const tagDate = tag.date ? new Date(tag.date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        }) : 'Unknown date';
        
        return `
            <div class="tag-item ${tag.isLTS ? 'lts' : ''}">
                <div class="tag-name">
                    <span class="version-tag ${tag.isLTS ? 'lts' : ''}">${tag.name}</span>
                    ${tag.isLTS ? '<span class="lts-badge">LTS</span>' : ''}
                </div>
                <div class="tag-date">${tagDate}</div>
            </div>
        `;
    }).join('');
}

async function toggleLTSFilter(sha, ltsOnly) {
    try {
        const tagsContainer = document.getElementById('tagsContainer');
        tagsContainer.innerHTML = '<div class="loading-indicator"><div class="spinner"></div><p>Filtering...</p></div>';
        
        const response = await fetch(`/api/commits/${sha}/tags?ltsOnly=${ltsOnly}`);
        const tagData = await response.json();
        
        if (!response.ok) {
            throw new Error(tagData.error || 'Failed to load tags');
        }
        
        tagsContainer.innerHTML = createTagsHTML(tagData.tags);
    } catch (error) {
        console.error('Error toggling LTS filter:', error);
        document.getElementById('tagsContainer').innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Failed to load tags: ${error.message}</p>
            </div>
        `;
    }
}

function showModal() {
    commitModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function hideModal() {
    commitModal.classList.add('hidden');
    document.body.style.overflow = '';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Add some keyboard shortcuts
document.addEventListener('keydown', function(e) {
    // Focus on search input when '/' is pressed
    if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
    }
    
    // Clear search when Ctrl+K is pressed
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInput.value = '';
        searchInput.focus();
        showEmptyState();
    }
});

// Add loading state management with auto-detection
let searchTimeout;
searchInput.addEventListener('input', function() {
    clearTimeout(searchTimeout);
    
    const query = this.value.trim();
    
    // Auto-search after user stops typing (debounced)
    // Only for message searches, not for commit IDs
    if (query.length > 2 && !isCommitSHA(query)) {
        searchTimeout = setTimeout(() => {
            performSearch();
        }, 1000);
    }
});

// Add visual feedback for commit SHA detection
searchInput.addEventListener('input', function() {
    const query = this.value.trim();
    
    if (query.length > 0) {
        if (isCommitSHA(query)) {
            // Visual feedback for commit SHA
            this.style.fontFamily = 'Monaco, monospace';
            this.style.backgroundColor = '#f8f9fa';
        } else {
            // Reset to normal for message search
            this.style.fontFamily = '';
            this.style.backgroundColor = '';
        }
    } else {
        // Reset when empty
        this.style.fontFamily = '';
        this.style.backgroundColor = '';
    }
}); 