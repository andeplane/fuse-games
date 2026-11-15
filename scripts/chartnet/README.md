# ChartNet: a learned step-chart experiment for Fusemania

A time-boxed test of whether a model trained on the StepMania/ITG packs places steps better than the rule-based
generator in `scripts/lib/fusemania/generate.ts`. It follows Dance Dance Convolution (Donahue et al., 2017) in two stages:

1. **Step placement** (`onset.py`): per 10 ms frame, the probability of a step. Input: log-mel at three window sizes
   (3 × 64 bands), the song's beat phase (sin/cos at quarter, eighth and sixteenth), and the difficulty. A conv front end
   and a dilated residual stack (about ±1.3 s context). Trained on Apple MPS in about 20 minutes.
2. **Step selection** (`steps.py`): which arrows each row gets. A 2-layer GRU over rows, conditioned on the gap to the
   previous and next row, the beat-phase class, the difficulty and the audio at that row. Trained with the four mirror
   images of every chart. Holds, rolls and mines are not generated.

`gen.py` snaps the placed steps to the song's grid (16ths, triplets where the song swings) and enforces the rule
generator's minimum gaps. A **hybrid** (that learned rhythm with the rule generator's arrows, jumps, freezes and mines,
`generateCharts(analysis, placement)`) is evaluated for comparison. The game offers ChartNet v2, below.

## Data stays local

The packs (`fusemania-songs/packs`, 480 songs, 1,950 dance-single charts), their features, the trained weights and every
per-song file derived from them live in `$CHARTNET_WORK` (default `~/projects/personal/fusemania-songs/chartnet`) and are
never committed. Only this code and the generated charts for Fuse's own songs (`games/fusemania/charts/chartnet/`) are
in the repository.

## Running it

```bash
cd ~/projects/personal/fusemania-songs/chartnet && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python torch librosa soundfile numpy
```

```bash
P=~/projects/personal/fusemania-songs/chartnet/.venv/bin/python
$P scripts/chartnet/extract.py            # pack features → $CHARTNET_WORK/cache (≈1 min, 1.8 GB)
$P scripts/chartnet/extract_fuse.py       # Fuse songs' features and measured beat grid
$P scripts/chartnet/onset.py --phase 1 --name onset_phase   # placement model + F1 vs spectral-flux baselines
$P scripts/chartnet/steps.py              # arrow model + perplexity vs a bigram
$P scripts/chartnet/extract.py test-audio && pnpm exec tsx scripts/chartnet/rule-baseline.ts $CHARTNET_WORK/rulegen/jobs.json $CHARTNET_WORK/rulegen/out.json
$P scripts/chartnet/gen.py placement-eval && pnpm exec tsx scripts/chartnet/rule-baseline.ts $CHARTNET_WORK/rulegen/jobs.json $CHARTNET_WORK/rulegen/out_hybrid.json $CHARTNET_WORK/rulegen/placement.json
$P scripts/chartnet/gen.py eval           # held-out songs: human vs learned vs rule-based vs hybrid
$P scripts/chartnet/onset.py --phase 1 --density 1 --name onset_dens && $P scripts/chartnet/arrows.py   # v2 models
$P scripts/chartnet/gen2.py eval && $P scripts/chartnet/gen2.py fuse   # v2 held-out metrics, Fuse charts
pnpm exec tsx scripts/chartnet/bundle.ts $CHARTNET_WORK/out_fuse2 && (cd scripts/chartnet && $P gen.py fixup ../../games/fusemania/charts/*.ssc) && pnpm exec tsx scripts/fusemania-charts.ts bundle
```

## Results (48 held-out pack songs, 190 charts)

The rule-based generator is the one on `main` after Fusemania merged (with its reference priors and mines).
Step placement, F1 against the human charts with a ±20 ms tolerance:

