# question-paper-repo

Archive of question papers and exercise sheets from IISER Mohali courses. Collected by students over several years. Expect mixed quality (some scans aren’t OCR’d; some files aren’t PDFs).

For an older archive, see the [course files mirror](https://iiserm.github.io/course_files/).
For more resources, Studocu hosts additional material: [IISER Mohali on Studocu](https://www.studocu.com/in/institution/indian-institute-of-science-education-and-research-mohali/30483).

---

## What’s here

* Course-wise folders containing past quizzes, minors, majors, endsems, and exercise sheets.
* Formats: PDF (preferred), images (PNG/JPG), office docs (DOCX), and the occasional ZIP.

---

## View and download

**On GitHub (web):**

* Click a file to preview (PDFs/images render in-browser; DOCX requires download).
* To download a single file: open it → **Download raw**.
* To get the whole repository: **Code** → **Download ZIP**.
* Want only a subfolder? Use Git (recommended) or sparse checkout (below).

**With Git (keeps you up to date):**

```bash
# Clone everything
git clone https://github.com/iiserm/question-paper-repo.git
cd question-paper-repo

# Pull updates later
git pull
```

**Sparse checkout (download just one course folder):**

```bash
git clone --filter=blob:none https://github.com/iiserm/question-paper-repo.git
cd question-paper-repo
git sparse-checkout init --cone
git sparse-checkout set <course_code_or/path>
git pull
```

**Large files / scans:**

* Files >50 MB must be tracked with Git LFS. If you see LFS pointers:

```bash
git lfs install
git lfs pull
```

---

## Contribute

Pull requests welcome. Keep it simple, consistent, and legal.

**1) Fork → branch → commit → PR**

```bash
# Fork on GitHub, then:
git clone https://github.com/iiserm/question-paper-repo.git
cd question-paper-repo
git checkout -b add-<course>-<year>
# add files under the correct folder (see structure below)
git add .
git commit -m "PHY403: Atomic and Molecular Physics (2025)"
git push -u origin HEAD
# Open a Pull Request on GitHub
```

**2) Where to put files (structure):**

```
<SUBJECT>/<COURSE_CODE>/<YEAR>/<your-file.pdf>
```

**Examples**

```
Physics/101/2024/Quiz 3.pdf
HSS/604/2022/Midsem I.jpeg
```

**3) File rules**

* Prefer PDF. If you upload images/DOCX, convert to PDF when possible.
* 300 dpi or better, cropped, de-skewed, legible. Avoid >100 MB per file; use LFS if >50 MB.
* Remove personal identifiers (names/roll numbers) unless required by the paper itself.

**4) Commit message format**

```
<COURSE_CODE>: <content> <year>
# e.g., "PHY120: Endsem 2023"
```

**5) PR checklist (Read before opening)**

* [ ] Files in correct folders and named correctly.
* [ ] Viewable PDF (opens on GitHub) or clear reason otherwise.
* [ ] OCR’d if possible (searchable text).
* [ ] No personal data.
* [ ] LFS used for large files.

**6) Can’t contribute via PR?**
[Open an Issue with](https://github.com/IISERM/question-paper-repo/issues/new): course code, year/semester, exam type, and a link to the files (drive link). Maintainers will ingest.

---

## Request fixes or removals

[Open an Issue](https://github.com/IISERM/question-paper-repo/issues/new) for:

* Broken links/files, unreadable scans, wrong metadata.
* Takedown requests (with justification).
  Or contact the repo owners via the IISER-M GitHub organization.

---

## Notes

* Quality varies; some scans are rough. Use OCR tools to improve search.
* This is a student-run archive intended for learning and exam prep. Use at your own risk.

---
