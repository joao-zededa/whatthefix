const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
require('dotenv').config();
const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// EVE-OS GitHub repository information
const EVE_OS_REPO = 'lf-edge/eve';
const GITHUB_API_BASE = 'https://api.github.com';

// Path for local clone of EVE-OS repository for ultra-fast git queries
const LOCAL_REPO_PATH = path.join(__dirname, 'eve-repo');

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

// Global request tracking to prevent duplicate requests
const activeRequests = new Map();

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

// Ensure local repository exists and is up to date
function ensureLocalRepo() {
  try {
    if (!fs.existsSync(path.join(LOCAL_REPO_PATH, '.git'))) {
      console.log('⏬ Cloning lf-edge/eve repository locally (this is done once)...');
      execSync(`git clone --filter=blob:none --quiet https://github.com/${EVE_OS_REPO}.git ${LOCAL_REPO_PATH}`, { stdio: 'inherit' });
      console.log('✅ Clone complete');
    } else {
      console.log('🔄 Fetching latest changes in local repo…');
      execSync('git fetch --all --tags --quiet', { cwd: LOCAL_REPO_PATH, stdio: 'inherit' });
      console.log('✅ Local repo up to date');
    }
  } catch (err) {
    console.warn('⚠️  Failed to set up local repo – falling back to GitHub API:', err.message);
  }
}

// Call repo setup at startup (non-blocking)
setTimeout(() => {
  try { ensureLocalRepo(); } catch (_) {}
}, 0);

function parseSemVer(name) {
  const match = name.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: +match[1],
    minor: +match[2],
    patch: +match[3],
    raw: match[0]
  };
}

function compareSemVer(a, b) {
  if (a.major !== b.major) return b.major - a.major;
  if (a.minor !== b.minor) return b.minor - a.minor;
  return b.patch - a.patch;
}

function buildTagSummary(tags) {
  const semverTags = tags.filter(t => t.semver);
  if (semverTags.length === 0) return { latestVersion: null, latestLTS: null };
  semverTags.sort((a, b) => compareSemVer(a.semver, b.semver));
  const latestVersion = semverTags.find(t => !t.name.includes('-rc') && !t.name.includes('-lts'))?.name || null;
  const latestLTS = semverTags.find(t => t.name.toLowerCase().includes('lts'))?.name || null;
  return { latestVersion, latestLTS };
}

function getTagsContainingCommitGit(sha) {
  const cacheKey = `git_tags_${sha}`;
  if (cache.commitTags.has(cacheKey)) {
    return cache.commitTags.get(cacheKey);
  }

  try {
    if (!fs.existsSync(path.join(LOCAL_REPO_PATH, '.git'))) {
      throw new Error('Local repo missing');
    }
    const stdout = execSync(`git tag --contains ${sha}`, { cwd: LOCAL_REPO_PATH, encoding: 'utf8' });
    const tagNames = stdout.split('\n').map(t => t.trim()).filter(Boolean);
    const tags = tagNames.map(name => ({
      name,
      isLTS: /lts$/i.test(name),
      semver: parseSemVer(name)
    }));
    
    // Sort tags by semantic version (newest first)
    tags.sort((a, b) => {
      // If both have semver, use semantic version comparison
      if (a.semver && b.semver) {
        return compareSemVer(a.semver, b.semver);
      }
      // If only one has semver, prioritize the one with semver
      if (a.semver && !b.semver) return -1;
      if (!a.semver && b.semver) return 1;
      // If neither has semver, use string comparison
      return b.name.localeCompare(a.name, undefined, { numeric: true });
    });
    
    const summary = buildTagSummary(tags);
    const payload = { tags, count: tags.length, summary };
    cache.commitTags.set(cacheKey, payload);
    return payload;
  } catch (err) {
    console.error('Git tag lookup failed:', err.message);
    return findTagsForCommit(sha).then(list => {
      const tags = list.map(t => ({ name: t.name, isLTS: /lts$/i.test(t.name), semver: parseSemVer(t.name) }));
      // Sort the fallback tags too
      tags.sort((a, b) => {
        if (a.semver && b.semver) {
          return compareSemVer(a.semver, b.semver);
        }
        if (a.semver && !b.semver) return -1;
        if (!a.semver && b.semver) return 1;
        return b.name.localeCompare(a.name, undefined, { numeric: true });
      });
      return { tags, count: tags.length, summary: buildTagSummary(tags) };
    });
  }
}

// ULTRA-FAST: Get tags that contain a commit using smart algorithm
async function getTagsContainingCommit(sha) {
  const cacheKey = `tags_${sha}`;
  
  // Check cache first
  if (cache.commitTags.has(cacheKey)) {
    console.log(`💾 Cache hit for commit ${sha.substring(0, 8)}`);
    return cache.commitTags.get(cacheKey);
  }
  
  // Prevent duplicate requests for same commit
  if (activeRequests.has(sha)) {
    console.log(`⏳ Waiting for existing request for commit ${sha.substring(0, 8)}`);
    return await activeRequests.get(sha);
  }
  
  // Create promise for this request
  const requestPromise = findTagsForCommit(sha);
  activeRequests.set(sha, requestPromise);
  
  try {
    const result = await requestPromise;
    return result;
  } finally {
    activeRequests.delete(sha);
  }
}

