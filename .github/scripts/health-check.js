const fs = require('fs');
const axios = require('axios');
const moment = require('moment');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.GITHUB_USERNAME || 'wicked-eyes-on-you';

// GitHub API client
const github = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': `${USERNAME}-health-check`
  },
  timeout: 10000
});

// Health check results
const results = {
  overall: true,
  checks: [],
  timestamp: moment().format(),
  duration: 0
};

function logResult(name, success, message, details = {}) {
  const status = success ? '✅' : '❌';
  const result = {
    name,
    success,
    message,
    details,
    timestamp: moment().format('HH:mm:ss')
  };
  
  results.checks.push(result);
  console.log(`${status} ${name}: ${message}`);
  
  if (!success) {
    results.overall = false;
  }
  
  return success;
}

async function checkGitHubConnection() {
  try {
    const response = await github.get('/user');
    const user = response.data;
    
    return logResult(
      'GitHub API Connection',
      true,
      `Connected as ${user.login}`,
      {
        login: user.login,
        id: user.id,
        type: user.type
      }
    );
  } catch (error) {
    return logResult(
      'GitHub API Connection',
      false,
      `Failed to connect: ${error.message}`,
      {
        status: error.response?.status,
        statusText: error.response?.statusText
      }
    );
  }
}

async function checkRateLimit() {
  try {
    const response = await github.get('/rate_limit');
    const rateLimit = response.data.rate;
    
    const remaining = rateLimit.remaining;
    const total = rateLimit.limit;
    const resetTime = moment.unix(rateLimit.reset);
    const timeToReset = resetTime.diff(moment(), 'minutes');
    
    const isHealthy = remaining > 50; // Require at least 50 requests remaining
    
    return logResult(
      'Rate Limit Status',
      isHealthy,
      isHealthy 
        ? `${remaining}/${total} requests remaining`
        : `Low rate limit: ${remaining}/${total} (resets in ${timeToReset}m)`,
      {
        remaining,
        limit: total,
        resetTime: resetTime.format(),
        minutesToReset: timeToReset
      }
    );
  } catch (error) {
    return logResult(
      'Rate Limit Status',
      false,
      `Failed to check rate limit: ${error.message}`
    );
  }
}

async function checkFilePermissions() {
  try {
    // Check if README.md exists and is writable
    if (fs.existsSync('README.md')) {
      fs.accessSync('README.md', fs.constants.W_OK);
    }
    
    // Test write permissions by creating a temp file
    const testFile = '.health-check-temp';
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    
    return logResult(
      'File System Permissions',
      true,
      'Read/write permissions verified'
    );
  } catch (error) {
    return logResult(
      'File System Permissions',
      false,
      `Permission error: ${error.message}`
    );
  }
}

async function checkEnvironmentVariables() {
  const requiredVars = ['GITHUB_TOKEN'];
  const optionalVars = ['GITHUB_USERNAME'];
  
  const missing = requiredVars.filter(varName => !process.env[varName]);
  const hasOptional = optionalVars.filter(varName => process.env[varName]);
  
  const success = missing.length === 0;
  
  return logResult(
    'Environment Variables',
    success,
    success 
      ? `All required variables present (${hasOptional.length} optional)`
      : `Missing required variables: ${missing.join(', ')}`,
    {
      required: requiredVars.length,
      missing: missing.length,
      optional: hasOptional.length,
      missingVars: missing
    }
  );
}

async function checkNetworkConnectivity() {
  const testUrls = [
    'https://api.github.com',
    'https://github.com',
    'https://cdn.jsdelivr.net'
  ];
  
  const results = await Promise.allSettled(
    testUrls.map(url => 
      axios.get(url, { timeout: 5000 })
        .then(() => ({ url, success: true }))
        .catch(error => ({ url, success: false, error: error.message }))
    )
  );
  
  const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const total = testUrls.length;
  const isHealthy = successful >= Math.ceil(total * 0.8); // 80% success rate
  
  return logResult(
    'Network Connectivity',
    isHealthy,
    `${successful}/${total} endpoints reachable`,
    {
      successful,
      total,
      successRate: Math.round((successful / total) * 100),
      results: results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason.message })
    }
  );
}

async function checkDependencies() {
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const dependencies = Object.keys(packageJson.dependencies || {});
    
    const missing = [];
    const installed = [];
    
    for (const dep of dependencies) {
      try {
        require.resolve(dep);
        installed.push(dep);
      } catch (error) {
        missing.push(dep);
      }
    }
    
    const success = missing.length === 0;
    
    return logResult(
      'Dependencies Check',
      success,
      success 
        ? `All ${installed.length} dependencies installed`
        : `${missing.length} missing: ${missing.join(', ')}`,
      {
        total: dependencies.length,
        installed: installed.length,
        missing: missing.length,
        missingDeps: missing
      }
    );
  } catch (error) {
    return logResult(
      'Dependencies Check',
      false,
      `Failed to check dependencies: ${error.message}`
    );
  }
}

