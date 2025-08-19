const fs = require('fs');
const axios = require('axios');
const moment = require('moment');

// Configuration
const CONFIG = {
  MAX_REPOS: 10,
  MAX_COMMITS: 5,
  TIMEZONE_OFFSET: 330, // IST
  API_DELAY: 150, // ms between requests to avoid rate limiting
  MAX_RETRIES: 3,
  CACHE_DURATION: 5 * 60 * 1000 // 5 minutes
};

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.GITHUB_USERNAME || 'wicked-eyes-on-you';

// Validate required environment variables
if (!GITHUB_TOKEN) {
  console.error('❌ GITHUB_TOKEN environment variable is required');
  process.exit(1);
}

const github = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json'
  },
  timeout: 10000 // 10 second timeout
});

// Utility functions
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const cache = new Map();

// Enhanced API call with retry mechanism
async function apiCallWithRetry(apiCall, retries = CONFIG.MAX_RETRIES, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await apiCall();
    } catch (error) {
      console.warn(`API call failed (attempt ${i + 1}/${retries}):`, error.message);

      if (i === retries - 1) {
        console.error('❌ Max retries reached, API call failed permanently');
        throw error;
      }

      console.log(`⏳ Retrying in ${delay}ms...`);
      await sleep(delay);
      delay *= 2; // Exponential backoff
    }
  }
}

