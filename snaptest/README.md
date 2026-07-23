# SNAPTEST

The recognition benchmark. **Full documentation:
[../docs/testing.md](../docs/testing.md)** — what it simulates, which modes
exist, how to read the results, and the lessons behind the design.

This directory holds the record, not the explanation:

- **[results.md](results.md)** — every run, with the analysis that followed it.
  Append a row after each meaningful run.

## Quick start

1. Open <https://snapcast.app/snaptest> and hard-refresh.
2. Confirm the console `BUILD` marker matches what you expect to be testing.
3. Choose **Tableau 10 scenes — EDH staples (100 cards)** and press Run
   (~5 minutes; keep the tab focused).
4. Press **Copy results** and paste the JSON.

Read `byLayout`, `byRotation`, `byPool` and `missTrueRank` before the headline
accuracy — the headline moves by a couple of cards on noise alone.
