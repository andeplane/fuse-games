# Phone home screen

The site selects the phone shell at startup on narrow screens or touch devices.
Every portal game appears on Home, spread over swipeable pages (12 apps per
page, including Games, Winamp and About). The page dots are buttons as well.
Games opens a screenshot carousel using the same portal gallery captures as
Fusteam, with swipe and previous/next controls and a direct Play action.

The `open` query parameter identifies Home (absent), `games`, `winamp`, `about`
or a portal game id. Navigation preserves other URL flags, including `mute`.
Browser Back/Forward, the labeled Back button and reload restore this route.
A directly opened app has Home as its in-app Back fallback. Reload restores
the app, not a running match or audio playback position.

One Winamp player stays mounted while navigating. Its classic panels fill the
phone width in portrait, with a growing playlist; landscape puts the playlist
beside the player and equalizer. Home, Back and Winamp's minimize action retain
playback. The active game iframe also survives visits to Home, Games, About
and Winamp; choosing a different game replaces that iframe.

The welcome dialog appears once per browser, with a versioned local preference.
If storage is unavailable, it can still be dismissed for the current visit.
About explains navigation and playback and can reopen the welcome dialog.

`Phone.test.tsx` covers the composed shell with injected navigation, welcome
storage and player fakes. Real-browser checks must additionally exercise URL
history, iframe switching, swiping, player sizing, and portrait/landscape layouts.