| Difficulty | Learned (song's grid) | Learned (rule generator's grid) | Hybrid | Rule-based | Spectral flux on the grid |
| ---------- | --------------------- | ------------------------------- | ------ | ---------- | ------------------------- |
| Beginner   | **0.58**              | 0.47                            | 0.43   | 0.42       | 0.31                      |
| Easy       | **0.77**              | 0.61                            | 0.60   | 0.50       | 0.47                      |
| Medium     | **0.78**              | 0.66                            | 0.65   | 0.57       | 0.65                      |
| Hard       | **0.76**              | 0.73                            | 0.73   | 0.60       | 0.75                      |
| Challenge  | **0.70**              | 0.67                            | 0.67   | 0.59       | 0.72                      |

Beginner is compared with the rule generator's Easy. The middle columns are the fair end-to-end comparison: they use
the beat grid that `analyze.ts` estimates, as the rule generator does, so the gap is what the model knows about
_which_ moments to step on. Without beat-phase input the audio-only model reaches 0.71 overall (0.75 with it), and
plain spectral flux reaches 0.45. On these songs the learned rhythm is denser than the human charts on Hard and
Challenge (4.3 and 5.0 rows a second against 3.7 and 4.3); the Fuse charts fix the density instead (below).

Step selection: the GRU's perplexity is 3.85 against 4.90 for a per-difficulty bigram. Pattern statistics (means over
charts, shares of single steps):

| Difficulty | Chart      | 4-gram variety | Jacks | Crossovers | Up↔Down candles | Jumps |
| ---------- | ---------- | -------------- | ----- | ---------- | --------------- | ----- |
| Hard       | human      | 0.54           | 0.042 | 0.073      | 0.12            | 0.080 |
| Hard       | learned    | 0.42           | 0.051 | 0.118      | 0.17            | 0.048 |
| Hard       | rule-based | 0.73           | 0.027 | 0.061      | 0.15            | 0.075 |
| Hard       | hybrid     | 0.64           | 0.044 | 0.108      | 0.22            | 0.074 |
| Challenge  | human      | 0.58           | 0.034 | 0.086      | 0.15            | 0.074 |
| Challenge  | learned    | 0.45           | 0.060 | 0.132      | 0.19            | 0.076 |
| Challenge  | rule-based | 0.65           | 0.051 | 0.094      | 0.19            | 0.080 |
| Challenge  | hybrid     | 0.62           | 0.062 | 0.125      | 0.20            | 0.080 |

On Easy and Medium the learned arrows look like the human ones. On Hard and Challenge they are less varied and have
too many crossovers, so the game's ChartNet charts take the rule generator's arrows. With the learned (denser) rhythm
the rule generator's arrows cross over more than on its own rhythm; playtesting decides whether that matters.

## ChartNet v2

v2 learns the arrows too, and makes Hard and Challenge busier:

- **Placement** (`onset.py --density 1`): the same model, also told the density the chart should have (log steps per
  second). Asked for 6 steps a second it writes streams where the music carries them, not just more scattered
  steps. Told the human chart's density, its F1 is Easy 0.78, Medium 0.79, Hard 0.77 and Challenge 0.73.
- **Arrows** (`arrows.py`): a causal transformer over the last 64 rows. Each row it sees the previous arrows, the gaps
  to the neighbouring rows, the beat phase, the difficulty, the density, the audio, and where the feet are
  (`feet.py`). It chooses taps and freeze heads (80 tokens). It is trained on all four mirror images, in about
  4 minutes on MPS.
- **Foot flow**: sampling subtracts a per-difficulty penalty for crossovers, jacks, hands and stepping on a held
  panel, plus a small cost for repeating a four-row pattern from the last 32 rows (`CHARTNET_REPEAT`). Freeze tails
  end before the held panel is needed again.

On the held-out songs, with placement told the human chart's density (`gen2.py eval`). Crossovers are counted with the
better starting foot for every run of steps (`crossover_best_parity`); jacks and jumps are shares of steps:

