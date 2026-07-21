# Metadata-assisted recognition

Version 4 of the card index adds mana cost, type line, and Oracle text. These
fields are useful evidence, but simply OCRing the whole card on every scan
would make recognition slower: title OCR is already the slowest stage when it
runs, and the benchmark shows it rarely changes the answer.

## Intended order of work

1. **Measure discriminative value offline.** Run `scripts/analyze_metadata.py`
   after the v4 index build. It reports how far exact mana cost, coarse type,
   their combination, and a rare Oracle word narrow the card population.
2. **Prototype extraction separately.** Measure mana-symbol detection and
   type/rules OCR against SNAPTEST crops without changing production ranking.
   Record extraction accuracy, latency, rotation, and whether the true card was
   already in the visual shortlist.
3. **Add evidence only where it can help.** Decisive visual and art matches must
   continue to return immediately. Metadata belongs on the uncertain fallback
   path unless measurements show a cheaper signal.
4. **Benchmark the complete pathway.** Compare Fixed 200 for regression and
   Tableau 10 EDH staples for realistic behavior. Check `byRotation`, pathway
   precision, median/p90 time, and whether misses are ranked or absent.

## Candidate signals

- **Mana cost:** count the top-right symbols and classify their colors from a
  well-framed candidate. Compare a parsed signature such as generic amount,
  symbol count, and W/U/B/R/G/C mask. This should be much cheaper than OCR.
- **Type line:** OCR one narrow line around the art/text boundary and reduce it
  to stable card types (`creature`, `instant`, `sorcery`, `land`, etc.). Use
  subtypes only when the read is strong enough.
- **Oracle text:** normalize OCR into meaningful words and use rare words as
  corroboration. This is a last-resort signal because the text is small and
  multi-line; a compact fingerprint should be loaded instead of full text.

Metadata must not override a decisive ORB result or a near-exact visual hash.
It also cannot repair an absent-candidate framing failure merely by reranking;
introducing a card globally requires sufficiently precise independent evidence.

## Evidence policy

The four visible regions are independent signals: name, mana cost, type line,
and rules text. A high-confidence semantic contradiction is a veto: an exact
`{1}` read is incompatible with `{2}`, and a clear `Sorcery` read is
incompatible with a candidate whose primary type is only `Creature`. Compound
types remain compatible when they overlap (`Creature` is compatible with
`Artifact Creature`).

That rule applies only above a measured confidence threshold. A cropped,
rotated, occluded, or unreadable region is neutral rather than contradictory.
Rules text is positive corroboration only because partial multi-line OCR is too
easy to miss; matching rare words can promote a candidate, but missing words do
not eliminate it. `metadataEvidence.js` owns these compatibility rules so the
future extractor and ranker cannot quietly apply different policies.
