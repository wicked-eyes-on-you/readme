const fs = require('fs');
const axios = require('axios');
const moment = require('moment');

// Environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.GITHUB_USERNAME || 'wicked-eyes-on-you';

console.log('Starting README generation for user:', USERNAME);
console.log('Current time:', new Date().toISOString());

// Configure axios with better error handling
const github = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json'
  },
  timeout: 10000
});

// Simple cache implementation
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function cachedApiCall(key, apiCall) {
  const cached = cache.get(key);
  const now = Date.now();
  
  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    console.log(`Using cached data for: ${key}`);
    return cached.data;
  }
  
  try {
    console.log(`Making API call for: ${key}`);
    const data = await apiCall();
    cache.set(key, { data, timestamp: now });
    return data;
  } catch (error) {
    if (cached) {
      console.warn(`API call failed for ${key}, using stale cache`);
      return cached.data;
    }
    console.error(`API call failed for ${key} with no cache available`);
    throw error;
  }
}

// Error handling interceptor
github.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 403) {
      console.error('GitHub API rate limit exceeded');
    } else if (error.response?.status === 404) {
      console.error('GitHub API resource not found');
    } else {
      console.error('GitHub API error:', error.message);
    }
    throw error;
  }
);

async function getRecentCommits() {
  try {
    console.log('Fetching recent commits...');
    const response = await cachedApiCall('user_events', () => 
      github.get(`/users/${USERNAME}/events?per_page=20`)
    );
    
    const pushEvents = response.data.filter(event => event.type === 'PushEvent');
    console.log(`Found ${pushEvents.length} push events`);

    if (pushEvents.length === 0) {
      console.log('No recent commits found, using fallback data');
      const fallbackTime = moment().utcOffset(330).format('YYYY-MM-DD hh:mm:ss A');
      return [`[${fallbackTime}] COMMIT: "No recent activity detected" → profile`];
    }

    const recentCommits = pushEvents
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
    
    console.log('Processed recent commits:', recentCommits.length);
    return recentCommits;
    
  } catch (error) {
    console.error('Error fetching commits:', error.message);
    const fallbackTimes = [
      moment().utcOffset(330).subtract(2, 'hours'),
      moment().utcOffset(330).subtract(5, 'hours'),
      moment().utcOffset(330).subtract(1, 'day')
    ];
    
    return fallbackTimes.map(time => 
      `[${time.format('YYYY-MM-DD hh:mm:ss A')}] COMMIT: "Working on improvements" → profile`
    );
  }
}

async function getLastCommitTime() {
  try {
    console.log('Fetching last commit time...');
    const response = await cachedApiCall('user_events_short', () => 
      github.get(`/users/${USERNAME}/events?per_page=5`)
    );
    
    const pushEvents = response.data.filter(event => event.type === 'PushEvent');
    const lastPushEvent = pushEvents[0];

    if (lastPushEvent) {
      const lastCommitTime = moment(lastPushEvent.created_at).utcOffset(330);
      const now = moment().utcOffset(330);
      const diffMinutes = now.diff(lastCommitTime, 'minutes');

      if (diffMinutes < 1) return 'just now';
      if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
      if (diffMinutes < 1440) {
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
    console.log('Fetching language statistics...');
    const reposResponse = await cachedApiCall('user_repos', () => 
      github.get(`/users/${USERNAME}/repos?per_page=20&sort=updated`)
    );
    
    const repos = reposResponse.data.filter(repo => !repo.fork && !repo.archived);
    console.log(`Processing ${repos.length} repositories for language stats`);

    const languageStats = {};
    let totalBytes = 0;

    // Process only recent repositories
    for (const repo of repos.slice(0, 8)) {
      try {
        const langResponse = await cachedApiCall(`repo_langs_${repo.name}`, () => 
          github.get(`/repos/${USERNAME}/${repo.name}/languages`)
        );
        
        for (const [lang, bytes] of Object.entries(langResponse.data)) {
          languageStats[lang] = (languageStats[lang] || 0) + bytes;
          totalBytes += bytes;
        }
      } catch (err) {
        console.warn(`Could not fetch languages for ${repo.name}`);
      }
    }

    if (totalBytes === 0) {
      console.log('No language data found, using fallback');
      return [`│ JavaScript  │ ████████████████████     │ 75.0%   │`];
    }

    const stats = Object.entries(languageStats)
      .map(([lang, bytes]) => ({
        name: lang,
        percentage: ((bytes / totalBytes) * 100)
      }))
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 5)
      .map(lang => {
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
      });
    
    console.log('Language stats processed');
    return stats;

  } catch (error) {
    console.error('Error fetching language stats:', error.message);
    return [
      `│ JavaScript  │ ████████████████████     │ 75.0%   │`,
      `│ HTML        │ █████████░               │ 45.0%   │`,
      `│ CSS         │ ████████░░               │ 40.0%   │`,
      `│ Python      │ █████░░░░░               │ 25.0%   │`,
      `│ Java        │ ████░░░░░░               │ 20.0%   │`
    ];
  }
}

async function getCommitHash() {
  try {
    console.log('Fetching commit hash...');
    // Try to get commit from this repository
    const response = await github.get(`/repos/${USERNAME}/${USERNAME}/commits?per_page=1`);
    
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
    console.log('Using fallback commit message');
    return 'latest commit';
  }
}

async function generateReadme() {
  console.log('Starting README generation...');

  try {
    const [recentCommits, lastCommit, languageStats, commitHash] = await Promise.all([
      getRecentCommits(),
      getLastCommitTime(),
      getLanguageStats(),
      getCommitHash()
    ]);

    console.log('All data fetched successfully');
    
    const formattedLanguageStats = languageStats.join('\n');
    const currentTime = moment().utcOffset(330).format('MMMM Do YYYY, h:mm:ss a');

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
│ Programming: C, Java, Python                          │
│ Database   : MongoDB, PostgreSQL                      │
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
\`\`\`

<div align="center" style="font-family: Consolas, 'Courier New', monospace;">

\`\`\`bash
$ echo "Thanks for visiting! Don't forget to ⭐ star interesting repos!"
\`\`\`

[![Profile Views](https://komarev.com/ghpvc/?username=${USERNAME}&label=Profile+Views&color=blueviolet)](https://github.com/${USERNAME})

</div>

##
<div align="center">
<sub>Last updated: ${currentTime} IST | Commit: ${commitHash} | Auto-generated every 6 hours</sub>
</div>`;

    fs.writeFileSync('README.md', readmeContent);
    console.log('README.md updated successfully!');
    
    // Return true to indicate changes were made
    return true;
    
  } catch (error) {
    console.error('Failed to generate README:', error);
    
    // Create a basic fallback README
    const fallbackContent = `# ${USERNAME}

> Dynamic profile README - Generation failed at ${new Date().toISOString()}

Please check the GitHub Actions logs for details.

<!-- Default fallback content -->`;
    
    fs.writeFileSync('README.md', fallbackContent);
    console.log('Fallback README created due to generation error');
    
    // Return true to indicate changes were made (even if it's a fallback)
    return true;
  }
}

// Run the generation
generateReadme()
  .then(changesMade => {
    console.log(`README generation completed. Changes made: ${changesMade}`);
    process.exit(0);
  })
  .catch(error => {
    console.error('Unhandled error in README generation:', error);
    process.exit(1);
  });