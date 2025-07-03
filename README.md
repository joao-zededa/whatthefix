# EVE-OS Fix Finder

A modern web application to search for fixes and commits in the EVE-OS repository based on commit ID or commit titles/messages.

![EVE-OS Fix Finder](https://img.shields.io/badge/EVE--OS-Fix%20Finder-blue)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Features

- 🔍 **Search by Commit Message**: Find commits by searching keywords in commit messages
- 🏷️ **Search by Commit ID**: Look up specific commits using their SHA hash
- 📱 **Responsive Design**: Works seamlessly on desktop and mobile devices
- 🎨 **Modern UI**: Clean, intuitive interface with smooth animations
- 📋 **Detailed View**: Click on any commit to see detailed information including file changes
- ⚡ **Real-time Search**: Auto-search as you type (for message searches)
- 🎯 **Quick Examples**: Pre-defined example searches to get started quickly

## Screenshots

The application features a modern, gradient-themed interface with:
- Clean search interface with radio button selection for search type
- Loading states and error handling
- Responsive grid layout for search results
- Modal popup for detailed commit information
- GitHub integration for viewing commits directly

## Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd whatthefix
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables (optional)**
Create a `.env` file in the root directory:
```bash
# Port for the server (optional, defaults to 3000)
PORT=3000

# GitHub Personal Access Token (optional, but recommended for higher rate limits)
# You can create one at: https://github.com/settings/tokens
GITHUB_TOKEN=your_github_personal_access_token_here
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

## Usage

### Search by Commit Message
1. Select "Search by Title/Message" (default)
2. Enter keywords related to the fix you're looking for (e.g., "memory leak", "security", "crash")
3. Press Enter or click Search
4. Browse through the results and click on any commit for detailed information

### Search by Commit ID
1. Select "Search by Commit ID"
2. Enter the full or partial commit SHA (e.g., `a1b2c3d4` or full hash)
3. Press Enter or click Search
4. View the specific commit details

### Quick Start Examples
Click on any of the example tags ("fix", "security", "memory leak", "crash") to perform a quick search.

### Keyboard Shortcuts
- `/` - Focus on search input
- `Ctrl+K` (or `Cmd+K` on Mac) - Clear search and focus input
- `Escape` - Close modal when viewing commit details
- `Enter` - Perform search when input is focused

## API Endpoints

The application provides a REST API that can be used independently:

### Search Commits
```
GET /api/search/commits?query=<search_term>&type=<message|sha>
```

**Parameters:**
- `query` (required): Search term or commit SHA
- `type` (optional): Search type, either "message" (default) or "sha"

**Response:**
```json
{
  "query": "fix memory leak",
  "type": "message",
  "count": 5,
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
```
GET /api/commits/:sha
```

**Response:**
```json
{
  "sha": "a1b2c3d4e5f6...",
  "message": "Fix memory leak in device manager\n\nDetailed description...",
  "author": "John Doe",
  "date": "2023-12-01T10:30:00Z",
  "url": "https://github.com/lf-edge/eve/commit/a1b2c3d4e5f6...",
  "repository": "lf-edge/eve",
  "files": [
    {
      "filename": "src/device.c",
      "status": "modified",
      "additions": 5,
      "deletions": 2,
      "patch": "@@ -10,7 +10,7 @@..."
    }
  ]
}
```

## Architecture

The application consists of:

### Backend (Node.js + Express)
- `server.js` - Main server file with API endpoints
- GitHub API integration for searching commits
- CORS enabled for cross-origin requests
- Error handling and response formatting

### Frontend (Vanilla JavaScript)
- `public/index.html` - Main HTML structure
- `public/styles.css` - Modern CSS with responsive design
- `public/script.js` - JavaScript for UI interactions and API calls

### Key Technologies
- **Backend**: Node.js, Express.js, Axios
- **Frontend**: Vanilla JavaScript, CSS3, HTML5
- **External APIs**: GitHub REST API
- **Fonts**: Inter (Google Fonts)
- **Icons**: Font Awesome

## Rate Limiting

The GitHub API has rate limits:
- **Without authentication**: 60 requests per hour
- **With GitHub token**: 5,000 requests per hour

To avoid rate limiting, set up a GitHub Personal Access Token in your `.env` file.

## Error Handling

The application includes comprehensive error handling:
- Network connection errors
- GitHub API rate limiting
- Invalid commit SHAs
- Empty search results
- Server errors

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [EVE-OS Project](https://github.com/lf-edge/eve) - The Linux Foundation Edge project
- [GitHub API](https://docs.github.com/en/rest) - For providing commit search capabilities
- [Font Awesome](https://fontawesome.com/) - For the beautiful icons
- [Google Fonts](https://fonts.google.com/) - For the Inter font family

## Support

If you encounter any issues or have questions:
1. Check the [Issues](../../issues) page
2. Create a new issue with detailed information
3. Include steps to reproduce any bugs

---

**Note**: This application searches the public EVE-OS repository on GitHub. Make sure you have internet connectivity to fetch commit information. 