// Check API rate limit
async function checkRateLimit() {
  try {
    const response = await github.get('/rate_limit');
    const { remaining, limit, reset } = response.data.rate;

    console.log(`📊 API Rate Limit: ${remaining}/${limit} remaining`);

    if (remaining < 10) {
      const resetTime = new Date(reset * 1000);
      console.warn(`⚠️ Low API rate limit. Resets at: ${resetTime}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('Could not check rate limit:', error.message);
    return true; // Assume it's okay if we can't check
  }
}

// Get recent commits with better error handling
async function getRecentCommits() {
  try {
    console.log('🔍 Fetching recent commits...');

    const response = await apiCallWithRetry(() =>
      github.get(`/users/${USERNAME}/events/public?per_page=50`)
    );

    console.log(`📦 Total events found: ${response.data.length}`);

    const recentPushEvents = response.data
      .filter(event => event.type === 'PushEvent')
      .filter(event => event.payload && event.payload.commits && event.payload.commits.length > 0)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, CONFIG.MAX_COMMITS)
      .map(event => {
        const time = moment(event.created_at)
          .utcOffset(CONFIG.TIMEZONE_OFFSET)
          .format('YYYY-MM-DD hh:mm:ss A');

        const repo = event.repo.name.split('/')[1];
        const latestCommit = event.payload.commits[event.payload.commits.length - 1];
        const commitMessage = latestCommit?.message || 'Updated files';
        const truncatedMessage = commitMessage.length > 50
          ? commitMessage.substring(0, 50) + '...'
          : commitMessage;

        return `[${time}] COMMIT: "${truncatedMessage}" → ${repo}`;
      });

    console.log(`✅ Recent push events found: ${recentPushEvents.length}`);

    if (recentPushEvents.length === 0) {
      console.log('⚠️ No recent commits found, using fallback data');
      return getFallbackCommits();
    }

    return recentPushEvents;
  } catch (error) {
    console.error('❌ Error fetching commits:', error.message);
    return getFallbackCommits();
  }
}

// Fallback commit data
function getFallbackCommits() {
  const now = moment().utcOffset(CONFIG.TIMEZONE_OFFSET);
  return [
    `[${now.format('YYYY-MM-DD hh:mm:ss A')}] COMMIT: "Add dynamic README automation" → profile`,
    `[${now.subtract(2, 'hours').format('YYYY-MM-DD hh:mm:ss A')}] COMMIT: "Fix terminal styling issues" → web-project`,
    `[${now.subtract(1, 'day').format('YYYY-MM-DD hh:mm:ss A')}] COMMIT: "Update dependencies" → portfolio`
  ];
}

// Get last commit time with better error handling
async function getLastCommitTime() {
  try {
    console.log('⏱️ Fetching last commit time...');

    const response = await apiCallWithRetry(() =>
      github.get(`/users/${USERNAME}/events/public?per_page=10`)
    );

    const lastPushEvent = response.data.find(event => event.type === 'PushEvent');

    if (lastPushEvent) {
      const lastCommitTime = moment(lastPushEvent.created_at).utcOffset(CONFIG.TIMEZONE_OFFSET);
      const now = moment().utcOffset(CONFIG.TIMEZONE_OFFSET);
      const diffMinutes = now.diff(lastCommitTime, 'minutes');

      if (diffMinutes < 1) return 'just now';
      if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
      if (diffMinutes < 1440) {
        const hours = Math.floor(diffMinutes / 60);
        return `${hours} hour${hours === 1 ? '' : 's'} ago`;
      }
      const days = Math.floor(diffMinutes / 1440);
      return `${days} day${days === 1 ? '' : 's'} ago`;
    }
    return '2 hours ago';
  } catch (error) {
    console.error('❌ Error fetching last commit time:', error.message);
    return '2 hours ago';
  }
}

// Get language statistics with rate limiting
async function getLanguageStats() {
  try {
    console.log('📊 Fetching language statistics...');

    const reposResponse = await apiCallWithRetry(() =>
      github.get(`/users/${USERNAME}/repos?sort=updated&per_page=${CONFIG.MAX_REPOS}`)
    );

    const repos = reposResponse.data
      .filter(repo => !repo.fork)
      .filter(repo => moment().diff(moment(repo.updated_at), 'days') < 180) // Only recent repos
      .slice(0, CONFIG.MAX_REPOS);

    console.log(`📁 Processing ${repos.length} repositories for language stats...`);

    const languageStats = {};
    let totalBytes = 0;
    let processedRepos = 0;

    for (const repo of repos) {
      try {
        await sleep(CONFIG.API_DELAY); // Rate limiting

        const langResponse = await apiCallWithRetry(() =>
          github.get(`/repos/${USERNAME}/${repo.name}/languages`)
        );

        const languages = langResponse.data;

        for (const [lang, bytes] of Object.entries(languages)) {
          languageStats[lang] = (languageStats[lang] || 0) + bytes;
          totalBytes += bytes;
        }

        processedRepos++;
        console.log(`  ✓ Processed ${repo.name} (${processedRepos}/${repos.length})`);
      } catch (err) {
        console.warn(`  ⚠️ Failed to get languages for ${repo.name}:`, err.message);
      }
    }

    if (totalBytes === 0) {
      console.log('⚠️ No language data found, using fallback');
      return getFallbackLanguageStats();
    }

    return formatLanguageStats(languageStats, totalBytes);
  } catch (error) {
    console.error('❌ Error fetching language stats:', error.message);
    return getFallbackLanguageStats();
  }
}

// Format language statistics into visual bars
function formatLanguageStats(languageStats, totalBytes) {
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

    const percentageStr = displayPercentage < 10
      ? ` ${displayPercentage.toFixed(1)}%    │`
      : ` ${displayPercentage.toFixed(1)}%   │`;

    const paddedLangName = lang.name.length > 11
      ? lang.name.substring(0, 11)
      : lang.name.padEnd(11);

    return `│ ${paddedLangName} │ ${barWithSpaces}│${percentageStr}`;
  }).join('\n');
}

// Fallback language statistics
function getFallbackLanguageStats() {
  return `│ JavaScript  │ ████████████████████     │ 45.2%   │
│ HTML        │ ████████████░░░░░░░░     │ 28.7%   │
│ CSS         │ ██████░░░░░░░░░░░░░░     │ 15.3%   │
│ Python      │ ███░░░░░░░░░░░░░░░░░     │ 10.8%   │`;
}

// Get commit hash with better error handling
async function getCommitHash() {
  try {
    console.log('🔑 Fetching latest commit hash...');

    const response = await apiCallWithRetry(() =>
      github.get(`/repos/${USERNAME}/${USERNAME}/commits?per_page=1`)
    );

    if (response.data.length > 0) {
      const shortHash = response.data[0].sha.substring(0, 7);
      const message = response.data[0].commit.message.split('\n')[0];
      const truncatedMessage = message.length > 30 ? message.substring(0, 30) + '...' : message;
      return `${shortHash} - ${truncatedMessage}`;
    }
    return 'latest';
  } catch (error) {
    console.error('❌ Error fetching commit hash:', error.message);
    return 'latest';
  }
}

// Get repository status with improved filtering
async function getRepoStatus() {
  try {
    console.log('📂 Fetching repository status...');

    const reposResponse = await apiCallWithRetry(() =>
      github.get(`/users/${USERNAME}/repos?sort=updated&per_page=8`)
    );

    const activeRepos = reposResponse.data
      .filter(repo =>
        !repo.fork &&
        moment().diff(moment(repo.updated_at), 'days') < 30 &&
        repo.name !== USERNAME
      )
      .slice(0, 4); // Reduced to avoid too many API calls

    if (activeRepos.length === 0) {
      return null;
    }

    const statusLines = [];

    for (const repo of activeRepos) {
      try {
        await sleep(CONFIG.API_DELAY); // Rate limiting

        const commitsResponse = await apiCallWithRetry(() =>
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
        console.warn(`  ⚠️ Failed to get commits for ${repo.name}:`, err.message);
      }
    }

    return statusLines.length > 0 ? statusLines.join('\n') : null;
  } catch (error) {
    console.error('❌ Error fetching repo status:', error.message);
    return null;
  }
}

// Main function to generate README
async function generateReadme() {
  const startTime = Date.now();
  console.log('🚀 Starting README generation...');
  console.log('━'.repeat(50));

  try {
    // Check rate limit before proceeding
    const rateLimitOk = await checkRateLimit();
    if (!rateLimitOk) {
      console.warn('⚠️ API rate limit too low, proceeding with caution...');
    }

    // Fetch all data concurrently where possible
    const [recentCommits, lastCommit, languageStats, repoStatus, commitHash] = await Promise.all([
      getRecentCommits(),
      getLastCommitTime(),
      getLanguageStats(),
      getRepoStatus(),
      getCommitHash()
    ]);

    const currentTime = moment().utcOffset(CONFIG.TIMEZONE_OFFSET).format('DD/MM/YYYY, hh:mm:ss a');

    const gitStatusSection = repoStatus ? `
## LIVE REPOSITORY STATUS

\`\`\`bash
$ git status --porcelain --all-repos
${repoStatus}
\`\`\`` : '';

    const readmeContent = `# wicked-eyes-on-you@github ~/profile LIVE

\`\`\`bash
$ echo 'initializing dynamic profile shell...'
> booting ── [OK]  bootloader: dynamic v2.0
> locale: en_US.UTF-8
> session: interactive (real-time)
> theme: terminal/cmd (enhanced with live data)
> github-api: connected
> fetching user data: complete
> initializing real-time updates: active
\`\`\`

| WHO AM I | LIVE STATUS |
|----------|-------------|
| \`> user:\` wicked-eyes-on-you | \`> last_updated:\` ${moment().utcOffset(CONFIG.TIMEZONE_OFFSET).format('DD/MM/YYYY, HH:mm:ss')} |
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
${languageStats}
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
export GITHUB_USER="wicked-eyes-on-you"
export LINKEDIN_URL="https://linkedin.com/in/wicked-eyes-on-you"  
export WEBSITE_URL="https://wicked-eyes-on-you.me"
export EMAIL="connect.wicked-eyes-on-you@gmail.com"

# Messaging & Community
export X_URL="https://x.com/wicked-eyes-on-you"
export TELEGRAM_URL="https://t.me/wicked-eyes-on-you"
export DISCORD_ID="wicked-eyes-on-you"

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

[![Profile Views](https://komarev.com/ghpvc/?username=wicked-eyes-on-you)](https://github.com/wicked-eyes-on-you)

</div>

##
<div align="center">
<sub>Last updated: ${moment().utcOffset(CONFIG.TIMEZONE_OFFSET).format('MMMM Do YYYY, h:mm:ss a')} IST | Commit: ${commitHash} | Auto-generated every 6 hours</sub>
</div>`;

    fs.writeFileSync('README.md', readmeContent);

    const executionTime = Date.now() - startTime;
    console.log('━'.repeat(50));
    console.log(`✅ README.md updated successfully in ${executionTime}ms!`);

  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error('━'.repeat(50));
    console.error(`❌ README generation failed after ${executionTime}ms:`, error.message);
    process.exit(1);
  }
}

// Run the script
generateReadme().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});