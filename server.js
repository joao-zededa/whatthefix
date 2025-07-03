const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// EVE-OS GitHub repository information
const EVE_OS_REPO = 'lf-edge/eve';
const GITHUB_API_BASE = 'https://api.github.com';

// In-memory cache for performance optimization
const cache = {
  tags: null,
  tagsTimestamp: null,
  commitTags: new Map(),
  commitDetails: new Map(),
  quickTagCount: new Map() // Quick count cache
};

const CACHE_TTL = 30 * 60 * 1000; // Increased to 30 minutes for better caching
const RATE_LIMIT_DELAY = 1000; // 1 second delay between API calls
const BATCH_SIZE = 3; // Reduced batch size for better rate limiting

// GitHub authentication headers
const getGitHubHeaders = () => {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'EVE-OS-Fix-Finder'
  };
  
  // Add authorization if token is available
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }
  
  return headers;
};

// Helper function to add delay between API calls
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to make GitHub API requests with proper rate limiting
async function makeGitHubRequest(url, params = {}) {
  try {
    // Add delay before each request to respect rate limits
    await delay(RATE_LIMIT_DELAY);
    
    const response = await axios.get(url, {
      params,
      headers: getGitHubHeaders(),
      timeout: 15000 // Increased timeout
    });
    return response;
  } catch (error) {
    if (error.response && error.response.status === 403) {
      console.error('GitHub API rate limit exceeded. Consider adding a GITHUB_TOKEN to your .env file');
      throw new Error('API rate limit exceeded. Please try again later or contact administrator.');
    }
    throw error;
  }
}

// Helper function to search commits
async function searchCommits(query, searchType = 'message') {
  try {
    let searchQuery = '';
    
    if (searchType === 'sha') {
      // Search by commit SHA
      const response = await makeGitHubRequest(`${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/commits/${query}`);
      return [response.data];
    } else {
      // Search by commit message
      searchQuery = `repo:${EVE_OS_REPO} ${query}`;
      const response = await makeGitHubRequest(`${GITHUB_API_BASE}/search/commits`, {
        q: searchQuery,
        sort: 'committer-date',
        order: 'desc',
        per_page: 50
      });
      return response.data.items;
    }
  } catch (error) {
    console.error('Error searching commits:', error.message);
    throw error;
  }
}

// Optimized function to get all repository tags with caching
async function getAllTags() {
  const now = Date.now();
  
  // Return cached tags if still valid
  if (cache.tags && cache.tagsTimestamp && (now - cache.tagsTimestamp) < CACHE_TTL) {
    return cache.tags;
  }
  
  try {
    console.log('🔄 Fetching fresh tag data (this may take a moment)...');
    const allTags = [];
    let page = 1;
    const perPage = 100;
    
    while (true) {
      console.log(`📥 Fetching tags page ${page}...`);
      
      const response = await makeGitHubRequest(`${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/tags`, {
        per_page: perPage,
        page: page
      });
      
      const tags = response.data;
      if (tags.length === 0) break;
      
      allTags.push(...tags);
      
      // Limit to prevent excessive API calls
      if (tags.length < perPage || page >= 5) break; // Max 5 pages = 500 tags
      page++;
    }
    
    // Cache the results
    cache.tags = allTags;
    cache.tagsTimestamp = now;
    
    console.log(`✅ Cached ${allTags.length} tags`);
    return allTags;
  } catch (error) {
    console.error('Error fetching tags:', error.message);
    throw error;
  }
}

// MUCH MORE EFFICIENT: Quick tag count without heavy API calls
async function getQuickTagCount(sha) {
  const cacheKey = `quick_${sha}`;
  
  // Check cache first
  if (cache.quickTagCount.has(cacheKey)) {
    return cache.quickTagCount.get(cacheKey);
  }
  
  try {
    console.log(`⚡ Getting quick count for ${sha.substring(0, 8)}...`);
    
    // Get commit details first
    const commitResponse = await makeGitHubRequest(`${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/commits/${sha}`);
    const commitDate = new Date(commitResponse.data.commit.author.date);
    
    // Calculate commit age
    const commitAge = Date.now() - commitDate.getTime();
    const daysOld = commitAge / (24 * 60 * 60 * 1000);
    
    // Smart estimation based on commit age without fetching all tags
    let estimatedCount = 0;
    const totalEstimatedTags = 300; // Rough estimate of EVE-OS tags
    
    if (daysOld > 365) {
      estimatedCount = Math.floor(totalEstimatedTags * 0.7); // Old commits likely in many tags
    } else if (daysOld > 180) {
      estimatedCount = Math.floor(totalEstimatedTags * 0.5); // Medium age
    } else if (daysOld > 90) {
      estimatedCount = Math.floor(totalEstimatedTags * 0.3); // Recent commits
    } else if (daysOld > 30) {
      estimatedCount = Math.floor(totalEstimatedTags * 0.15); // Recent commits
    } else {
      estimatedCount = Math.floor(totalEstimatedTags * 0.05); // Very recent
    }
    
    const result = {
      branches: 1,
      estimatedTags: estimatedCount,
      isInMainBranch: estimatedCount > 10
    };
    
    // Cache the result
    cache.quickTagCount.set(cacheKey, result);
    
    console.log(`⚡ Quick analysis: ${estimatedCount} estimated tags for ${sha.substring(0, 8)} (${daysOld.toFixed(0)} days old)`);
    return result;
  } catch (error) {
    console.warn('Failed to get quick tag count:', error.message);
    return { branches: 0, estimatedTags: 0, isInMainBranch: false };
  }
}

