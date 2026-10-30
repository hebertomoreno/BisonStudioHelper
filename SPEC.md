# Finisher — Ableton project tracker (Electron)

Desktop app for finishing Ableton Live projects. It reads and writes the user's songs folders. The goal is to counter jumping between projects: a few chosen songs stay pinned at the top, and every other song is visible but ranked below them.

Target: macOS. Stack: Electron + Vite + React + TypeScript. Main process does all filesystem work; renderer talks to it over a typed IPC bridge (`contextBridge`, `contextIsolation: true`, no `nodeIntegration`).

---

## 0. Current folder layout (surveyed 2026-10-25)

The design below is based on what is actually on disk. Fixture tests should reproduce these cases.

**Documents root: `~/Documents/Songs`** (internal APFS drive)
- 50 projects sit directly in the root (`Earth Project/`). About 20 sit one level down inside a **wrapper folder** named after the song (`Valid Reasons/ValidReasons Project/`), and a few deeper (`Pure Conviction/DR-05/Pure Conviction/`).
- Wrapper folders often hold the song's `Bounces/` folder beside the project instead of inside it (`Two Steps Uniradio/Bounces/`).
- Project folder names do not always end in " Project" (`Pure Conviction/`).
- Some top-level folders are not songs and are excluded from scanning:
  - `Samples/`: the user's sample library (sample packs, some containing their own Ableton projects). A samples browser is planned for later (section 12).
  - `_Organized_By_Year/` and `_Organized_By_Year_Fixed/`: symlinks to projects, some now dangling because the target moved to Feather.
  - `MaxForLive/`: third-party Ableton content, not the user's.
  - `Exported Songs (2019-2020)/` and `Nikolas Murdock Demo 2021/`: old finished audio, no projects.
- `BRPage Sounds/` (sound design) and `NewlyRediscovered/` hold projects and are scanned like any other folder.
- Projects hold many `.als` versions (Massive Project: 8, Earth Project: 6), plus `Backup/`, `Samples/`, and often a 0-byte `Icon\r` file (custom folder icon).
- Exports sit in folders named `Bounces`, `Exported Files`, `ExportedFiles`, `ExportedFIles`, `Exported FIles`, or loose in the project root (`Massive Project/Massive.mp3`). Some export folders contain a stems subfolder (`Exported Files/StemsForMixing/`). Formats seen: wav, mp3, m4a. Live writes `.asd` analysis files next to audio.
- Sets reference samples in the project's `Samples/` folder, in `~/Documents/Songs/Samples/`, on the Desktop, and in the Core Library.
- No `.finisher.json` exists yet.

**Feather root: `/Volumes/Feather/Songs`** (exFAT, USB, 79 GB free, 7.7% of the drive)
- Songs sit at `Projects/<Folder>/<Song> Project/`. One project is loose at `Songs/Bouncy1 Project/`.
- The first-level folders under `Projects/` are `Covers`, `Emi Folder`, `Filosofolk`, `Hiphop beats`, `Instrumental`, `Monoxido`, `No Assigned Project but Promising`, `Not that promising`, `Old Stuff`, `ReallyHappy`, `Reincarnation 2021`, `Rough Ideas`, `Singles`, `The Forest`, `Videos`, `YearOfTheBrownBear`. Of these, `YearOfTheBrownBear`, `Filosofolk`, `The Forest`, and `Emi Folder` are releases; the rest are plain folders for now. `Singles/` holds one subfolder per single (`Singles/GimmeTheSign/GimmeTheSignPostBobbing Project/`).
- Some folders are empty, created before their songs (`Monoxido/` is empty while `Monoxido Project` is still in Documents).
- `ReallyHappy/Ableton Sessions/Old Versions/` holds 10 older copies of songs that also exist elsewhere, up to 6 levels below the root. They are tracked as songs.
- Songs on Feather are actively worked on, the same as songs in Documents.
- macOS writes AppleDouble `._*` files and `.DS_Store` files on this drive.
- `/Volumes/Feather/Bounces/` is a loose bounce folder (39 files, including `.zip` and `.asd`).
- Ableton projects outside `Songs/` (`YaVistePodcast/`, `Videos/`) are out of scope.

**Same-name projects across roots.** GimmeTheSign exists in 3 places, and Valid Reasons, All Of You, Two Steps Forward, and Two Steps Uniradio each exist in Documents and in Feather's Old Versions. They stay separate songs; grouping versions of one song is out of scope for now.

**Bounce inbox: `~/Library/Mobile Documents/com~apple~CloudDocs/Shared Bounces`** (iCloud Drive)
- 25 audio files and 2 collaborator subfolders (`A Waterfall Ernie 160 BPM/`, `Losing All My Friends Ernie 63 BPM/`).
- Almost all files are evicted (dataless iCloud placeholders), so reading one triggers a download.
- Names use abbreviations (`LAMFV1.wav` = Losing All My Friends), Spanish dates (`19 Marzo 2026`, `6Nov2025`), BPM tokens (`63 BPM`), and camelCase (`AWaterfallHornsComplete6Nov2025.m4a`).

**Ableton:** Live 12 Suite, sets saved by 12.4.3 to 12.4.6 (`<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.4.3">`).
- Core Library is inside the app bundle: `/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library`.
- User Library: `~/Music/Ableton/User Library`. Factory Packs: `~/Music/Ableton/Factory Packs`.

---

## 1. Core concepts

**Song** = one Ableton project folder, meaning a folder that contains an `Ableton Project Info/` subfolder and at least one `.als` file in its top level.