| Difficulty | Chart      | F1   | Steps/s | 4-gram variety | Crossovers | Jacks | Jumps | Freezes |
| ---------- | ---------- | ---- | ------- | -------------- | ---------- | ----- | ----- | ------- |
| Hard       | human      |      | 3.73    | 0.54           | 0.078      | 0.042 | 0.080 | 0.022   |
| Hard       | v2         | 0.75 | 3.55    | 0.66           | 0.032      | 0.015 | 0.125 | 0.018   |
| Hard       | rule-based | 0.60 | 3.17    | 0.73           | 0.037      | 0.027 | 0.075 | 0.043   |
| Challenge  | human      |      | 4.30    | 0.58           | 0.068      | 0.034 | 0.074 | 0.065   |
| Challenge  | v2         | 0.69 | 4.08    | 0.67           | 0.040      | 0.025 | 0.137 | 0.052   |
| Challenge  | rule-based | 0.59 | 4.52    | 0.65           | 0.056      | 0.051 | 0.080 | 0.041   |

v2 is more varied than the human charts, with fewer crossovers and jacks, and somewhat more jumps. At human density
its runs of 16ths are short (longest 4.9 on average against 28.7 in the human Challenge charts); they come with
density, below.

## Fuse songs

Each song's charts keep its own header and timing (`bundle.ts`). Until 2026-11-15 the charts aimed at
about the packs' 75th to 90th percentile of steps per second: Easy 1.8, Medium 2.8 and Hard 4.3; Challenge aimed at 7.0, which these songs' tempos cap at about 12 steps a second
in 16th streams (the ladder has moved up since, see "The ladder" below). Over the
20 songs (`gen2.py fuse`):

| Difficulty | Steps/s | 16th-stream share | Longest 16th run | 4-gram variety | Crossovers | Jacks | Jumps | Freezes |
| ---------- | ------- | ----------------- | ---------------- | -------------- | ---------- | ----- | ----- | ------- |
| Easy       | 1.68    | 0                 | 1                | 0.68           | 0.029      | 0     | 0.084 | 0.013   |
| Medium     | 2.57    | 0                 | 1                | 0.60           | 0.030      | 0.005 | 0.110 | 0.008   |
| Hard       | 3.96    | 0.14              | 5.9              | 0.44           | 0.038      | 0.023 | 0.077 | 0.010   |
| Challenge  | 6.43    | 0.68              | 37.5             | 0.35           | 0.028      | 0.023 | 0.059 | 0.021   |

The busiest two seconds of a Challenge chart reach a median of 9 steps a second (at most 10). Human Challenge charts in
the packs peak at a median of 7.5, 10.5 at the 90th percentile, and 15 at most.

These are the game's charts: `bundle.ts` writes them into `games/fusemania/charts/<id>.ssc` (credited `ChartNet`,
which `fusemania-charts.ts generate` leaves alone), and `gen.py fixup` keeps a one-second lead-in and ends a freeze
before any row that would need a third arrow. To rebuild: train (`onset.py --density 1 --name onset_dens`, `arrows.py`), then `gen2.py fuse` and
`pnpm exec tsx scripts/chartnet/bundle.ts $CHARTNET_WORK/out_fuse2`.

## ChartNet v3 (what the game offers now)

v3 is v2's two small models retrained on much more data, with sampling tuned against human charts.

- **Data.** 89 community packs from 2005 to 2016 (`community-packs.txt`, downloaded by `packs.py`) on top of the DDR
  and In The Groove packs: 3,417 songs and 11,028 charts, up from 480 and 1,950, and 2,959 Challenge charts where
  there were 182. The 48 DDR/ITG test songs are frozen in `$CHARTNET_WORK/test_keys.json`; `test2_keys.json` holds out
  128 community songs; a song held out in one pack is not trained on from another (`data.split`).
- **Training** runs on a rented GPU: all songs at once need about 18 GB of memory per run. `extract.py` (with
  `OMP_NUM_THREADS=1`: one thread per worker is 15 times faster than letting every worker thread), then
  `onset.py --phase 1 --density 1 --wide 1 --len 1000 --steps 12000 --name onset_v3` and
  `arrows.py --steps 24000 --name arrows_c1`. Scoring and generation run on the Mac and load only the songs they need.
- **Features.** `data.band_rhythm` adds the onset strength in 8 bands, bass to high melody, and each band's share of
  the onset energy over 4 seconds; `--wide 1` lets placement look about 5 seconds each way.