// HEAVILY OPTIMIZED: Smart tag analysis with aggressive rate limiting
async function getTagsContainingCommit(sha) {
  const cacheKey = sha;
  
  // Check cache first
  if (cache.commitTags.has(cacheKey)) {
    console.log(`💾 Cache hit for commit ${sha.substring(0, 8)}`);
    return cache.commitTags.get(cacheKey);
  }
  
  try {
    console.log(`🚀 Processing tags for commit ${sha.substring(0, 8)}...`);
    const startTime = Date.now();
    
    // Get commit details
    const commitResponse = await makeGitHubRequest(`${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/commits/${sha}`);
    const commitDate = new Date(commitResponse.data.commit.author.date);
    
    // Get all tags (cached)
    const allTags = await getAllTags();
    
    // MORE AGGRESSIVE FILTERING: Only check recent tags for recent commits
    const commitAge = Date.now() - commitDate.getTime();
    const daysOld = commitAge / (24 * 60 * 60 * 1000);
    
    let candidateTags = allTags;
    
    // If commit is very recent, only check recent tags
    if (daysOld < 30) {
      candidateTags = allTags.slice(0, 20); // Only check 20 most recent tags
    } else if (daysOld < 90) {
      candidateTags = allTags.slice(0, 50); // Only check 50 most recent tags
    } else if (daysOld < 180) {
      candidateTags = allTags.slice(0, 100); // Only check 100 most recent tags
    } else {
      candidateTags = allTags.slice(0, 150); // Max 150 tags even for old commits
    }
    
    console.log(`📊 Filtered to ${candidateTags.length} candidate tags (commit is ${daysOld.toFixed(0)} days old)`);
    
    // Process with much smaller batches and longer delays
    const batchSize = BATCH_SIZE;
    const tagsWithCommit = [];
    
    for (let i = 0; i < candidateTags.length; i += batchSize) {
      const batch = candidateTags.slice(i, i + batchSize);
      
      console.log(`🔄 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(candidateTags.length/batchSize)} (${batch.length} tags)`);
      
      const batchPromises = batch.map(async (tag) => {
        try {
          const compareResponse = await makeGitHubRequest(
            `${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/compare/${sha}...${tag.commit.sha}`
          );
          
          const status = compareResponse.data.status;
          const aheadBy = compareResponse.data.ahead_by || 0;
          const behindBy = compareResponse.data.behind_by || 0;
          
          let shouldInclude = false;
          let reason = '';
          
          if (status === 'behind') {
            shouldInclude = true;
            reason = 'behind';
          } else if (status === 'identical') {
            shouldInclude = true;
            reason = 'identical';
          } else if (status === 'diverged' && behindBy === 0) {
            shouldInclude = true;
            reason = 'diverged_contains';
          } else if (status === 'diverged' && behindBy > 0) {
            if (daysOld > 30 && behindBy < 100) {
              shouldInclude = true;
              reason = 'diverged_old_commit';
            } else {
              shouldInclude = false;
              reason = 'diverged_unlikely';
            }
          }
          
          if (shouldInclude) {
            return {
              name: tag.name,
              commit: tag.commit.sha,
              date: tag.commit?.commit?.author?.date || null,
              comparison: { status: reason, aheadBy, behindBy }
            };
          }
          
          return null;
        } catch (error) {
          console.warn(`⚠️  Failed to compare with tag ${tag.name}:`, error.message);
          return null;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      const validResults = batchResults.filter(result => result !== null);
      tagsWithCommit.push(...validResults);
      
      // Progress update
      const progress = Math.min(i + batchSize, candidateTags.length);
      console.log(`📈 Progress: ${progress}/${candidateTags.length} tags processed, found ${tagsWithCommit.length} matches`);
      
      // Longer delay between batches to respect rate limits
      if (i + batchSize < candidateTags.length) {
        console.log(`⏱️  Waiting ${RATE_LIMIT_DELAY * 2}ms before next batch...`);
        await delay(RATE_LIMIT_DELAY * 2);
      }
    }
    
    // Cache the result
    cache.commitTags.set(cacheKey, tagsWithCommit);
    
    const endTime = Date.now();
    const durationMinutes = Math.round((endTime - startTime) / (1000 * 60));
    console.log(`⚡ Found ${tagsWithCommit.length} tags in ${durationMinutes} minutes`);
    
    return tagsWithCommit;
  } catch (error) {
    console.error('Error getting tags:', error.message);
    throw error;
  }
}

// Optimized commit details with caching
async function getCommitDetails(sha) {
  if (cache.commitDetails.has(sha)) {
    return cache.commitDetails.get(sha);
  }
  
  try {
    const response = await makeGitHubRequest(`${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/commits/${sha}`);
    const commit = response.data;
    
    const formattedCommit = {
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: commit.commit.author.date,
      url: commit.html_url,
      repository: EVE_OS_REPO
    };
    
    // Cache the result
    cache.commitDetails.set(sha, formattedCommit);
    return formattedCommit;
  } catch (error) {
    console.error('Error fetching commit details:', error.message);
    throw error;
  }
}

// Helper function to analyze version information
function analyzeVersions(tags) {
  const versions = tags.map(tag => {
    const version = parseVersion(tag.name);
    return {
      ...tag,
      version: version,
      isLTS: isLTSVersion(tag.name, version)
    };
  }).filter(tag => tag.version); // Only include valid versions
  
  // Sort by version (newest first)
  versions.sort((a, b) => compareVersions(b.version, a.version));
  
  const latestVersion = versions[0];
  const latestLTS = versions.find(v => v.isLTS);
  
  // Find major versions
  const majorVersions = {};
  versions.forEach(v => {
    const major = v.version.major;
    if (!majorVersions[major] || compareVersions(v.version, majorVersions[major].version) > 0) {
      majorVersions[major] = v;
    }
  });
  
  return {
    allVersions: versions,
    latestVersion: latestVersion,
    latestLTS: latestLTS,
    majorVersions: Object.values(majorVersions).sort((a, b) => b.version.major - a.version.major),
    ltsVersions: versions.filter(v => v.isLTS)
  };
}

// Helper function to parse version from tag name
function parseVersion(tagName) {
  // Match patterns like: v1.2.3, 1.2.3, v1.2.3-lts, 1.2.3-rc1, etc.
  const versionRegex = /^v?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9-]+))?/;
  const match = tagName.match(versionRegex);
  
  if (!match) return null;
  
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
    prerelease: match[4] || null,
    raw: tagName
  };
}