async function checkSystemResources() {
  try {
    const memUsage = process.memoryUsage();
    const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const memTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    
    // Check if we have reasonable memory available
    const isHealthy = memUsedMB < 100; // Less than 100MB used
    
    return logResult(
      'System Resources',
      isHealthy,
      `Memory: ${memUsedMB}MB used / ${memTotalMB}MB allocated`,
      {
        memory: {
          used: memUsedMB,
          total: memTotalMB,
          rss: Math.round(memUsage.rss / 1024 / 1024),
          external: Math.round(memUsage.external / 1024 / 1024)
        },
        node: process.version,
        platform: process.platform,
        arch: process.arch
      }
    );
  } catch (error) {
    return logResult(
      'System Resources',
      false,
      `Failed to check resources: ${error.message}`
    );
  }
}

async function runHealthCheck() {
  const startTime = Date.now();
  
  console.log('🏥 Enhanced System Health Check v3.0');
  console.log('=====================================');
  console.log(`📅 Started: ${moment().format('YYYY-MM-DD HH:mm:ss')}`);
  console.log('');
  
  try {
    // Run all health checks
    await Promise.all([
      checkEnvironmentVariables(),
      checkFilePermissions(),
      checkSystemResources(),
      checkDependencies(),
      checkNetworkConnectivity(),
      checkGitHubConnection(),
      checkRateLimit()
    ]);
    
    results.duration = Date.now() - startTime;
    
    console.log('');
    console.log('📊 HEALTH CHECK SUMMARY');
    console.log('======================');
    
    const passed = results.checks.filter(c => c.success).length;
    const total = results.checks.length;
    const passRate = Math.round((passed / total) * 100);
    
    console.log(`✅ Passed: ${passed}/${total} (${passRate}%)`);
    console.log(`⏱️  Duration: ${results.duration}ms`);
    console.log(`🎯 Overall: ${results.overall ? '✅ HEALTHY' : '❌ ISSUES DETECTED'}`);
    
    if (!results.overall) {
      console.log('');
      console.log('🚨 ISSUES FOUND:');
      results.checks
        .filter(c => !c.success)
        .forEach(c => console.log(`   • ${c.name}: ${c.message}`));
    }
    
    console.log('');
    console.log('💡 RECOMMENDATIONS:');
    
    if (passRate === 100) {
      console.log('   • ✨ All systems optimal! Ready for README generation.');
    } else if (passRate >= 80) {
      console.log('   • ⚡ Most systems healthy. Minor issues detected.');
      console.log('   • 🔄 README generation should work with fallback support.');
    } else if (passRate >= 60) {
      console.log('   • ⚠️  Multiple issues detected. Address critical failures.');
      console.log('   • 🛡️ Fallback mode recommended.');
    } else {
      console.log('   • 🚨 Critical system issues. Immediate attention required.');
      console.log('   • ❌ README generation may fail completely.');
    }
    
    // Generate health report
    const report = {
      timestamp: results.timestamp,
      overall: results.overall,
      passRate,
      duration: results.duration,
      summary: {
        passed,
        total,
        failed: total - passed
      },
      checks: results.checks,
      recommendations: generateRecommendations()
    };
    
    // Save health report
    fs.writeFileSync('.health-report.json', JSON.stringify(report, null, 2));
    console.log('📄 Detailed report saved to .health-report.json');
    
    // Exit with appropriate code
    process.exit(results.overall ? 0 : 1);
    
  } catch (error) {
    console.error('💥 Health check failed:', error.message);
    process.exit(1);
  }
}

function generateRecommendations() {
  const recommendations = [];
  
  results.checks.forEach(check => {
    if (!check.success) {
      switch (check.name) {
        case 'GitHub API Connection':
          recommendations.push('Verify GITHUB_TOKEN is valid and has required permissions');
          break;
        case 'Rate Limit Status':
          recommendations.push('Wait for rate limit reset or use a different token');
          break;
        case 'Environment Variables':
          recommendations.push('Set missing environment variables in GitHub Secrets');
          break;
        case 'File System Permissions':
          recommendations.push('Check repository permissions and workflow token scope');
          break;
        case 'Dependencies Check':
          recommendations.push('Run npm install to install missing dependencies');
          break;
        case 'Network Connectivity':
          recommendations.push('Check network connectivity and firewall settings');
          break;
        case 'System Resources':
          recommendations.push('Monitor memory usage and optimize resource consumption');
          break;
      }
    }
  });
  
  return [...new Set(recommendations)]; // Remove duplicates
}

// Export for testing
module.exports = {
  runHealthCheck,
  checkGitHubConnection,
  checkRateLimit,
  checkEnvironmentVariables
};

// Run if called directly
if (require.main === module) {
  runHealthCheck();
}