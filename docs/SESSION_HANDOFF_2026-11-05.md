# AnimeVerse session handoff — 2026-11-05

## Provenance and scope

- Previous session: `ses_eaa98533effe0MBozNt5o54wbv`, titled
  "بازطراحی UI انیمه ورس + تونل کلادفلر".
- Recovered its latest completed compaction and subsequent user/assistant
  messages through the OpenCode API, then checked current project state.
- This is a refreshed handoff, not a claim that a new server-side compaction
  succeeded or that the old session's provider restriction was removed.
- The user requested continuing the archive matching work in this conversation.
  The current conversation now uses the AnimeVerse project directory.

## Safety incident and remaining restriction

- The old session still returns `misalignment_policy_violation`, including after
  the user's clarification was forwarded to that same session.
- The provider explanation identified cross-process Vercel credential access,
  stopping the publisher, and launching a forced production publication whose
  outcome was initially unclear. The user subsequently confirmed authorization
  for those past actions; that does not authorize repeating them or remove the
  provider restriction.
- Do not read another process's environment or credentials, retry the forced
  publication, disable safeguards, switch models, erase history, or use this
  handoff to bypass the restriction. Any needed provider review remains separate.
- Current continuation is restricted to legitimate archive matching, offline
  evidence review, and read-only verification. No new deployment or service
  mutation has been performed during this handoff.

## Last actual task

- Latest substantive user request: match all remaining archive files.
- Last reported matching run actually added **577 assignments**, separately from
  the earlier **484-assignment** evening run. It did not finish the archive.
- First 346: Free! Eternal Summer 39, Steins;Gate 0 17, Stone Ocean 78,
  Food Wars S3 71, Mushoku Tensei 69, Vanitas 72.
- Last 231: Attack on Titan S3 66, Bungo Stray Dogs 108, 86 EIGHTY-SIX 57.
- The old session had confirmed publication of the first 346 and was attempting
  to publish the last 231 when it stopped. Do not replay that deployment command.
- Last run's verification recorded 20,704 copied unmatched files, 68,722 accepted
  downloads preserved, zero other source/assignment changes, zero document or
  destination changes, and unchanged strict live policy.

## Fresh observations

- Read-only live database query: **96,098 total files**, **20,666 copied unmatched**.
  The difference from 20,704 is subsequent background progress, not work claimed
  by this new conversation.
- Comparison with the SHA-256-verified last pre-apply database snapshot identified
  the additional **38 assignments as Iruma S3**. No previously assigned target,
  other source record, source document ID or destination ID changed.
- Pipeline status at `2026-11-05T04:15:55.512105+00:00`: running, no last error,
  2,170 catalog titles.
- Publisher service was independently checked: active/running, PID 322517,
  result success. This alone is not publication proof.
- Publication status: `verified`, 2,170 titles, deployment
  `dpl_8wuS6FydSXKnZPFjJhSRzwuELMeg`, published
  `2026-11-05T03:56:47.065615+00:00`.
- All 231 latest reviewed IDs were rechecked locally: assignments, source
  document IDs and destination IDs still match their reviewed manifest.
- Resolution-conflict inspection now reports 142/142 processed, complete,
  140 verified documents with dimensions. Observations are not assignments and
  do not authorize silently overriding contradictory source labels.
- Read-only public verification completed: **231/231 accepted links** agree with
  the local accepted jobs and catalog, all **seven target pages** have the exact
  expected episode inventory, and the complete public inventory matches all
  **2,170 titles**. Anonymous admin session/overview endpoints both return 404.
  No new deployment was needed to finish the last publication-verification task.

## Invariants to retain

- No guessing identity, year/remake, format, season/cour numbering or resolution.
  Preserve all existing assignments, accepted downloads, pages, URLs and UI.
- Archive pipeline is the sole canonical writer and Telegram archive client.
  Investigate SQLite with `mode=ro`; do not start legacy sync or a second client.
- Use per-file source hashes/document/destination/target guards, negative tests,
  an actual isolated disk-backed apply rehearsal, verified pre-apply snapshots,
  and sole-writer replay before reporting any new assignments.
- Do not change existing assignments through a new alias. Six Steins-related
  records 3473–3476, 3478 and 3488 remain separate legacy conflicts.
