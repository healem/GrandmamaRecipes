# Grandmama's Recipes

Grandmama's recipe box as a mobile-friendly web app: browse, search, cook from, and scale 492 family recipes. No server, no database, no build tooling — plain HTML/CSS/JS that runs anywhere static files can be served.

## Layout

```
index.html, app.js, styles.css   the app (hash-routed single page)
sw.js, manifest.webmanifest      offline support / "Add to Home Screen"
icons/                           app icons
vendor/minisearch.js             the one dependency (client-side search, MIT)
data/recipes.json                generated — all recipes, parsed and normalised
data/tips.json                   generated — Maddy's kitchen hints
originals/                       the source text files (never edited by the build)
build/parse_recipes.py           converts originals/ -> data/
build/corrections.json           typo fixes applied during conversion
build/warnings.txt               generated — anything the parser wasn't sure about
```

## Rebuilding the data

Python 3.8+ with no extra packages:

```
python3 build/parse_recipes.py
```

That re-reads every `originals/*.txt`, applies `build/corrections.json`, and rewrites `data/recipes.json`, `data/tips.json` and `build/warnings.txt`. Run it after adding or editing a recipe file.

To add a recipe, drop a text file in `originals/` using the same layout as the others (title on line 4, `Recipe By`, `Serving Size`, `Categories`, the fixed-column ingredient table, directions, then the `- - - -` rule). To fix a typo, either edit the original or add an entry to `corrections.json`:

- `words` — whole-word, case-insensitive, case-preserving replacements everywhere (`"jalepeno": "jalapeno"`).
- `phrases` — exact substring replacements (`"chick roast": "chuck roast"`).
- `titles` — replace a whole title, keyed by the title exactly as it appears in the file.
- `categories` — override a recipe's categories, keyed by the *corrected* title.

## Deploying

The app uses only relative paths, so it works from a site root or any sub-folder.

**GitHub Pages:** push to `main`, then in the repository settings choose *Pages → Deploy from a branch → main, / (root)*. The site appears at `https://healem.github.io/GrandmamaRecipes/`.

**teamgogetmarried.com/Grandmama:** copy the whole repository (everything except `build/` is needed at runtime; `originals/` is only used by the "original file" links) into the `Grandmama` folder on the web server.

Offline support and Add-to-Home-Screen need HTTPS (GitHub Pages provides it). Over plain HTTP the app still works normally, it just won't cache for offline use.

## Using the app

- **Search** matches titles, ingredients, categories and cook names, with typo tolerance ("zuchini" finds zucchini).
- **Browse** by category, by cook, favorites, recently viewed, or the A–Z list.
- **Servings** — change the number on any recipe and every ingredient amount rescales, rounded to kitchen fractions; counted items (eggs, cans) round to halves and are flagged. "Tidy units" turns 12 tsp into ¼ cup and the like. Directions are never rewritten, so pan sizes and times still need a cook's judgement.
- **Cooking** — tap ingredients to check them off, tap a step to mark your place, "Keep screen on" stops the phone from sleeping, and Print gives a clean one-page version.
- **My notes** — free-text notes per recipe, saved in the browser on that device only.

## What the conversion does

The originals are MasterCook text exports. The parser reads the header fields, the fixed-column ingredient table (amount / unit / ingredient — preparation), the directions and the notes. It normalises 140-odd unit spellings to about 40, folds the "Maddy's X" categories into the shared ones, unifies the author spellings to two cooks (Elizabeth Powell and Madeline Healey), title-cases the all-caps titles, sentence-cases the handful of recipes typed in capitals, and splits directions into steps whether they were written as wrapped paragraphs or one line per step. The nutrition estimates in the source files are dropped.