- **Sampling** (`arrows.generate`, `gen.place`): six candidate continuations per 16 rows, keeping the one the model
  likes best that repeats least; costs on jumps, freezes and jacks set so held-out charts land on human rates; the
  last 5% of a Challenge chart's steps prefer positions a sixteenth from a step already placed, so near-runs close
  up into streams; 24ths are placed by the model and kept only as runs.
- **Review notes** (`guidance.py`): a span and frequency band marked in the chart lab becomes steps on that band's
  onsets, placed before anything else.

What was measured, on the 48 held-out DDR/ITG songs (`gen2.py eval`, `gen2.py place-eval`):

| Held-out DDR/ITG charts     | Human | v2    | v3    |
| --------------------------- | ----- | ----- | ----- |
| Challenge: step timing F1   |       | 0.69  | 0.72  |
| Challenge: steps in streams | 0.25  | 0.12  | 0.20  |
| Challenge: longest 16th run | 28.7  | 4.9   | 11.9  |
| Challenge: jumps            | 0.074 | 0.137 | 0.105 |
| Challenge: freezes          | 0.065 | 0.052 | 0.046 |
| Challenge: jacks            | 0.034 | 0.025 | 0.039 |
| Hard: step timing F1        |       | 0.75  | 0.75  |
| Hard: jumps                 | 0.080 | 0.125 | 0.080 |
| Hard: freezes               | 0.022 | 0.018 | 0.030 |
| Hard: jacks                 | 0.042 | 0.015 | 0.024 |

Placement alone, told each human chart's step count: 0.737 overall for v2 and 0.742 for v3 (Challenge 0.691 and
0.729; the stream preference then trades 0.02 of that for the stream share). On the held-out community songs 0.750 and
0.765 (Challenge 0.794 and 0.823). What did not help: the band features (0.738 without, 0.742 with), the wider context
alone (0.740 without, 0.738 with), and a bigger arrow model (8 layers, d=384: best validation loss 1.06 against 1.04
for the small one, then it overfits).

Data did, for the arrows. Loss per row on the same held-out charts (`gen2.py arrow-eval`), by training songs:

| Training songs       | 480 (v2) | 735  | 1,470 | 2,944 | 5,923 |
| -------------------- | -------- | ---- | ----- | ----- | ----- |
| DDR/ITG test songs   | 1.53     | 1.43 | 1.35  | 1.30  | 1.26  |
| Community test songs | 1.28     | 1.05 | 0.99  | 0.94  | 0.91  |

The last column adds a second batch of 88 packs (`packs.py chunk 1`, 6,444 songs in all). The game's arrows come from
that model (`arrows_c1`). Placement did not gain from the second batch (0.738 on the DDR/ITG songs, 0.765 on the
community songs), so it stays the model trained on the first (`onset_v3`).

Over the game's 36 songs (`gen2.py fuse`; a cover's Challenge aims at its original's density):

| Difficulty | Steps/s | 16th-stream share | 24th share | Longest 16th run | 4-gram variety | Jacks | Jumps | Freezes |
| ---------- | ------- | ----------------- | ---------- | ---------------- | -------------- | ----- | ----- | ------- |
| Easy       | 1.62    | 0                 | 0          | 1                | 0.62           | 0     | 0.035 | 0.024   |
| Medium     | 2.52    | 0                 | 0          | 1                | 0.53           | 0.002 | 0.072 | 0.020   |
| Hard       | 3.76    | 0.17              | 0.010      | 7.5              | 0.52           | 0.041 | 0.064 | 0.028   |
| Challenge  | 5.55    | 0.52              | 0.103      | 46.8             | 0.44           | 0.052 | 0.053 | 0.033   |

Human Challenge charts at 5.5 to 7.5 steps a second: 0.53 in 16th streams, 0.05 in 24ths, variety 0.42, jumps 0.05,
freezes 0.07. v2's Challenge charts for the same songs had variety 0.33.