Every song is in one of three **lanes**:

| Lane | Purpose | Rules |
|---|---|---|
| **Focus** | Songs the user has committed to continuing. Pinned at the top. | Default cap: 3 (configurable). Adding a 4th prompts the user to pick one to move to Queue. Manual drag order. |
| **Queue** | Songs in rotation that are not in Focus. | Sorted by last worked (most recent first), by excitement, or manual order. The chosen sort is stored in app state. |
| **Shelf** | Parked songs and newly discovered projects. | Not shown in the main list. One action ("Bring to queue") moves a song to Queue; supports multi-select for bulk moves, since the first scan shelves every existing song. |

A song with no entry in `lanes` (fresh install, or a sidecar from another Mac) goes to Shelf.

Newly discovered songs carry a "New" tag until they leave the Shelf or the user opens their detail view. The very first scan (empty `songCache`) imports every existing song without the tag, so it only marks songs that appear later.

Separately, every song has a **status**:

`idea → demo → in production → mixing → finished`

Status can move forward or backward. Every change is recorded with a timestamp. Lane and status are independent (a "mixing" song can be on the Shelf).

---

## 2. Storage

Source of truth for per-song data is a sidecar file inside each project folder, so the data moves with the project:

```
<Song> Project/
  ├── Ableton Project Info/
  ├── Samples/
  ├── <Song>.als
  └── .finisher.json      ← written by this app
```

`.finisher.json`:

```json
{
  "schemaVersion": 1,
  "id": "uuid",
  "title": "Song name (defaults to folder name minus ' Project')",
  "aliases": ["LAMF"],
  "status": "demo",
  "statusHistory": [
    { "status": "idea", "at": "2026-09-01T18:22:00-06:00" },
    { "status": "demo", "at": "2026-10-12T21:05:00-06:00" }
  ],
  "excitement": 4,
  "excitementHistory": [
    { "value": 3, "at": "2026-09-01T18:22:00-06:00", "note": null },
    { "value": 4, "at": "2026-10-12T21:05:00-06:00", "note": "Chorus finally works" }
  ],
  "sessions": [
    {
      "id": "uuid",
      "startedAt": "2026-10-25T19:00:00-06:00",
      "endedAt":   "2026-10-25T21:10:00-06:00",
      "notes": "What happened this session",
      "next":  "What to work on next time"
    }
  ],
  "tasks": [
    { "id": "uuid", "text": "Fix kick/bass clash in chorus", "done": false, "createdAt": "...", "doneAt": null }
  ],
  "mainAls": null,
  "collect": {
    "lastCheckedAt": "...",
    "alsFile": "Song.als",
    "alsMtime": "...",
    "alsSize": 438726,
    "settingsHash": "hash of allowedExternalRoots",
    "state": "collected | not_collected | unknown",
    "externalFiles": ["/Users/.../Desktop/sample.wav"],
    "missingFiles": ["Samples/Recorded/take 3.wav"],
    "otherSets": [{ "file": "Song old.als", "state": "not_collected", "externalCount": 3 }]
  },
  "pinnedBounce": null,
  "linkedBounces": [{ "path": "/abs/path/to/file.mp3", "linkedAt": "..." }],
  "copiedBounces": [
    { "file": "Song v3.mp3", "copiedFrom": "/abs/inbox/Song v3.mp3", "sourceMtime": "...", "sourceSize": 6613440, "copiedAt": "..." }
  ]
}
```

- `mainAls`: filename of a user-pinned main set, relative to the project folder (so it survives moves). `null` = use the newest `.als`.
- `aliases`: extra names used by inbox matching (7b).
- The sidecar holds nothing about releases. Release membership lives in `releases.json` (8b), so moving, relinking or renaming a release never rewrites song folders.
- All timestamps are ISO 8601 with the local offset.

App-level state lives in `app.getPath('userData')/state.json`:

```json
{
  "schemaVersion": 1,
  "roots": [
    {
      "path": "/Users/<user>/Documents/Songs", "label": "Documents",
      "maxDepth": 6,
      "exclude": ["Samples", "_Organized_By_Year", "_Organized_By_Year_Fixed", "MaxForLive", "Exported Songs (2019-2020)", "Nikolas Murdock Demo 2021"]
    },
    {
      "path": "/Volumes/Feather/Songs", "label": "Feather",
      "maxDepth": 6,
      "foldersPath": "Projects",
      "exclude": []
    }
  ],
  "focusCap": 3,
  "lanes": { "<songId>": "focus | queue | shelf" },
  "order": { "focus": ["id", "id"], "queue": ["id"] },
  "queueSort": "lastWorked | excitement | manual",
  "abletonAppName": "Ableton Live 12 Suite",
  "allowedExternalRoots": [
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library",
    "/Users/<user>/Music/Ableton/User Library",
    "/Users/<user>/Music/Ableton/Factory Packs"
  ],
  "bounceFolderNames": ["Bounces", "Exported Files"],
  "inboxPaths": [
    "/Users/<user>/Library/Mobile Documents/com~apple~CloudDocs/Shared Bounces",
    "/Volumes/Feather/Bounces"
  ],
  "inbox": { "ignored": ["/abs/path", "..."], "matchThreshold": 60 },
  "sessionGapHours": 3,
  "progressWeights": { "idea": 0, "demo": 0.25, "in production": 0.55, "mixing": 0.8, "finished": 1 },
  "staleness": { "amberDays": 7, "redDays": 21 },
  "excitementScale": [{ "value": 1, "emoji": "😐", "label": "Not feeling it" }],
  "savedFilters": [{ "name": "Demos I'm excited about", "filter": { "status": ["demo"], "excitementMin": 4 } }],
  "activeSession": { "songId": "...", "sessionId": "...", "startedAt": "..." },
  "songCache": {
    "<songId>": {
      "path": "/abs/path/Song Project", "rootPath": "/Volumes/Feather/Songs", "folder": "Rough Ideas",
      "title": "...", "status": "demo", "excitement": 4, "latestNext": "...",
      "lastWorkedAt": "...", "collectState": "collected", "seenAt": "...",
      "notFound": false
    }
  },
  "songFlags": { "<songId>": { "new": true, "duplicateOf": "Earth" } },
  "pendingSidecarEdits": [{ "songId": "...", "op": "renameRelease", "from": "Old", "to": "New" }]
}
```

