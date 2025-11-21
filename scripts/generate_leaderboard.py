#!/usr/bin/env python3
"""
Generate contributor leaderboard based on commit counts
Updates both README.md and docs/leaderboard.json
Includes both GitHub users and email-only contributors (via Google Auth)
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

# Exclusion list - usernames/names to exclude from leaderboard
EXCLUDED_USERNAMES = {
    'Darsh-A',
    'PseudoFractal',
    'pseudofractal',
    'Darsh Suhas Ambade',
}

# GitHub API headers
headers = {
    'Authorization': f'token {GITHUB_TOKEN}',
    'Accept': 'application/vnd.github.v3+json',
}


def fetch_all_commits():
    """Fetch all commits from the repository to count by author"""
    print("Fetching all commits from repository...")
    
    # Dictionary to store commit counts by author
    # Key: (name, email) tuple, Value: count
    author_commits = defaultdict(int)
    
    page = 1
    per_page = 100
    total_commits = 0
    
    while True:
        url = f'https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/commits'
        params = {
            'per_page': per_page,
            'page': page
        }
        
        response = requests.get(url, headers=headers, params=params)
        
        if response.status_code == 409:
            # Repository is empty
            print("Repository is empty or has no commits")
            return []
        
        response.raise_for_status()
        commits = response.json()
        
        if not commits:
            break
        
        for commit in commits:
            # Get author info from commit
            commit_data = commit.get('commit', {})
            author_data = commit_data.get('author', {})
            
            name = author_data.get('name', 'Unknown')
            email = author_data.get('email', 'unknown@unknown.com')
            
            # Skip bot commits (by committer email)
            committer_data = commit_data.get('committer', {})
            committer_email = committer_data.get('email', '')
            if 'bot@' in committer_email.lower() or '[bot]' in committer_email.lower():
                # This is a bot commit, but we still want to count the author
                pass
            
            # Skip if author is a bot
            if '[bot]' in name.lower() or 'bot@' in email.lower():
                continue
            
            # Skip GitHub's noreply addresses for bots
            if 'github-actions[bot]' in email or 'dependabot[bot]' in email:
                continue
            
            # Count this commit for the author
            author_key = (name, email)
            author_commits[author_key] += 1
            total_commits += 1
        
        print(f"  Processed page {page} ({len(commits)} commits)...")
        
        # Check if there are more pages
        if len(commits) < per_page:
            break
        
        page += 1
        
        # Safety limit to prevent infinite loops
        if page > 1000:
            print("  Warning: Reached page limit (1000)")
            break
    
    print(f"Total commits processed: {total_commits}")
    print(f"Unique authors found: {len(author_commits)}")
    
    return author_commits


def create_contributor_list(author_commits):
    """Convert author commits dictionary to sorted contributor list"""
    contributors = []
    
    for (name, email), commits in author_commits.items():
        # Try to get GitHub username if email matches
        username = None
        avatar_url = None
        profile_url = None
        
        # Check if this is a GitHub email
        if 'users.noreply.github.com' in email:
            # Extract username from GitHub noreply email format
            # Format: username@users.noreply.github.com or ID+username@users.noreply.github.com
            parts = email.split('@')[0]
            if '+' in parts:
                username = parts.split('+')[1]
            else:
                username = parts
        
        # Check exclusion list
        # Check both username and name against exclusion list
        display_username = username or name
        if display_username in EXCLUDED_USERNAMES or name in EXCLUDED_USERNAMES:
            print(f"  Excluding: {display_username} ({name})")
            continue
        
        # If we found a GitHub username, get their avatar
        if username:
            avatar_url = f'https://github.com/{username}.png'
            profile_url = f'https://github.com/{username}'
        else:
            # For non-GitHub users, use initials or placeholder
            # Use name for display
            username = name
            # Use a generated avatar based on name
            avatar_url = f'https://ui-avatars.com/api/?name={name.replace(" ", "+")}&background=random&size=200'
            profile_url = None
        
        contributors.append({
            'username': username or name,
            'name': name,
            'email': email,
            'avatar_url': avatar_url,
            'profile_url': profile_url,
            'commits': commits
        })
    
    # Sort by commit count (descending)
    contributors.sort(key=lambda x: x['commits'], reverse=True)
    
    return contributors


def fetch_all_contributors():
    """Fetch all contributors including email-only contributors"""
    author_commits = fetch_all_commits()
    contributors = create_contributor_list(author_commits)
    
    print(f"Found {len(contributors)} total contributors")
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
        # Use name if available, otherwise username
        display_name = contributor.get('name') or contributor['username']
        commits = contributor['commits']
        
        # Add medal emoji for top 3
        rank = f"{i}"
        if i == 1:
            rank = "🥇"
        elif i == 2:
            rank = "🥈"
        elif i == 3:
            rank = "🥉"
        
        leaderboard_md += f"| {rank} | {display_name} | {commits} |\n"
    
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
        # Validate environment variables
        if not GITHUB_TOKEN:
            raise ValueError("GITHUB_TOKEN environment variable is required")
        if not REPO_OWNER or not REPO_NAME:
            raise ValueError("REPO_OWNER and REPO_NAME environment variables are required")
        
        print(f"Generating leaderboard for {REPO_OWNER}/{REPO_NAME}")
        print(f"Excluding: {', '.join(EXCLUDED_USERNAMES)}")
        print()
        
        contributors = fetch_all_contributors()
        
        if not contributors:
            print("⚠️  Warning: No contributors found!")
            print("This might be a new repository or all contributors are excluded.")
            # Still update with empty list
        
        update_readme(contributors)
        generate_json(contributors)
        print("✅ Leaderboard updated successfully!")
        return 0
        
    except requests.exceptions.RequestException as e:
        print(f"❌ GitHub API Error: {e}")
        print("Check your GITHUB_TOKEN and network connection")
        return 1
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    exit(main())