Whole-chart variety (the share of distinct four-row patterns) falls as a chart gets denser, so compare it at equal
density: human Challenge charts score 0.58 at 4 to 5 steps a second and 0.42 at 5.5 to 7.5. `variety_w64` measures
it inside 64-row windows instead.

## Where a chart gets busy (`density.py`) and what the chart lab taught

Anders marked 17 spans with a frequency band on Final Chase in the chart lab and tapped 569 steps of rhythm. Measured
against them (`$CHARTNET_WORK/labels`):

- **The placement model already hears the rhythm.** Inside each marked span, the strongest moments (as many as were
  tapped) land within 60 ms of a tap for 77% with plain onsets over all frequencies, 82% in the marked band, 86% in
  the best single band per span, and 84% with the model's step probability.
- **It does not know where to get busy.** Steps per 2 seconds in the old Challenge chart correlate 0.04 with his
  taps. The same holds against held-out human charts: 0.25 (Hard) and 0.34 (Challenge) on the DDR/ITG songs.
- **No single audio measure says where he taps fast**: onset rates per band, harmonic and percussive onset rates and
  the note rate of the strongest melodic line each correlate at most 0.3 to 0.4 with his tap rate.
- **Which arrows a human chart uses hardly depends on the music.** The arrow model's held-out loss is 1.261 with
  the audio and 1.259 with the audio blanked on the DDR/ITG songs (0.914 and 0.933 on the community songs): given
  the rhythm and the feet, the sound adds almost nothing.

What is built on that:

- `density.py` trains a second small model (dilated convolutions over the whole song at 2 frames a second: band
  energies, onset strength and note rate per band, the placement model's probability mass) to predict how many steps
  a human chart has around each moment compared with its own average. `gen.place` lets the placement model spread
  the steps its own way first, then scales every two-second window's share by that profile (to the power
  `CHARTNET_BUSY_POWER`, 1) and fills each window with its strongest peaks. Charts then get busy where the human
  charts do more often: on the held-out community songs the correlation per chart goes from 0.38 to 0.47 on Hard,
  0.32 to 0.41 on Medium and 0.54 to 0.57 on Challenge, on the DDR/ITG songs from 0.25 to 0.28 on Hard and 0.34 to
  0.38 on Challenge; step timing F1 stays where it was (0.742 and 0.741, 0.765 and 0.761). It trains on the Mac in
  two minutes (`density.py pool`, `density.py train 1500`; longer overfits). A first version multiplied every
  peak's probability by the profile: that scored better (0.33 and 0.41 on the DDR/ITG songs) but emptied calm
  stretches, six songs lost every step of their first ten seconds, so windows now only scale.
- `guidance.tapped_beats`: taps scatter over a whole sixteenth, so they are not snapped. Every two beats get as many
  steps as were tapped there, on the grid positions the placement model likes best (a share of them, on 8ths, for
  Medium and Hard), on top of what the window would have had. Final Chase's Challenge then has a step on about 90%
  of his taps (66% before) and is busy where he is.
- `guidance.opening_beat`: every chart starts on the song's first clear, sharp sound after the lead-in.

### The labelling loop (`watch_notes.py`)

`python watch_notes.py` watches the lab's notes and taps and regenerates a song about 20 seconds after its labels
change (`gen2.py fuse` for that song, `bundle.ts`, `gen.py fixup`, `fusemania-charts.ts bundle`); the lab served from
the same checkout shows the result on reload. The labels the committed charts were made from are copied to
`labels/` so the charts can be regenerated without the labeller's machine. What a note does (`guidance.py`):

- starts with `good`: the span is locked, later regenerations keep its rows;
- `bad: too many` or `bad: too few`: the span gets half or 1.7 times its steps;
- has a frequency box: the steps follow that band's onsets; with `jump` in the text those steps become jumps;
- contains `good first` (or is tagged `start`): the chart starts on the strongest onset in the span;
- a tapped rhythm: where the taps sit on the grid (Burning Heat: 12 ms from the nearest triplet or sixteenth, random
  taps would be 22 ms) each tap is a step; where they scatter (Final Chase) they set the step count per two beats.