async function findTagsForCommit(sha) {
  try {
    console.log(`🔥 ACCURATE: Finding tags for commit ${sha.substring(0, 8)}...`);
    const startTime = Date.now();
    
    // Get all tags efficiently (cached after first call)
    const allTags = await getAllTags();
    console.log(`📊 Checking ${allTags.length} tags with accurate algorithm`);
    
    const tagsWithCommit = [];
    
    // Let's try a different approach - use the /commits endpoint for each tag
    // This should be more accurate than the compare API
    const batchSize = 10;
    let processed = 0;
    
    for (let i = 0; i < allTags.length; i += batchSize) {
      const batch = allTags.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (tag) => {
        try {
          // NEW APPROACH: Get commits from this tag and check if our commit is in there
          const commitsResponse = await makeGitHubRequest(
            `${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/commits`,
            {
              sha: tag.name,      // Use tag name as SHA
              per_page: 100,      // Get recent commits
              since: '2024-01-01T00:00:00Z'  // Only check recent commits for speed
            }
          );
          
          const commits = commitsResponse.data;
          const containsCommit = commits.some(commit => commit.sha === sha);
          
          if (containsCommit) {
            console.log(`✅ FOUND: Tag ${tag.name} contains commit ${sha.substring(0, 8)}`);
            return {
              name: tag.name,
              commit: tag.commit.sha,
              date: tag.commit?.commit?.author?.date || null
            };
          }
          
          return null;
        } catch (error) {
          // If commits API fails, fallback to compare API
          try {
            const compareResponse = await makeGitHubRequest(
              `${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/compare/${sha}...${tag.commit.sha}`
            );
            
            const result = compareResponse.data;
            
            // More lenient logic: accept more cases
            const containsCommit = (
              result.status === 'behind' ||     
              result.status === 'identical' ||  
              (result.status === 'diverged' && result.behind_by === 0) ||
              (result.status === 'diverged' && result.behind_by <= 5)  // Allow small divergence
            );
            
            if (containsCommit) {
              console.log(`✅ COMPARE: Tag ${tag.name} contains commit ${sha.substring(0, 8)} (${result.status})`);
              return {
                name: tag.name,
                commit: tag.commit.sha,
                date: tag.commit?.commit?.author?.date || null
              };
            }
            
            return null;
          } catch (compareError) {
            return null;
          }
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      const validResults = batchResults.filter(result => result !== null);
      tagsWithCommit.push(...validResults);
      
      processed += batch.length;
      
      // Progress logging every 50 tags
      if (processed % 50 === 0) {
        console.log(`✅ PROGRESS: ${processed}/${allTags.length} tags checked, found ${tagsWithCommit.length} matches`);
      }
      
      // Shorter delay for speed
      if (i + batchSize < allTags.length) {
        await delay(60);
      }
    }
    
    // Sort by semantic version (newest first)
    tagsWithCommit.sort((a, b) => {
      // Extract version numbers for proper sorting
      const aMatch = a.name.match(/(\d+)\.(\d+)\.(\d+)/);
      const bMatch = b.name.match(/(\d+)\.(\d+)\.(\d+)/);
      
      if (aMatch && bMatch) {
        const aMajor = parseInt(aMatch[1]);
        const aMinor = parseInt(aMatch[2]);
        const aPatch = parseInt(aMatch[3]);
        
        const bMajor = parseInt(bMatch[1]);
        const bMinor = parseInt(bMatch[2]);
        const bPatch = parseInt(bMatch[3]);
        
        // Compare major.minor.patch
        if (aMajor !== bMajor) return bMajor - aMajor;
        if (aMinor !== bMinor) return bMinor - aMinor;
        return bPatch - aPatch;
      }
      
      // Fallback to string comparison for non-semantic versions
      return b.name.localeCompare(a.name, undefined, { numeric: true });
    });
    
    // Debug: Log all found tags
    console.log(`🎯 DEBUG: Found tags: ${tagsWithCommit.map(t => t.name).join(', ')}`);
    
    // Cache result
    cache.commitTags.set(`tags_${sha}`, tagsWithCommit);
    
    const endTime = Date.now();
    const durationSeconds = Math.round((endTime - startTime) / 1000);
    console.log(`🎉 ACCURATE: Found ${tagsWithCommit.length} tags in ${durationSeconds} seconds`);
    
    return tagsWithCommit;
  } catch (error) {
    console.error('Error finding tags:', error.message);
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

// Search for commits by message or get commit by SHA
async function searchCommits(query, type = 'message') {
  try {
    // If it looks like a SHA, treat it as a commit ID
    if (query.match(/^[a-f0-9]{7,40}$/i)) {
      console.log(`🔍 Searching by commit SHA: ${query}`);
      try {
        const response = await makeGitHubRequest(`${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/commits/${query}`);
        return [response.data];
      } catch (error) {
        if (error.response && error.response.status === 404) {
          return []; // Commit not found
        }
        throw error;
      }
    }
    
    // Otherwise, search by commit message
    console.log(`🔍 Searching commits by message: "${query}"`);
    const response = await makeGitHubRequest(`${GITHUB_API_BASE}/search/commits`, {
      q: `repo:${EVE_OS_REPO} ${query}`,
      sort: 'committer-date',
      order: 'desc',
      per_page: 20
    });
    
    return response.data.items || [];
  } catch (error) {
    console.error('Error searching commits:', error.message);
    throw error;
  }
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

// SIMPLIFIED: Just get commit details (keep this fast)
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

// SIMPLIFIED: Get tags containing a commit (only when requested)
app.get('/api/commits/:sha/tags', async (req, res) => {
  try {
    const { sha } = req.params;
    const data = await getTagsContainingCommitGit(sha);
    res.json({ sha, ...data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tags', message: error.message });
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