// Helper function to determine if a version is LTS
function isLTSVersion(tagName, version) {
  // Check if tag name contains LTS indicators
  const ltsIndicators = ['lts', 'stable', 'long-term'];
  const tagLower = tagName.toLowerCase();
  
  if (ltsIndicators.some(indicator => tagLower.includes(indicator))) {
    return true;
  }
  
  // For EVE-OS, assume even major versions are LTS (common pattern)
  // This is a heuristic and might need adjustment based on actual EVE-OS versioning
  if (version && version.major % 2 === 0 && !version.prerelease) {
    return true;
  }
  
  return false;
}

// Helper function to compare versions
function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  
  // Handle prerelease versions
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  if (a.prerelease && b.prerelease) return a.prerelease.localeCompare(b.prerelease);
  
  return 0;
}

// API Routes
app.get('/api/search/commits', async (req, res) => {
  try {
    const { query, type = 'message' } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const commits = await searchCommits(query, type);
    
    // Format the response
    const formattedCommits = commits.map(commit => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: commit.commit.author.date,
      url: commit.html_url,
      repository: EVE_OS_REPO
    }));

    res.json({
      query,
      type,
      count: formattedCommits.length,
      commits: formattedCommits
    });
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ 
      error: 'Failed to search commits',
      message: error.message 
    });
  }
});

// Get commit details by SHA with caching
app.get('/api/commits/:sha', async (req, res) => {
  try {
    const { sha } = req.params;
    const commit = await getCommitDetails(sha);
    res.json(commit);
  } catch (error) {
    console.error('Commit fetch error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch commit details',
      message: error.message 
    });
  }
});

