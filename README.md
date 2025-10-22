# WhatTheFix

A powerful web application to search for fixes and commits in the EVE-OS repository, with advanced features for finding which versions contain specific commits.

![WhatTheFix](https://img.shields.io/badge/WhatTheFix-blue)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)

## Features

### Advanced Search Capabilities
- **Smart Search Detection**: Automatically detects commit IDs vs. message searches
- **Commit Message Search**: Find commits by keywords with pagination support
- **Commit ID Lookup**: Direct commit lookup using SHA hashes
- **Pagination**: Load thousands of results with "Load More" functionality
- **Real-time Search**: Auto-search as you type for message searches

### Version Analysis
- **Tag Analysis**: Find which EVE-OS versions contain any specific commit
- **LTS Detection**: Identify Long-Term Support versions automatically  
- **Version Summary**: See Latest and Latest LTS versions at a glance
- **LTS Filtering**: Toggle to show only LTS versions
- **Fast Git Integration**: Local repository for instant tag lookup (sub-second performance)

### Modern User Experience
- **Responsive Design**: Perfect on desktop, tablet, and mobile
- **Beautiful UI**: Gradient themes with smooth animations
- **Clickable Header**: Click the logo to reset and start fresh
- **Search Hints**: Helpful guidance when search is empty
- **Interactive Examples**: Click example buttons to try searches instantly
- **Modal Commit Details**: Rich popup with complete commit information

### Performance & Reliability
- **Smart Caching**: In-memory caching for faster repeat searches
- **Rate Limit Management**: Efficient GitHub API usage with token support
- **Error Recovery**: Graceful handling of network issues and API limits
- **Local Git Repo**: Clones EVE-OS locally for lightning-fast tag analysis

## What's Coming

Exciting features in development:

- **User Profile Creation**: Personalized accounts with custom settings and preferences
- **Search History**: Track and revisit your previous searches with saved results
- **GitHub Token Configuration**: Manage your GitHub authentication directly within your profile

## Screenshots
[Homescreen]<img width="2440" height="2706" alt="CleanShot 2025-10-22 at 16 56 16@2x" src="https://github.com/user-attachments/assets/0830e910-d835-490f-b412-fa8c92cb584c" />
[Search]<img width="2468" height="1532" alt="CleanShot 2025-10-22 at 16 40 09@2x" src="https://github.com/user-attachments/assets/bdc7fdc9-d547-4748-9b4e-298ec68d6b11" />
[Results]<img width="1864" height="3004" alt="CleanShot 2025-10-22 at 16 39 46@2x" src="https://github.com/user-attachments/assets/36552ed1-e33c-4fc6-928a-a6c2de87fc82" />


The application features a modern interface with:
- **Clean Search Interface**: Universal search box with smart detection
- **Pagination Support**: Browse through thousands of commits
- **Rich Commit Details**: Modal with full commit information and tag analysis
- **Version Summary Cards**: Latest, Latest LTS, and Total Tags counters
- **Professional Tag Display**: Clean badges with LTS highlighting

## Installation

### Prerequisites
- Node.js 18+ 
- Git (for local repository features)
- Internet connection (for GitHub API)

### Quick Start

1. **Clone the repository**
```bash
git clone <repository-url>
cd whatthefix
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables (recommended)**
Create a `.env` file in the root directory:
```bash
# GitHub Personal Access Token (highly recommended for 5000 requests/hour)
# Create at: https://github.com/settings/tokens
GITHUB_TOKEN=your_github_personal_access_token_here

# Port for the server (optional, defaults to 3000)
PORT=3000
```

4. **Start the application**
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

5. **Open your browser**
Navigate to `http://localhost:3000`

The first startup will clone the EVE-OS repository locally for fast tag analysis. The application automatically keeps this repository synchronized with the latest changes by performing background updates whenever the local cache expires (every 30 minutes) or when new tags are detected. This ensures you always have access to the most current version information while maintaining lightning-fast search performance. 

## Usage Guide

### Basic Searching
1. **Enter your search term** in the universal search box:
   - For commits: Enter keywords like "fix memory leak" or "security patch"
   - For specific commits: Enter SHA like `a1b2c3d4` or full hash
2. **Auto-Detection**: The app automatically detects if you're searching by commit ID or message
3. **Browse Results**: Scroll through results and use "Load More Results" for pagination
4. **View Details**: Click any commit to see detailed information

### Version Analysis
1. **Search for any commit** using the methods above
2. **Click on a commit** to open the detailed view
3. **Find Tags**: Click "Find Tags Containing This Commit" 
4. **View Results**: See all EVE-OS versions that include this fix
5. **Filter LTS**: Toggle "LTS only" to see just Long-Term Support versions
6. **Summary Cards**: Check Latest Version, Latest LTS, and Total Tags

### Keyboard Shortcuts
- `/` - Focus search input
- `Ctrl+K` / `Cmd+K` - Clear search and start over
- `Escape` - Close modal dialogs
- `Enter` - Execute search

### Quick Tips
- **Click the header** to reset everything and start fresh
- **Use example buttons** for quick demo searches
- **Scroll down** to automatically load more results
- **Check the version cards** to understand release status

## API Reference

### Search Commits with Pagination
```http
GET /api/search/commits?query=<term>&type=<type>&page=<page>&per_page=<count>
```

**Parameters:**
- `query` (required): Search term or commit SHA
- `type` (optional): "message" (default) or "sha"  
- `page` (optional): Page number (default: 1)
- `per_page` (optional): Results per page (default: 30, max: 100)

**Response:**
```json
{
  "query": "fix memory leak",
  "type": "message", 
  "page": 1,
  "per_page": 30,
  "count": 30,
  "total_count": 1449,
  "has_more": true,
  "commits": [
    {
      "sha": "a1b2c3d4e5f6...",
      "message": "Fix memory leak in device manager", 
      "author": "John Doe",
      "date": "2023-12-01T10:30:00Z",
      "url": "https://github.com/lf-edge/eve/commit/a1b2c3d4e5f6...",
      "repository": "lf-edge/eve"
    }
  ]
}
```

### Get Commit Details
```http
GET /api/commits/:sha
```

### Find Tags Containing Commit
```http
GET /api/commits/:sha/tags
```

**Response:**
```json
{
  "sha": "a1b2c3d4e5f6...",
  "count": 19,
  "summary": {
    "latestVersion": "11.0.5-lts",
    "latestLTS": "11.0.5-lts"
  },
  "tags": [
    {
      "name": "11.0.5-lts",
      "isLTS": true,
      "semver": {
        "major": 11,
        "minor": 0, 
        "patch": 5
      }
    }
  ]
}
```

### Cache Management
```http
GET /api/cache/status     # Check cache status
POST /api/cache/clear     # Clear all caches
```

## Architecture

### Backend (Node.js + Express)
- **server.js**: Main server with API endpoints and GitHub integration
- **Local Git Repo**: Cloned EVE-OS repository for fast tag analysis
- **Caching System**: In-memory caching for tags, commits, and relationships
- **Rate Limiting**: Smart GitHub API usage with token support

### Frontend (Modern Web Stack)
- **public/index.html**: Semantic HTML structure
- **public/styles.css**: Responsive CSS with modern design patterns
- **public/script.js**: Vanilla JavaScript with advanced DOM manipulation

### Key Technologies
- **Backend**: Node.js, Express.js, Axios, Git CLI
- **Frontend**: Vanilla JavaScript, CSS3 Grid/Flexbox, HTML5
- **External APIs**: GitHub REST API v3
- **Styling**: Custom CSS with gradients and animations
- **Icons**: Font Awesome 6
- **Fonts**: Inter (Google Fonts)

### Performance Features
- **Local Git Operations**: Sub-second tag analysis using `git tag --contains`
- **Smart Caching**: 30-minute TTL for tags, persistent commit details
- **Pagination**: Efficient loading of large result sets
- **Request Optimization**: Batched API calls and intelligent rate limiting

## Rate Limiting & Performance

### GitHub API Limits
- **Without Token**: 60 requests/hour
- **With Token**: 5,000 requests/hour
- **Recommendation**: Always use a GitHub Personal Access Token

### Local Repository
The app automatically clones the EVE-OS repository to `./eve-repo/` for:
- **Lightning-fast tag analysis** (vs. 80+ seconds with API)
- **100% accuracy** matching GitHub's native tag display
- **Reduced API usage** for better rate limit management

### Caching Strategy
- **Tag Cache**: 30 minutes TTL for repository tags
- **Commit Cache**: Persistent for session duration
- **Smart Updates**: Background repository updates when needed

## Development

### Project Structure
```
whatthefix/
├── server.js              # Main server application
├── package.json           # Dependencies and scripts
├── public/                # Frontend assets
│   ├── index.html         # Main HTML page
│   ├── styles.css         # All CSS styles
│   └── script.js          # Frontend JavaScript
├── eve-repo/              # Local EVE-OS repository (auto-created)
└── README.md              # This file
```

### Environment Setup
1. **GitHub Token**: Generate a new Classic Token at https://github.com/settings/tokens with `public_repo` scope
2. **Local Development**: Use `npm run dev` for auto-reload
3. **Production**: Use `npm start` for stable deployment
4. **Okta SSO**: See `README-OKTA.md` for OIDC setup, security, and diagrams. Copy `.env.example` to `.env` and configure Okta values.

### Debugging
- **Server Logs**: Check `server_output.log` 
- **Browser Console**: Monitor frontend operations and API calls
- **Cache Status**: Visit `/api/cache/status` for cache information

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Test your changes thoroughly
4. Commit with clear messages (`git commit -m 'Add version comparison feature'`)
5. Push to your branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request with detailed description

### Development Guidelines
- **Responsive Design**: Test on multiple screen sizes
- **Error Handling**: Add comprehensive error recovery
- **Performance**: Consider rate limits and caching implications
- **User Experience**: Maintain the clean, intuitive interface

## Troubleshooting

### Common Issues

**Blank page when loading more results**
- Fixed in latest version with improved pagination logic

**Slow tag analysis**  
- Ensure local git repository is available and up-to-date
- Check GitHub token configuration for API fallback

**Rate limit exceeded**
- Add `GITHUB_TOKEN` to `.env` file
- Consider caching duration adjustments

**Repository clone fails**
- Check internet connectivity and disk space
- Verify git is installed and accessible


## Acknowledgments

- **[EVE-OS Project](https://github.com/lf-edge/eve)** - The Linux Foundation Edge virtualization engine
- **[GitHub API](https://docs.github.com/en/rest)** - Comprehensive repository data access
- **[Font Awesome](https://fontawesome.com/)** - Beautiful icon library
- **[Google Fonts](https://fonts.google.com/)** - Inter font family

## Support

For issues, questions, or feature requests:

1. **Check existing [Issues](../../issues)**
2. **Create a new issue** with:
   - Detailed description
   - Steps to reproduce
   - Browser/system information
   - Screenshots if applicable

---

**Happy Bug Hunting!** Find those fixes and track them across EVE-OS versions with ease. 
