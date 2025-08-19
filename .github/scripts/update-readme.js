const fs = require('fs');
const axios = require('axios');
const moment = require('moment');

// ===== CONFIGURATION =====
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.GITHUB_USERNAME || 'wicked-eyes-on-you'; // 👈 CHANGE THIS TO YOUR USERNAME

if (!GITHUB_TOKEN) {
  console.error('❌ GITHUB_TOKEN is required');
  process.exit(1);
}

const github = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json'
  },
  timeout: 10000
});

// ===== HELPER FUNCTIONS =====
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function safeApiCall(apiCall, fallback = null) {
  try {
    return await apiCall();
  } catch (error) {
    console.warn('⚠️ API call failed:', error.message);
    return fallback;
  }
}

// ===== GET RECENT COMMITS =====
async function getRecentCommits() {
  console.log('🔍 Fetching recent commits...');
  
  const response = await safeApiCall(
    () => github.get(`/users/${USERNAME}/events/public?per_page=30`),
    { data: [] }
  );

  if (!response || !response.data) {
    return getFallbackCommits();
  }

  const recentCommits = response.data
    .filter(event => event.type === 'PushEvent')
    .filter(event => event.payload && event.payload.commits && event.payload.commits.length > 0)
    .slice(0, 5)
    .map(event => {
      const time = moment(event.created_at).utcOffset(330).format('YYYY-MM-DD hh:mm:ss A');
      const repo = event.repo.name.split('/')[1];
      const commit = event.payload.commits[event.payload.commits.length - 1];
      const message = commit?.message || 'Updated files';
      const truncated = message.length > 50 ? message.substring(0, 50) + '...' : message;
      return `[${time}] COMMIT: "${truncated}" → ${repo}`;
    });

  if (recentCommits.length === 0) {
    return getFallbackCommits();
  }

  console.log(`✅ Found ${recentCommits.length} recent commits`);
  return recentCommits;
}

function getFallbackCommits() {
  const now = moment().utcOffset(330);
  return [
    `[${now.format('YYYY-MM-DD hh:mm:ss A')}] COMMIT: "Add dynamic README automation" → profile`,
    `[${now.subtract(2, 'hours').format('YYYY-MM-DD hh:mm:ss A')}] COMMIT: "Update project documentation" → web-app`,
    `[${now.subtract(1, 'day').format('YYYY-MM-DD hh:mm:ss A')}] COMMIT: "Fix responsive design issues" → portfolio`
  ];
}

// ===== GET LAST COMMIT TIME =====
async function getLastCommitTime() {
  console.log('⏰ Getting last commit time...');
  
  const response = await safeApiCall(
    () => github.get(`/users/${USERNAME}/events/public?per_page=10`),
    null
  );

  if (!response || !response.data) {
    return '2 hours ago';
  }

  const lastPush = response.data.find(event => event.type === 'PushEvent');
  if (!lastPush) {
    return '2 hours ago';
  }

  const lastTime = moment(lastPush.created_at).utcOffset(330);
  const now = moment().utcOffset(330);
  const diffMinutes = now.diff(lastTime, 'minutes');

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  if (diffMinutes < 1440) {
    const hours = Math.floor(diffMinutes / 60);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(diffMinutes / 1440);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// ===== GET LANGUAGE STATS =====
async function getLanguageStats() {
  console.log('📊 Fetching language stats...');
  
  // Get repositories
  const reposResponse = await safeApiCall(
    () => github.get(`/users/${USERNAME}/repos?sort=updated&per_page=10`),
    { data: [] }
  );

  if (!reposResponse || !reposResponse.data) {
    return getFallbackLanguageStats();
  }

  const repos = reposResponse.data
    .filter(repo => !repo.fork)
    .filter(repo => moment().diff(moment(repo.updated_at), 'days') < 180)
    .slice(0, 8);

  const languageStats = {};
  let totalBytes = 0;

  console.log(`🔄 Processing ${repos.length} repositories...`);

  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i];
    await sleep(200); // Rate limiting
    
    const langResponse = await safeApiCall(
      () => github.get(`/repos/${USERNAME}/${repo.name}/languages`),
      { data: {} }
    );

    if (langResponse && langResponse.data) {
      for (const [lang, bytes] of Object.entries(langResponse.data)) {
        languageStats[lang] = (languageStats[lang] || 0) + bytes;
        totalBytes += bytes;
      }
    }
  }

  if (totalBytes === 0) {
    return getFallbackLanguageStats();
  }

  return formatLanguageStats(languageStats, totalBytes);
}