// NEW: Quick tag count endpoint for immediate feedback
app.get('/api/commits/:sha/quick-tags', async (req, res) => {
  try {
    const { sha } = req.params;
    const quickInfo = await getQuickTagCount(sha);
    
    res.json({
      sha,
      quick: true,
      ...quickInfo
    });
  } catch (error) {
    console.error('Quick tags fetch error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch quick tag info',
      message: error.message 
    });
  }
});

// Get tags containing a commit (optimized)
app.get('/api/commits/:sha/tags', async (req, res) => {
  try {
    const { sha } = req.params;
    const { ltsOnly } = req.query;
    
    const tags = await getTagsContainingCommit(sha);
    const versionAnalysis = analyzeVersions(tags);
    
    let filteredVersions = versionAnalysis.allVersions;
    if (ltsOnly === 'true') {
      filteredVersions = versionAnalysis.ltsVersions;
    }
    
    res.json({
      sha,
      tags: filteredVersions,
      summary: {
        totalTags: versionAnalysis.allVersions.length,
        latestVersion: versionAnalysis.latestVersion,
        latestLTS: versionAnalysis.latestLTS,
        majorVersions: versionAnalysis.majorVersions,
        ltsCount: versionAnalysis.ltsVersions.length
      }
    });
  } catch (error) {
    console.error('Tags fetch error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch tags',
      message: error.message 
    });
  }
});

// Cache management endpoints
app.get('/api/cache/status', (req, res) => {
  res.json({
    tags: {
      cached: !!cache.tags,
      count: cache.tags ? cache.tags.length : 0,
      age: cache.tagsTimestamp ? Date.now() - cache.tagsTimestamp : null
    },
    commitTags: cache.commitTags.size,
    commitDetails: cache.commitDetails.size,
    quickTagCount: cache.quickTagCount.size
  });
});

app.post('/api/cache/clear', (req, res) => {
  cache.tags = null;
  cache.tagsTimestamp = null;
  cache.commitTags.clear();
  cache.commitDetails.clear();
  cache.quickTagCount.clear();
  res.json({ message: 'Cache cleared successfully' });
});

// Serve the main application
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Add rate limit info endpoint
app.get('/api/rate-limit', async (req, res) => {
  try {
    const response = await makeGitHubRequest(`${GITHUB_API_BASE}/rate_limit`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch rate limit info' });
  }
});

// DEBUG: Test individual tag comparison
app.get('/api/debug/compare/:sha/:tagName', async (req, res) => {
  try {
    const { sha, tagName } = req.params;
    
    // Get all tags to find the requested tag
    const allTags = await getAllTags();
    const tag = allTags.find(t => t.name === tagName);
    
    if (!tag) {
      return res.status(404).json({ error: `Tag ${tagName} not found` });
    }
    
    // Perform the comparison
    const compareResponse = await makeGitHubRequest(
      `${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/compare/${sha}...${tag.commit.sha}`
    );
    
    // Get commit details
    const commitResponse = await makeGitHubRequest(`${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/commits/${sha}`);
    const tagCommitResponse = await makeGitHubRequest(`${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/commits/${tag.commit.sha}`);
    
    res.json({
      commit: {
        sha: sha,
        date: commitResponse.data.commit.author.date,
        message: commitResponse.data.commit.message.split('\n')[0]
      },
      tag: {
        name: tag.name,
        commit: tag.commit.sha,
        date: tagCommitResponse.data.commit.author.date,
        message: tagCommitResponse.data.commit.message.split('\n')[0]
      },
      comparison: {
        status: compareResponse.data.status,
        aheadBy: compareResponse.data.ahead_by,
        behindBy: compareResponse.data.behind_by,
        totalCommits: compareResponse.data.total_commits
      },
      verdict: compareResponse.data.status === 'behind' || compareResponse.data.status === 'identical' ? 'CONTAINS' : 'DOES_NOT_CONTAIN'
    });
  } catch (error) {
    console.error('Debug compare error:', error.message);
    res.status(500).json({ 
      error: 'Failed to compare commit with tag',
      message: error.message 
    });
  }
});

// DISABLED: Don't warm up cache on startup to save API calls
async function warmUpCache() {
  console.log('🔥 Cache warming disabled to preserve API rate limits');
  console.log('   Cache will be populated on first use');
}

app.listen(PORT, () => {
  console.log(`EVE-OS Fix Finder server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to use the application`);
  
  if (process.env.GITHUB_TOKEN) {
    console.log('✅ GitHub token configured - higher rate limits available');
  } else {
    console.log('⚠️  No GitHub token found - limited to 60 requests/hour');
    console.log('   Add GITHUB_TOKEN to .env file for 5,000 requests/hour');
  }
  
  // Warm up cache in the background
  setTimeout(warmUpCache, 1000);
}); 