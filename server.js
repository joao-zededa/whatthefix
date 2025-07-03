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

// Helper function to search commits
async function searchCommits(query, searchType = 'message') {
  try {
    let searchQuery = '';
    
    if (searchType === 'sha') {
      // Search by commit SHA
      const response = await axios.get(`${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/commits/${query}`);
      return [response.data];
    } else {
      // Search by commit message
      searchQuery = `repo:${EVE_OS_REPO} ${query}`;
      const response = await axios.get(`${GITHUB_API_BASE}/search/commits`, {
        params: {
          q: searchQuery,
          sort: 'committer-date',
          order: 'desc',
          per_page: 50
        },
        headers: {
          'Accept': 'application/vnd.github.cloak-preview+json'
        }
      });
      return response.data.items;
    }
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

// Get commit details by SHA
app.get('/api/commits/:sha', async (req, res) => {
  try {
    const { sha } = req.params;
    const response = await axios.get(`${GITHUB_API_BASE}/repos/${EVE_OS_REPO}/commits/${sha}`);
    
    const commit = response.data;
    const formattedCommit = {
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: commit.commit.author.date,
      url: commit.html_url,
      repository: EVE_OS_REPO,
      files: commit.files ? commit.files.map(file => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch
      })) : []
    };

    res.json(formattedCommit);
  } catch (error) {
    console.error('Commit fetch error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch commit details',
      message: error.message 
    });
  }
});

// Serve the main application
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`EVE-OS Fix Finder server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to use the application`);
}); 