// Global variables
let searchTimeout;
let currentResults = [];
let currentPage = 1;
let currentQuery = '';
let currentSearchType = '';
let hasMoreResults = false;
let isLoadingMore = false;
let scrollTimeout;
let allLoadedTags = []; // Store all loaded tags for search functionality
let currentCommitSha = '';
let currentBackportData = null;

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
    // Header click to go home
    const headerTitle = document.querySelector('.header-content h1');
    if (headerTitle) {
        headerTitle.addEventListener('click', goHome);
    }
    
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

    // Tag search functionality in modal
    const tagSearchInput = document.getElementById('tagSearchInput');
    const clearTagSearch = document.getElementById('clearTagSearch');
    
    if (tagSearchInput) {
        tagSearchInput.addEventListener('input', function() {
            const query = this.value.trim();
            filterTags(query);
            
            // Show/hide clear button
            if (clearTagSearch) {
                clearTagSearch.style.display = query ? 'block' : 'none';
            }
        });
    }
    
    if (clearTagSearch) {
        clearTagSearch.addEventListener('click', function() {
            if (tagSearchInput) {
                tagSearchInput.value = '';
                filterTags('');
                this.style.display = 'none';
                tagSearchInput.focus();
            }
        });
    }

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

    // Infinite scroll - DISABLED for debugging
    // window.addEventListener('scroll', handleScroll);

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

async function performSearch(isNewSearch = true) {
    let query, searchType;
    
    if (isNewSearch) {
        query = searchInput.value.trim();
        
        if (!query) {
            showSearchHint();
            return;
        }

        // Automatically detect search type
        searchType = detectSearchType(query);
        
        // Reset pagination for new searches
        currentPage = 1;
        currentQuery = query;
        currentSearchType = searchType;
        currentResults = [];
    } else {
        // For pagination, use stored values
        query = currentQuery;
        searchType = currentSearchType;
    }
    
    // Update UI state - only show loading indicator for new searches
    if (isNewSearch) {
        showLoading();
    }
    searchButton.disabled = true;
    
    try {
        const response = await fetch(`/api/search/commits?query=${encodeURIComponent(query)}&type=${searchType}&page=${currentPage}&per_page=30`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Search failed');
        }
        
        // Validate API response structure
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid API response structure');
        }
        
        // Update pagination info
        hasMoreResults = data.has_more || false;
        
        if (isNewSearch) {
            console.log('Displaying new search results');
            displayResults(data, searchType);
        } else {
            console.log('Appending results to existing search');
            appendResults(data);
        }
        
        // If searching for SHA and found exactly one commit, automatically show details with tags
        if (searchType === 'sha' && data.commits.length === 1 && isNewSearch) {
            setTimeout(() => showCommitDetailsWithTags(data.commits[0]), 100);
        }
        
    } catch (error) {
        console.error('Search error:', error);
        showError(error.message || 'Failed to search commits. Please try again.');
    } finally {
        if (isNewSearch) {
            hideLoading();
        }
        searchButton.disabled = false;
        isLoadingMore = false;
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
    
    // Show total count if available
    if (data.total_count !== undefined) {
        resultsCount.textContent = `${data.total_count} total commit${data.total_count !== 1 ? 's' : ''} found`;
    } else {
        resultsCount.textContent = `${data.count} commit${data.count !== 1 ? 's' : ''} found`;
    }
    
    // Clear previous results
    resultsList.innerHTML = '';
    currentResults = [];
    
    // Create commit items
    data.commits.forEach(commit => {
        const commitItem = createCommitItem(commit);
        resultsList.appendChild(commitItem);
        currentResults.push(commit);
    });
    
    // Add load more button if there are more results
    addLoadMoreButton();
    
    showResults();
}

function appendResults(data) {
    // Simple validation
    if (!data || !data.commits || !Array.isArray(data.commits) || !resultsList) {
        console.error('Cannot append results - invalid data or DOM elements');
        isLoadingMore = false;
        return;
    }
    
    console.log(`Appending ${data.commits.length} new results to existing ${currentResults.length} results`);
    
    // Remove the current load more button before adding new items
    const existingButton = document.getElementById('loadMoreButton');
    if (existingButton) {
        existingButton.remove();
    }
    
    // Add each commit
    data.commits.forEach(commit => {
        try {
            const commitItem = createCommitItem(commit);
            if (commitItem) {
                resultsList.appendChild(commitItem);
                currentResults.push(commit);
            }
        } catch (error) {
            console.error('Error creating commit item:', error);
        }
    });
    
    console.log(`Total results now: ${currentResults.length}`);
    
    // Update the load more button
    addLoadMoreButton();
}

