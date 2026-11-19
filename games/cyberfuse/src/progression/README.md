# DOS campaign progression

C-Dogs records a zero-based mission index in each briefing password, using the campaign title, the chosen map seed and the one- or two-player alphabet. The default seed is zero. A password starts that mission with a new score and inventory. Cyberfuse maps two or more cooperative players to the DOS two-player alphabet and keeps a local code per campaign, seed and player mode. Completing the last mission ends the campaign. Dogfight has its own first-to-five scoring.

Mission bonuses follow the awarded totals in `CDOGS.C`. Each survivor receives the party’s objective, key and time bonuses, then their own health and conduct adjustments. At the default health setting the health bonus begins above 150 HP. The time multiplier in the code is 25 points per full second remaining. The compiled scorer also enforces six kills for the knife-only bonus and six friendlies plus more than half as many as hostile kills for the butcher penalty. Some DOS result labels and the original manual describe different thresholds. A dead player’s prior points enter the end-of-run tally; if an ally survives, the dead player starts the next mission with zero career points.

## Reproduce the source comparison

Run the following with the extracted [C-Dogs DOS source](https://www.dosgamesarchive.com/file/c-dogs/cdogssrc). The source ZIP used for these fixtures had SHA-256 `a3abe423206205739092953ccd1191746ab8a21130079cd0c40bbe9f48a309ee`.

```sh
python3 games/cyberfuse/src/progression/reference_probe.py /path/to/cdogs-source
pnpm exec tsx --test games/cyberfuse/tests/progression.test.ts
```

The probe compiles the original `MakePassword`, `Bonuses` and `Summary` bodies with inert drawing functions and initializes the DOS structs. It prints codes for the second through fourth missions of all five campaigns and compares scoring for a 4,915-tick mission with two objectives, two keycards, 183 HP, seven kills and only a knife. The original scorer awards 2,000 team points and 680 personal points. This comparison exercises the numeric rules independently of the browser room and results UI.