The values above are the defaults for this user's machine (section 0); `<user>` is filled in at runtime.

- `songCache` is a read-only copy of each song's display data, refreshed on every scan. It is what the app shows for songs whose drive is not mounted, since their sidecar is unreadable then. `notFound` is set when the drive was mounted but the folder was missing from the last scan.
- `songFlags`: the "New" and "Duplicate of" tags (sections 1 and 3).
- `pendingSidecarEdits`: sidecar changes that could not be written because the drive was unmounted. They are applied when the drive mounts. (Releases no longer need this, since they are not stored in sidecars.)

The release database lives in its own file, `app.getPath('userData')/releases.json` (section 8b):

```json
{
  "schemaVersion": 1,
  "releases": [
    {
      "id": "uuid",
      "name": "Filosofolk",
      "type": "single | EP | album | other",
      "released": false,
      "targetDate": "2027-03-01",
      "art": "uuid.png",
      "folder": { "rootPath": "/Volumes/Feather/Songs", "path": "Projects/Filosofolk" },
      "added": ["<songId from outside the folder>"],
      "excluded": ["<songId inside the folder that is not on the release>"],
      "plannedTracks": null,
      "order": ["songId", "songId"],
      "createdAt": "..."
    }
  ]
}
```

It is seeded with `YearOfTheBrownBear`, `Filosofolk`, `The Forest` and `Emi Folder` (each pointing at `Projects/<name>` on Feather) and `Nikolas Murdock Demo 2021` (released, no folder). A `state.json` from before this file existed has its `releases`, `roots[].folders` and `tracklists` migrated into it once. If `releases.json` cannot be read, it is moved aside as `releases.json.corrupt-<ts>`, never overwritten.

Writes must be atomic: write to `.finisher.json.tmp`, then `fs.rename`. Never modify `.als` files.

The watcher must ignore the app's own sidecar writes: record the mtime and size of each write, and drop watcher events that match.

---

## 3. Scanning the songs folders

- The app supports several song roots (`roots` in app state): Documents and Feather. All roots work the same way; songs on Feather are fully usable while it is mounted.
- On launch and on demand, walk each mounted root for Ableton project folders:
  - Use `lstat` and never follow symlinks (the `_Organized_By_Year_Fixed/` symlinks would otherwise duplicate songs, and some are dangling).
  - Stop descending once a folder is identified as a project; projects are never nested inside projects.
  - Skip `Backup/`, `Samples/`, `Ableton Project Info/`, bounce folders, `._*` and `.DS_Store`, and everything in the root's `exclude` list. An entry without a slash matches a folder name at any depth (`MaxForLive`); an entry with a slash is a path relative to the root (`Projects/ReallyHappy/Ableton Sessions/Old Versions`).
  - A folder with `Ableton Project Info/` but no `.als` (e.g. only an `.alc` clip, like `SNIPS/A moment Project`) is not a song.
  - Default `maxDepth` is 6, since Feather has projects 6 levels below the root.
- A folder counts as a project regardless of its name (it does not have to end in " Project").
- A discovered folder without `.finisher.json` gets one created with `status: "idea"` and goes to the Shelf.
- **Wrapper folders.** A folder that is not a root or a first-level folder under `foldersPath` and contains exactly one project folder is that project's wrapper. The wrapper's bounce folders and loose audio files count as that song's bounces (7a). If a wrapper holds several projects (`How Can I Miss You/` holds two), its bounces are not assigned; they appear in the Inbox for matching (7b).
- Each song card shows where it lives: the root label ("Documents" or "Feather"), plus the folder name for songs under `foldersPath` (e.g. "Feather · Rough Ideas").
- Watch each mounted root with `chokidar`, and re-scan a root when its drive is mounted (watch `/Volumes`). The watcher ignores the same names the walk skips, plus `.finisher.json.tmp` and the app's own sidecar writes (section 2).
- If a folder with a known `id` is renamed or moved, match it by the `id` in its sidecar, not by path.
- **Duplicate ids.** Duplicating a project in Finder copies its sidecar. When two folders hold the same `id`, the one at the path in `songCache` keeps it. The other gets a new `id`, keeps the copied history, and is shelved with a "Duplicate of <title>" tag.
- A project can hold several `.als` files (versions). The **main set** is the most recently modified `.als` in the project root, excluding `Backup/`. The user can pin a different one (`mainAls`).
- Songs whose root is not mounted stay in every list, shown from `songCache` and marked "drive not connected".

---

## 4. "Last worked on"

`lastWorkedAt = max(mtime of main .als, endedAt of latest session)`