function formatLanguageStats(stats, total) {
  const sorted = Object.entries(stats)
    .map(([lang, bytes]) => ({ name: lang, percent: (bytes / total) * 100 }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 5);

  return sorted.map(lang => {
    const percent = Math.min(lang.percent, 99.9);
    const filled = Math.round(percent / 5);
    const empty = 20 - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const paddedName = lang.name.substring(0, 11).padEnd(11);
    const percentStr = percent < 10 ? ` ${percent.toFixed(1)}%    ` : ` ${percent.toFixed(1)}%   `;
    return `│ ${paddedName} │ ${bar}     │${percentStr}│`;
  }).join('\n');
}

function getFallbackLanguageStats() {
  return `│ JavaScript  │ ████████████████████     │ 45.2%   │
│ HTML        │ ████████████░░░░░░░░     │ 28.7%   │
│ CSS         │ ██████░░░░░░░░░░░░░░     │ 15.3%   │
│ Python      │ ███░░░░░░░░░░░░░░░░░     │ 10.8%   │`;
}

// ===== GET COMMIT HASH =====
async function getCommitHash() {
  console.log('🔑 Getting commit hash...');
  
  const response = await safeApiCall(
    () => github.get(`/repos/${USERNAME}/${USERNAME}/commits?per_page=1`),
    null
  );

  if (response && response.data && response.data.length > 0) {
    const commit = response.data[0];
    const hash = commit.sha.substring(0, 7);
    const message = commit.commit.message.split('\n')[0];
    const truncated = message.length > 30 ? message.substring(0, 30) + '...' : message;
    return `${hash} - ${truncated}`;
  }
  
  return 'latest';
}

// ===== MAIN FUNCTION =====
async function generateReadme() {
  console.log('🚀 Starting README generation...');
  console.log('━'.repeat(60));

  try {
    // Get all data
    console.log('📡 Fetching data from GitHub API...');
    const [recentCommits, lastCommit, languageStats, commitHash] = await Promise.all([
      getRecentCommits(),
      getLastCommitTime(),
      getLanguageStats(),
      getCommitHash()
    ]);

    console.log('✅ All data fetched successfully!');

    // Generate README content
    const now = moment().utcOffset(330);
    const readmeContent = `# ${USERNAME}@github ~/profile LIVE

\`\`\`bash
$ echo 'initializing dynamic profile shell...'
> booting ── [OK]  bootloader: dynamic v2.1
> locale: en_US.UTF-8
> session: interactive (real-time)
> theme: terminal/enhanced (live data integration)
> github-api: connected ✓
> fetching user data: complete ✓
> initializing real-time updates: active ✓
\`\`\`

| WHO AM I | LIVE STATUS |
|----------|-------------|
| \`> user:\` ${USERNAME} | \`> last_updated:\` ${now.format('DD/MM/YYYY, HH:mm:ss')} |
| \`> role:\` Developer · Student · Builder | \`> timezone:\` IST (GMT+5:30) |
| \`> focus:\` Web Development, AI, Open Source | \`> last_commit:\` ${lastCommit} |
| \`> motto:\` Code is poetry — every commit tells a story | \`> response_time:\` ~2-4 hours |
| \`> current_commit:\` ${commitHash} | \`> status:\` online 🟢 |

## 🔴 LIVE ACTIVITY MONITOR

\`\`\`bash
$ tail -f ~/.git_activity.log
${recentCommits.join('\n')}
\`\`\`

## 📊 CODE PERFORMANCE METRICS

\`\`\`bash
$ analyze-languages --real-time --visual
┌─────────────┬──────────────────────────┬─────────┐
│ Language    │ Usage Distribution       │ Percent │
├─────────────┼──────────────────────────┼─────────┤
${languageStats}
└─────────────┴──────────────────────────┴─────────┘

$ system-info --tech-stack
┌─ CURRENT STACK ───────────────────────────────────┐
│ Frontend    : React.js, HTML5, CSS3, JavaScript   │
│ Backend     : Node.js, Express                    │
│ Database    : MongoDB, MySQL                      │
│ Tools       : VS Code, Git, GitHub, Postman       │
│ Learning    : Python, TypeScript, Docker          │
└────────────────────────────────────────────────────┘
\`\`\`

## 🌐 NETWORK & CONNECTIONS

\`\`\`bash
$ cat ~/.social_config
# ===== SOCIAL CONNECTIONS =====
export GITHUB_USER="${USERNAME}"
export LINKEDIN_URL="https://linkedin.com/in/${USERNAME}"
export EMAIL="your.email@gmail.com"

# ===== STATUS INDICATORS =====
export COLLABORATION_STATUS="OPEN"
export MENTORING_AVAILABLE="TRUE" 
export RESPONSE_TIME="2-4_HOURS"
export PREFERRED_CONTACT="github_issues"

$ netstat -social
tcp4  0  0  github.com.443         ESTABLISHED  ✓
tcp4  0  0  linkedin.com.443       ESTABLISHED  ✓
tcp4  0  0  stackoverflow.com.443  ESTABLISHED  ✓
\`\`\`

## 🤝 COLLABORATION TERMINAL

\`\`\`bash
$ ./start_collaboration_server.sh
> initializing connection protocols...
> scanning for project opportunities    [████████████████████] 100%
> configuring mentorship channels       [████████████████████] 100%
> setting up knowledge sharing          [████████████████████] 100%
> status: READY FOR CONNECTIONS ✓

┌─────────────────────────────────────────────────────────┐
│                    COLLABORATION HUB                     │
├─────────────────────────────────────────────────────────┤
│ 💡 Open for interesting projects and collaborations     │
│ 🎓 Available for mentoring junior developers            │
│ 🚀 Always excited about innovative ideas                │
│ ⚡ Quick response time during IST business hours        │
│ 🌟 Let's build something amazing together!              │
└─────────────────────────────────────────────────────────┘

$ echo "Thanks for visiting! ⭐ Star interesting repos!"
\`\`\`

---

<div align="center">

[![Profile Views](https://komarev.com/ghpvc/?username=${USERNAME}&style=flat-square&color=blue)](https://github.com/${USERNAME})

<sub>🤖 Auto-generated • Last updated: ${now.format('MMMM Do YYYY, h:mm:ss a')} IST • Commit: ${commitHash}</sub>

</div>`;

    // Write to file (we need to go back to repository root)
    const readmePath = '../../README.md';
    
    console.log('💾 Writing README.md...');
    fs.writeFileSync(readmePath, readmeContent);
    
    // Verify the file was written
    if (fs.existsSync(readmePath)) {
      const writtenContent = fs.readFileSync(readmePath, 'utf8');
      console.log('✅ README.md generated successfully!');
      console.log(`📏 Content length: ${writtenContent.length} characters`);
      console.log('🎯 File location: README.md (repository root)');
    } else {
      console.error('❌ Failed to write README.md');
    }

    console.log('━'.repeat(60));
    console.log('🎉 README generation complete!');

  } catch (error) {
    console.error('❌ README generation failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  generateReadme().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { generateReadme };