const fs = require('fs');
const axios = require('axios');
const moment = require('moment');

// Environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.GITHUB_USERNAME || 'wicked-eyes-on-you';

// Configure axios with better error handling and timeouts
const github = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'X-GitHub-Api-Version': '2022-11-28'
  },
  timeout: 10000
});

// Cache for API responses to avoid redundant calls
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Utility function to make cached API calls
async function cachedApiCall(key, apiCall) {
  const cached = cache.get(key);
  const now = Date.now();
  
  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    return cached.data;
  }
  
  try {
    const data = await apiCall();
    cache.set(key, { data, timestamp: now });
    return data;
  } catch (error) {
    // Return cached data even if stale when API fails
    if (cached) {
      console.warn(`API call failed for ${key}, using stale cache`);
      return cached.data;
    }
    throw error;
  }
}

// Handle GitHub API rate limits
function handleRateLimit(response) {
  const remaining = parseInt(response.headers['x-ratelimit-remaining'] || '0');
  const resetTime = parseInt(response.headers['x-ratelimit-reset'] || '0') * 1000;
  
  if (remaining < 10) {
    console.warn(`Low GitHub API rate limit: ${remaining} remaining, reset at ${new Date(resetTime).toISOString()}`);
  }
  
  return response;
}

// Enhanced error handling for GitHub API
github.interceptors.response.use(
  response => handleRateLimit(response),
  error => {
    if (error.response) {
      const status = error.response.status;
      
      if (status === 403 && error.response.headers['x-ratelimit-remaining'] === '0') {
        console.error('GitHub API rate limit exceeded');
        throw new Error('RATE_LIMIT_EXCEEDED');
      } else if (status === 404) {
        console.error('GitHub API resource not found');
        throw new Error('RESOURCE_NOT_FOUND');
      } else if (status >= 500) {
        console.error('GitHub API server error');
        throw new Error('SERVER_ERROR');
      }
    } else if (error.code === 'ECONNABORTED') {
      console.error('GitHub API request timeout');
      throw new Error('REQUEST_TIMEOUT');
    }
    
    console.error('GitHub API error:', error.message);
    throw error;
  }
);

async function getRecentCommits() {
  try {
    const response = await cachedApiCall('user_events', () => 
      github.get(`/users/${USERNAME}/events?per_page=30`)
    );
    
    console.log('Total events found:', response.data.length);

    const pushEvents = response.data.filter(event => event.type === 'PushEvent');
    console.log('Push events found:', pushEvents.length);

    if (pushEvents.length === 0) {
      console.log('No recent commits found, using fallback data');
      const fallbackTime = moment().utcOffset(330).format('YYYY-MM-DD hh:mm:ss A');
      return [
        `[${fallbackTime}] COMMIT: "No recent activity detected" → profile`,
      ];
    }

    const recentPushEvents = pushEvents
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)
      .map(event => {
        const time = moment(event.created_at).utcOffset(330).format('YYYY-MM-DD hh:mm:ss A');
        const repo = event.repo.name.split('/')[1];

        const latestCommit = event.payload.commits[event.payload.commits.length - 1];
        const commitMessage = latestCommit?.message || 'Updated files';
        const truncatedMessage = commitMessage.length > 50 
          ? commitMessage.substring(0, 50) + '...' 
          : commitMessage;

        return `[${time}] COMMIT: "${truncatedMessage}" → ${repo}`;
      });

    return recentPushEvents;
  } catch (error) {
    console.error('Error fetching commits:', error.message);
    const fallbackTimes = [
      moment().utcOffset(330).subtract(2, 'hours'),
      moment().utcOffset(330).subtract(5, 'hours')
    ];
    
    return fallbackTimes.map(time => 
      `[${time.format('YYYY-MM-DD hh:mm:ss A')}] COMMIT: "Fallback commit message" → sample-repo`
    );
  }
}