function addLoadMoreButton() {
    if (!resultsList) return;
    
    // Remove existing load more button
    const existingButton = document.getElementById('loadMoreButton');
    if (existingButton) {
        existingButton.remove();
    }
    
    // Add load more button if there are more results
    if (hasMoreResults && !isLoadingMore) {
        const loadMoreContainer = document.createElement('div');
        loadMoreContainer.id = 'loadMoreButton';
        loadMoreContainer.className = 'load-more-container';
        loadMoreContainer.innerHTML = `
            <button class="load-more-btn" onclick="loadMoreResults()">
                <i class="fas fa-arrow-down"></i>
                Load More Results
            </button>
            <div class="load-more-info">
                Showing ${currentResults.length} results
            </div>
        `;
        resultsList.appendChild(loadMoreContainer);
    }
}

async function loadMoreResults() {
    // Simple guard clause
    if (isLoadingMore || !hasMoreResults) return;
    
    isLoadingMore = true;
    currentPage++;
    
    try {
        // Show loading state in button if it exists
        const loadMoreBtn = document.querySelector('.load-more-btn');
        if (loadMoreBtn) {
            loadMoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
            loadMoreBtn.disabled = true;
        }
        
        await performSearch(false);
        
    } catch (error) {
        console.error('Error loading more results:', error);
        // Reset state on error
        isLoadingMore = false;
        currentPage--;
        
        // Reset button if it exists
        const loadMoreBtn = document.querySelector('.load-more-btn');
        if (loadMoreBtn) {
            loadMoreBtn.innerHTML = '<i class="fas fa-arrow-down"></i> Load More Results';
            loadMoreBtn.disabled = false;
        }
    }
}

