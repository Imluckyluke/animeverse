# Full unmatched-archive workflow

Matching an archive file, researching its reference, and publishing a ready
episode are separate outcomes. Never report a completed search or a reviewed
hold as a certified file assignment.

## Reference research

`tools/tg/archive_reference_research.py` researches the entire remaining scope
with bounded aliased AniList searches. Raw and canonical queries are independent;
pagination must finish before its results become eligible identity evidence.
Missing parsed titles also enter research via the original filename. This never
modifies source records or opens a Telegram session. Rate deadlines, completed
queries and partial pagination survive process restarts in the private cache.
`--research-base-names` also researches base names for explicit S1 labels, keeping
any remake year. This supplies review context only: it does not approve an S1
alias, erase a part marker, or cause a bare franchise name to certify a season.

The sole archive writer consumes completed references. The planner's batch limit
counts accepted title plans, not the first high-volume candidates: ambiguous
titles cannot starve verified titles farther down the inventory.

Completed primary responses are indexed across queries: an actual exact provider
name found while researching another title can be used after the file title's
own search is complete. This never imports third-party aliases or promotes a
partial query. Other versions found elsewhere in the cache are also included so
they strengthen, rather than bypass, remake/format conflicts.

`tools/tg/archive_alternate_reference_research.py` separately researches names
without an exact AniList counterpart through public MAL metadata exposed by
Jikan. Its independent cache and progress live only in `data/archive-full-match/`.
It completes pagination, respects rate deadlines, resumes partial queries and
retains broad/rejected searches as holds. It does **not** merge provider aliases,
change the primary identity cache or assign files. A matching search hit remains
a lead until its title, format, year, numbering and cross-provider IDs are checked.