Display as relative time ("3 days ago") with the exact date on hover. Color the label by age, thresholds configurable (`staleness`): under 7 days neutral, 7–21 days amber, over 21 days red. Applies to Focus and Queue. For songs on an unmounted drive, use the cached value.

---

## 5. Detecting "Collect All and Save"

Do not rely on folder names alone. Parse the `.als`:

1. The `.als` is gzip-compressed XML. Decompress with `zlib.gunzipSync`.
2. Parse with a streaming or fast XML parser (`sax` or `fast-xml-parser`); sets can be large (up to ~5 MB compressed here).
3. Collect every `FileRef` that sits inside a `SampleRef`. Skip all other `FileRef`s: Live 12 also writes them for device presets (`AbletonDefaultPresetRef`), browser folders (e.g. `Path Value="/Users/<user>/Desktop"`), and plug-in presets with an empty `Path`. As a second filter, keep only paths with an audio extension (`.wav .aif .aiff .mp3 .m4a .flac .ogg`).
4. Resolve each `FileRef` to an absolute path. Each one has `<RelativePathType>`, `<RelativePath>`, and `<Path>` (absolute).
   - `RelativePathType 3` = relative to the project folder (e.g. `Samples/Recorded/x.wav`). Resolve against the **current** project folder, not `Path`, since `Path` keeps the old location after the user moves or copies a project folder (e.g. from Documents to Feather in Finder).
   - `RelativePathType 0` = no relative path (`RelativePath` is empty); use `Path`. Live writes this for samples dragged in from outside the project that were never collected (e.g. `~/Documents/NewSamples/...`).
   - Other types: use `Path`; if it does not exist, try `RelativePath` against the `.als` file's folder (type 1 is relative to it, e.g. `../../../Desktop`).
   - Sample refs in the checked sets use only types 0 and 3. Types 1, 5, and 6 appear only in non-sample refs (presets, browser folders), which step 3 skips. If a sample ref with another type turns up, fall back to `Path` and log it.
5. Classify each resolved file:
   - inside the project folder → collected
   - inside an `allowedExternalRoots` path (Core Library, User Library, Factory Packs; Collect All excludes factory content by default) → acceptable
   - anything else → external. This includes `~/Documents/Songs/Samples/` and other projects' folders.
6. `state = "collected"` when there are zero external files, otherwise `"not_collected"`, with the list stored in `externalFiles`. Referenced files that no longer exist on disk go in `missingFiles`. Missing files do not change `state`, since Collect All cannot fix them, but the badge shows them.
7. Re-run the check when the main `.als` changes (watcher event). Cache by `alsMtime` + `alsSize` + `settingsHash`, so a set is re-parsed only when the set or `allowedExternalRoots` changes.
8. Also check the other `.als` files in the project root (not `Backup/`) and store a summary in `otherSets`. Only the main set decides `state`.

Fixture tests, from Live 12.4 sets checked on 2026-10-25:

| Set | Sample refs | Expected |
|---|---|---|
| `Feather/.../Emi Folder/Ivana Tite Project/Ivana Tite Con Coro.als` (main set, user-confirmed Collect All and Save) | 38, all type 3 in `Samples/` (incl. `Samples/Processed/Bounce/`) | `collected` |
| `.../Ivana Tite Project/Ivana Tite.als` | 35, all type 3 in `Samples/Imported` and `Samples/Recorded` | `collected` |
| `.../Ivana Tite Project/Ivana Tite Con Coro Para Emi.als` | 27 type 3 in `Samples/`, 8 type 0 pointing at `~/Documents/NewSamples/` | `not_collected`, 8 external |
| `Documents/Songs/Dating Apps Project/Dating Apps V2.als` | 25, all type 3 in `Samples/` | `collected` |

The Ivana Tite project covers the main-set rule too: its newest `.als` is the main set and decides `state`, while `Con Coro Para Emi.als` shows up in `otherSets` as not collected. The same loop is referenced as type 0 from `~/Documents/NewSamples/` in one set and as type 3 from `Samples/Imported/` in another. Copy the fixtures into the test folder; don't read them from Feather at test time.

UI: a badge on each song — "Collected" / "N external files" / "N missing". Clicking it lists the files, including other sets that are not collected.

---

## 6. Opening Ableton

- "Open in Live" on a song: `shell.openPath(mainAlsPath)` (opens with the default app for `.als`).
- Fallback / explicit app: `execFile('open', ['-a', abletonAppName, mainAlsPath])` with `abletonAppName = "Ableton Live 12 Suite"`.
- "Open folder": `shell.showItemInFolder(mainAlsPath)`.
- "Open in Live" is the only way to start a session (see 7); there is no separate Start session button.
- Disabled while the song's drive is not mounted.

---

## 7. Sessions and notes

- **Open in Live** starts a session: records `startedAt`, opens the set in Live, shows a running timer on the song card. Only one active session at a time; opening another song prompts to end the current one.
- The active session is stored in `state.json` (`activeSession`) as soon as it starts, and written to the sidecar when it ends.
- **End session**: modal with two fields: "What I did today" (`notes`) and "Next time" (`next`). Saves to the sidecar.
- The latest `next` is shown on the song card, so the list answers "what was I going to do on this?" without opening the song.
- If the app quits during a session, ask on next launch whether to end it at the last `.als` save time (or at now, if the set was not saved after `startedAt`).
- Song detail view shows the session log in reverse chronological order.

---

## 7a. Bounces and preview

No export automation for now. The user exports from Live manually; the app reads what is there.

