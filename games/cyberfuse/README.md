# Cyberfuse

Cyberfuse brings Ronny Wester’s DOS C-Dogs v1.06 to Fuse. Play a campaign solo or with a squad, or play a first-to-five dogfight. Original mission briefings lead into the armory. Pick up to three weapons, complete the required objectives and gather the surviving players at extraction.

Online campaigns and Dogfight support up to six players. Two players can share one keyboard.

## Play

From the repository root run `pnpm install`, then `pnpm dev`. Open the printed server URL followed by `/cyberfuse/`. Choose **Play → Single player**, select a campaign or arena and choose **Deploy**. To play together, choose **Host room** and share the invite. The room host can open a shared TV from the lobby. Two players at one computer can select **Two players on this keyboard** before deploying. Player 1 uses the arrows, Space and Shift. Player 2 uses WASD, F and G. Each player chooses a kit in the lobby. Shared screens split when the operatives move too far apart.

- **WASD or arrows** move and face eight directions. Hold **Space or left Ctrl** to fire.
- **Shift or Enter** with a direction slides. Tap and release while still to change weapon.
- **M** opens the campaign automap. The touchscreen has a direction pad and separate Fire, Slide / switch and Map buttons.
- **Escape** opens the game menu. A mission is the campaign round unit. Dogfight records each bout as a round.

Use the mission password in the solo briefing or room lobby to resume a campaign. Solo and co-op use different passwords. Difficulty, enemy density, health and friendly fire can be changed before a campaign.

## Source and credits

The rules port uses the released DOS source and the v1.06 campaigns. See the [reference and verification notes](../../docs/design/cyberfuse-reference.md), [shipped DOS gameplay probes](reference/dos-probes.md), [artwork pipeline](src/art/README.md), [campaign extraction and credits](src/campaign/README.md), [hostile AI probes](src/ai/reference.md) and [weapon traces](src/ordnance/REFERENCE.md).

The original C-Dogs code is by Ronny Wester. The Cyberfuse game code is distributed under [GPL-2.0-or-later](COPYING). Wester’s original campaigns are adapted under CC BY. Cyberfuse provides replacement graphics and synthesized sound. [Upstream code and credits](https://github.com/cxong/cdogs-sdl) · [Campaign permission](https://github.com/cxong/cdogs-sdl/blob/master/doc/README_DATA.md)
