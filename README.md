# QPR (Question Paper Repo)

https://github.com/user-attachments/assets/e4f24335-c6b0-49a4-a5f0-71db0b4f495b

An archive of question papers and exercise sheets from IISER Mohali courses, collected by students over several years. Quality varies—some scans aren't OCR'd, and some files aren't PDFs.

## Access the Website

**Always prefer using the website** for viewing and uploading files. Git methods are for advanced users who want to keep a local copy or contribute via CLI.

**Website:** https://iiserm.github.io/question-paper-repo/

### Additional Resources

- For an older archive, see the [course files mirror](https://iiserm.github.io/course_files/)
- For more materials, check [IISER Mohali on Studocu](https://www.studocu.com/in/institution/indian-institute-of-science-education-and-research-mohali/30483)

---

## What's Here

Course-wise folders containing past quizzes, minors, majors, endsems, and exercise sheets.

**Formats:** PDF (preferred), images (PNG/JPG), office docs (DOCX), and occasional ZIP files.

---

## RULES(!!!)
- **DO NOT UPLOAD ANYTHING THAT IS COPYRIGHTED**
- **Do not upload your personal notes/work** unless they are the solutions for the exercises, assignments, or exam papers.

## View and Download

### On GitHub (Web)

- Click a file to preview (PDFs and images render in-browser; DOCX requires download)
- **Download a single file:** Open it → click **Download raw**
- **Download the whole repository:** Click **Code** → **Download ZIP**
- **Want only a subfolder?** Use Git (recommended) or sparse checkout (see below)

### With Git (Recommended)

Keeps you up to date with the latest papers:

```bash
# Clone everything
git clone https://github.com/iiserm/question-paper-repo.git
cd question-paper-repo

# Pull updates later
git pull
```

### Sparse Checkout (One Course Folder Only)

```bash
git clone --filter=blob:none https://github.com/iiserm/question-paper-repo.git
cd question-paper-repo
git sparse-checkout init --cone
git sparse-checkout set <course_code_or/path>
git pull
```

### Large Files / Scans

Files larger than 50 MB are tracked with Git LFS. If you see LFS pointers instead of actual files:

```bash
git lfs install
git lfs pull
```

---

## Contribute

Pull requests welcome. Keep it simple, consistent, and legal.

### Web Method

#### 1) Fork the Repository

<img width="1281" height="170" alt="Screenshot 2025-11-13 121043" src="https://github.com/user-attachments/assets/16ed61cf-c451-47d2-bfa0-dbd8c2c57047" />

Click the **Fork** button to create a copy of the repository in your account so you can make edits.

#### 2) Add Files

<img width="1889" height="433" alt="image" src="https://github.com/user-attachments/assets/3e0ad01e-883f-4b80-a925-9f01e70050cb" />

- Navigate to your desired folder and click **Add files**
- After uploading, click **Commit changes** (the green button)
- Optionally add a title and description for your files

#### 3) Create a Pull Request

<img width="950" height="409" alt="Screenshot 2025-11-13 121745" src="https://github.com/user-attachments/assets/934dbeba-4f91-49f1-a899-0515617b67d3" />

After a successful commit, you'll see a **Contribute** option. Click it and select **Open a Pull Request**.

This creates a request for the maintainers to review your changes and merge them into the original repository.

Now sit back, relax, and wait for the review!

### CLI Method

#### 1) Fork → Branch → Commit → PR

```bash
# Fork on GitHub, then clone your fork:
git clone https://github.com/YOUR_USERNAME/question-paper-repo.git
cd question-paper-repo
git checkout -b add-<course>-<year>

# Add files under the correct folder (see structure below)
git add .
git commit -m "PHY403: Atomic and Molecular Physics (2025)"
git push -u origin HEAD

# Open a Pull Request on GitHub
```

#### 2) File Structure

```
<SUBJECT>/<COURSE_CODE>/<YEAR>/<your-file.pdf>
```

**Examples:**

```
Physics/101/2024/Quiz 3.pdf
HSS/604/2022/Midsem I.jpeg
```

#### 3) File Guidelines

- **Prefer PDF.** Convert images/DOCX to PDF when possible
- **Quality:** 300 dpi or better, cropped, de-skewed, and legible
- **Size:** Avoid files larger than 100 MB; use LFS for files over 50 MB
- **Privacy:** Remove personal identifiers (names/roll numbers) unless required by the paper

#### 4) Commit Message Format

```
<COURSE_CODE>: <content> <year>
```

Example: `PHY120: Endsem 2023`

#### 5) Pull Request Checklist

Before opening a PR, ensure:

- [ ] Files are in correct folders and named correctly
- [ ] PDF is viewable (opens on GitHub) or clear reason otherwise
- [ ] OCR'd if possible (searchable text)
- [ ] No personal data included
- [ ] LFS used for large files

#### 6) Alternative Contribution Method

Can't contribute via PR? [Open an Issue](https://github.com/IISERM/question-paper-repo/issues/new) with:

- Course code
- Year/semester
- Exam type
- Link to files (e.g., Google Drive)

Maintainers will add the files for you.

---

## Request Fixes or Removals

[Open an Issue](https://github.com/IISERM/question-paper-repo/issues/new) for:

- Broken links/files, unreadable scans, or wrong metadata
- Takedown requests (with justification)

Or contact the repository owners via the IISER-M GitHub organization.

---

## Important Notes

- **Quality varies**—some scans are rough. Use OCR tools to improve searchability
- This is a student-run archive intended for learning and exam preparation
- Use at your own risk

---

## 🏆 Contributor Leaderboard

Top contributors based on commit count:

| Rank | Contributor | Commits |
|------|-------------|--------:|
| 🥇 | Manu A Sankaran | 127 |
| 🥈 | Jasmeen Kaur | 108 |
| 🥉 | HARSH VARDHAN SHRESHTH | 99 |
| 4 | SASHVATH KRISHNAN S | 70 |
| 5 | MANVENDRA SINGH | 55 |

*Last updated: 2026-04-16 13:35:02 UTC*