function handleScroll() {
    // Simple throttling - only check every 250ms
    if (scrollTimeout) return;
    
    scrollTimeout = setTimeout(() => {
        scrollTimeout = null;
        
        try {
            // Only trigger infinite scroll if we have results and more are available
            if (!hasMoreResults || isLoadingMore || currentResults.length === 0) return;
            
            // Simple scroll check
            const scrollThreshold = 500; // Increased threshold for safety
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const windowHeight = window.innerHeight;
            const documentHeight = document.documentElement.scrollHeight;
            
            // Check if we're near the bottom
            if (scrollTop + windowHeight >= documentHeight - scrollThreshold) {
                console.log('Loading more results...');
                loadMoreResults();
            }
        } catch (error) {
            console.error('Scroll handler error:', error);
            // Clear the timeout to prevent issues
            scrollTimeout = null;
        }
    }, 250);
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
                <div class="tag-item${tag.isLTS ? ' lts-tag' : ''}">
                    <span class="tag-name">${tag.name}</span>
                    ${tag.date ? `<span class="tag-date">${new Date(tag.date).toLocaleDateString()}</span>` : ''}
                </div>
            `).join('');
        }
        
        // Clear tag search when new tags are loaded
        const tagSearchInput = document.getElementById('tagSearchInput');
        const clearTagSearch = document.getElementById('clearTagSearch');
        
        if (tagSearchInput) {
            tagSearchInput.value = '';
        }
        if (clearTagSearch) {
            clearTagSearch.style.display = 'none';
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

// Analyze backports for the current commit
async function analyzeBackports() {
    if (!currentCommit) return;
    
    const backportButton = document.querySelector('.analyze-backports-button');
    const backportResults = document.getElementById('backportResults');
    
    if (!backportButton || !backportResults) return;
    
    // Update button to show loading state
    backportButton.disabled = true;
    backportButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing Backports...';
    
    // Show the results section with loading state
    backportResults.style.display = 'block';
    backportResults.innerHTML = `
        <h4><i class="fas fa-code-branch"></i> Backport Analysis</h4>
        <div class="loading-backports">
            <i class="fas fa-spinner fa-spin"></i>
            <p>Analyzing backports across stable branches...</p>
            <small>This may take a moment to search all stable branches</small>
        </div>
    `;
    
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        const response = await fetch(`/api/commits/${currentCommit.sha}/backports`, { signal: controller.signal });
        clearTimeout(timeout);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to analyze backports');
        }
        displayBackportResults(data);
        backportButton.innerHTML = '<i class="fas fa-check"></i> Analysis Complete';
        backportButton.disabled = false;
    } catch (error) {
        backportResults.innerHTML = `
            <h4><i class="fas fa-code-branch"></i> Backport Analysis</h4>
            <div class="no-backports-message">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Analysis Failed</h3>
                <p>Failed to analyze backports: ${error.name === 'AbortError' ? 'Request timed out.' : error.message}</p>
                <button onclick="analyzeBackports()" class="analyze-backports-button">
                    <i class="fas fa-redo"></i>
                    Retry Analysis
                </button>
            </div>
        `;
        backportButton.innerHTML = '<i class="fas fa-project-diagram"></i> Find Backported Commits';
        backportButton.disabled = false;
    }
}

// Display backport analysis results
function displayBackportResults(data) {
    const backportResults = document.getElementById('backportResults');
    if (!backportResults) return;
    
    const { originalCommit, backportedCommits, summary } = data;
    
    if (backportedCommits.length === 0) {
        backportResults.innerHTML = `
            <h4><i class="fas fa-code-branch"></i> Backport Analysis</h4>
            <div class="no-backports-message">
                <i class="fas fa-info-circle"></i>
                <h3>No Backports Found</h3>
                <p>This commit does not appear to have been backported to any stable branches.</p>
                <small>This could mean it's only available in the main development branch.</small>
            </div>
        `;
        return;
    }
    
    // Generate the results HTML
    backportResults.innerHTML = `
        <h4><i class="fas fa-code-branch"></i> Backport Analysis Results</h4>
        <div class="backport-summary">
            <div class="summary-cards">
                <div class="summary-card">
                    <div class="card-value" id="backportCount">${summary.totalBackports}</div>
                    <div class="card-label">Backports Found</div>
                </div>
                <div class="summary-card">
                    <div class="card-value" id="branchCount">${summary.branchesWithBackports}</div>
                    <div class="card-label">Stable Branches</div>
                </div>
                <div class="summary-card">
                    <div class="card-value" id="tagCount">${summary.totalTagsAcrossBackports}</div>
                    <div class="card-label">Total Tags</div>
                </div>
            </div>
        </div>
        <div id="backportCommitsList" class="backport-commits-list">
            ${backportedCommits.map(commit => createBackportCommitItem(commit)).join('')}
        </div>
    `;
}

// Create a backport commit item
function createBackportCommitItem(commit) {
    const commitDate = new Date(commit.date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
    
    // Handle both old format (similarity) and new format (confidence)
    const confidencePercent = Math.round((commit.confidence || commit.similarity || 0) * 100);
    
    // Determine method display
    const methodLabels = {
        'explicit_reference': 'Explicit Reference',
        'cherry_pick_reference': 'Cherry-pick',
        'similarity_match': 'Message Similarity'
    };
    const methodLabel = methodLabels[commit.method] || 'Detection Method';
    
    // Color code by confidence level
    let confidenceClass = 'low-confidence';
    if (confidencePercent >= 90) {
        confidenceClass = 'high-confidence';
    } else if (confidencePercent >= 80) {
        confidenceClass = 'medium-confidence';
    }
    
    const tagsHtml = commit.tags.length > 0 
        ? `<div class="backport-commit-tags">
             <div class="backport-tags-label">Tags containing this backport:</div>
             <div class="backport-tags-container">
               ${commit.tags.map(tag => `
                 <span class="backport-tag${tag.isLTS ? ' lts' : ''}">${tag.name}</span>
               `).join('')}
             </div>
           </div>`
        : `<div class="backport-commit-tags">
             <div class="backport-tags-label">No tags found for this backport</div>
           </div>`;
    
    return `
        <div class="backport-commit-item">
            <div class="backport-commit-header">
                <div class="backport-commit-info">
                    <span class="backport-commit-sha">${commit.sha.substring(0, 8)}</span>
                    <span class="backport-commit-branch">${commit.branch}</span>
                    <span class="backport-commit-confidence ${confidenceClass}" title="${methodLabel}">
                        ${confidencePercent}% confidence
                    </span>
                </div>
            </div>
            <div class="backport-commit-message">${escapeHtml(commit.message.split('\n')[0])}</div>
            <div class="backport-commit-meta">
                <span><i class="fas fa-user"></i> ${escapeHtml(commit.author)}</span>
                <span><i class="fas fa-calendar"></i> ${commitDate}</span>
                <span><i class="fas fa-search"></i> ${methodLabel}</span>
                <span><i class="fas fa-external-link-alt"></i> <a href="${commit.url}" target="_blank" style="color: inherit;">View on GitHub</a></span>
            </div>
            ${tagsHtml}
        </div>
    `;
}

function showModal() {
    commitModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function hideModal() {
    const modal = document.getElementById('commitModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
    
    // Clear tag search when modal is closed
    const tagSearchInput = document.getElementById('tagSearchInput');
    const clearTagSearch = document.getElementById('clearTagSearch');
    
    if (tagSearchInput) {
        tagSearchInput.value = '';
    }
    if (clearTagSearch) {
        clearTagSearch.style.display = 'none';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Go home - reset everything to initial state
function goHome() {
    // Clear search input
    searchInput.value = '';
    searchInput.style.fontFamily = '';
    searchInput.style.backgroundColor = '';
    
    // Remove any hint messages
    const existingHints = document.querySelectorAll('.search-hint-message');
    existingHints.forEach(hint => hint.remove());
    
    // Hide modal if open
    hideModal();
    
    // Reset pagination state
    currentPage = 1;
    currentQuery = '';
    currentSearchType = '';
    hasMoreResults = false;
    isLoadingMore = false;
    
    // Clear results and go to empty state
    clearResults();
    
    // Focus search input for new search
    searchInput.focus();
    
    // Clear any timeouts
    clearTimeout(searchTimeout);
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
    currentPage = 1;
    hasMoreResults = false;
    isLoadingMore = false;
}

// Show commit details with automatic tag loading
async function showCommitDetailsWithTags(commit) {
    currentCommit = commit; // Store for backport analysis
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
                        <div class="field-label"><i class="fas fa-user"></i> Sign off by:</div>
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
                
                <!-- Backport Analysis Section -->
                <div class="commit-detail">
                    <h4><i class="fas fa-code-branch"></i> Backport Analysis</h4>
                    <div class="backport-actions">
                        <button onclick="analyzeBackports()" class="analyze-backports-button">
                            <i class="fas fa-project-diagram"></i>
                            Find Backported Commits
                        </button>
                        <small class="action-note">Find all backported versions of this commit across stable branches</small>
                    </div>
                </div>
                
                <!-- Backport Results Section -->
                <div id="backportResults" class="commit-detail backport-results-section" style="display: none;">
                    <!-- Results will be populated here -->
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
            const latest = tagData.summary?.latestVersion || 'None';
            const latestLTS = tagData.summary?.latestLTS || 'None';
            tagsSection.innerHTML = `
                <div class="tags-header">
                    <h3><i class="fas fa-tags"></i> Tags Containing This Commit</h3>
                    <label class="lts-toggle"><input type="checkbox" id="ltsOnlyToggle"> LTS only</label>
                </div>
                <div class="summary-cards">
                    <div class="summary-card latest-card">
                        <div class="card-label">Latest Version</div>
                        <div class="card-value">${latest}</div>
                    </div>
                    <div class="summary-card lts-card">
                        <div class="card-label">Latest LTS</div>
                        <div class="card-value">${latestLTS}</div>
                    </div>
                    <div class="summary-card count-card">
                        <div class="card-label">Total Tags</div>
                        <div class="card-value" id="tagCountDisplay">${tagData.count}</div>
                    </div>
                </div>
                
                <!-- Tag Search Input -->
                <div class="tag-search-container">
                    <input 
                        type="text" 
                        id="tagSearchInput" 
                        placeholder="Search tags (e.g., 15.5, lts, rc)..."
                        class="tag-search-input"
                    >
                    <button id="clearTagSearch" class="clear-tag-search" style="display: none;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="tags-grid" id="tagsGrid">
                    ${tagData.tags.map(tag => `
                        <div class="tag-card${tag.isLTS ? ' lts' : ''}" data-lts="${tag.isLTS}" data-tag-name="${tag.name.toLowerCase()}">
                            <div class="tag-name"><i class="fas fa-tag"></i> ${tag.name}</div>
                        </div>
                    `).join('')}
                </div>
                
                <!-- No results message -->
                <div id="noTagsFound" class="no-tags-found" style="display: none;">
                    <i class="fas fa-search"></i>
                    <p>No tags found matching your search</p>
                </div>
            `;
            // Add toggle listener with card updates
            document.getElementById('ltsOnlyToggle').addEventListener('change', function() {
                // Re-apply the current search with the new LTS filter
                const searchInput = document.getElementById('tagSearchInput');
                const currentQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
                filterTagsInModal(currentQuery);
            });
            
            // Add search functionality
            const tagSearchInput = document.getElementById('tagSearchInput');
            const clearTagSearch = document.getElementById('clearTagSearch');
            
            if (tagSearchInput) {
                tagSearchInput.addEventListener('input', function() {
                    const query = this.value.trim().toLowerCase();
                    filterTagsInModal(query);
                    
                    // Show/hide clear button
                    if (clearTagSearch) {
                        clearTagSearch.style.display = query ? 'block' : 'none';
                    }
                });
            }
            
            if (clearTagSearch) {
                clearTagSearch.addEventListener('click', function() {
                    if (tagSearchInput) {
                        tagSearchInput.value = '';
                        filterTagsInModal('');
                        this.style.display = 'none';
                        tagSearchInput.focus();
                    }
                });
            }
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

function showSearchHint() {
    hideAllStates();
    
    // Remove any existing hint messages first
    const existingHints = document.querySelectorAll('.search-hint-message');
    existingHints.forEach(hint => hint.remove());
    
    // Create an elegant hint message
    const hintElement = document.createElement('div');
    hintElement.className = 'search-hint-message';
    hintElement.innerHTML = `
        <div class="hint-header">
            <div class="hint-icon">
                <i class="fas fa-search"></i>
            </div>
            <div class="hint-title">
                <h3>Ready to Search</h3>
                <p class="hint-subtitle">Find commits and track fixes across EVE-OS versions</p>
            </div>
            <button class="hint-close" onclick="closeSearchHint()">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="hint-body">
            <div class="hint-section">
                <div class="hint-option">
                    <div class="option-icon">
                        <i class="fas fa-code-branch"></i>
                    </div>
                    <div class="option-content">
                        <strong>Search by Commit ID</strong>
                        <span>Enter full or partial SHA hash</span>
                        <code class="option-example">2b7201c</code>
                    </div>
                </div>
                <div class="hint-option">
                    <div class="option-icon">
                        <i class="fas fa-comment-dots"></i>
                    </div>
                    <div class="option-content">
                        <strong>Search by Keywords</strong>
                        <span>Find commits by message content</span>
                        <code class="option-example">fix memory leak</code>
                    </div>
                </div>
            </div>
            <div class="hint-examples">
                <div class="examples-header">
                    <i class="fas fa-play-circle"></i>
                    <span>Quick Start Examples</span>
                </div>
                <div class="example-buttons">
                    <button class="example-btn" onclick="fillExample('f63bb927d74c8e6fb04e470a6969c926aaa3f5cd')">
                        <i class="fas fa-hashtag"></i>
                        Sample Commit
                    </button>
                    <button class="example-btn" onclick="fillExample('fix crash')">
                        <i class="fas fa-bug"></i>
                        Fix Crash
                    </button>
                    <button class="example-btn" onclick="fillExample('pillar')">
                        <i class="fas fa-cogs"></i>
                        Pillar
                    </button>
                    <button class="example-btn" onclick="fillExample('security')">
                        <i class="fas fa-shield-alt"></i>
                        Security
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Insert after the search section
    const searchSection = document.querySelector('.search-section');
    searchSection.appendChild(hintElement);
    
    // Focus the search input
    searchInput.focus();
    
    // No automatic removal - hint stays until user takes action
}

