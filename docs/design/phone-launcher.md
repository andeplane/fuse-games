# Phone launcher

The root page uses an iPhone-style home screen on narrow viewports (under 900px)
or devices with a coarse pointer and no hover, including landscape phones.
Desktop visitors keep FuseOS. Existing root Riders invite redirects run first.

Home offers game apps, a Games folder with a normally scrolling catalogue, and
Winamp. The catalogue comes from the same portal metadata as the desktop.
Games open in a full-screen iframe so the phone shell can retain its player.
The Home bar returns to the launcher, retaining the active game. Resume game
returns to it; in-game portal links navigate within the shell without reloading
Winamp. `?open=<game>` opens that game directly;
`?mute` carries into games and silences Winamp for agent previews.

Winamp loads lazily and stays mounted when minimized or while a game is open.
Its own minimize/close buttons return Home; they do not stop playback. Playback
requires a user gesture. This keeps audio within the active browser page; it
does not promise playback when the operating system suspends the browser.

Fusemania's touch controls use the keyboard's inverted T: up above down, left
and right beside down. On-device play overlays transparent pads on the canvas
instead of reserving a large opaque band. Shared-screen controllers use the
same arrangement. Input ownership, timing and lane order are unchanged.