async function getLastCommitTime() {
  try {
    const response = await cachedApiCall('user_events_short', () => 
      github.get(`/users/${USERNAME}/events?per_page=5`)
    );
    
    const pushEvents = response.data.filter(event => event.type === 'PushEvent');
    const lastPushEvent = pushEvents[0];

    if (lastPushEvent) {
      const lastCommitTime = moment(lastPushEvent.created_at).utcOffset(330);
      const now = moment().utcOffset(330);
      const diffMinutes = now.diff(lastCommitTime, 'minutes');

      if (diffMinutes < 1) {
        return 'just now';
      } else if (diffMinutes < 60) {
        return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
      } else if (diffMinutes < 1440) {
        const hours = Math.floor(diffMinutes / 60);
        return `${hours} hour${hours === 1 ? '' : 's'} ago`;
      } else {
        const days = Math.floor(diffMinutes / 1440);
        return `${days} day${days === 1 ? '' : 's'} ago`;
      }
    }
    return 'recently';
  } catch (error) {
    console.error('Error fetching last commit time:', error.message);
    return 'recently';
  }
}

async function getLanguageStats() {
  try {
    const reposResponse = await cachedApiCall('user_repos', () => 
      github.get(`/users/${USERNAME}/repos?per_page=50&sort=updated`)
    );
    
    const repos = reposResponse.data.filter(repo => !repo.fork && !repo.archived);
    console.log(`Processing ${repos.length} repositories for language stats`);

    const languageStats = {};
    let totalBytes = 0;

    // Process only the most recently updated repositories to save API calls
    const reposToProcess = repos.slice(0, 15);
    
    for (const repo of reposToProcess) {
      try {
        const langResponse = await cachedApiCall(`repo_langs_${repo.name}`, () => 
          github.get(`/repos/${USERNAME}/${repo.name}/languages`)
        );
        
        const languages = langResponse.data;

        for (const [lang, bytes] of Object.entries(languages)) {
          languageStats[lang] = (languageStats[lang] || 0) + bytes;
          totalBytes += bytes;
        }
        
        // Small delay to be respectful of API limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        console.warn(`Could not fetch languages for ${repo.name}: ${err.message}`);
      }
    }

    if (totalBytes === 0) {
      return [`│ No Data     │ ░░░░░░░░░░░░░░░░░░░░     │  0.0%   │`];
    }

    const sortedLangs = Object.entries(languageStats)
      .map(([lang, bytes]) => ({
        name: lang,
        percentage: ((bytes / totalBytes) * 100)
      }))
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 5);

    return sortedLangs.map(lang => {
      const displayPercentage = Math.min(lang.percentage, 99.9);
      const filled = Math.round(displayPercentage / 5);
      const empty = Math.max(0, 20 - filled);
      const bar = '█'.repeat(filled) + '░'.repeat(empty);
      const barWithSpaces = (bar + '     ').substring(0, 25);

      let percentageStr;
      if (displayPercentage < 10) {
        percentageStr = ` ${displayPercentage.toFixed(1)}%    │`;
      } else {
        percentageStr = ` ${displayPercentage.toFixed(1)}%   │`;
      }

      const paddedLangName = lang.name.length > 11 
        ? lang.name.substring(0, 11) 
        : lang.name.padEnd(11);

      return `│ ${paddedLangName} │ ${barWithSpaces}│${percentageStr}`;
    });

  } catch (error) {
    console.error('Error fetching language stats:', error.message);
    return [`│ API Error   │ ░░░░░░░░░░░░░░░░░░░░     │  0.0%   │`];
  }
}

async function getCommitHash() {
  try {
    const response = await cachedApiCall('profile_commit', () => 
      github.get(`/repos/${USERNAME}/${USERNAME}/commits?per_page=1`)
    );
    
    if (response.data.length > 0) {
      const shortHash = response.data[0].sha.substring(0, 7);
      const message = response.data[0].commit.message.split('\n')[0];
      const truncatedMessage = message.length > 40 
        ? message.substring(0, 40) + '...' 
        : message;
      return `${shortHash} - ${truncatedMessage}`;
    }
    return 'latest commit';
  } catch (error) {
    console.error('Error fetching commit hash:', error.message);
    return 'latest commit';
  }
}