When that public API is unavailable, `archive_offline_reference_review.py` can
inspect a SHA-256-verified public release of manami-project's
[anime-offline-database](https://github.com/manami-project/anime-offline-database).
Keep its release provenance, update date and ODbL/DbCL attribution. Its aggregated
aliases and linked provider IDs are research leads only, not authority to rewrite
provider synonyms, merge versions or assign files. Staleness and primary-reference
conflicts are explicit. Runtime snapshots/reports stay private and uncommitted.

`archive_provider_node_research.py` follows those report IDs to fetch actual
AniList primary nodes, with bounded ID batches, pagination proof, durable retry
deadlines and explicit missing-node holds. It stores both the snapshot's expected
facts and fresh provider responses in a **separate** private cache. It does not
merge an alias, modify the matching cache or make an assignment. Every alias or
version choice still needs its own primary/file evidence.
`primary_cache_with_nodes()` can stage only actual complete AniList response
fields for a separate read-only planner preview. It never copies snapshot names
into provider synonyms. The live matching cache is not changed by staging; a
separate metadata handoff preserves its rate deadline and existing entries.

## Filename recovery

`tools/tg/archive_recovery_preview.py` copies the live database read-only into
memory and uses the existing conservative filename/document guards. It emits a
private, per-file proposal list, never live database writes. The writer checks:

- The file is still copied and unassigned, and its exact source hash matches.
- Its original filename, existing episode/quality, and caption constraints agree.
- Document reuse has the same document ID, filename, size and certified target.
- The **current** identity planner independently certifies the recovered record.

Uncertified proposals are restored inside a savepoint. Existing assignments,
accepted download identities and per-file reviewed protections remain untouched.
Accepted recoveries keep the original parsed record and hash in `archiveRecovery`.
Only the sole writer applies these proposals; do not write live assignments from
a separate SQLite connection or start a second Telegram client.

## Evidence and remaining work

### Reviewed bounded batch, 2026-11-04

Complete cached primary responses and independent filename/caption inventories
were checked for these exact literal aliases (not a generic season-name rule):

| Archive label | Primary identity / MAL | Year / episodes | Files / archive-ID ceiling |
| --- | --- | --- | --- |
| `The Seven Deadly Sins(S2` | [99539](https://anilist.co/anime/99539) / 34577 | 2018 / 24 | 72 / 10954 |
| `The Seven Deadly Sins(S3` | [108928](https://anilist.co/anime/108928) / 39701 | 2019 / 24 | 72 / 11029 |
| `Ghost in the Shell-s2` | [801](https://anilist.co/anime/801) / 801 | 2004 / 26 | 78 / 43720 |
| `Rurouni Kenshin`, explicit filename `(2023)` only | [142877](https://anilist.co/anime/142877) / 50613 | 2023 / 24 | 72 / 55046 |

All four primary nodes are finished TV entries. The first two archive cohorts
explicitly carry S2/S3 and contain episodes 1–24 at 480p/720p/1080p, without
duplicate episode-quality pairs. Primary official titles are *Revival of the
Commandments* and *Imperial Wrath of the Gods*; the cached alternate titles also
explicitly label them second/third instalments. The Ghost cohort carries S2 in
its captions, agreeing with *Stand Alone Complex 2nd GIG*, episodes 1–26 at those
same three qualities. Its existing S1 page remains independent.

The Kenshin alias additionally requires the literal filename year 2023 for
every accepted record: episode bounds alone cannot distinguish the 1996 TV
series, the 2023 remake, its sequel or specials. The other 162 unmarked/mismatched
Kenshin records remain outside this 72-file batch. ID ceilings, MAL conflicts,
TV format, existing-page identity and all per-file guards remain enforced.
The pre-activation snapshot retains all source records and assignments. A
294-file planner preview is not by itself proof of application or publication.

A second independently checked batch covers 280 files, with seven rejects kept:

| Archive label | AniList / MAL | Year / TV total | Accepted / ceiling |
| --- | --- | --- | --- |
| `magi the labyrinth of magic - S2` | 18115 / 18115 | 2013 / 25 | 49 / 50117 |
| `Story Of The Alps` | 2546 / 2546 | 1983 / 48 | 48 / 104077 |
| `Classroom S2` | 145545 / 51096 | 2022 / 13 | 39 / 32088 |
| `The Ancient Magus'Bride` | 98436 / 35062 | 2017 / 24 | 72 / 34842 |
| `Chuunibyou S1` | 14741 / 14741 | 2012 / 12 | 36 / 30334 |
| `Chuunibyou S2` | 18671 / 18671 | 2014 / 12 | 36 / 30404 |

Each complete cached primary node's official title/synonym, MAL reference, TV
format, year and total was checked against the untouched source filenames and
captions. Magi filenames explicitly say *The Kingdom of Magic*; the primary
synonym names *The Labyrinth of Magic 2*. Record 50096 disagrees between filename
episode 4 and parsed/caption episode 1 and stays held. Chuunibyou episode 13
records 30306/30320/30334 and 30376/30390/30404 do not fit their 12-episode TV
identities and stay held rather than being relabelled as specials. The Magus
cohort is explicitly the 24-episode TV identity, never the similarly named ONA.
The in-memory apply rehearsal certified exactly 280 individual IDs; only the
sole writer may apply them to the live catalog after its separate snapshot.

The third 2026-11-04 batch added 221 individually checked files, after an
in-memory apply rehearsal and a separate pre-activation snapshot:

| Literal archive label | AniList / MAL | Year / TV total | Accepted / ceiling |
| --- | --- | --- | --- |
| `SNAFU S1` | 14813 / 14813 | 2013 / 13 | 39 / 44735 |
| `SNAFU S2` | 20698 / 23847 | 2015 / 13 | 39 / 44781 |
| `SNAFU S3` | 108489 / 39547 | 2020 / 12 | 35 / 44822 |
| `Non Non Biyori Repeat S2` | 20694 / 23623 | 2015 / 12 | 36 / 42136 |
| `Log Horizon: Destruction of the Round Table S3` | 114862 / 41109 | 2021 / 12 | 36 / 68881 |
| `Kekkai sensen - S2` | 97886 / 34451 | 2017 / 12 | 36 / 32395 |

The primary SNAFU responses independently include Oregairu 2/3 and Kan/Zoku
season identities. Non Non Repeat filenames carry the official sequel name;
Log Horizon filenames explicitly name *Entaku Houkai*, and Kekkai filenames
explicitly name *Sensen & Beyond*. Specials/OVAs stay independent. SNAFU record
44786 says 1080 in the filename but 480p in its caption and remains held; its
quality is not guessed or rewritten. All pre-existing assignments, accepted
download URLs, page slugs and source records passed snapshot comparison after
the writer applied exactly these 221 IDs.

## Reported filename-only cohorts (2026-11-04)

The owner's Kiznaiver/UQ Holder/Owari/Zoku examples exposed a parser coupling:
without a supported numeric quality the whole parse returned null, discarding
an otherwise explicit title and episode. The read-only admin/review hint now
extracts those independently. It does not rewrite source records, certify a
match, map HD to 720p, or manufacture a download. `576p` is supported explicitly,
and numbered `END` / `- END` filename suffixes do not erase episode numbers.

These particular 62 copied files were additionally inspected through the sole
pipeline Telegram client, with record-SHA/document-ID/filename/size guards.
Telegram had no video-dimension attributes, so a bounded Matroska parser read
only the first 65,536 bytes of each file (4,063,232 bytes total), directly from
the immutable source document. No complete video or temporary video artifact
was downloaded; protected documents are not read. Parsed EBML TrackType=video,
PixelWidth and PixelHeight are the resolution evidence. Cropped 720x392 files
retain `392p`, never a guessed/rounded `480p` label.

| Literal filename identity | AniList / MAL | Files / reviewed ID ceiling |
| --- | --- | --- |
| Kiznaiver | 21421 / 31798 | 12 / 1572 |
| Owari no Seraph | 20829 / 26243 | 12 / 3572 |
| Owari no Seraph - Nagoya Kessen Hen S2 | 20993 / 28927 | 12 / 3585 |
| UQ Holder | 21855 / 33478 | 12 / 4006 |
| Yahari Ore no Seishun Love Comedy wa Machigatteiru Zoku | 20698 / 23847 | 11 / 7876 |
| Shingeki no Kyojin: LOST GIRLS | 99634 / 36106 | 3 / 2212 |

All six primary nodes were independently re-fetched from AniList GraphQL and
cross-checked against MAL IDs and the public offline reference. Literal aliases
remain bounded to these archive cohorts; future files do not inherit review.
Lost Girls is the distinct three-episode OVA, not the eight-OAD umbrella or TV.
Only exact files 2210/2211/2212 map overall OAD 6/7/8, legacy 16.5A/B/C and
explicit Lost Girls Part 01/02/03 to Lost Girls episodes 1/2/3. The original
filename/caption and both numbering systems remain preserved. Reference:
https://myanimelist.net/anime/36106/ and
https://en.wikipedia.org/wiki/Attack_on_Titan%3A_Lost_Girls .

The bounded header inspector only processes an explicit local request manifest;
it cannot select another chat, send bot starts or write archive assignments.
Its evidence is not a match. Recovery candidates must be independently rebuilt
from current source hashes and that exact-document evidence, accepted by the
normal identity planner, then pass actual publication guards in an in-memory
rehearsal before the sole writer can apply them. The separate
`reported-example-recovery-proposals.json` does not overwrite earlier recovery
work. Approved source changes preserve the original record under
`archiveRecovery.originalRecord` with its SHA-256.

Pre-apply snapshot: `data/backups/archive-reported-examples-20261104T080143Z`.
The exact 62-file rehearsal accepted all 62 assignments and 51 new quality
links; the 11 Zoku files belong to an already-ready quality, whose existing
public URLs remain unchanged. Publication/deployment is verified separately.

Post-apply verification confirmed all 62 IDs at their rehearsed targets, all
96,032 other source records/assignments unchanged, all 67,443 previously
accepted downloads unchanged, and all source/destination Telegram document
identities preserved. These six filename searches now each return zero
unmatched files in the admin review. Remaining unmatched files: 22,256. Five
new catalog pages and 51 new ready quality links were prepared; Zoku used its
existing page. All 54 Python test files passed after the changes.

## Global parser audit, 2026-11-04

At the owner's request, `archive_parser_audit.py` checks every currently copied,
unmatched file against the same per-file review guards and records a coherent
read-only SQLite roster with source SHA-256s. The first global snapshot accounted
for all 22,257 files. Of these, 585 original records lacked title/quality fields;
579 were copied videos eligible for exact-document metadata inspection. This
is audit coverage, not a claim of 22,257 matches.

Version-3 metadata requests are bounded to 1,024 explicit hash-guarded IDs and
processed by the sole pipeline client in batches of at most 20 per loop. Every
batch checkpoints exact-document observations and terminal reasons, preserves
earlier evidence, and closes each Telegram header iterator. Already processed
IDs are not fetched again after a restart. Stale source records, missing source
messages, changed document IDs/names/sizes and protected content are accounted
for explicitly, never silently accepted. The request cannot select another chat,
create a second Telegram client, start MiniBot, or apply an assignment.

Long opaque numeric filenames do not become anime titles, and embedded digit
sequences such as `7114867204.mp4` no longer manufacture a `720p` quality. All
explicit source resolution labels, including uncommon heights, must agree with
the observed video height before a recovery candidate can be certified. Missing
identity, remakes, packs, inconsistent numbering and existing-page conflicts
remain separate holds. Research, parser hints, inspection and planner readiness
are not counted as matches; bounded apply rehearsals, source guards and verified
pre-apply snapshots are still required for every accepted batch.

The completed current audit is retained separately at
`data/archive-full-match/global-parser-audit-20261104-current/`; it must not be
rerun merely because the OpenCode process restarts. After the filename-only
reference-intake fix, 78 previously omitted searches completed with pagination
proof. That research completion is not an assignment count. The 579-file
Telegram inspection request remains durable through restarts.

The existing account FloodWait was already set to 2026-11-04 13:38:38 UTC
(17:08:38 Iran) in the pre-inspection snapshot. Neither the inspector nor the
offline review clears, shortens or bypasses it. Existing copied files can still
be reviewed locally: `reconcile_reviewed_offline()` runs inside the sole writer
before Telegram connection, and accepts only an explicitly approved manifest
with exact source SHA-256, document ID, copied destination ID, reconstructed
record and rehearsed target key. A source/destination/target change fails closed.
Unaccepted source changes are restored. Accepted state/catalog is saved before
the DB assignment commit; already-ready downloads are never replaced.

NHK ni Youkoso!'s 24 `[576 DVD]` files passed an actual isolated apply rehearsal
(24 assignments, 24 new links, all 67,501 prior accepted downloads unchanged).
Their numeric quality is explicit in the filename; no new Telegram request or
HD-to-resolution inference is required. Their pre-apply snapshot is
`data/backups/archive-global-nhk-preapply-20261104T094650Z`.

Large recovery previews now use owner-only SQLite scratch files under
`/tmp/opencode` with a 4 MiB SQLite cache instead of nested full in-memory
archive backups. Measured targeted preview/apply peak RSS was approximately
497/486 MB. Full-archive audit and large apply rehearsals should run serially on
this host, not alongside each other or resource-heavy TypeScript builds.

The sole writer subsequently applied all 24 NHK IDs to `al1210`, slug
`nhk-ni-youkoso`, through the offline guarded startup path. Comparison against
the pre-apply SQLite snapshot found no changes to any other source record,
assignment or document/destination identity. All 67,501 prior accepted downloads
and the persisted Telegram FloodWait remained unchanged. Remaining unmatched
copied files: 22,233. Public deployment and the pending 579-file inspection are
separate from this confirmed local application. All 56 Python test files passed.

### Bulk matching continuation

The seven-title review of Great Mission, Botsuraku Yotei, Ice Guy, Jijou wo
Shiranai, Tensai Ouji, Lord of Mysteries and Grendizer U rehearsed 376 files and
actually accepted 347 (198 new ready quality slots). The 29 others remained
held. Each literal alias has a primary ID, independent MAL ID, year, episode
total, format and archive-ID ceiling; filename-title/episode/quality/codec
contradictions still hold. A Persian name explicitly labelled `نام فارسی` in
the legacy English display field is not treated as an English identity claim;
the remaining official title and all other page-identity guards must agree.

The sole writer then applied all 347 reviewed IDs. Snapshot comparison verified
all 67,594 prior accepted downloads unchanged, no changes to any other source
record/assignment, and no document/destination identity changes. Remaining
unmatched at that verification: 21,889. Verified pre-apply snapshot:
`data/backups/archive-bulk-seven-preapply-20261104T155142Z`.

The 579-file inspection finished after the persisted Telegram wait expired:
555 exact documents inspected, 473 with video dimensions, and 24 already-matched
NHK files skipped with explicit outcomes. From those observations the next
actual apply rehearsal accepted 94 files (81 new quality slots), not every
inspected file. Missing episodes, absolute-numbering conflicts, mismatched
resolutions and ambiguous identities remain held. The full recoverable preview
can now scan every copied unmatched file with the existing strict filename,
caption, exact-document and reference guards, then run actual `apply_plan` on
the isolated disk-backed database. Only accepted IDs enter a reviewed manifest;
planning alone, inspection alone and status repair never count as assignments.

All 94 metadata-backed IDs were subsequently applied by the sole writer, with
all 67,812 earlier accepted downloads, other source records/assignments, and
document/destination identities unchanged against the SHA-256-verified snapshot
`data/backups/archive-bulk-video-preapply-20261104T155605Z`. The two reviewed
bulk batches therefore contributed 441 confirmed assignments. The live count
at verification was 21,765 unmatched out of 96,098 source files; counts also
reflect normal acquisition/matching between batches, not just subtraction.

A following all-recoverable rehearsal scanned all 21,765 unmatched copies and
found 1,430 potential parser repairs, but zero additional actual assignments
under the current identity/page guards. None of those repairs were applied or
reported as matches. Further progress needs new identity/numbering evidence,
not merely repeated parser passes or a relaxed guard. The original immutable
58,446-ID roster still had all IDs present and 36,817 assigned. All 57 Python
test files passed after these changes. No commit or push was made.

### Bounded planning performance

Reviewed batch replay and isolated rehearsal now pass `only_titles` to the
identity planner instead of rebuilding unrelated title decisions for every
batch. This filters title selection only: every same-title copied/pending
record, the complete cross-query provider pool, all existing pages, bindings,
remake years and current exact-document peers still participate in the same
guards. The normal periodic whole-archive planner remains unscoped. An empty
scope yields no assignments. Tests compare scoped entries with the corresponding
full-plan entries and keep competing remakes, duplicate pages and changed peer
documents held. This is a preparation/verification optimization, not a claim of
additional matched files or a waiver of missing identity evidence.

Measured on the immutable seven-title pre-apply snapshot: full planning took
72.665 seconds for 2,084 titles; bounded planning took 17.608 seconds for seven
titles (4.13x for this stage). All seven entries / 347 planned IDs were identical,
with zero database writes. This is not a fourfold end-to-end matching-rate claim.

### Evening continuation: 389 additional applied files

Two actual apply rehearsals were replayed by the sole writer with source hash,
document, destination and current target guards:

- Four-title batch: 178 files / 137 new links. City Hunter 2 (62), Occult Academy
  (38), Berserk Memorial Edition (37), Mission: Yozakura Family (41). Three
  contradictory files remained held. Snapshot:
  `archive-reviewed-four-evening-20261104T211251Z`.
- Five-title batch: 211 files / 126 new links. Dr. Stone S1 (72), Iruma S3 (18),
  Megumi no Daigo (39), Kinnikuman S2 (43), Snowball Earth (39). Snapshot:
  `archive-reviewed-five-evening-20261104T211914Z`.

City Hunter's literal reviewed `City Hunter 2 - NN` prefix is not an episode
range; real ranges, changed episodes/qualities and later archive IDs still hold.
Occult Academy's explicit filename S01 is retained instead of being erased by
the caption. All new literal aliases retain primary ID, year, format, total,
MAL cross-ID and archive ceilings; abbreviated labels additionally require a
reviewed full filename/template. Iruma files with filename/caption quality
disagreements were not silently accepted. Bare Megumi names remain held.

The Yozakura page's literal 2023 scraper year was corrected to its verified 2024
TV/27 identity, retaining its URL, posts and downloads. One Kinnikuman page's
literal Cyrillic `о` typo in its romanized title is recognized only for that
exact page/primary identity; there is no global confusable folding or title edit.
Berserk's fully certified provider page is reused while its legacy duplicate is
kept. Dr. Stone's exact 2019/24 page is certified and reused; its differently
dated legacy page is exempted only while all recorded literal title, format,
provider/total absence, slug and post facts remain unchanged. The legacy page
itself is not modified, merged, hidden or deleted. Other duplicate-page conflicts
remain held.

Snapshot comparisons verified all other source records/assignments and every
document/destination identity unchanged. The two batches preserved respectively
68,019 and 68,156 previously accepted downloads. Remaining unmatched after the
389 confirmed assignments: 21,376. All 58 Python test files passed before the
follow-up inspection request change; its 14 targeted tests also passed.

A separate hash-guarded request now queues 142 copied unmatched videos whose
explicit filename resolution disagrees with the caption or stored resolution.
This is inspection only: no contradiction guard has been relaxed and no file
was matched merely because a header was requested. The prior completed request
is retained in `resolution-conflict-inspection-20261104/previous-request.json`,
and version-3 inspection keeps earlier exact-document evidence. Telegram's
existing wait until 2026-11-05 01:40:44 UTC (05:10:44 Iran) was already present
in both pre-apply snapshots, before this new inspection request. It is neither
cleared nor bypassed; offline matching can continue independently.

Baccano's official DVD release page was then verified directly at
`https://www.baccano.jp/release/dvd.html`: overall episodes 14/15/16 are labelled
Bangai-hen upper/middle/lower on DVDs 5/7/8, dated February/April/May 2008.
The nine exact source IDs, literal filenames/captions, sizes and qualities have
a closed certificate mapping them to AniList/MAL 3901 special episodes 1–3;
all 39 regular files remain AniList/MAL 2251 TV episodes 1–13. No generic
offset/OVA exception was introduced. Original records and overall source labels
are retained. The actual rehearsal and sole-writer apply both accepted all 48,
preserving all 68,282 previous accepted downloads and every other source
record/assignment/document/destination. Remaining unmatched: 21,328. Snapshot:
`archive-reviewed-baccano-20261104T213030Z`. The reference certificate is retained
at `data/archive-full-match/baccano-numbering-reference-20261104.md`.

Another 47 literal numeric-title files passed actual rehearsal and sole-writer
apply: Night Head 2041 (36) and Tokyo Magnitude 8.0 (11). The title numbers were
misclassified as range endpoints; 2041 was also wrongly treated as a release
year. Only the exact reviewed titles, filename/episode agreement and archive
ceilings exempt their literal numeric prefixes. Real ranges and additional
explicit release years still hold. Night Head keeps primary 125868/MAL 43767,
TV/2021/12; Tokyo Magnitude keeps primary/MAL 6211, TV/2009/11. Original filenames,
captions, assignments and other title-year checks are unchanged. All 68,330
previous accepted downloads and other source/document/destination identities
were preserved against `archive-reviewed-numeric-titles-20261104T213451Z`.
Evening confirmed total: 484 new assignments; unmatched: 21,281. The first 389
were publicly verified in deployment `dpl_7iNiEeX1DXXbVqSsCUjF2WH62qSr` (2,150
titles); publication of the remaining 95 is a separate in-progress step.

### Night continuation: 346 additional actual assignments

Local-evidence matching continued during the unchanged Telegram wait; no new
Telegram session or historical AniPlus acquisition was used for these batches.
The earlier 484 were subsequently fully published (`dpl_RxPtwJAyBFnVZwdnSwEtjq2tFm7B`).

| Closed reviewed batch | Actual assignments | Pre-apply snapshot |
| --- | --- | --- |
| Free! Eternal Summer / Steins;Gate 0 | 39 / 17 | `archive-reviewed-literal-tv-20261104T221401Z` |
| Stone Ocean overall 13–38 | 78 | `archive-reviewed-stone-ocean-20261104T222142Z` |
| Food Wars! S3 / Mushoku Tensei / Vanitas | 71 / 69 / 72 | `archive-reviewed-split-cour-20261104T223456Z` |

All three passed disk-backed actual apply rehearsals, SHA-256-verified snapshots,
sole-writer replay and post-apply full source/assignment/document/destination
comparisons. They preserved respectively 68,377 / 68,433 / 68,510 previously
accepted downloads, with zero changes to other source records/assignments or
document/destination IDs. Strict new-posts-only policy remained unchanged.
Remaining copied unmatched after these **346 applied files: 20,935**.

The literal Free dual-source `[s2-NN]` templates agree on explicit quality;
identical sizes across different documents are neither identity nor resolution
proof. Steins 0's numeric title/dash format is certified only for the 17 listed
unassigned IDs. The six pre-existing episode-zero records 3473–3476, 3478 and
3488 are separately documented legacy conflicts, **not repaired** by this work:
they still point to the 2011 legacy Steins;Gate page `t442244619409`. No accepted
`archive:ID` job was present for those six at inspection, but the existing page
has 124 assignments, so it is not overwritten, merged, renumbered or deleted.
Its entire state entry remained unchanged in the latest snapshot comparison.

Stone Ocean's official complete-series 13–38 maps to AniList 146722 episodes
1–26. MAL independently splits that span into 51367 (12) and 53273 (14); both
component identities/totals and episode numbers remain explicit rather than
pretending that MAL 51367 alone has 26 episodes. Source labels and original
records are retained. See the private `stone-ocean-numbering-reference-20261104.md`.
Its 78 assignments produced 77 new links; a duplicate ready slot was not replaced.

Food Wars splits 1–12 / 13–24 into 99255 / 100773, Mushoku 1–11 / 12–23 into
108465 / 127720, and Vanitas 1–12 / 13–24 into 131646 / 135136. These are closed
ID-to-original-episode certificates, not a generic offset or a global permission
to erase season markers. Both original and canonical numbering are validated;
the original record is immutable recovery evidence. All six exact target pages
retain independently checked provider ID, MAL ID, TV/year/total and page guards.
Food Wars 8591 stays held for filename `(4800)` versus caption `(480)`. Three
explicitly listed Vanitas episode-14 files have no caption: their basis names
that absence and relies on the explicit filename plus stored episode/quality,
not invented dual-source evidence. The three episode-15 Persian captions
independently agree. See `split-cour-numbering-reference-20261104.md`.

All **62 Python test files passed** after the split-cour changes. No commit or
push was made. The first 56 files were separately publicly verified in
`dpl_8gtd3SARnqUstoKmX6H5QPjZF3m2` (2,156 titles). Publication of the following
290 is a separate guarded build/verification operation, not implied by matching.

Another **231 files** then passed the same rehearsal/snapshot/sole-writer/apply
comparison workflow: Attack on Titan S3 (66), Bungo Stray Dogs (108), and 86
(57). Snapshot: `archive-reviewed-numbering-three-20261104T224308Z`. All 68,722
previously accepted downloads were preserved; other records/assignments and all
document/destination identities had zero changes, and strict live policy was
byte-for-byte unchanged. Remaining copied unmatched: **20,704**. This night
continuation's confirmed actual total is now **577**, separately from the earlier
484-file evening batch. All 62 Python test files passed again.

Official Attack S3's own client-loaded `story/episode_data.php` explicitly gives
series #38–#59, corresponding to seasonal 1–22. Primary 99147 covers seasonal
1–12; 104578 covers seasonal 13–22 as its own 1–10. Bungo's official first/second
season pages give 1–24 and explicitly identify #25 as the manga-bundled OVA;
the official third-season pages give #26–#37. The archive's 108 regular files
have no #25, so third-season numbering subtracts **25**, not 24. The OVA is not
invented or inserted. 86's official story gives 1–23; the exact cohort here
contains only 1–19, split at 11/12, with missing episodes 20–23 not claimed as
received or matched. See `numbering-three-reference-20261104.md`. These 231
assignments produced 231 new links; their public publication remains separate.

### Read-only continuation verification, 2026-11-05

After recovering the earlier session summary, the latest 231 assignments were
checked against their reviewed targets, document IDs, copied destinations,
accepted jobs and ready catalog links. All 231 public `/api/link` responses
matched those accepted URLs, and all seven target pages had the exact expected
episode inventories. The complete public slug inventory matched all 2,170 local
catalog titles. Anonymous admin session and overview endpoints both returned
404. Existing publication status was `verified`, deployment
`dpl_8wuS6FydSXKnZPFjJhSRzwuELMeg`, published at
`2026-11-05T03:56:47.065615+00:00`. This verification made no new deployment,
service change, credential access or archive assignment.

The current database contained 96,098 files and 20,666 copied unmatched. A
comparison with the SHA-256-verified last pre-apply database snapshot accounted
for the additional 38 background assignments as Iruma S3, separately from the
577-file reviewed run. No previously assigned targets, other source records,
source document IDs or copied destinations changed. The resolution-conflict
inspection now reports all 142 requests processed, including 140 verified
documents with dimensions; inspection completion is not an assignment count.

The old conversation's provider restriction remains unresolved. Its warning
and the current continuation boundaries are retained in
`docs/SESSION_HANDOFF_2026-11-05.md`; moving context is not permission to repeat
cross-process credential access or forced production publication.

The private `data/archive-full-match/` directory holds the original ID roster,
per-file audit, reference progress and recovery previews. Backups are made before
bulk work. Compare actual database assignments against that roster; do not reset
the baseline to make progress appear complete. Rebuild recovery previews as new
references arrive. Conflicting remakes, packs, missing metadata and unparseable
files still need independent source/context evidence, not forced assignments.

For a report against the original full-match roster, use `archive_review.py`
with `--include-scope data/archive-full-match/baseline.json`. This unions the
immutable roster with the older review scope and current unmatched IDs; it never
replaces either historical baseline. The included-baseline digest and matched
count are reported independently of an older review campaign's baseline.

Keep every runtime database, report, session, video and backup out of source commits.

Some superseded snapshots created during matching are stored losslessly as
`<original-name>.gz` to avoid filling the host disk. Their private
`snapshot-compression.json` records original names, byte counts, SHA-256 hashes
and restore checks. Decompress to a separate location and verify the manifest
before use; SQLite snapshots also passed `PRAGMA quick_check` after restoration.
The immutable full-match baseline and latest activation snapshot were not changed
by this compression pass. This does not constitute off-host restore verification.

## Assignment preservation during live post matching

Source upserts, bootstrap imports and later post matching fill only null file
assignments. They must never replace a previously certified file target when a
new post creates another page for the same title. Pages and existing downloads
are neither merged nor deleted to hide this conflict.

An accidental remap can be restored only by the sole writer's
`archive_assignment_preservation.py` consumer. A separately reviewed private
proposal names an immutable snapshot and its SHA-256, the exact expected current
and prior keys, provider ID and record hash. The snapshot itself must prove the
old key, identical source record, document ID, copied destination and state. The
current target must still pass complete primary-reference year/format/episode
checks and per-file certification. Missing or changed proof stays held; the
consumer changes no metadata, pages, downloads or notifications. Replaying a
completed restoration is a no-op.

For a documented accidental replacement of an accepted download's identity,
an explicit `restoreDownload` proposal also proves the immutable state snapshot
hash and both the original and expected-current job hashes. Only animeKey, slug
and postId may differ; the URL, message, source file, episode, quality, status and
every other job field must be unchanged. The writer restores that exact snapshot
job and removes only its erroneous pointer from the later page. It does not
delete a page, overwrite a different accepted slot or emit an episode alert.
State is saved before committing these database corrections. Publication itself
also refuses to overwrite an existing accepted archive job on a different page.

## Filename years and numbering variants

Different explicit filename years form disjoint cohorts. Files with no year
never inherit a neighbour's year; two years in the same filename still conflict.
Each cohort independently passes the same exact-provider, episode, season,
format, existing-page and binding checks. No original field is rewritten.
When a target page already has the exact provider ID, a different separately
certified provider ID sharing its normalized remake title is not that target;
unknown identities and duplicate target pages still hold.

Reviewed literal aliases with an archive-ID ceiling form their own cohorts.
Files beyond the ceiling retain `alias_cohort_review`; they cannot inherit the
review or prevent older, individually reviewed files from reaching the planner.
The ceiling itself is never raised by this partitioning.
When the primary response supplies a MAL ID for a reviewed cross-provider alias,
that ID must also match the review; a contradictory cross-reference is rejected
even if the AniList ID, year, format, total and official title otherwise agree.

Filename recovery also refuses to replace a non-null parsed season or part
with a different value (including erasing it), even if the shortened caption
title lacks that marker. Exact-document recovery remains a separate path with
fresh peer certification and preserved original metadata, not a filename guess.

Known compact-numbering alternatives have explicit holds: Psycho-Pass's
11-episode New Edit versus the 22-episode broadcast, Saiki K.'s 24 compilations
versus 120 shorts, and Monogatari Second Season's 23 story episodes versus 26
including recaps. Bounds alone are not proof of numbering. An exact document
reuse may inherit its independently certified peer identity; the writer regenerates
that evidence from document ID, filename, size and the existing provider target.
Other compact sets require individual version/numbering evidence.

An exact-document recovery also rechecks its existing target page directly.
The planner regenerates the peer proof from the current database on every pass,
checks the copied destination, filename, size, episode, quality, target provider,
page year/format/total and conflicting bindings. Stored evidence alone does not
qualify. This can reuse a single first episode or an already verified abbreviated
page label without inventing a provider synonym, broad title binding, new page
or episode numbering. Changed/missing peers and conflicting target facts hold.

## Standalone specials without an OVA word in the title

Some official OVA titles do not contain the literal word `OVA` or `special`.
These are eligible only with one exact finished provider identity, its finite
episode total and start year, and an independently matching filename carrying
that explicit year. Without an OVA label or a filename year they remain held:
a bare title could instead be a TV adaptation with a `(TV)` provider suffix.
A filename's parenthesized year may be interpreted only when it equals the
certified provider year. The original filename/record is never rewritten.

The page keeps `archiveSpecialReference`, copied from the actual provider response.
Its ID, format, year, title and episode checks remain active for later writes.
An existing TV parent cannot receive these files, and a TV/OVA title collision
still stays held. Missing numbering is accepted only for one provider-confirmed
standalone special; this is not a guessed TV episode or an invented episode count.
