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
        commitDetails.innerHTML = '<div class="loading-indicator"><div class="spinner"></div><p>Loading commit details...</p></div>';
        
        const response = await fetch(`/api/commits/${sha}`);
        const commit = await response.json();
        
        if (!response.ok) {
            throw new Error(commit.error || 'Failed to load commit details');
        }
        
        displayCommitDetails(commit);
    } catch (error) {
        console.error('Error loading commit details:', error);
        commitDetails.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Failed to load commit details: ${error.message}</p>
            </div>
        `;
    }
}

function displayCommitDetails(commit) {
    const commitDate = new Date(commit.date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    let filesHtml = '';
    if (commit.files && commit.files.length > 0) {
        filesHtml = `
            <div class="commit-files">
                <h4><i class="fas fa-file-code"></i> Files Changed (${commit.files.length})</h4>
                ${commit.files.map(file => `
                    <div class="file-item">
                        <div class="file-header">
                            <div class="file-name">${escapeHtml(file.filename)}</div>
                            <div class="file-stats">
                                <span class="additions">+${file.additions}</span>
                                <span class="deletions">-${file.deletions}</span>
                            </div>
                        </div>
                    </div>
                `).join('')}
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
        
        <div class="commit-detail">
            <h4><i class="fas fa-external-link-alt"></i> View on GitHub</h4>
            <p><a href="${commit.url}" target="_blank" style="color: #667eea; text-decoration: none;">${commit.url}</a></p>
        </div>
        
        ${filesHtml}
    `;
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