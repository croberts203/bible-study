# Bible Sources

A Bible study web app and landing page:

- **`site/index.html`**: the public webpage
- **`site/app/`**: the app (installable on Android and iPhone from the browser, and works offline for chapters you've read)

## What the app does

The tabs are Read, Study (the research tools), Search, Plans, Saved and More. On phones they sit at the bottom like a normal app. First-time users get a short welcome, and you can swipe to change chapter.

- **Translations:** about 35 freely licensed Bibles in 20 languages. English: KJV, BSB, LSV, ASV, WEB, JPS Tanakh 1917, Masoretic English Tanakh, Webster, Geneva, Douay-Rheims. Plus the Aleppo Codex (Hebrew), the Textus Receptus (Greek) and the Latin Vulgate, and Arabic, Chinese, Czech, Dutch, Esperanto, French, German, Hungarian, Italian, Polish, Portuguese, Romanian, Russian, Swedish, Ukrainian and Vietnamese. You choose separately for the Old and New Testament, and any number show side by side.
- **Hebrew in its historical scripts:** switch the Hebrew between Paleo-Hebrew (First Temple era), consonants only (as in the Dead Sea Scrolls), vowels only, and the full Masoretic text.
- **Listen:** the full chapter in Hebrew or Greek, read aloud with the verse lit up as it's read. Modern Hebrew and modern Greek use the phone's own voices. Ancient pronunciation (Biblical Hebrew, Erasmian Greek) is a reconstruction read by a Spanish voice, for its clear vowels.
- **Explanations:** verse-by-verse context notes as footnotes, plus an introduction to each chapter. The default is the Tyndale Open Study Notes; you can switch to Keil & Delitzsch (Hebrew scholarship on the Old Testament), John Gill (Jewish and rabbinic background), Jamieson-Fausset-Brown, Matthew Henry, Adam Clarke or John Calvin. All come from the HelloAO Free Use Bible API.
- **Footnotes:** small letters in the text open notes. Key Hebrew and Greek words (YHWH, nephesh, ḥesed, Sheol, aiōnios…) get what the original means, its ancient setting, and the scholars who've written on it. History checks, archaeology, textual differences, contradictions and hard passages are footnoted too.
- **History:** a timeline with traditional and scholarly dates, background for all 66 books, 22 archaeological finds tied to passages, and 39 biblical claims rated against the historical record (confirmed / partly / debated / no evidence / conflicts).
- **Topic:** type any subject and the app gathers the Hebrew and Greek words for it and every verse that uses them, plus a text search in any translation and language. Verses are sorted into "affirms" and "negates" (negation detected in the Hebrew and Greek as well as the translation), and the closest pairs are offered as possible contradictions.

- **Read:** English (KJV, ASV, WEB, Geneva) beside the Hebrew OT and Greek NT, with English glosses under each word, plus the Septuagint in Greek and English. Septuagint psalm numbers are converted automatically.
- **Tap a word:** see its transliteration, grammar in plain English, Strong's number, lexicon entry, and every verse that uses it. Greek words that are missing from some editions (e.g. not in the Textus Receptus) are flagged.
- **Tap a verse number:** cross references (OpenBible.info, ranked by votes), highlight, bookmark, note, copy.
- **Differences:** a cross-section table of places where the Hebrew (MT), the Septuagint and New Testament quotations differ. Each entry has a factual summary, Dead Sea Scroll evidence where relevant, and the actual texts. You can record your own verdict on each one. Entries live in `site/differences.json`, so you can add more.
- **Hebrew ↔ Septuagint highlighting:** every Old Testament verse is compared automatically, with words only in the Hebrew shown in orange and words only in the Septuagint in green. Each verse gets a rating (major or smaller difference, not in the Septuagint), and Septuagint-only verses are listed. "Scan whole book" ranks every difference in a book. The comparison runs through two literal English translations (KJV from the Hebrew, Brenton from the Greek), because the Septuagint data isn't word-tagged, so a few highlights are only word choices.
- **Contradictions:** 33 passages that appear to conflict (Samuel/Kings vs Chronicles numbers, Gospel parallels, Genesis, Acts). Each shows the passages side by side with the differing words highlighted, plus common explanations and manuscript evidence, and you can record your verdict. Entries live in `site/contradictions.json`.
- **Hard passages:** 53 entries in seven groups: sexual violence, mass killing, violence against children and child sacrifice, slavery, harsh laws, treatment of women, and texts later used to justify harm. Each says what happens without graphic detail, whether the text commands, approves, condemns or only reports it, and how readers interpret it. Verses are marked in red in the reader, with a chapter warning; a toggle turns this off. Cross references into them are flagged too. Entries live in `site/hard-passages.json`.
- **Cross-reference problems:** each cross reference is checked and flagged if it's a weak link (few votes), touches a known difference or contradiction, lands where the Septuagint differs or is missing, or points to a verse that doesn't exist in the chosen translation. "Compare wording" highlights how the two passages differ.
- **Search:** words, phrases in "quotes", references (`John 3:16`), or Strong's numbers (`H7225`, `G26`).
- **Reading plans:** six built-in plans with progress tracking.
- **Saved:** notes, bookmarks, highlights, verdicts, and backup/restore.
- **Sync:** optional sign-in with Supabase so your data follows you across devices.

## Setup (one time)

### 1. Put it on GitHub

1. Create a new repository, for example `bible-study`.
2. Upload everything in this folder, including the hidden `.github` folder. With git:
   `git init && git add . && git commit -m "Bible Sources" && git branch -M main && git remote add origin https://github.com/<you>/bible-study.git && git push -u origin main`
3. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
4. Go to **Actions → Build data and deploy → Run workflow**. The first run downloads the Bible data (Hebrew, Greek, Septuagint, lexicons, cross references), converts it, and publishes the site. It takes a few minutes.
5. The site will be at `https://<you>.github.io/bible-study/`, with the app at `/app/`.

**Check the first build.** Open the run log and look at the "Show build summary" step. It lists what was built and any warnings. If a source failed (for example, a file got renamed upstream), the site still deploys without that feature, and you'll see the warning there and on the app's About page.

### 2. Custom domain (optional)

Add a `CNAME` file inside `site/` containing your domain, and point the domain's DNS at GitHub Pages. This is the same setup as fishforecast.net.

### 3. Sync across devices (optional)

1. In Supabase, open the SQL editor and run `supabase/schema.sql`. It creates one `user_data` table protected by row-level security.
2. Go to **Authentication → URL Configuration** and add your site URL (e.g. `https://<you>.github.io/bible-study/app/`) to the Redirect URLs.
3. Put your project URL and anon (publishable) key in `site/app/config.js`, then commit.

Without step 3, everything is saved in the browser only. Saved → Download backup lets you move it.

## Testing locally without downloading data

```
python scripts/build_data.py --fixtures tests/fixtures --out site/data
cd site && python -m http.server 8000     # open http://localhost:8000/app/
```

The fixtures are tiny placeholder texts used to check that the parsers and the app work.

## Data sources and licenses

| Data | Source | License |
|---|---|---|
| Hebrew OT (TAHOT) and Greek NT (TAGNT), word-tagged; brief lexicons (TBESH/TBESG) | STEPBible.org / Tyndale House Cambridge | CC BY 4.0 (attribution shown in app) |
| Cross references | OpenBible.info (from the Treasury of Scripture Knowledge) | CC BY |
| Septuagint Greek and English | Brenton; Greek Orthodox text; Updated Brenton (via eBible.org) | Public domain |
| Hebrew Bible | Westminster Leningrad Codex (eBible.org), Aleppo Codex (midvash) | Public domain |
| Explanations and commentaries | Tyndale Open Study Notes (CC BY-SA 4.0) and public-domain commentaries, via bible.helloao.org | As listed in the app |
| KJV, ASV, WEB, Geneva 1599 | midvash/bible-data | Public domain |
| Textual differences and contradictions | Written for this app (`site/differences.json`, `site/contradictions.json`, `site/hard-passages.json`) | Yours |

Licensed modern translations (NIV, ESV, NASB) can't be bundled. They would need a publisher license or an API key.