function closeSearchHint() {
    const hintElement = document.querySelector('.search-hint-message');
    if (hintElement) {
        hintElement.style.animation = 'slideOutToTop 0.3s ease-in';
        setTimeout(() => {
            if (hintElement.parentNode) {
                hintElement.remove();
            }
        }, 300);
    }
}

function fillExample(example) {
    searchInput.value = example;
    // Remove any existing hints
    const existingHints = document.querySelectorAll('.search-hint-message');
    existingHints.forEach(hint => hint.remove());
    performSearch();
}

// Filter tags based on search query
function filterTags(query) {
    const tagsList = document.getElementById('tagsList');
    const noTagsFound = document.getElementById('noTagsFound');
    const tagCount = document.getElementById('tagCount');
    
    if (!tagsList || !tagCount) return;
    
    const tagItems = tagsList.querySelectorAll('.tag-item');
    let visibleCount = 0;
    
    if (!query) {
        // Show all tags
        tagItems.forEach(item => {
            item.classList.remove('hidden', 'highlight');
        });
        visibleCount = tagItems.length;
    } else {
        const queryLower = query.toLowerCase();
        
        tagItems.forEach(item => {
            const tagName = item.querySelector('.tag-name');
            if (tagName) {
                const tagNameText = tagName.textContent.toLowerCase();
                
                // Check if tag matches search query
                const matches = tagNameText.includes(queryLower) || 
                              (queryLower === 'lts' && item.classList.contains('lts-tag')) ||
                              (queryLower === 'rc' && tagNameText.includes('rc'));
                
                if (matches) {
                    item.classList.remove('hidden');
                    item.classList.add('highlight');
                    visibleCount++;
                } else {
                    item.classList.add('hidden');
                    item.classList.remove('highlight');
                }
            }
        });
    }
    
    // Update count
    tagCount.textContent = visibleCount;
    
    // Show/hide no results message
    if (noTagsFound) {
        noTagsFound.style.display = visibleCount === 0 && query ? 'block' : 'none';
    }
    
    // Hide tags list if no results
    tagsList.style.display = visibleCount === 0 && query ? 'none' : 'block';
}