Burning Heat was labelled after the model was trained and served as a blind test: the placement model matches the
tapped rhythm at 70% there (84% on Final Chase), and the chart made without its labels has a step on 59% of the taps.
With the labels: 73%, busy where the taps are busy 0.60 (from 0.24), first step at 3.2 s where the note says. Training
the placement model further on one song's taps did not transfer to the other (70% to 65%, 84% to 82%).

Also measured, and not built on yet:

- What he marks is a lead that stands out. In the densely labelled part of Final Chase, quieter drums tell marked
  spans from the gaps between them with an AUC of 0.75, one clear note at a time in the melody range 0.72, the
  harmonic share of the sound 0.66. Splitting the song into sections does not find the spans (his notes start 3.2 s
  from the nearest boundary, a random moment 3.9 s).
- Telling the arrow model how accented each step's sound is adds nothing: held-out loss 1.264 and 0.936 without,
  1.262 and 0.935 with. It already gives a jump 56 to 62% probability on the rows where the human chart has one.

## The ladder, repeats, and what the timing score can still tell us (2026-11-15)

**The ladder.** Hard is now what Challenge was (as busy as the packs' meter 12), and Challenge is a new chart well
above it, as busy as the packs' 14s and 15s where the song carries it (`gen2.ladder`): 1.8, 3.2, 7.0 and 10 steps
a second asked for, charts come out at 0.9 of that. A cover's Hard is its original's hardest chart and its Challenge
at most 1.75 times that. Both top charts are written the way the packs write a Challenge (`MODEL_DIFF`). Over the 36
songs the median chart has 1.6, 2.9, 5.7 and 8.1 rows a second.

- A meter is no longer fixed per difficulty: a chart carries the meter whose median pack chart is as busy
  (`games/fusemania/charts/pack-meters.json`, from 13,000 pack charts; `gen2.py meters` writes it after
  `gen.py fixup`). The old meters ran about three too high: what was called 13 to 15 is a pack 12.
- A slow song's grid fills up before its Challenge gets as busy as asked; its Hard then steps down to 0.78 of what
  the Challenge reached (`HARD_SHARE`), so the two stay a step apart.
- Where 24ths are closer than 85 ms (above about 118 BPM) the Challenge takes its 24th runs from the Hard chart,
  which has them only where the music does, and puts its extra steps on sixteenths. Left free, up to half of such
  a chart became 24th runs at 13 steps a second; pack charts of that density have 3% of their steps in such runs.
- In the new Challenge a jack costs more (`DENSE_PENALTY`): 1.4% of its steps repeat the arrow before, where it was
  2.9%; pack charts of that density have 1.6%.
- Twelve songs are stored at 95 to 113 BPM, and several of them are really twice as fast (the covers' originals
  run at 190 to 200 BPM). Their sixteenths are then eighths, so their top charts cannot get much busier on this
  grid: Monolith, Jelly Beach Bounce and Snaky Jazz gain under 15% on the old Challenge. Storing the real tempo
  would fix it and would also double the scroll speed of those songs, so it is not done here.

**Repeats** (`repeats.py`). Human charts give bars that sound alike the same rhythm: a bar and the earlier bar it
sounds most like share 0.77 to 0.90 of their steps. The placement model scores every moment on its own, so two such
bars could come out a step apart. `repeats.share` blends each bar's step probability with the bars that sound like
it (similarity of their spectra at the sixteenth slots, at least 0.5; half the weight on the group) before any step
is picked. `gen2.py place-eval` prints the measure.

| Songs                                  | Timing F1      | Same rhythm on alike bars | Human charts |
| -------------------------------------- | -------------- | ------------------------- | ------------ |
| DDR/ITG held out                       | 0.741 to 0.744 | 0.786 to 0.831            | 0.772        |
| Community held out                     | 0.762 to 0.762 | 0.806 to 0.842            | 0.840        |
| DukAmok originals (never trained on)   | 0.864 to 0.867 | 0.849 to 0.896            | 0.895        |
| The game's 36 songs, at Hard's density |                | 0.719 to 0.772            |              |

The game's songs repeat less than pack songs do: 47% of their bars have another bar that sounds alike, 78 to 88%
in the packs. When a rhythm repeats, human charts rarely repeat the arrows: 7% of such bars carry the same or the
mirrored arrows in community charts, 24% in DDR/ITG charts.

**The timing score is at its ceiling.** Some songs are in two packs with two different human charts. At a similar
density (57 pairs of Hard and Challenge charts) two human charters put 0.69 of their steps on the same sixteenth
(the middle half of the pairs: 0.61 to 0.77). ChartNet scores 0.76, 0.84 and 0.86 against a human chart on the three
held-out sets, measured the same way. A higher score against pack charts therefore no longer says the chart is
better, and nothing below moved it:

| Added to the placement model (a bar-by-bar model on top of ChartNet's probability) | DDR/ITG | Community | DukAmok |
| ---------------------------------------------------------------------------------- | ------- | --------- | ------- |
| The steps it already placed, and the matching earlier bar's steps                  | +0.005  | -0.011    | -0.037  |
| The same, trained on its own earlier picks instead of the human's                  | -0.001  | -0.005    | -0.030  |
| A spectrogram resampled to the beat grid                                           | -0.002  | 0.000     | -0.004  |
| Fine pitch: 84 constant-Q bins and their rise                                      | -0.005  | -0.008    | -0.003  |
| Separated instruments (Demucs: drums, bass, vocals, other), three runs each        | 0.000   | +0.003    | +0.007  |
| Transcribed notes (basic-pitch)                                                    | 0.000   | +0.003    | -0.002  |
| Instruments and notes together                                                     | -0.002  | +0.001    | +0.005  |
| Pitch, instruments and notes together                                              | -0.008  | -0.007    | 0.000   |
| terra's answers (97 songs it labelled)                                             |         |           | -0.005  |

Each row is the change against the same model without the input; three runs of the same model differ by up to 0.004.
Separated instruments are the one input with a repeatable gain: on the DukAmok songs all three runs with them
(0.847 to 0.850) beat all three without (0.839 to 0.843). The last five rows were trained on the 2,187 songs whose
features were extracted (70%); the extractors are not in this folder yet.

Two things did move a score, and both say the same: what is missing is which layer of the music this charter
follows, not a better ear.

- Shown the human chart's steps in the bar before, terra (a vision model reading one measure of a constant-Q
  picture) scores 0.83 where it scores 0.74 without and ChartNet 0.77. Shown its own answer for the bar before, it
  scores 0.72. The bar-by-bar model given the human's first 16 bars scores 0.79 on the rest where it scores 0.76
  without (DDR/ITG; on community songs 0.86 and 0.84, level with ChartNet).
- terra's prompt, over ten variants on held-out measures: 0.755 as first written, 0.806 with ChartNet's score for
  each line under the picture (ChartNet with the same number of steps: 0.797).

## Chart lab (reviewing charts against the music)

`games/fusemania/chart-lab.html`, served at `<base>fusemania/chart-lab.html?song=<id>` (live:
https://andeplane.github.io/fuse-games/fusemania/chart-lab.html?song=final-chase) and not linked from the game's menus.
Time runs down the page: the song's charts (arrows coloured by subdivision, StepMania style) beside the onset strength
ChartNet reads and a spectrogram, either constant-Q (24 bins an octave, each bin from the shortest FFT window that
resolves it, like a wavelet transform) or the 64 mel bands at a 2048 window that `features.py` feeds the model. It
plays the song with an assist tick on a chart's steps or on the beats, and edits taps (snapped, exported as `.ssc`).

Drag on the spectrogram to select a time span and a frequency band: the lab plots that band's onset flux (the
feature such a band would add) and counts each chart's steps by subdivision in the span. A selection becomes a review
note (`src/lab/notes.ts`, versioned JSON): kept in the browser, downloadable, copyable as text for a chat, or saved to
a file on every change (Chrome's file picker). `Load .ssc…` adds a candidate's charts (e.g. `gen2.py fuse` output)
beside the song's own for comparison. The DSP is `src/lab/spectrum.ts` and runs in a worker (about 8 s a song).
