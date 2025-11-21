#!/usr/bin/env node
/**
 * Generate contributor leaderboard based on commit counts
 * Updates both README.md and docs/leaderboard.json
 * Includes both GitHub users and email-only contributors (via Google Auth)
 */

const fs = require('fs').promises;
const path = require('path');

// Get environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER || 'IISERM';
const REPO_NAME = process.env.REPO_NAME || 'question-paper-repo';

// Exclusion list - usernames/names to exclude from leaderboard
const EXCLUDED_USERNAMES = new Set([
    'Darsh-A',
    'PseudoFractal',
    'pseudofractal',
    'Darsh Suhas Ambade',
]);

// GitHub API headers
const headers = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Node.js'
};

/**
 * Fetch all commits from the repository to count by author
 */
async function fetchAllCommits() {
    console.log('Fetching all commits from repository...');
    
    // Map to store commit counts by author
    // Key: "name|email", Value: { name, email, count }
    const authorCommits = new Map();
    
    let page = 1;
    const perPage = 100;
    let totalCommits = 0;
    
    while (true) {
        const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?per_page=${perPage}&page=${page}`;
        
        const response = await fetch(url, { headers });
        
        if (response.status === 409) {
            // Repository is empty
            console.log('Repository is empty or has no commits');
            return authorCommits;
        }
        
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }
        
        const commits = await response.json();
        
        if (!commits || commits.length === 0) {
            break;
        }
        
        for (const commit of commits) {
            // Get author info from commit
            const commitData = commit.commit || {};
            const authorData = commitData.author || {};
            
            const name = authorData.name || 'Unknown';
            const email = authorData.email || 'unknown@unknown.com';
            
            // Skip if author is a bot
            if (name.toLowerCase().includes('[bot]') || email.toLowerCase().includes('bot@')) {
                continue;
            }
            
            // Skip GitHub's noreply addresses for bots
            if (email.includes('github-actions[bot]') || email.includes('dependabot[bot]')) {
                continue;
            }
            
            // Count this commit for the author
            const authorKey = `${name}|${email}`;
            
            if (authorCommits.has(authorKey)) {
                authorCommits.get(authorKey).count++;
            } else {
                authorCommits.set(authorKey, { name, email, count: 1 });
            }
            
            totalCommits++;
        }
        
        console.log(`  Processed page ${page} (${commits.length} commits)...`);
        
        // Check if there are more pages
        if (commits.length < perPage) {
            break;
        }
        
        page++;
        
        // Safety limit to prevent infinite loops
        if (page > 1000) {
            console.log('  Warning: Reached page limit (1000)');
            break;
        }
    }
    
    console.log(`Total commits processed: ${totalCommits}`);
    console.log(`Unique authors found: ${authorCommits.size}`);
    
    return authorCommits;
}

/**
 * Convert author commits map to sorted contributor list
 */
function createContributorList(authorCommits) {
    const contributors = [];
    
    for (const [key, data] of authorCommits) {
        const { name, email, count } = data;
        
        // Try to get GitHub username if email matches
        let username = null;
        let avatarUrl = null;
        let profileUrl = null;
        
        // Check if this is a GitHub email
        if (email.includes('users.noreply.github.com')) {
            // Extract username from GitHub noreply email format
            // Format: username@users.noreply.github.com or ID+username@users.noreply.github.com
            const parts = email.split('@')[0];
            if (parts.includes('+')) {
                username = parts.split('+')[1];
            } else {
                username = parts;
            }
        }
        
        // Check exclusion list
        const displayUsername = username || name;
        if (EXCLUDED_USERNAMES.has(displayUsername) || EXCLUDED_USERNAMES.has(name)) {
            console.log(`  Excluding: ${displayUsername} (${name})`);
            continue;
        }
        
        // If we found a GitHub username, get their avatar
        if (username) {
            avatarUrl = `https://github.com/${username}.png`;
            profileUrl = `https://github.com/${username}`;
        } else {
            // For non-GitHub users, use generated avatar
            username = name;
            avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&size=200`;
            profileUrl = null;
        }
        
        contributors.push({
            username: username || name,
            name,
            email,
            avatar_url: avatarUrl,
            profile_url: profileUrl,
            commits: count
        });
    }
    
    // Sort by commit count (descending)
    contributors.sort((a, b) => b.commits - a.commits);
    
    return contributors;
}

/**
 * Fetch all contributors including email-only contributors
 */
async function fetchAllContributors() {
    const authorCommits = await fetchAllCommits();
    const contributors = createContributorList(authorCommits);
    
    console.log(`Found ${contributors.length} total contributors`);
    return contributors;
}

/**
 * Update the leaderboard section in README.md
 */
async function updateReadme(contributors) {
    console.log('Updating README.md...');
    
    let content = await fs.readFile('README.md', 'utf-8');
    
    // Generate leaderboard markdown
    let leaderboardMd = '## 🏆 Contributor Leaderboard\n\n';
    leaderboardMd += 'Top contributors based on commit count:\n\n';
    leaderboardMd += '| Rank | Contributor | Commits |\n';
    leaderboardMd += '|------|-------------|--------:|\n';
    
    const top5 = contributors.slice(0, 5);
    for (let i = 0; i < top5.length; i++) {
        const contributor = top5[i];
        const displayName = contributor.name || contributor.username;
        const commits = contributor.commits;
        
        // Add medal emoji for top 3
        let rank = `${i + 1}`;
        if (i === 0) rank = '🥇';
        else if (i === 1) rank = '🥈';
        else if (i === 2) rank = '🥉';
        
        leaderboardMd += `| ${rank} | ${displayName} | ${commits} |\n`;
    }
    
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    leaderboardMd += `\n*Last updated: ${now} UTC*\n`;
    
    // Find and replace the leaderboard section
    const startMarker = '## 🏆 Contributor Leaderboard';
    const oldStartMarker = '## Commit leaderboard (metric: files)';
    
    if (content.includes(startMarker)) {
        // Find the section and replace it
        const startIdx = content.indexOf(startMarker);
        const nextSectionIdx = content.indexOf('\n## ', startIdx + startMarker.length);
        
        if (nextSectionIdx === -1) {
            // No next section, replace till end
            content = content.substring(0, startIdx) + leaderboardMd + '\n';
        } else {
            // Replace till next section
            content = content.substring(0, startIdx) + leaderboardMd + '\n' + content.substring(nextSectionIdx);
        }
    } else if (content.includes(oldStartMarker)) {
        // Replace old format
        const startIdx = content.indexOf(oldStartMarker);
        const nextSectionIdx = content.indexOf('\n## ', startIdx + oldStartMarker.length);
        
        if (nextSectionIdx === -1) {
            content = content.substring(0, startIdx) + leaderboardMd + '\n';
        } else {
            content = content.substring(0, startIdx) + leaderboardMd + '\n' + content.substring(nextSectionIdx);
        }
    } else {
        // Append at the end
        content += '\n' + leaderboardMd;
    }
    
    await fs.writeFile('README.md', content, 'utf-8');
    console.log('README.md updated successfully');
}

/**
 * Generate leaderboard JSON for the website
 */
async function generateJson(contributors) {
    console.log('Generating docs/leaderboard.json...');
    
    const data = {
        last_updated: new Date().toISOString(),
        total_contributors: contributors.length,
        contributors
    };
    
    // Ensure docs directory exists
    await fs.mkdir('docs', { recursive: true });
    
    await fs.writeFile(
        'docs/leaderboard.json',
        JSON.stringify(data, null, 2),
        'utf-8'
    );
    
    console.log('leaderboard.json generated successfully');
}

/**
 * Main function
 */
async function main() {
    try {
        const contributors = await fetchAllContributors();
        await updateReadme(contributors);
        await generateJson(contributors);
        console.log('✅ Leaderboard updated successfully!');
    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

