# Phone home screen

The site selects the phone shell at startup on narrow screens or touch devices.
Every portal game appears on Home, spread over swipeable pages (12 apps per
page, including Games, Winamp and About). The page dots are buttons as well.
Games opens a screenshot carousel using the same portal gallery captures as
Fusteam, with native horizontal swipe pages, page dots and a direct Play action.
The selected game page is retained when leaving and reopening Games.

The `open` query parameter identifies Home (absent), `games`, `winamp`, `about`
or a portal game id. Navigation preserves other URL flags, including `mute`.
Browser Back/Forward and reload restore this route. The phone shell has one
round, classic iPhone-style Home button, with no Back or app-switching toolbar.
Open an app's Home icon again to resume it. Reload restores
the app, not a running match or audio playback position.

One Winamp player stays mounted while navigating. Its classic panels fill the
phone width in portrait, with a growing playlist; landscape puts the playlist
beside the player and equalizer. Home and Winamp's minimize action retain
playback. The active game iframe also survives visits to Home, Games, About
and Winamp; choosing a different game replaces that iframe.

The phone-only welcome fills the screen with three swipeable highlights: the
vibe-coded game collection, its shared multiplayer libraries, and an invitation
to play. Continue and page dots provide alternatives to swiping; Skip dismisses
the introduction at any point. It appears once per browser, with a versioned local preference.
If storage is unavailable, it can still be dismissed for the current visit.
About explains navigation and playback and can reopen the welcome dialog.

`Phone.test.tsx` covers the composed shell with injected navigation, welcome
storage and player fakes. Real-browser checks must additionally exercise URL
history, iframe switching, swiping, player sizing, and portrait/landscape layouts.