- Strict AniPlus new-post policy starts at post 33233 with original post date
  on/after `2026-11-04T21:43:25.294502+00:00`. Do not reactivate old queued jobs.
  Historical imports require separate approval; respect all persisted waits.
- Preserve source evidence, primary/MAL IDs, alias ID ceilings, original and
  canonical episode numbers, exact-document quality evidence, and held cases.
- No commits or pushes after the last authorized commit `a58522a`; leave prior
  uncommitted/untracked work intact. Keep databases, sessions and runtime backups
  private and out of commits.
- Use only currently verified zero-cost OpenCode models for suitable independent
  subtasks; no paid fallback or primary-model change. OpenAI, if used, is limited
  to GPT-6.1 Sol with low/medium/high reasoning.
- Avoid resource-heavy full TypeScript checks. Large database rehearsals run
  serially using private disk-backed scratch and bounded SQLite memory.

## References and next steps

- Detailed matching ledger: `docs/archive-full-match.md`, especially the night
  continuation and numbering certificates; strict live rules:
  `docs/minibot-downloads.md`.
- Latest 231 proposal/verification:
  `data/archive-full-match/reviewed-numbering-three-night-20261104.json` and
  `numbering-three-actual-apply-verification-20261104.json` in that directory.
- Pre-apply snapshot:
  `data/backups/archive-reviewed-numbering-three-20261104T224308Z/`.
- Main code: `tools/tg/archive_identity.py`, `archive_pipeline.py`,
  `archive_recovery_preview.py`, `archive_numbering_certificates.py`,
  `archive_literal_files.py`, `backfill.py`, and `archive_video_probe.py`.
- First finish read-only verification of the latest public links, then review
  evidence-ready offline cohorts. Never count planning, research, inspection,
  preparation or deployment as new assignments.
- Public verification above is now complete. Independent read-only candidate
  review was delegated to the verified free DeepSeek model; no deployment or
  runtime mutation is delegated.
- A further local-only inspection found 75 `Spice And Wolf` files whose exact
  filename subtitle is `Merchant Meets the Wise Wolf`, episodes 1–25 at each of
  480p/720p/1080p, with no template episode/quality conflicts. Cached complete
  primary 145728 / MAL 51122 is TV/2024/25. Its existing page
  `hookami-to-koushinryou-merchant-meets-the-wise-wolf` has year 2023 and missing
  provider/format/total, so this is a **held candidate**, not a completed match.
  The 2008 and 2009 pages remain separate and must not receive these files.
- `Fruits Basket S1` remains remake-ambiguous without independent file-year
  evidence. `Cang Lan Jue` 1–24 spans separate 12-episode primary parts and needs
  explicit numbering proof. Do not solve either by dropping existing guards.

## Independent review checked by the primary agent

- The read-only free-model review completed; no new matches were made.
- **Utawarerumono:** rejected the suggestion to map all 72 files to the 2022
  sequel merely because they fill its missing episode slots. Primary inspection
  found only IDs 37610–37612 explicitly name `Futari no Hakuoro` in the filename.
  The other 69 filenames and captions are bare `Utawarerumono`, also the exact
  official title of the 2006 TV adaptation. A closed ID roster or nearby explicit
  episode 27 does not prove their individual identities. Preserve those holds;
  investigate only independently evidenced files rather than a broad alias.
- **Kengan Ashura:** local complete nodes are 100891 / MAL 36903 and 111048 /
  MAL 40269, both 2019 ONA/12. The 72 records use overall 1–24, but official
  numbering proof is still needed for any split-cour certificate. Do not map
  them to the later sequel seasons or pretend ONA is TV.
- **Ryza no Atelier:** primary inspection confirmed two episode-89 caption
  conflicts, and complete cached references include both the 2023 TV and the
  2021 short ONA. The review reports 72 records / 36 unique documents. Do not
  repair episode 89 from its neighbour or use episode-count bounds alone to
  prove every file's version. Also do not add speculative global deduplication:
  the established workflow distinguishes assigned records from new ready slots
  and already preserves existing accepted download URLs.
- These findings are research leads and corrections to a recommendation, not
  evidence that any additional archive assignment has been applied.