**Detection**
- **Bounce folders** are subfolders of the project folder, or of its wrapper folder (section 3), whose name matches an entry in `bounceFolderNames` (default `["Bounces", "Exported Files"]`, configurable). Matching ignores case and spaces, so `ExportedFiles`, `ExportedFIles`, and `Exported FIles` all match.
- Loose audio files in the project root (`Massive.mp3`) and in a single-project wrapper also count as bounces, labeled "in project folder".
- Read the top level of each bounce folder only; subfolders are usually stems (`StemsForMixing/`) and are ignored.
- Accepted formats: `.mp3`, `.m4a`, `.wav`, `.flac`. `.aif`/`.aiff` are listed but marked "can't preview" (Chromium cannot play them). Ignore `.asd`, `._*`, `.zip`, and everything else.
- Group files by basename: `Song v3.mp3` and `Song v3.wav` are one **bounce** with two formats.
- Bounce date = file mtime (of the newest file in the group).
- The watcher (section 3) also watches bounce folders so new exports appear without a rescan. Ignore a file until its size has stopped changing for 2 seconds, since Live may still be writing it.
- Bounces are derived from the folder on each scan and not stored in `.finisher.json`. Only `pinnedBounce` (optional, user-set basename) is stored in the sidecar.

**Playback**
- Use the HTML `<audio>` element in the renderer. Chromium plays MP3, AAC (m4a), WAV, and FLAC natively, so no playback library is needed.
- When a bounce has several formats, play in this order: MP3, M4A, FLAC, WAV.
- Serve files to the renderer through a custom protocol registered in main (`protocol.handle('bounce', ...)`), restricted to paths inside known bounce folders. Resolve the requested path with `fs.realpath` before the allowlist check, so symlinks and `..` cannot escape it. Do not enable `file://` access or `webSecurity: false`.
- Support range requests in the protocol handler so seeking works.
- One player for the whole app: starting a preview on another song stops the current one.

**UI**
- Song card: play/pause button for the pinned bounce, or the newest bounce if none is pinned. Hidden when the song has no bounces.
- Song card shows bounce date relative ("bounced 2 days ago").
- Song detail: list of all bounces, newest first, with date, formats available, play button, and "Pin as preview".
- Player bar at the bottom of the window: song title, bounce name, seek bar, elapsed/total time.
- Waveform display (`wavesurfer.js`) is optional, after the basic player works.
- Filter: "has bounce" / "no bounce" in Main list and Shelf.

### 7b. Bounce inbox

The user keeps catch-all bounce folders outside the songs folders: `Shared Bounces` on iCloud Drive, and `/Volumes/Feather/Bounces`. Files there are not tied to a song. The app detects them, suggests the song each one belongs to, and lets the user copy, move, or link each one to that song.

**Settings**
- `inboxPaths`: list of catch-all folders (feature is off when empty).
- Watched like the songs folders. Formats and the 2-second size-stable rule are the same as 7a.
- **Items**: each top-level audio file is an item (MP3/WAV pairs grouped by basename). Each first-level subfolder is also one item (collaborator stem folders like `A Waterfall Ernie 160 BPM/`), matched by the folder name and copied or linked as a whole.

**iCloud placeholders**
- Most files in `Shared Bounces` are evicted placeholders. Detect them with `stat` (the `SF_DATALESS` flag) and show a cloud icon.
- Matching uses only the name and `stat` data, so it never triggers a download.
- Play, copy, and move trigger the download. Show a "Downloading…" state and do not time out the request.
- The size-stable rule does not apply to placeholders, since their size is reported before the data is local.
- After a copy, verify the size against the downloaded original.

**Matching an item to a song**
1. Normalize the item name and every song's title, folder name, and `aliases`:
   - lowercase, remove the extension and a trailing " Project"
   - split camelCase and letter/digit boundaries (`AWaterfallHornsComplete6Nov2025` → `a waterfall horns complete 6 nov 2025`)
   - replace `_ - . !` with spaces
   - remove version tokens (`v3`, `v03`, `v1.0`, `ver 2`)
   - remove BPM tokens (`63 bpm`)
   - remove dates: ISO (`2026-10-25`), 6- and 8-digit numbers (`251025`, `300424`, `03022024`), and day + month name + year in English or Spanish (`19 marzo 2026`, `6 nov 2025`)
   - for item names only, remove common words (`bounce`, `mix`, `master`, `mastered`, `demo`, `final`, `export`, `rough`, `updated`, `complete`). Song titles keep these words, so "Master of None" stays intact.
