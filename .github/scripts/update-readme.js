const fs = require('fs');
const axios = require('axios');
const moment = require('moment');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.GITHUB_USERNAME || 'wicked-eyes-on-you';

const github = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json'
  }
});

async function getRecentCommits() {
  try {
    const response = await github.get(`/users/${USERNAME}/events/public?per_page=100`);
    console.log('Total events found:', response.data.length);

    const recentPushEvents = response.data
      .filter(event => event.type === 'PushEvent')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)
      .map(event => {
        const time = moment(event.created_at).utcOffset(330).format('YYYY-MM-DD hh:mm:ss A');
        const repo = event.repo.name.split('/')[1];

        console.log('Processing commit:', event.created_at, '→', time, '→', repo);

        const latestCommit = event.payload.commits[event.payload.commits.length - 1];
        const commitMessage = latestCommit?.message || 'Updated files';
        const truncatedMessage = commitMessage.length > 50 
          ? commitMessage.substring(0, 50) + '...' 
          : commitMessage;

        return `[${time}] COMMIT: "${truncatedMessage}" → ${repo}`;
      });

    console.log('Recent push events found:', recentPushEvents.length);

    if (recentPushEvents.length === 0) {
      console.log('No recent commits found, using fallback data');
      return [
        `[${moment().utcOffset(330).format('YYYY-MM-DD hh:mm:ss A')}] COMMIT: "No recent activity detected" → profile`,
      ];
    }

    return recentPushEvents;
  } catch (error) {
    console.error('Error fetching commits:', error.message);
    return [
      `[${moment().utcOffset(330).subtract(2, 'hours').format('YYYY-MM-DD hh:mm:ss A')}] COMMIT: "Add dynamic README automation" → analyze-code`,
      `[${moment().utcOffset(330).subtract(5, 'hours').format('YYYY-MM-DD hh:mm:ss A')}] COMMIT: "Fix terminal styling issues" → readme`
    ];
  }
}

async function getLastCommitTime() {
  try {
    const response = await github.get(`/users/${USERNAME}/events/public`);
    const lastPushEvent = response.data.find(event => event.type === 'PushEvent');

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
    return '2 hours ago';
  } catch (error) {
    return '2 hours ago';
  }
}

async function getLanguageStats() {
  try {
    const reposResponse = await github.get(`/users/${USERNAME}/repos?per_page=100`);
    const repos = reposResponse.data.filter(repo => !repo.fork);

    const languageStats = {};
    let totalBytes = 0;

    for (const repo of repos.slice(0, 20)) {
      try {
        const langResponse = await github.get(`/repos/${USERNAME}/${repo.name}/languages`);
        const languages = langResponse.data;

        for (const [lang, bytes] of Object.entries(languages)) {
          languageStats[lang] = (languageStats[lang] || 0) + bytes;
          totalBytes += bytes;
        }
      } catch (err) {}
    }

    if (totalBytes === 0) {
      return `│ No Data     │ ░░░░░░░░░░░░░░░░░░░░     │  0.0%    │`;
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
    }).join('\n');

  } catch (error) {
    console.error('Error fetching language stats:', error.message);
    return `│ API Error   │ ░░░░░░░░░░░░░░░░░░░░     │  0.0%    │`;
  }
}

async function getCommitHash() {
  try {
    const response = await github.get(`/repos/${USERNAME}/${USERNAME}/commits?per_page=1`);
    if (response.data.length > 0) {
      const shortHash = response.data[0].sha.substring(0, 7);
      const message = response.data[0].commit.message.split('\n')[0];
      return `${shortHash} - ${message}`;
    }
    return 'latest';
  } catch (error) {
    return 'latest';
  }
}

async function getRepoStatus() {
  try {
    const reposResponse = await github.get(`/users/${USERNAME}/repos?sort=updated&per_page=10`);
    const activeRepos = reposResponse.data
      .filter(repo => 
        !repo.fork && 
        moment().diff(moment(repo.updated_at), 'days') < 30 &&
        repo.name !== 'test_new'
      )
      .slice(0, 5);

    if (activeRepos.length === 0) {
      return null;
    }

    const statusLines = [];
    for (const repo of activeRepos) {
      try {
        const commitsResponse = await github.get(`/repos/${USERNAME}/${repo.name}/commits?per_page=3`);
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
      } catch (err) {}
    }

    return statusLines.length > 0 ? statusLines.join('\n') : null;
  } catch (error) {
    console.error('Error fetching repo status:', error.message);
    return null;
  }
}

async function generateReadme() {
  console.log('Starting README generation...');

  const [recentCommits, lastCommit, languageStats, repoStatus, commitHash] = await Promise.all([
    getRecentCommits(),
    getLastCommitTime(),
    getLanguageStats(),
    getRepoStatus(),
    getCommitHash()
  ]);

  const currentTime = moment().utcOffset(330).format('DD/MM/YYYY, hh:mm:ss a');

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
| \`> user:\` wicked-eyes-on-you | \`> last_updated:\` ${moment().utcOffset(330).format('DD/MM/YYYY, hh:mm:ss')} |
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
export EMAIL="wicked-eyes-on-you@gmail.com"

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
│ Response Time   │ ~2–4 hours (IST business hours)               │
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
<sub>Last updated: ${moment().utcOffset(330).format('MMMM Do YYYY, h:mm:ss a')} IST | Commit: ${commitHash} | Auto-generated every 6 hours</sub>
</div>`;

  fs.writeFileSync('README.md', readmeContent);
  console.log('README.md updated successfully!');
}

generateReadme().catch(console.error);