#!/usr/bin/env python3
"""
Generate contributor leaderboard based on commit counts
Updates both README.md and docs/leaderboard.json
"""

import os
import json
import requests
from datetime import datetime
from collections import defaultdict

# Get environment variables
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN')
REPO_OWNER = os.environ.get('REPO_OWNER', 'IISERM')
REPO_NAME = os.environ.get('REPO_NAME', 'question-paper-repo')

# GitHub API headers
headers = {
    'Authorization': f'token {GITHUB_TOKEN}',
    'Accept': 'application/vnd.github.v3+json',
}


def fetch_all_contributors():
    """Fetch all contributors with their commit counts from GitHub API"""
    print("Fetching contributors from GitHub API...")
    
    contributors = []
    page = 1
    per_page = 100
    
    while True:
        url = f'https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/contributors'
        params = {
            'per_page': per_page,
            'page': page,
            'anon': 'false'  # Exclude anonymous contributors
        }
        
        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()
        
        data = response.json()
        if not data:
            break
            
        for contributor in data:
            # Skip bots
            if contributor.get('type') == 'Bot':
                continue
                
            contributors.append({
                'username': contributor['login'],
                'avatar_url': contributor['avatar_url'],
                'profile_url': contributor['html_url'],
                'commits': contributor['contributions']
            })
        
        # Check if there are more pages
        if len(data) < per_page:
            break
            
        page += 1
    
    # Sort by commit count (descending)
    contributors.sort(key=lambda x: x['commits'], reverse=True)
    
    print(f"Found {len(contributors)} contributors")
    return contributors


def update_readme(contributors):
    """Update the leaderboard section in README.md"""
    print("Updating README.md...")
    
    with open('README.md', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Generate leaderboard markdown
    leaderboard_md = "## 🏆 Contributor Leaderboard\n\n"
    leaderboard_md += "Top contributors based on commit count:\n\n"
    leaderboard_md += "| Rank | Contributor | Commits |\n"
    leaderboard_md += "|------|-------------|--------:|\n"
    
    for i, contributor in enumerate(contributors[:5], 1):  # Top 5
        username = contributor['username']
        commits = contributor['commits']
        
        # Add medal emoji for top 3
        rank = f"{i}"
        if i == 1:
            rank = "🥇"
        elif i == 2:
            rank = "🥈"
        elif i == 3:
            rank = "🥉"
        
        leaderboard_md += f"| {rank} | {username} | {commits} |\n"
    
    leaderboard_md += f"\n*Last updated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC*\n"
    
    # Find and replace the leaderboard section or the old format
    # First, try to find the new leaderboard section
    start_marker = "## 🏆 Contributor Leaderboard"
    
    # Check if old leaderboard format exists
    old_start_marker = "## Commit leaderboard (metric: files)"
    
    if start_marker in content:
        # Find the section and replace it
        start_idx = content.find(start_marker)
        # Find the next ## heading or end of file
        next_section_idx = content.find("\n## ", start_idx + len(start_marker))
        
        if next_section_idx == -1:
            # No next section, replace till end
            content = content[:start_idx] + leaderboard_md + "\n"
        else:
            # Replace till next section
            content = content[:start_idx] + leaderboard_md + "\n" + content[next_section_idx:]
    
    elif old_start_marker in content:
        # Replace old format
        start_idx = content.find(old_start_marker)
        next_section_idx = content.find("\n## ", start_idx + len(old_start_marker))
        
        if next_section_idx == -1:
            content = content[:start_idx] + leaderboard_md + "\n"
        else:
            content = content[:start_idx] + leaderboard_md + "\n" + content[next_section_idx:]
    
    else:
        # Append at the end
        content += "\n" + leaderboard_md
    
    with open('README.md', 'w', encoding='utf-8') as f:
        f.write(content)
    
    print("README.md updated successfully")


def generate_json(contributors):
    """Generate leaderboard JSON for the website"""
    print("Generating docs/leaderboard.json...")
    
    data = {
        'last_updated': datetime.utcnow().isoformat() + 'Z',
        'total_contributors': len(contributors),
        'contributors': contributors
    }
    
    os.makedirs('docs', exist_ok=True)
    
    with open('docs/leaderboard.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    
    print("leaderboard.json generated successfully")


def main():
    try:
        contributors = fetch_all_contributors()
        update_readme(contributors)
        generate_json(contributors)
        print("✅ Leaderboard updated successfully!")
    except Exception as e:
        print(f"❌ Error: {e}")
        raise


if __name__ == '__main__':
    main()