2. Score each song with a fuzzy string match on the normalized names (token-set similarity, e.g. `fuzzball`'s `token_set_ratio`). Also compare against `aliases`.
3. Add a small bonus when the file's mtime falls within 2 hours after a save of that song's main `.als` or during a logged session.
4. Show the top 3 candidates with scores. If the best score is below `matchThreshold` (default 60/100), mark the item as unmatched and require a manual pick.
5. When the user picks a song manually for an unmatched item, offer to save the item's leading token as an alias (e.g. `LAMF` for Losing All My Friends), so the next export matches.

**Actions per item**
- **Copy to song** (default, primary button): copy into the song's `Bounces/` folder, creating it if needed, and leave the original in the inbox so it keeps syncing. Verify the copy's size matches the original. Never overwrite: if the name exists, append ` (2)`. Record the item in `copiedBounces` with the original's path, mtime, and size.
- **Move to song**: move into the song's `Bounces/` folder, creating it if needed. Use `fs.rename` on the same volume; across volumes (always the case for iCloud → Feather and Feather → Documents), copy, verify size, then remove the original. Never overwrite: if the name exists, append ` (2)`. The UI states that a moved file leaves the synced folder.
- **Link to song**: leave the item in place and record it in the song's `linkedBounces`. The file keeps syncing.
- **Pick another song**: search box over all songs, including Shelf and songs on unmounted drives. Copy and move need the song's drive mounted; link does not.
- **Ignore**: hide the item from the inbox. Stored in app state, reversible from Settings.

Decisions are never applied automatically, even for high scores. The user confirms each one, with an option to apply the suggested match to all selected items at once.

**Storage**
- Linked bounces are listed and played the same way as files in the song's own bounce folders, marked with a "linked" label.
- If a linked file no longer exists, show it as missing with options to relink or remove the link.
- If an inbox original listed in `copiedBounces` is later replaced (its mtime or size differs from `sourceMtime`/`sourceSize`), it reappears in the inbox as an update to that song.
- An item already copied to, linked to, or moved into a song, or ignored, does not appear in the inbox.

**Protocol allowlist**: the `bounce://` handler (7a) also allows `inboxPaths` and any path in a song's `linkedBounces`.

**UI**: an **Inbox** view with a count badge in the sidebar. Each row: name, date, formats, cloud icon if evicted, a play button (to identify the file by listening), the suggested song with its score, and the actions above.

---

## 7c. Work sessions from saves (step 5)

Sessions are also counted without the user doing anything, from `.als` saves. This shows how much work has gone into a song, especially in long stages like mixing.

**Sources of saves**
- **Live's backups.** On every save, Live moves the previous version into the project's `Backup/` folder as `<Set name> [YYYY-MM-DD HHMMSS].als`, keeping the last 10 per set. Checked on WeAreNotToBlame: the name is the time of the *new* save (when the backup was made), and the backup file's mtime is the time of the *previous* save. So each backup yields two saves. Only names and mtimes are read; these files are never opened or changed.
- **Current `.als` mtimes**: each set's latest save.
- **Going forward**, every save triggers a watcher rescan (section 3), which picks up the set's new mtime and Live's new backup. This is the save log; no separate watcher hook is needed.
- **Bulk-copy guard.** File mtimes can come from copying, not working: several YearOfTheBrownBear sets carry the same 2026-07-09 mtime. Ignore a mtime-based save when more than 3 projects share the same mtime minute. Backup names and live watcher events are never ignored.
- **"Open in Live" sessions** (section 7) also count, so a session where the user listens or tweaks without saving still shows up.

**Storage.** Saves go in `app.getPath('userData')/activity.json`, keyed by song id. Nothing is written into project folders.

```json
{
  "schemaVersion": 1,
  "saves": {
    "<songId>": [
      { "at": "2026-10-08T23:41:15.000Z", "set": "WeAreNotToBlame", "source": "backup | mtime" }
    ]
  }
}
```

- Each scan merges the saves it sees into the log. Saves are deduplicated by set and time (within 2 seconds), since the same save shows up as a set mtime, then a backup name, then a backup mtime.
- The first scan imports all existing backups, so songs start with real history. Surveyed 2026-10-29: 24 of Feather's 89 projects already show 5 or more sessions (WeAreNotToBlame 11, A WATERFALL 10, Boxing2 8).
- Songs on an unmounted drive keep their history; only new saves wait for the drive.

**Sessions**
- Saves less than 3 hours apart (`sessionGapHours`, in state) form one session. Its span is from the first save to the last; one save alone is a session with no length.
- An explicit session (section 7) that overlaps an inferred one replaces it, keeping the inferred saves as detail. Explicit sessions carry notes and "next"; inferred ones don't.
- Approximate time = sum of session spans. Show it as "about 6 h", never more precise, since time before the first save in a session is unknown.

**Shown**
- Song card: "11 sessions · last 3 days ago".
- **Sessions in the current stage**: sessions since the song's latest `statusHistory` entry, e.g. "Mixing · 6 sessions over 5 weeks". The count starts again on each status change.
- Song detail: session list (date, number of saves, approximate length, notes if explicit) and sessions per status on the status timeline.
- Release (8b/8c): sessions this month across its songs, next to the progress bar, so a stuck release can be told apart from one that is moving.
- Sort and filter: "most sessions", "no session in N days".

**Limits.** Only saves and "Open in Live" are seen. Work done without saving, in a set not opened through the app, is invisible.

---

## 8. Status and history

- Status control on each card (dropdown or arrow buttons). Each change appends to `statusHistory`.
- Song detail shows a timeline: status, date, and days spent in each status.
- Board view: five columns, one per status, cards draggable between columns. Dragging a card changes status (and records history). The board shows Focus + Queue by default, with a toggle to include Shelf.
- Setting a Focus song to `finished` asks whether to move it out of Focus.
- Songs on an unmounted drive are read-only (status, excitement, tasks), since their sidecar cannot be written.

---

## 8a. Excitement

How promising the song feels, rated 1–5 and shown as an emoji. Independent of status and lane.

| Value | Emoji | Meaning |
|---|---|---|
| 1 | 😐 | Not feeling it |
| 2 | 🙂 | Has something |
| 3 | 😊 | Worth working on |
| 4 | 😃 | Excited about it |
| 5 | 🤩 | Top priority |

Emoji set and labels are configurable in Settings (`excitementScale`).

- `excitement` holds the current value; `null` means unrated. New songs start unrated.
- Every change appends to `excitementHistory` with a timestamp and an optional one-line note.
- Set it from the song card (click the emoji to open a 1–5 picker) or from song detail.
- The End session modal (section 7) includes an optional excitement picker, prefilled with the current value. Changing it there records a history entry; leaving it unchanged records nothing.
- Song detail shows excitement over time as a step chart alongside the status timeline, so you can see whether a demo gained or lost appeal.

**Querying:**
- Filter by excitement in Main list, Board, and Shelf: a multi-select of 1–5 plus "Unrated".
- Sort by excitement (high to low, then last worked) in Queue and Shelf.
- Combined filters work together, e.g. status = demo AND excitement ≥ 4 ("demos I'm excited about").
- Saved filters: the user can save a filter combination with a name and pick it from a dropdown (`savedFilters`).
- Unrated songs on the Shelf get a "Rate" prompt so the backlog of demos can be rated in one pass.

---

## 8b. Releases and folders

Releases and folders are separate things, and the link between them is kept in one place: the release database (`releases.json`, section 2).

- A **folder** is a place on disk. Each first-level folder under a root's `foldersPath` (Feather: `Projects/`) is a folder, e.g. `Rough Ideas/`. Folders are discovered by the scan and shown as a label on song cards. Folders know nothing about releases.
- A **release** is a record in the release database: name, type, released flag, prospective release date (`targetDate`), cover art, and optionally a pointer to one folder (`folder`: root path + path relative to the root).
- Song sidecars hold nothing about releases. Renaming, relinking or deleting a release only changes `releases.json`, works while Feather is unplugged, and never writes to a song folder.
- New folders found by the scan are plain folders. They are never turned into releases automatically.

**Membership.** A song is on a release when:
1. its project folder is under the release's `folder`, at any depth, and its id is not in `excluded`; or
2. its id is in `added` (songs from elsewhere, e.g. a Documents project that belongs on the album).

`excluded` is how sketches and old versions inside a release folder are kept off the release (YearOfTheBrownBear holds 14 projects, not all of them album tracks). Adding an excluded song back removes it from `excluded`. Songs are matched by sidecar id, so a project renamed inside the folder stays on the release; a project moved out of the folder leaves it unless it is in `added`.

A song can be on several releases (a single that is also on the album). Its card shows the folder release first.

**Folder pointer health.** When the release's root is mounted and the folder does not exist (renamed in Finder), the release shows "Folder not found" with a "Choose folder…" action to repoint it. Its folder members are then empty, but `added`, `excluded` and `order` are kept, so repointing restores everything.

Current setup (section 0): `YearOfTheBrownBear`, `Filosofolk`, `The Forest`, and `Emi Folder` point at their Feather folders. `Nikolas Murdock Demo 2021` is a released release with no folder.

**Releases**
- Fields: `name`, `type` (single / EP / album / other), `released` (checkbox: the release is out, so it is old), `targetDate` (optional, prospective release date), `art`.
- **Cover art**: one image per release. The user picks a JPEG, PNG, WebP or GIF; the app copies it into `userData/art/<uuid>.<ext>` and serves it through an `art://` protocol that only accepts those generated names. Release folders are never written. Replacing a cover deletes the old copy.
- Song cards show the first release's cover, or a colored placeholder with the release's (or song's) initials. Hovering the cover offers "Add cover" / "Change cover". A song on no release gets an "Add to release…" picker under the cover, which puts it in that release's `added`.
- Create, rename, repoint and delete releases in the Releases view. Deleting a release removes only its record and its art copy; folders and songs are untouched.
- Released releases are listed below unreleased ones, collapsed by default. Their songs are not hidden from the main lists, but can be filtered out with "Hide released".

**UI**
- Releases view, **Releases** tab: one row per release with cover, type, released checkbox, target date, folder (if any), song count, and the progress bar (8c). Opening a release lists its songs in tracklist order with status, excitement, collect badge, last bounce, and play button. Songs can be dragged to reorder (`order`), and each folder song has "Not on this release" (adds to `excluded`). An "Excluded" group at the bottom lists them with "Put back".
- Releases view, **Folders** tab: one row per folder with its root, song count, and the release pointing at it (if any), with "Make a release from this folder" or "Point a release here".
- Song detail shows the song's releases and lets the user add it to or take it off a release.
- Filter by release, by folder, and "Hide released" in Main list, Board, and Shelf.

## 8c. Release progress (planned)

The app's main job is showing how close a song, and a release, is to done. This section turns song statuses into a progress estimate for a release.

**Song progress.** Each status has a weight (`progressWeights` in state, editable in Settings). The user confirmed these as the starting values (mixing really is about 80% of the way) and may tune them once the app is in use:

| Status | Weight |
|---|---|
| idea | 0 |
| demo | 0.25 |
| in production | 0.55 |
| mixing | 0.8 |
| finished | 1.0 |

`finished` is set by hand and always counts as 1.0. There is no automatic check against bounces or saves.

**Release progress.**
- `progress = sum(song weights) / max(member count, plannedTracks)`. Each song weighs the same.
- `plannedTracks` (optional, on the release) covers tracks that don't exist yet: an EP planned at 5 songs with 3 projects reads "3 of 5 tracks exist", and the 2 missing slots count as 0. The count varies per release and changes over time, so it is set and edited where songs are added to a release (release detail, and the "Add to release…" flow), not fixed when the release is created. Unset means the member count is the plan.
- Shown as a percentage and a stacked bar with one segment per status (e.g. "2 finished, 1 mixing, 3 demo").

**Momentum and forecast.** From the members' `statusHistory`:
- Rebuild the release's progress on each day a member changed status, giving a progress-over-time line (drawn in the release detail).
- Velocity = progress gained in the last 6 weeks, per week.
- Forecast finish = today + (1 − progress) / velocity. With a `targetDate`, show "On track", "About N weeks behind", or "Ahead". With no status change in 6 weeks, show "Stalled since <date>" instead of a forecast. With fewer than 2 changes ever, show "Not enough history yet".
- This is a rough guide, labeled "estimate", never a promise.

**What's holding it back.** Under the bar, list up to three songs that cost the release the most: the lowest-weight songs first, then songs whose last-worked date is red (section 4). Each has "Move to Focus".

**Where it shows.**
- Releases view rows: percentage, stacked bar, forecast line.
- Release detail: the same, plus the progress-over-time line and the per-song list.
- Focus stage (built): a 20-cell pixel bar for the selected song (status pill, bar, percentage), and a small bar under the release name with the release's percentage and song count ("3 of 5 tracks" when `plannedTracks` is higher). Hovering the release bar shows the status breakdown.

**Offline.** `songCache` keeps each song's `statusHistory`, so releases on an unplugged Feather still show their progress (marked "as of <last scan>").

**Starting point.** Every existing song starts as `idea`, so every release reads 0% until statuses are set. The release detail has a quick status picker per song to make that first pass fast.

---

## 9. Views

1. **Main list** (default)
   - Focus section at top: large cards with title, location label (e.g. "Feather · Rough Ideas"), status, excitement, release tags, last worked, latest "next" note, collect badge, bounce play button, buttons: Open in Live, Move to Queue.
   - Queue section below: compact rows with the same data and actions Open in Live, Move to Focus, Move to Shelf.
   - Filters: status, excitement, release, folder, location (Documents / Feather), has/no bounce, hide released, saved filters.
2. **Board**: status columns (section 8), with the same filters.
3. **Shelf**: grid/list of shelved songs with search by title, the same filters, sort by excitement or last worked, multi-select, "Bring to queue" and "Bring to focus" buttons, and the "Rate" prompt for unrated songs. Newly discovered projects show a "New" tag; duplicates show "Duplicate of <title>".
4. **Song detail**: tasks checklist, session log, status timeline, excitement chart, release tags, bounces (own, wrapper, linked), collect report (including other sets), main `.als` picker.
5. **Releases**: Releases tab and Folders tab (section 8b), with progress (8c).
6. **Inbox**: bounce inbox (section 7b).
7. **Settings**: song roots (path, label, max depth, exclude list, folders path), bounce folder names, inbox paths, ignored inbox items, match threshold, focus cap, Live app name, allowed external roots, staleness thresholds, excitement scale.

---

## 10. Build order

1. Electron + Vite + React + TS scaffold, IPC bridge, settings with folder picker.
2. Scanner (symlinks, excludes, wrappers, duplicate ids) + sidecar read/write + `songCache` + watcher. Main list with lanes, drag reorder, location label. Basic Shelf view with multi-select "Bring to queue", since every discovered song starts there.
3. Open in Live (starts a session), open folder.
4. Sessions (end modal, notes, next), last-worked calculation.
4a. Bounce folder detection (name variants, wrappers, loose files), custom protocol, player bar (section 7a).
4b. Bounce inbox: iCloud placeholders, matching, copy/move/link/ignore, linked bounces, aliases (section 7b).
5. Status + history + board view. Excitement rating + history + filters/sort (section 8a). Work sessions from saves: backup import, save log, sessions, sessions in the current stage (section 7c). Built; song detail (timeline, session list, excitement chart) comes with the song detail view.
6. `.als` parser and collect detection, with fixture tests (section 5).
6a. Releases view: release database (done: `releases.json`, folder pointers, art), create/rename/repoint/delete, membership (exclude, add, order), Folders tab (section 8b).
6b. Release progress: weights, planned track count, progress bar, forecast, holding-back list (section 8c). Needs step 5 (statuses).
7. Full Shelf view: search, filters, Rate prompt.
8. Packaging with `electron-builder` for macOS.

## 11. Constraints

- Never write to, move, or rename `.als` files, samples, project folders, or release folders.
- The app writes only: `.finisher.json`, `Bounces/` folders, and audio copied or moved from an inbox into them when the user confirms (7b).
- All filesystem access stays in the main process.
- Never follow symlinks while scanning.
- The app must work with song roots on an external drive that may be unmounted: show the songs as unavailable (from `songCache`) rather than deleting state.

---

## 12. Later (out of scope for now)

- **Move to Feather.** A verified copy of a collected project from Documents to Feather, with the source sent to the Trash. On hold. Notes for when it comes back, from the survey in section 0:
  - Feather is exFAT, so the move is always a copy (`fs.rename` fails with `EXDEV`).
  - macOS adds `._*` files there; leave them, `.DS_Store`, and `Icon\r` out of the file comparison, and compare mtimes with a 2-second tolerance.
  - Check free space with a margin; Feather is at 7.7% free.
  - Ask the user to close the set in Live before re-running the collect check, since closing can save it.
  - Never merge into an existing destination.
- **Samples browser.** A visual way to browse `~/Documents/Songs/Samples/`, the user's sample library. Excluded from song scanning until then.
- **Versions of one song.** Grouping same-name projects (e.g. the three GimmeTheSign projects) as versions of one song.
- **Lanes on another Mac.** Lanes and order live in `state.json`, and releases in `releases.json`, on this Mac only.