async function getRepoStatus() {
  try {
    const reposResponse = await cachedApiCall('user_repos_updated', () => 
      github.get(`/users/${USERNAME}/repos?sort=updated&per_page=8`)
    );
    
    const activeRepos = reposResponse.data
      .filter(repo => 
        !repo.fork && 
        !repo.archived &&
        moment().diff(moment(repo.updated_at), 'days') < 60 &&
        repo.name !== USERNAME
      )
      .slice(0, 4);

    if (activeRepos.length === 0) {
      return null;
    }

    const statusLines = [];
    
    for (const repo of activeRepos) {
      try {
        const commitsResponse = await cachedApiCall(`repo_commits_${repo.name}`, () => 
          github.get(`/repos/${USERNAME}/${repo.name}/commits?per_page=2`)
        );
        
        const commits = commitsResponse.data;

        if (commits.length > 0) {
          statusLines.push(`## ${repo.name}...origin/main`);
          
          commits.forEach(commit => {
            const message = commit.commit.message.split('\n')[0];
            const truncated = message.length > 40 ? message.substring(0, 40) + '...' : message;
            const fileStatus = Math.random() > 0.5 ? 'M' : 'A';
            statusLines.push(` ${fileStatus} ${truncated}`);
          });
          
          statusLines.push('');
        }
      } catch (err) {
        console.warn(`Could not fetch commits for ${repo.name}: ${err.message}`);
      }
    }

    return statusLines.length > 0 ? statusLines.join('\n') : null;
  } catch (error) {
    console.error('Error fetching repo status:', error.message);
    return null;
  }
}

async function getProfileViews() {
  try {
    // This would require a separate service as GitHub doesn't provide this via API
    // For now, return a placeholder or use a cached value
    return "1,000+";
  } catch (error) {
    return "1,000+";
  }
}

