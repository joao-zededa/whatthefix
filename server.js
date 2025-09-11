const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
require('dotenv').config();
const fs = require('fs');
const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
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

// Cache for stable branches
const backportCache = {
  stableBranches: null,
  stableBranchesTimestamp: null,
  backportedCommits: new Map(),
  branchCommits: new Map()
};

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

// Allow custom Accept header for preview APIs
function getGitHubHeadersWithAccept(acceptHeader) {
  const headers = getGitHubHeaders();
  if (acceptHeader) headers['Accept'] = acceptHeader;
  return headers;
}

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

// Helper to make GitHub API requests with extra headers
async function makeGitHubRequestCustom(url, params = {}, extraHeaders = {}) {
  try {
    await delay(RATE_LIMIT_DELAY);
    const response = await axios.get(url, {
      params,
      headers: { ...getGitHubHeaders(), ...extraHeaders },
      timeout: 15000
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

// Get all stable branches with caching
async function getStableBranches() {
  const now = Date.now();
  
  // Return cached stable branches if still valid
  if (backportCache.stableBranches && backportCache.stableBranchesTimestamp && 
      (now - backportCache.stableBranchesTimestamp) < CACHE_TTL) {
    return backportCache.stableBranches;
  }
  
  try {
    console.log('🔄 Fetching stable branches...');
    const allBranches = [];
    let page = 1;
    const perPage = 100;
    
    while (true) {
      const response = await makeGitHubRequest(`${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/branches`, {
        per_page: perPage,
        page: page
      });
      
      const branches = response.data;
      if (branches.length === 0) break;
      
      allBranches.push(...branches);
      
      if (branches.length < perPage || page >= 3) break; // Max 3 pages = 300 branches
      page++;
    }
    
    // Filter for stable branches (branches that end with -stable or -lts)
    const stableBranches = allBranches.filter(branch => {
      const name = branch.name.toLowerCase();
      return name.includes('-stable') || name.includes('-lts') || name.includes('lts');
    });
    
    // Sort branches by version (newest first)
    stableBranches.sort((a, b) => {
      const aVersion = parseSemVer(a.name);
      const bVersion = parseSemVer(b.name);
      
      if (aVersion && bVersion) {
        return compareSemVer(aVersion, bVersion);
      }
      
      // Fallback to name comparison
      return b.name.localeCompare(a.name, undefined, { numeric: true });
    });
    
    // Cache the results
    backportCache.stableBranches = stableBranches;
    backportCache.stableBranchesTimestamp = now;
    
    console.log(`✅ Found ${stableBranches.length} stable branches: ${stableBranches.slice(0, 5).map(b => b.name).join(', ')}${stableBranches.length > 5 ? '...' : ''}`);
    return stableBranches;
  } catch (error) {
    console.error('Error fetching stable branches:', error.message);
    throw error;
  }
}

// Find backported commits for a given original commit
async function findBackportedCommits(originalCommitSha, originalCommitMessage) {
  const cacheKey = `backport_${originalCommitSha}`;
  
  // Check cache first
  if (backportCache.backportedCommits.has(cacheKey)) {
    console.log(`💾 Cache hit for backported commits of ${originalCommitSha.substring(0, 8)}`);
    return backportCache.backportedCommits.get(cacheKey);
  }
  
  try {
    console.log(`🔍 Looking for backported commits of ${originalCommitSha.substring(0, 8)}...`);

    // FAST PATH A: PR commit titles matched on stable branches (local git)
    if (fs.existsSync(path.join(LOCAL_REPO_PATH, '.git'))) {
      try {
        const prTitleResults = await findBackportsViaPRTitles(originalCommitSha);
        if (prTitleResults.length > 0) {
          const unique = removeDuplicateBackports(prTitleResults);
          unique.sort((a, b) => new Date(b.date) - new Date(a.date));
          backportCache.backportedCommits.set(cacheKey, unique);
          console.log(`⚡ PR-title scan found ${unique.length} backports for ${originalCommitSha.substring(0, 8)}`);
          return unique;
        }
      } catch (ptErr) {
        console.warn('⚠️ PR-title fast scan failed:', ptErr.message);
      }
    }

    // FAST PATH B: Use local git to search backports across stable branches
    if (fs.existsSync(path.join(LOCAL_REPO_PATH, '.git'))) {
      try {
        const fastResults = await findBackportedCommitsLocal(originalCommitSha, originalCommitMessage);
        // Cache the results
        backportCache.backportedCommits.set(cacheKey, fastResults);
        console.log(`⚡ Fast local scan found ${fastResults.length} backports for ${originalCommitSha.substring(0, 8)}`);
        return fastResults;
      } catch (localError) {
        console.warn('⚠️ Fast local backport scan failed, falling back to API search:', localError.message);
      }
    }

    // PR-BASED STRATEGY: Use PR associations and stable branch merged PRs
    try {
      const prStrategyResults = await findBackportsViaPRs(originalCommitSha);
      if (prStrategyResults.length > 0) {
        const unique = removeDuplicateBackports(prStrategyResults);
        unique.sort((a, b) => new Date(b.date) - new Date(a.date));
        backportCache.backportedCommits.set(cacheKey, unique);
        console.log(`🧭 PR strategy found ${unique.length} backports for ${originalCommitSha.substring(0, 8)}`);
        return unique;
      }
    } catch (prError) {
      console.warn('⚠️ PR-based backport strategy failed:', prError.message);
    }

    // SLOWER FALLBACK: Existing API-based approach
    const stableBranches = await getStableBranches();
    const backportedCommits = [];
    const originalPR = await findPRForCommit(originalCommitSha);

    for (const branch of stableBranches) {
      try {
        console.log(`🔍 Searching in branch ${branch.name}...`);

        const explicitBackports = await findExplicitBackports(originalCommitSha, originalPR, branch.name);
        backportedCommits.push(...explicitBackports);

        const cherryPickBackports = await findCherryPickBackports(originalCommitSha, branch.name);
        backportedCommits.push(...cherryPickBackports);

        const similarCommits = await findSimilarCommits(originalCommitMessage, originalCommitSha, branch.name);
        backportedCommits.push(...similarCommits);

        await delay(300);
      } catch (error) {
        console.warn(`⚠️ Failed to search branch ${branch.name}:`, error.message);
        continue;
      }
    }

    const uniqueBackports = removeDuplicateBackports(backportedCommits);
    uniqueBackports.sort((a, b) => new Date(b.date) - new Date(a.date));
    backportCache.backportedCommits.set(cacheKey, uniqueBackports);
    console.log(`🎉 Found ${uniqueBackports.length} backported commits for ${originalCommitSha.substring(0, 8)}`);
    return uniqueBackports;
  } catch (error) {
    console.error('Error finding backported commits:', error.message);
    throw error;
  }
}

// SUPER-FAST: Local git backport discovery across stable branches
async function findBackportedCommitsLocal(originalCommitSha, originalCommitMessage) {
  const shortSha = originalCommitSha.substring(0, 8);
  // Ensure remotes are fresh
  try {
    execSync('git fetch --all --tags --quiet', { cwd: LOCAL_REPO_PATH });
  } catch (_) {}
  const branches = await getLocalStableBranches();

  if (branches.length === 0) {
    return [];
  }

  const maxPerBranch = 4000; // safety cap
  const grepArgs = [
    `--grep=cherry picked from commit ${originalCommitSha}`,
    `--grep=cherry picked from commit ${shortSha}`,
    `--grep=${originalCommitSha}`,
    `--grep=${shortSha}`
  ];

  // Run branch scans with limited concurrency
  const concurrency = Math.min(6, Math.max(2, os.cpus()?.length || 4));
  const tasks = branches.map(branchName => async () => {
    const ref = `origin/${branchName}`;
    const cmd = `git log ${ref} --no-merges -i --date=iso --pretty=format:%H%x01%an%x01%ad%x01%s -n ${maxPerBranch} ${grepArgs.map(a => `--grep="${a.replace(/"/g, '\\"')}"`).join(' ')}`;
    try {
      const { stdout } = await execAsync(cmd, { cwd: LOCAL_REPO_PATH, maxBuffer: 1024 * 1024 * 64 });
      if (!stdout) return [];
      return stdout.split('\n').filter(Boolean).map(line => {
        const [sha, author, date, subject] = line.split('\u0001');
        const lower = subject ? subject.toLowerCase() : '';
        let confidence = 0.8;
        let method = 'explicit_reference';
        if (lower.includes(`cherry picked from commit ${originalCommitSha.toLowerCase()}`) ||
            lower.includes(`cherry picked from commit ${shortSha.toLowerCase()}`)) {
          confidence = 0.95;
          method = 'cherry_pick_reference';
        } else if (lower.includes(shortSha.toLowerCase()) || lower.includes(originalCommitSha.toLowerCase())) {
          confidence = 0.85;
          method = 'explicit_reference';
        }
        return { sha, branch: branchName, message: subject || '', author: author || '', date, url: `https://github.com/${EVE_OS_REPO}/commit/${sha}`, tags: [], confidence, method };
      });
    } catch (_) {
      return [];
    }
  });

  const results = await runWithConcurrency(tasks, concurrency);
  const allCandidates = results.flat();

  // Deduplicate by SHA
  const deduped = removeDuplicateBackports(allCandidates);

  // Enrich with tags (fast local git)
  const tagTasks = deduped.map(async candidate => {
    try {
      const stdout = execSync(`git tag --contains ${candidate.sha}`, { cwd: LOCAL_REPO_PATH, encoding: 'utf8', timeout: 10000 });
      const tagNames = stdout.split('\n').map(t => t.trim()).filter(Boolean);
      candidate.tags = tagNames.map(name => ({ name, isLTS: /lts$/i.test(name), semver: parseSemVer(name) }));
    } catch (_) {
      candidate.tags = [];
    }
    return candidate;
  });

  const enriched = await Promise.all(tagTasks);
  enriched.sort((a, b) => new Date(b.date) - new Date(a.date));
  return enriched;
}

// --- PR-based backport discovery (fast, precise) ---
async function findBackportsViaPRs(originalCommitSha) {
  const backports = [];

  // 1) Find PRs associated with the original commit
  const associatedPRs = await getAssociatedPRNumbersForCommit(originalCommitSha);
  const originalPRNumbers = new Set(associatedPRs);

  // If we didn't find any PR, still allow cherry-pick based matches
  const stableBranches = await getStableBranches();
  const limitedBranches = stableBranches.slice(0, 10); // cap for speed

  // 2) For each stable branch, list merged PRs and inspect
  for (const branch of limitedBranches) {
    try {
      const prs = await listMergedPRsForBranch(branch.name, 1); // one page for speed
      for (const pr of prs) {
        const prNumber = pr.number;
        // Inspect PR body for backport references
        const prBodyNumbers = extractBackportPRNumbersRegex(pr.body || '');
        const intersects = [...prBodyNumbers].some(n => originalPRNumbers.has(n));

        // Fetch commits in this PR
        const prCommitsResp = await makeGitHubRequest(`${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/pulls/${prNumber}/commits`, { per_page: 100 });
        const prCommits = prCommitsResp.data || [];

        // Inspect commits for cherry-pick reference
        const hasCherryPick = prCommits.some(c => {
          const msg = c.commit?.message || '';
          const picked = extractCherryPickHashRegex(msg);
          if (!picked) return false;
          const shortSha = originalCommitSha.substring(0, 8).toLowerCase();
          return picked.toLowerCase().startsWith(shortSha) || shortSha.startsWith(picked.toLowerCase());
        });

        if (intersects || hasCherryPick) {
          // Treat this PR as a backport container; add its commits as candidates
          for (const prCommit of prCommits) {
            if (!prCommit.sha || prCommit.sha === originalCommitSha) continue;
            let tags = [];
            try {
              // Prefer local git for speed
              if (fs.existsSync(path.join(LOCAL_REPO_PATH, '.git'))) {
                const stdout = execSync(`git tag --contains ${prCommit.sha}`, { cwd: LOCAL_REPO_PATH, encoding: 'utf8', timeout: 8000 });
                const tagNames = stdout.split('\n').map(t => t.trim()).filter(Boolean);
                tags = tagNames.map(name => ({ name, isLTS: /lts$/i.test(name), semver: parseSemVer(name) }));
              } else {
                tags = await getTagsForBackportedCommit(prCommit.sha, branch.name);
              }
            } catch (_) { /* ignore */ }

            backports.push({
              sha: prCommit.sha,
              branch: branch.name,
              message: prCommit.commit?.message || '',
              author: prCommit.commit?.author?.name || pr.user?.login || 'unknown',
              date: prCommit.commit?.author?.date || pr.merged_at || pr.updated_at || new Date().toISOString(),
              url: prCommit.html_url || `https://github.com/${EVE_OS_REPO}/commit/${prCommit.sha}`,
              tags,
              confidence: intersects && hasCherryPick ? 0.95 : intersects ? 0.9 : 0.9,
              method: intersects && hasCherryPick ? 'pr_body_and_cherry_pick' : intersects ? 'pr_body_reference' : 'cherry_pick_reference'
            });
          }
        }
      }
    } catch (e) {
      console.warn(`⚠️ PR scan failed for ${branch.name}:`, e.message);
      continue;
    }
  }

  return backports;
}

function extractBackportPRNumbersRegex(body) {
  const text = (body || '').toLowerCase();
  const regex = /(back\s*port(ing)?|port|original)s?[^#]{0,30}((#\d{3,6}\b)|(https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d{3,6}))/gi;
  const numbers = new Set();
  let match;
  while ((match = regex.exec(text)) !== null) {
    const fragment = match[0];
    const refs = fragment.match(/(?:#|pull\/)\d{3,6}/g) || [];
    for (const ref of refs) {
      const num = parseInt(ref.replace(/[^0-9]/g, ''), 10);
      if (!isNaN(num)) numbers.add(num);
    }
  }
  return numbers;
}

function extractCherryPickHashRegex(msg) {
  const m = (msg || '').match(/cherry[ -]?picked from commit ([0-9a-fA-F]{7,40})/i);
  return m ? m[1] : null;
}

async function getAssociatedPRNumbersForCommit(sha) {
  try {
    const resp = await makeGitHubRequestCustom(
      `${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/commits/${sha}/pulls`,
      {},
      { 'Accept': 'application/vnd.github.groot-preview+json' }
    );
    const arr = resp.data || [];
    return arr.map(p => p.number).filter(Boolean);
  } catch (_) {
    return [];
  }
}

async function listMergedPRsForBranch(branchName, pages = 1) {
  const all = [];
  for (let page = 1; page <= pages; page++) {
    const search = await makeGitHubRequest(`${GITHUB_API_BASE}/search/issues`, {
      q: `repo:${EVE_OS_REPO} is:pr is:merged base:${branchName}`,
      sort: 'updated',
      order: 'desc',
      per_page: 50,
      page
    });
    const items = search.data.items || [];
    // Normalize: fetch minimal PR info for author if needed
    all.push(...items.map(i => ({ number: i.number, title: i.title, body: i.body || '', user: i.user || {}, merged_at: i.closed_at || null, updated_at: i.updated_at || null })));
    if (items.length < 50) break;
  }
  return all;
}

// --- PR commit title matching using local git (high precision) ---
async function findBackportsViaPRTitles(originalCommitSha) {
  if (!fs.existsSync(path.join(LOCAL_REPO_PATH, '.git'))) {
    throw new Error('Local git repo not available');
  }

  // Get associated PRs
  const prNumbers = await getAssociatedPRNumbersForCommit(originalCommitSha);
  if (!prNumbers || prNumbers.length === 0) {
    return [];
  }

  // Collect unique commit titles from those PRs
  const titlesSet = new Set();
  for (const prNum of prNumbers) {
    try {
      const resp = await makeGitHubRequest(`${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/pulls/${prNum}/commits`, { per_page: 100 });
      const commits = resp.data || [];
      for (const c of commits) {
        const firstLine = (c.commit?.message || '').split('\n')[0].trim();
        if (!firstLine) continue;
        const cleaned = firstLine.replace(/^(fix|feat|chore|docs):\s*/i, '').trim();
        // Skip merge commits
        if (/^merge\s/i.test(cleaned)) continue;
        titlesSet.add(cleaned);
      }
    } catch (e) {
      console.warn(`⚠️ Failed to fetch commits for PR #${prNum}:`, e.message);
    }
  }

  const titles = [...titlesSet].slice(0, 30); // safety cap
  if (titles.length === 0) return [];

  // Ensure remotes are fresh
  try { execSync('git fetch --all --tags --quiet', { cwd: LOCAL_REPO_PATH }); } catch (_) {}

  const branches = await getLocalStableBranches();
  if (branches.length === 0) return [];

  // Build grep arguments for exact match (fixed strings)
  const grepArgs = titles.map(t => `--grep=\"${t.replace(/\"/g, '\\"')}\"`).join(' ');
  const maxPerBranch = 8000;
  const concurrency = Math.min(6, Math.max(2, os.cpus()?.length || 4));

  const tasks = branches.map(branchName => async () => {
    const ref = `origin/${branchName}`;
    // Use -F for fixed strings and -i for case-insensitive; OR across multiple --grep
    const cmd = `git log ${ref} --no-merges -F -i --date=iso --pretty=format:%H%x01%an%x01%ad%x01%s -n ${maxPerBranch} ${grepArgs}`;
    try {
      const { stdout } = await execAsync(cmd, { cwd: LOCAL_REPO_PATH, maxBuffer: 1024 * 1024 * 64 });
      if (!stdout) return [];
      const lines = stdout.split('\n').filter(Boolean);
      const matches = [];
      for (const line of lines) {
        const [sha, author, date, subject] = line.split('\u0001');
        const subjectClean = (subject || '').split('\n')[0].trim().replace(/^(fix|feat|chore|docs):\s*/i, '').trim();
        // Confirm exact title match ignoring trivial prefixes
        const isExact = titlesSet.has(subjectClean);
        if (!isExact) continue;
        matches.push({ sha, branch: branchName, message: subject || '', author: author || '', date, url: `https://github.com/${EVE_OS_REPO}/commit/${sha}`, tags: [], confidence: 0.92, method: 'pr_title_match' });
      }
      return matches;
    } catch (_) {
      return [];
    }
  });

  const results = await runWithConcurrency(tasks, concurrency);
  const all = results.flat();

  // Enrich with tags via local git
  await Promise.all(all.map(async item => {
    try {
      const stdout = execSync(`git tag --contains ${item.sha}`, { cwd: LOCAL_REPO_PATH, encoding: 'utf8', timeout: 8000 });
      const tagNames = stdout.split('\n').map(t => t.trim()).filter(Boolean);
      item.tags = tagNames.map(name => ({ name, isLTS: /lts$/i.test(name), semver: parseSemVer(name) }));
    } catch (_) {
      item.tags = [];
    }
  }));

  return all;
}

// Helper: get stable branches using local git (no API)
async function getLocalStableBranches() {
  try {
    const { stdout } = await execAsync("git for-each-ref --format='%(refname:short)' refs/remotes/origin", { cwd: LOCAL_REPO_PATH });
    const remoteBranches = stdout.split('\n').map(l => l.trim()).filter(Boolean);
    const names = remoteBranches
      .map(ref => ref.startsWith('origin/') ? ref.substring('origin/'.length) : ref)
      .filter(name => name && (name.toLowerCase().includes('-stable') || name.toLowerCase().includes('lts')));
    // Prefer semver-like branches first
    names.sort((a, b) => {
      const av = parseSemVer(a) || { major: -1, minor: -1, patch: -1 };
      const bv = parseSemVer(b) || { major: -1, minor: -1, patch: -1 };
      return compareSemVer(av, bv);
    });
    return names;
  } catch (err) {
    console.warn('⚠️ Failed to list local branches, aborting local fast path');
    throw err;
  }
}

// Helper: run async tasks with limited concurrency
async function runWithConcurrency(taskFactories, limit) {
  const results = new Array(taskFactories.length);
  let index = 0;
  let active = 0;
  return await new Promise(resolve => {
    const next = () => {
      if (index >= taskFactories.length && active === 0) {
        return resolve(results);
      }
      while (active < limit && index < taskFactories.length) {
        const current = index++;
        active++;
        taskFactories[current]().then(res => {
          results[current] = res;
        }).catch(() => {
          results[current] = [];
        }).finally(() => {
          active--;
          next();
        });
      }
    };
    next();
  });
}

// Find PR associated with a commit
async function findPRForCommit(commitSha) {
  try {
    // Search for PRs that mention this commit
    const searchResponse = await makeGitHubRequest(`${GITHUB_API_BASE}/search/issues`, {
      q: `repo:${EVE_OS_REPO} type:pr ${commitSha}`,
      sort: 'created',
      order: 'desc',
      per_page: 5
    });
    
    const prs = searchResponse.data.items || [];
    
    // Find the most likely PR (usually the one with the commit in its merge commit)
    for (const pr of prs) {
      if (pr.pull_request && pr.state === 'closed') {
        // Get PR details to check if this commit is in the merge
        const prResponse = await makeGitHubRequest(`${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/pulls/${pr.number}`);
        const prData = prResponse.data;
        
        if (prData.merged && prData.merge_commit_sha) {
          // Check if our commit is related to this PR
          return {
            number: pr.number,
            title: pr.title,
            body: pr.body,
            merge_commit_sha: prData.merge_commit_sha
          };
        }
      }
    }
    
    return null;
  } catch (error) {
    console.warn('Failed to find PR for commit:', error.message);
    return null;
  }
}

// Method 1: Find explicit backport references
async function findExplicitBackports(originalCommitSha, originalPR, branchName) {
  const backports = [];
  
  try {
    // NEW: search PRs targeting this branch that reference original PR
    if (originalPR) {
      const prSearchResponse = await makeGitHubRequest(`${GITHUB_API_BASE}/search/issues`, {
        q: `repo:${EVE_OS_REPO} is:pr base:${branchName} "${originalPR.number}"`,
        sort: 'updated',
        order: 'desc',
        per_page: 10
      });
      const prItems = prSearchResponse.data.items || [];
      for (const pr of prItems) {
        // fetch PR commits
        const prCommitsResp = await makeGitHubRequest(`${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/pulls/${pr.number}/commits`, { per_page: 10 });
        const prCommits = prCommitsResp.data;
        for (const prCommit of prCommits) {
          if (prCommit.sha === originalCommitSha) continue;
          // add each commit as backport candidate
          const tags = await getTagsForBackportedCommit(prCommit.sha, branchName);
          backports.push({
            sha: prCommit.sha,
            branch: branchName,
            message: prCommit.commit.message,
            author: prCommit.commit.author.name,
            date: prCommit.commit.author.date,
            url: prCommit.html_url,
            tags: tags,
            confidence: 0.9,
            method: 'pr_base_reference'
          });
        }
      }
    }
    
    // Search for commits that explicitly mention the original commit or PR
    const searchTerms = [
      originalCommitSha.substring(0, 8), // Short SHA
      originalCommitSha, // Full SHA
    ];
    
    if (originalPR) {
      searchTerms.push(`#${originalPR.number}`);
      searchTerms.push(`pull/${originalPR.number}`); // NEW: full pull URL reference
      searchTerms.push(`${originalPR.number}`); // NEW: bare number reference
      searchTerms.push(`backport.*${originalPR.number}`);
      searchTerms.push(`cherry.*pick.*${originalCommitSha.substring(0, 8)}`);
    }
    
    for (const term of searchTerms) {
      const searchResponse = await makeGitHubRequest(`${GITHUB_API_BASE}/search/commits`, {
        q: `repo:${EVE_OS_REPO} "${term}" branch:${branchName}`,
        sort: 'committer-date',
        order: 'desc',
        per_page: 10
      });
      
      const commits = searchResponse.data.items || [];
      
      for (const commit of commits) {
        if (commit.sha === originalCommitSha) continue;
        
        // Check if this looks like a backport
        const isBackport = isLikelyBackport(commit, originalCommitSha, originalPR);
        
        if (isBackport.isBackport) {
          const tags = await getTagsForBackportedCommit(commit.sha, branchName);
          
          backports.push({
            sha: commit.sha,
            branch: branchName,
            message: commit.commit.message,
            author: commit.commit.author.name,
            date: commit.commit.author.date,
            url: commit.html_url,
            tags: tags,
            confidence: isBackport.confidence,
            method: 'explicit_reference'
          });
        }
      }
      
      await delay(100); // Small delay between searches
    }
  } catch (error) {
    console.warn(`Failed to find explicit backports in ${branchName}:`, error.message);
  }
  
  return backports;
}

// Method 2: Find cherry-pick references
async function findCherryPickBackports(originalCommitSha, branchName) {
  const backports = [];
  
  try {
    const searchResponse = await makeGitHubRequest(`${GITHUB_API_BASE}/search/commits`, {
      q: `repo:${EVE_OS_REPO} "cherry picked from commit" branch:${branchName}`,
      sort: 'committer-date',
      order: 'desc',
      per_page: 20
    });
    
    const commits = searchResponse.data.items || [];
    
    for (const commit of commits) {
      const message = commit.commit.message;
      
      // Look for cherry-pick patterns
      const cherryPickMatch = message.match(/cherry picked from commit ([a-f0-9]{7,40})/i);
      if (cherryPickMatch) {
        const referencedSha = cherryPickMatch[1];
        
        // Check if this references our original commit (full or partial match)
        if (originalCommitSha.startsWith(referencedSha) || referencedSha.startsWith(originalCommitSha.substring(0, 8))) {
          const tags = await getTagsForBackportedCommit(commit.sha, branchName);
          
          backports.push({
            sha: commit.sha,
            branch: branchName,
            message: commit.commit.message,
            author: commit.commit.author.name,
            date: commit.commit.author.date,
            url: commit.html_url,
            tags: tags,
            confidence: 0.95,
            method: 'cherry_pick_reference'
          });
        }
      }
    }
  } catch (error) {
    console.warn(`Failed to find cherry-pick backports in ${branchName}:`, error.message);
  }
  
  return backports;
}

// Method 3: Find similar commits (fallback)
async function findSimilarCommits(originalMessage, originalCommitSha, branchName) {
  const backports = [];
  
  try {
    const firstLine = originalMessage.split('\n')[0].trim();
    
    // Remove common prefixes that might differ in backports
    const cleanedFirstLine = firstLine.replace(/^(fix|feat|chore|docs):\s*/i, '').trim();
    
    const searchResponse = await makeGitHubRequest(`${GITHUB_API_BASE}/search/commits`, {
      q: `repo:${EVE_OS_REPO} "${cleanedFirstLine}" branch:${branchName}`,
      sort: 'committer-date',
      order: 'desc',
      per_page: 10
    });
    
    const commits = searchResponse.data.items || [];
    
    for (const commit of commits) {
      if (commit.sha === originalCommitSha) continue;
      
      const commitFirstLine = commit.commit.message.split('\n')[0].trim();
      const similarity = calculateStringSimilarity(firstLine, commitFirstLine);
      
      // Higher threshold for similarity-based matching since it's less reliable
      if (similarity > 0.85) {
        const tags = await getTagsForBackportedCommit(commit.sha, branchName);
        
        backports.push({
          sha: commit.sha,
          branch: branchName,
          message: commit.commit.message,
          author: commit.commit.author.name,
          date: commit.commit.author.date,
          url: commit.html_url,
          tags: tags,
          confidence: similarity,
          method: 'similarity_match'
        });
      }
    }
  } catch (error) {
    console.warn(`Failed to find similar commits in ${branchName}:`, error.message);
  }
  
  return backports;
}

// Check if a commit is likely a backport
function isLikelyBackport(commit, originalCommitSha, originalPR) {
  const message = commit.commit.message.toLowerCase();
  const shortSha = originalCommitSha.substring(0, 8).toLowerCase();
  
  // High confidence patterns
  if (message.includes(`cherry picked from commit ${shortSha}`) ||
      message.includes(`cherry picked from commit ${originalCommitSha}`) ||
      message.includes(`(cherry picked from commit ${shortSha})`) ||
      message.includes(`(cherry picked from commit ${originalCommitSha})`)) {
    return { isBackport: true, confidence: 0.95 };
  }
  
  if (originalPR) {
    if (message.includes(`backport of #${originalPR.number}`) ||
        message.includes(`backport #${originalPR.number}`) ||
        message.includes(`original: #${originalPR.number}`) ||
        message.includes(`cherry-pick of #${originalPR.number}`)) {
      return { isBackport: true, confidence: 0.90 };
    }
  }
  
  // Medium confidence patterns
  if (message.includes('backport') && message.includes(shortSha)) {
    return { isBackport: true, confidence: 0.80 };
  }
  
  if (message.includes('cherry-pick') && message.includes(shortSha)) {
    return { isBackport: true, confidence: 0.80 };
  }
  
  return { isBackport: false, confidence: 0 };
}

// Remove duplicate backports
function removeDuplicateBackports(backports) {
  const seen = new Set();
  return backports.filter(backport => {
    if (seen.has(backport.sha)) {
      return false;
    }
    seen.add(backport.sha);
    return true;
  });
}

// Get tags for a backported commit in a specific branch
async function getTagsForBackportedCommit(commitSha, branchName) {
  try {
    // Use local git repo if available for faster lookup
    if (fs.existsSync(path.join(LOCAL_REPO_PATH, '.git'))) {
      try {
        const stdout = execSync(`git tag --contains ${commitSha} --merged ${branchName}`, { 
          cwd: LOCAL_REPO_PATH, 
          encoding: 'utf8',
          timeout: 10000 
        });
        const tagNames = stdout.split('\n').map(t => t.trim()).filter(Boolean);
        return tagNames.map(name => ({
          name,
          isLTS: /lts$/i.test(name),
          semver: parseSemVer(name)
        }));
      } catch (gitError) {
        console.warn(`⚠️ Git command failed for ${commitSha}, falling back to API`);
      }
    }
    
    // Fallback to API-based tag lookup
    const allTags = await getAllTags();
    const tagsWithCommit = [];
    
    // Check a subset of tags to avoid too many API calls
    const recentTags = allTags.slice(0, 50); // Check most recent 50 tags
    
    for (const tag of recentTags) {
      try {
        const compareResponse = await makeGitHubRequest(
          `${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/compare/${commitSha}...${tag.commit.sha}`
        );
        
        const result = compareResponse.data;
        const containsCommit = (
          result.status === 'behind' ||
          result.status === 'identical' ||
          (result.status === 'diverged' && result.behind_by === 0)
        );
        
        if (containsCommit) {
          tagsWithCommit.push({
            name: tag.name,
            isLTS: /lts$/i.test(tag.name),
            semver: parseSemVer(tag.name)
          });
        }
      } catch (error) {
        // Skip this tag if comparison fails
        continue;
      }
    }
    
    return tagsWithCommit;
    
  } catch (error) {
    console.error('Error getting tags for backported commit:', error.message);
    return [];
  }
}

// Calculate string similarity using simple algorithm
function calculateStringSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) {
    return 1.0;
  }
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

// Levenshtein distance algorithm
function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
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
async function searchCommits(query, type = 'message', page = 1, perPage = 30) {
  try {
    // If query is a GitHub URL, resolve it to commits first (PR or commit URL)
    const ghUrlMatch = (query || '').match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/(pull\/(\d+)|commit\/([0-9a-fA-F]{7,40}))/i);
    if (ghUrlMatch) {
      const owner = ghUrlMatch[1];
      const repo = ghUrlMatch[2];
      const prNum = ghUrlMatch[4] ? parseInt(ghUrlMatch[4], 10) : null;
      const commitShaFromUrl = ghUrlMatch[5] || null;
      const repoFull = `${owner}/${repo}`;

      if (prNum) {
        // Fetch commits from the PR and return them as results
        const commitsResp = await makeGitHubRequest(`${GITHUB_API_BASE}/repos/${repoFull}/pulls/${prNum}/commits`, { per_page: 100 });
        const prCommits = commitsResp.data || [];
        const formatted = prCommits.map(c => ({
          sha: c.sha,
          message: c.commit?.message || '',
          author: c.commit?.author?.name || c.author?.login || 'unknown',
          date: c.commit?.author?.date || null,
          url: c.html_url || `https://github.com/${repoFull}/commit/${c.sha}`,
          repository: repoFull
        }));
        return {
          items: formatted,
          total_count: formatted.length,
          incomplete_results: false,
          has_more: false
        };
      }

      if (commitShaFromUrl) {
        // Fetch a single commit
        const response = await makeGitHubRequest(`${GITHUB_API_BASE}/repos/${repoFull}/commits/${commitShaFromUrl}`);
        return {
          items: [response.data],
          total_count: 1,
          incomplete_results: false,
          has_more: false
        };
      }
    }

    // If it looks like a SHA, treat it as a commit ID
    if (query.match(/^[a-f0-9]{7,40}$/i)) {
      console.log(`🔍 Searching by commit SHA: ${query}`);
      try {
        const response = await makeGitHubRequest(`${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/commits/${query}`);
        return { 
          items: [response.data], 
          total_count: 1, 
          incomplete_results: false,
          has_more: false
        };
      } catch (error) {
        if (error.response && error.response.status === 404) {
          return { items: [], total_count: 0, incomplete_results: false, has_more: false };
        }
        throw error;
      }
    }
    
    // Otherwise, search by commit message
    console.log(`🔍 Searching commits by message: "${query}" (page ${page})`);
    const response = await makeGitHubRequest(`${GITHUB_API_BASE}/search/commits`, {
      q: `repo:${EVE_OS_REPO} ${query}`,
      sort: 'committer-date',
      order: 'desc',
      per_page: perPage,
      page: page
    });
    
    const data = response.data;
    return {
      items: data.items || [],
      total_count: data.total_count || 0,
      incomplete_results: data.incomplete_results || false,
      has_more: (page * perPage) < (data.total_count || 0)
    };
  } catch (error) {
    console.error('Error searching commits:', error.message);
    throw error;
  }
}

// Search for tags by name or pattern
async function searchTags(query, page = 1, perPage = 30) {
  try {
    console.log(`🔍 Searching tags by name: "${query}" (page ${page})`);
    
    // Get all tags (cached)
    const allTags = await getAllTags();
    
    // Filter tags based on query
    const queryLower = query.toLowerCase();
    const filteredTags = allTags.filter(tag => {
      const tagNameLower = tag.name.toLowerCase();
      
      // Support different search patterns
      if (query.includes('*')) {
        // Simple wildcard support
        const pattern = query.replace(/\*/g, '.*');
        const regex = new RegExp(pattern, 'i');
        return regex.test(tag.name);
      } else {
        // Simple substring match
        return tagNameLower.includes(queryLower);
      }
    });
    
    // Sort tags by semantic version (newest first) and then by name
    filteredTags.sort((a, b) => {
      const aVersion = parseSemVer(a.name);
      const bVersion = parseSemVer(b.name);
      
      if (aVersion && bVersion) {
        return compareSemVer(aVersion, bVersion);
      }
      
      // If one has semver and other doesn't, prioritize semver
      if (aVersion && !bVersion) return -1;
      if (!aVersion && bVersion) return 1;
      
      // Fallback to string comparison for non-semantic versions
      return b.name.localeCompare(a.name, undefined, { numeric: true });
    });
    
    // Implement pagination
    const startIndex = (page - 1) * perPage;
    const endIndex = startIndex + perPage;
    const paginatedTags = filteredTags.slice(startIndex, endIndex);
    
    // Format tags for response
    const formattedTags = paginatedTags.map(tag => ({
      name: tag.name,
      sha: tag.commit.sha,
      date: tag.commit?.commit?.author?.date || null,
      url: tag.zipball_url,
      isLTS: /lts$/i.test(tag.name),
      semver: parseSemVer(tag.name)
    }));
    
    return {
      tags: formattedTags,
      total_count: filteredTags.length,
      has_more: endIndex < filteredTags.length
    };
  } catch (error) {
    console.error('Error searching tags:', error.message);
    throw error;
  }
}

// API Routes
app.get('/api/search/commits', async (req, res) => {
  try {
    const { query, type = 'message', page = 1, per_page = 30 } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const pageNum = parseInt(page) || 1;
    const perPageNum = Math.min(parseInt(per_page) || 30, 100); // Max 100 per page
    
    const searchResult = await searchCommits(query, type, pageNum, perPageNum);
    
    // Format the response
    const formattedCommits = searchResult.items.map(commit => ({
      sha: commit.sha,
      message: commit.commit?.message || commit.message || '',
      author: commit.commit?.author?.name || commit.author || commit.author_name || 'unknown',
      date: commit.commit?.author?.date || commit.date || null,
      url: commit.html_url || commit.url || (commit.sha ? `https://github.com/${EVE_OS_REPO}/commit/${commit.sha}` : undefined),
      repository: commit.repository || EVE_OS_REPO
    }));

    res.json({
      query,
      type,
      page: pageNum,
      per_page: perPageNum,
      count: formattedCommits.length,
      total_count: searchResult.total_count,
      has_more: searchResult.has_more,
      incomplete_results: searchResult.incomplete_results,
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

// API endpoint for searching tags
app.get('/api/search/tags', async (req, res) => {
  try {
    const { query, page = 1, per_page = 30 } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const pageNum = parseInt(page) || 1;
    const perPageNum = Math.min(parseInt(per_page) || 30, 100); // Max 100 per page
    
    const searchResult = await searchTags(query, pageNum, perPageNum);
    
    res.json({
      query,
      page: pageNum,
      per_page: perPageNum,
      count: searchResult.tags.length,
      total_count: searchResult.total_count,
      has_more: searchResult.has_more,
      tags: searchResult.tags
    });
  } catch (error) {
    console.error('Tag search error:', error.message);
    res.status(500).json({ 
      error: 'Failed to search tags',
      message: error.message 
    });
  }
});

// API endpoint to get all tags with optional filtering
app.get('/api/tags', async (req, res) => {
  try {
    const { lts_only = false, limit = 50 } = req.query;
    
    let allTags = await getAllTags();
    
    // Filter for LTS tags if requested
    if (lts_only === 'true') {
      allTags = allTags.filter(tag => /lts$/i.test(tag.name));
    }
    
    // Sort by semantic version (newest first)
    allTags.sort((a, b) => {
      const aVersion = parseSemVer(a.name);
      const bVersion = parseSemVer(b.name);
      
      if (aVersion && bVersion) {
        return compareSemVer(aVersion, bVersion);
      }
      
      if (aVersion && !bVersion) return -1;
      if (!aVersion && bVersion) return 1;
      
      return b.name.localeCompare(a.name, undefined, { numeric: true });
    });
    
    // Limit results
    const limitNum = parseInt(limit) || 50;
    const limitedTags = allTags.slice(0, limitNum);
    
    // Format tags for response
    const formattedTags = limitedTags.map(tag => ({
      name: tag.name,
      sha: tag.commit.sha,
      date: tag.commit?.commit?.author?.date || null,
      url: tag.zipball_url,
      isLTS: /lts$/i.test(tag.name),
      semver: parseSemVer(tag.name)
    }));
    
    res.json({
      count: formattedTags.length,
      total_available: allTags.length,
      tags: formattedTags
    });
  } catch (error) {
    console.error('Tags fetch error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch tags',
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

// NEW: Find backported commits for a given commit
app.get('/api/commits/:sha/backports', async (req, res) => {
  try {
    const { sha } = req.params;
    
    // Get commit details first
    const commitDetails = await getCommitDetails(sha);
    
    // Find backported commits
    const backportedCommits = await findBackportedCommits(sha, commitDetails.message);
    
    res.json({
      originalCommit: {
        sha: sha,
        message: commitDetails.message,
        author: commitDetails.author,
        date: commitDetails.date,
        url: commitDetails.url
      },
      backportedCommits: backportedCommits,
      summary: {
        totalBackports: backportedCommits.length,
        branchesWithBackports: [...new Set(backportedCommits.map(b => b.branch))].length,
        totalTagsAcrossBackports: backportedCommits.reduce((sum, b) => sum + b.tags.length, 0)
      }
    });
  } catch (error) {
    console.error('Backport analysis error:', error.message);
    res.status(500).json({ 
      error: 'Failed to analyze backports',
      message: error.message 
    });
  }
});

// NEW: Get stable branches
app.get('/api/branches/stable', async (req, res) => {
  try {
    const stableBranches = await getStableBranches();
    
    res.json({
      count: stableBranches.length,
      branches: stableBranches.map(branch => ({
        name: branch.name,
        sha: branch.commit.sha,
        protected: branch.protected,
        isLTS: /lts$/i.test(branch.name),
        semver: parseSemVer(branch.name)
      }))
    });
  } catch (error) {
    console.error('Stable branches error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch stable branches',
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