// Global variables
let searchTimeout;
let currentResults = [];
let currentPage = 1;
let currentQuery = '';
let currentSearchType = '';
let hasMoreResults = false;
let isLoadingMore = false;
let scrollTimeout;

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
                <div class="tags-grid" id="tagsGrid">
                    ${tagData.tags.map(tag => `
                        <div class="tag-card${tag.isLTS ? ' lts' : ''}" data-lts="${tag.isLTS}">
                            <div class="tag-name"><i class="fas fa-tag"></i> ${tag.name}</div>
                        </div>
                    `).join('')}
                </div>
            `;
            // Add toggle listener with card updates
            document.getElementById('ltsOnlyToggle').addEventListener('change', function() {
                const showLTSOnly = this.checked;
                const allCards = document.querySelectorAll('#tagsGrid .tag-card');
                let visibleCount = 0;
                
                allCards.forEach(card => {
                    const isLTS = card.getAttribute('data-lts') === 'true';
                    const shouldShow = !showLTSOnly || isLTS;
                    card.style.display = shouldShow ? 'flex' : 'none';
                    if (shouldShow) visibleCount++;
                });
                
                // Update the count card
                document.getElementById('tagCountDisplay').textContent = visibleCount;
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

function showSearchHint() {
    hideAllStates();
    
    // Remove any existing hint messages first
    const existingHints = document.querySelectorAll('.search-hint-message');
    existingHints.forEach(hint => hint.remove());
    
    // Create a friendly hint message
    const hintElement = document.createElement('div');
    hintElement.className = 'search-hint-message';
    hintElement.innerHTML = `
        <div class="hint-icon">
            <i class="fas fa-lightbulb"></i>
        </div>
        <div class="hint-content">
            <h3>Ready to Search!</h3>
            <p>Enter a commit ID (like <code>2b7201c</code>) or search terms to find commits in the EVE-OS repository.</p>
            <div class="hint-examples">
                <strong>Try these examples:</strong>
                <div class="example-hints">
                    <span class="example-hint" onclick="fillExample('f63bb927d74c8e6fb04e470a6969c926aaa3f5cd')">f63bb927d74c8e6fb04e470a6969c926aaa3f5cd</span>
                    <span class="example-hint" onclick="fillExample('fix crash')">fix crash</span>
                    <span class="example-hint" onclick="fillExample('pillar')">pillar</span>
                </div>
            </div>
        </div>
    `;
    
    // Insert after the search section
    const searchSection = document.querySelector('.search-section');
    searchSection.appendChild(hintElement);
    
    // Focus the search input
    searchInput.focus();
    
    // Remove the hint after 5 seconds
    setTimeout(() => {
        if (hintElement.parentNode) {
            hintElement.remove();
        }
    }, 5000);
}

function fillExample(example) {
    searchInput.value = example;
    // Remove any existing hints
    const existingHints = document.querySelectorAll('.search-hint-message');
    existingHints.forEach(hint => hint.remove());
    performSearch();
} 