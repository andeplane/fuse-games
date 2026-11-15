# DSP rhythm with learned step patterns

The experimental generator uses non-AI rhythm extraction for step times on every song it generates. The learned
placement network is not loaded. Spectral attacks from the lab's fine spectrum supply candidate events. Pitch
motion is a separate descriptor: it cannot create a step by itself. An experimental phrase selector follows
the 400–4000 Hz lead when pitch changes and attacks corroborate one another beyond chance, and otherwise uses
independent 40–250 Hz bass attacks. It chooses one layer per four beats using eight beats of context. This is a
heuristic, not instrument separation; the lab also exposes each layer separately. Decisions (`gpt-6-luna`,
prompted with numerical evidence and four separate example songs)
chooses a four-level policy: density budget, two-second peak row rate, beat subdivisions, stream length and recovery.
A deterministic selector applies that policy to Easy, Medium and Hard. Challenge retains the complete detected
line without density or stream suppression. The existing `arrows_c1` model chooses panels and jumps at those fixed
times. Easy uses only left/right with one panel per row; higher levels allow all four panels with at most two per
row. Crossovers are forbidden. This version generates taps/jumps: holds are disabled because trimming provisional
holds can change the physical foot assignment. Final foot assignments are verified after postprocessing.

No new model training is required for this version. `arrows_c1` is the already-trained pattern model; Decisions is
prompted, not fine-tuned. Pattern features retain its original three-window mel representation plus band channels.
Those features inform arrow patterns, not event placement. Full-duration audio is decoded; features are sampled at
the pattern model's own frame rate. BPM changes, offsets and stops are evaluated by the TypeScript timing code and
exported on a 1/48-beat grid. Quantisation chooses the closest audio timestamp around a stop, and skips events
inside an unrepresentable pause rather than relocating them by seconds. Candidate spacing is specified in beats,
not a fixed millisecond interval; fixed analysis frames still describe the spectrum's physical resolution.

Generated charts replace the canonical chart files for our own songs. Authored pack songs get separate `dsp-`
ids in an experimental pack, preserving their original reference charts. The highest four authored charts by
meter map to Easy/Medium/Hard/Challenge; missing lower charts remain
missing in evaluation. Thus a sole source chart is Challenge, and an Edit can map to our Challenge without creating
a fifth difficulty. Pack-derived meters are assigned from realized density. Difficulty is also affected by patterns,
so row-rate limits alone do not establish how a chart feels.

Reproduction (artifacts, source audio and weights stay outside Git):

1. `decisions-policy.ts extract --ids … --out …` obtains full-duration DSP candidates. Labels never enter extraction.
2. `decisions-policy.ts prepare` builds audio-only packets and separate evaluation references.
3. `decisions-policy.ts run` calls Decisions from the Mac using `OPENAI_API_KEY`; its request-hash cache avoids
   repeat calls. No API key enters browser bundles or compute workers.
4. `decisions-policy.ts jobs` applies policies and exports fixed beats, exact times and timing maps.
5. On the compute worker run `dsp_patterns.py --jobs … --weights …/arrows_c1.pt --stats …/feat_stats_v3_208.npz
--audio-cache … --out …`; use `--shard i/n` for parallel songs. It needs PyTorch, NumPy, librosa, SoundFile and FFmpeg.
6. `bundle-dsp-charts.ts <generated directory> <jobs JSON>` verifies exact head timing, panel constraints and the
   final pattern report bound to the SSC hash and generator source hashes. It then registers the charts;
   `pnpm exec tsx scripts/fusemania-charts.ts bundle` puts them in the game. Finish with
   `pnpm exec tsx scripts/fusemania-previews.ts --aliases-only` to reuse the original immutable audio previews.

The separate `decisions-policy.ts evaluate` report compares raw and policy-selected timing against mapped authored
rows. The four prompt-example songs are excluded from aggregate check scores. These are development/check results,
not a fresh blind test: the pack was already inspected during DSP calibration. The committed historical policy
report predates complete Challenge rhythm and the phrase selector; it does not establish current accuracy.
Private user taps can be checked with `check-rhythm-labels.ts`, and are never bundled or used to manufacture events.
Easy has no reference in the DukAmok
pack under this mapping. Human playtesting and comparison on other packs remain necessary before production adoption.