// Filter tags in the modal based on search query
function filterTagsInModal(query) {
    const tagsGrid = document.getElementById('tagsGrid');
    const noTagsFound = document.getElementById('noTagsFound');
    const tagCountDisplay = document.getElementById('tagCountDisplay');
    const ltsToggle = document.getElementById('ltsOnlyToggle');
    
    if (!tagsGrid || !tagCountDisplay) return;
    
    const tagCards = tagsGrid.querySelectorAll('.tag-card');
    const showLTSOnly = ltsToggle ? ltsToggle.checked : false;
    let visibleCount = 0;
    
    tagCards.forEach(card => {
        const tagName = card.getAttribute('data-tag-name') || '';
        const isLTS = card.getAttribute('data-lts') === 'true';
        
        // Check if tag matches search query
        let matchesSearch = true;
        if (query) {
            const queryLower = query.toLowerCase();
            matchesSearch = tagName.includes(queryLower) || 
                          (queryLower === 'lts' && isLTS) ||
                          (queryLower === 'rc' && tagName.includes('rc'));
        }
        
        // Check if tag matches LTS filter
        const matchesLTSFilter = !showLTSOnly || isLTS;
        
        // Show tag if it matches both search and LTS filter
        const shouldShow = matchesSearch && matchesLTSFilter;
        
        if (shouldShow) {
            card.classList.remove('hidden');
            card.classList.toggle('highlight', !!query);
            card.style.display = 'flex';
            visibleCount++;
        } else {
            card.classList.add('hidden');
            card.classList.remove('highlight');
            card.style.display = 'none';
        }
    });
    
    // Update count
    tagCountDisplay.textContent = visibleCount;
    
    // Show/hide no results message
    if (noTagsFound) {
        noTagsFound.style.display = visibleCount === 0 && (query || showLTSOnly) ? 'block' : 'none';
    }
    
    // Show/hide tags grid and reset layout properly
    if (visibleCount === 0 && (query || showLTSOnly)) {
        tagsGrid.style.display = 'none';
    } else {
        tagsGrid.style.display = 'flex';
        // Reset to original grid layout when no search/filter is active
        if (!query && !showLTSOnly) {
            tagsGrid.style.flexDirection = '';
            tagsGrid.style.flexWrap = '';
            // Remove any inline styles that might interfere
            tagsGrid.style.gap = '';
            tagsGrid.style.maxHeight = '';
            tagsGrid.style.overflowY = '';
        }
    }
} 