async function generateReadme() {
  console.log('Starting README generation...');
  console.log(`Username: ${USERNAME}`);

  try {
    const [recentCommits, lastCommit, languageStats, repoStatus, commitHash, profileViews] = await Promise.all([
      getRecentCommits(),
      getLastCommitTime(),
      getLanguageStats(),
      getRepoStatus(),
      getCommitHash(),
      getProfileViews()
    ]);

    const currentTime = moment().utcOffset(330).format('DD/MM/YYYY, hh:mm:ss a');
    const formattedLanguageStats = Array.isArray(languageStats) ? languageStats.join('\n') : languageStats;

    const gitStatusSection = repoStatus ? `
## LIVE REPOSITORY STATUS

\`\`\`bash
$ git status --porcelain --all-repos
${repoStatus}
\`\`\`` : '';

    const readmeContent = `# ${USERNAME}@github ~/profile LIVE

\`\`\`bash
$ echo 'initializing dynamic profile shell...'
> booting ── [OK]  bootloader: dynamic v2.1
> locale: en_US.UTF-8
> session: interactive (real-time)
> theme: terminal/cmd (enhanced with live data)
> github-api: connected
> fetching user data: complete
> initializing real-time updates: active
\`\`\`

| WHO AM I | LIVE STATUS |
|----------|-------------|
| \`> user:\` ${USERNAME} | \`> last_updated:\` ${moment().utcOffset(330).format('DD/MM/YYYY, HH:mm:ss')} |
| \`> role:\` IT student · builder · open source contributor | \`> timezone:\` IST (GMT+5:30) |
| \`> focus:\` AI, Blockchain, Web Development, Cloud Native | \`> last_commit:\` ${lastCommit} |
| \`> mood:\` compiling chaos into clean output | \`> response_time:\` ~2-4 hours |
| \`> current_commit:\` ${commitHash} | \`> status:\` online |

${gitStatusSection}

## REAL-TIME ACTIVITY MONITOR

\`\`\`bash
$ tail -f ~/.git_activity.log
${recentCommits.join('\n')}
\`\`\`

## PERFORMANCE METRICS

\`\`\`bash
$ analyze-code-metrics --languages --graph
┌─────────────┬──────────────────────────┬─────────┐
│ Language    │ Usage Graph (Real Data)  │ Percent │
├─────────────┼──────────────────────────┼─────────┤
${formattedLanguageStats}
└─────────────┴──────────────────────────┴─────────┘

$ system-info --stack
┌─ TECH STACK ──────────────────────────────────────────┐
│ Frontend   : React.js, Tailwind CSS, HTML5, CSS3, JS  │
│ Programming: C, Java                                  │
│ Database   : MongoDB                                  │
│ Versioning : Git, GitHub                              │
│ Tools      : VS Code, Postman, Figma                  │
└───────────────────────────────────────────────────────┘
\`\`\`

## NETWORK CONFIGURATION

\`\`\`bash
$ cat ~/.bashrc | grep -A 20 "# SOCIAL CONNECTIONS"
# SOCIAL CONNECTIONS
export GITHUB_USER="${USERNAME}"
export LINKEDIN_URL="https://linkedin.com/in/${USERNAME}"  
export WEBSITE_URL="https://${USERNAME}.me"
export EMAIL="connect.${USERNAME}@gmail.com"

# Messaging & Community
export X_URL="https://x.com/${USERNAME}"
export TELEGRAM_URL="https://t.me/${USERNAME}"
export DISCORD_ID="${USERNAME}"

# CONNECTION STATUS
export COLLABORATION_STATUS="OPEN"
export MENTORING_AVAILABLE="TRUE"
export RESPONSE_TIME="2-4_HOURS_IST"
export PREFERRED_CONTACT="github_issues_or_email"

$ netstat -an | grep LISTEN
tcp4  0  0  github.com.443         ESTABLISHED
tcp4  0  0  linkedin.com.443       ESTABLISHED
tcp4  0  0  gmail.com.443          ESTABLISHED
tcp4  0  0  localhost.3000         LISTENING
\`\`\`

## COLLABORATION HUB

\`\`\`bash
$ echo "Initiating connection protocols..."
> scanning for interesting projects       [████████████████████] 100%
> evaluating collaboration opportunities  [████████████████████] 100%
> setting up mentorship channels          [████████████████████] 100%
> status: READY FOR CONNECTIONS

$ cat << EOF
┌─────────────────┬───────────────────────────────────────────────┐
│ Field           │ Details                                       │
├─────────────────┼───────────────────────────────────────────────┤
│ Quote           │ Code is poetry — every commit tells a story.  │
│ Collaboration   │ Open for innovative projects                  │
│ Mentoring       │ Available for fellow developers               │
│ Response Time   │ ~2-4 hours                                    │
│ Contact Method  │ GitHub issues or email                        │
└─────────────────┴───────────────────────────────────────────────┘
EOF

$ exit
> session terminated gracefully
> last_commit: ${commitHash}
> status: ready for next connection
> goodbye!
\`\`\`

<div align="center" style="font-family: Consolas, 'Courier New', monospace;">

\`\`\`bash
$ echo "Thanks for visiting! Don't forget to ⭐ star interesting repos!"
\`\`\`

[![Profile Views](https://komarev.com/ghpvc/?username=${USERNAME}&label=Profile+Views&color=blueviolet)](https://github.com/${USERNAME})

</div>

##
<div align="center">
<sub>Last updated: ${moment().utcOffset(330).format('MMMM Do YYYY, h:mm:ss a')} IST | Commit: ${commitHash} | Auto-generated every 6 hours</sub>
</div>`;

    fs.writeFileSync('README.md', readmeContent);
    console.log('README.md updated successfully!');
    
  } catch (error) {
    console.error('Failed to generate README:', error);
    
    // Create a basic fallback README if generation completely fails
    const fallbackContent = `# ${USERNAME}

> Dynamic profile README - Generation failed at ${new Date().toISOString()}

Please check the GitHub Actions logs for details.

<!-- Default fallback content -->`;
    
    fs.writeFileSync('README.md', fallbackContent);
    console.log('Fallback README created due to generation error');
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

generateReadme().catch(console.error);