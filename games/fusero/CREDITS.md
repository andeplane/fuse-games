# Credits and provenance

Fusero ports Classic gameplay from OpenLieroX, retaining Fuse's networking and original neon presentation. Credit goes to Liero creator Joosa Riekkinen, Liero Xtreme creator Jason Boettcher, and OpenLieroX contributors including Dark Charlie and Albert Zeyer.

The gameplay source and data baseline is OpenLieroX commit [`0a20c6d0a10ed63b28a15f05c771913c294efbf6`](https://github.com/openlierox/openlierox/tree/0a20c6d0a10ed63b28a15f05c771913c294efbf6), release `20260717.2`, with its packaged Classic mod. Source-derived TypeScript files identify themselves as altered ports and retain source attribution. They are distributed with the pinned upstream [GNU Library General Public License](upstream/COPYING.LIB) and the [original source-release notice](upstream/original-license.txt). The original notice does not replace the LGPL notices applying to later OpenLieroX contributions.

The exact Classic binary, native physical masks and animation-geometry fixtures are retained for reproducible extraction and parity tests; see [upstream/SOURCE.md](upstream/SOURCE.md) and [SOURCE-PARITY.md](SOURCE-PARITY.md). The compiled native differential fixture preserves the upstream functions it exercises. Source for the altered port and its build/test tooling is in this repository under `games/fusero/` and `scripts/fusero-*`.

The neon cave renderer and desktop worm icon are original code-drawn Fuse artwork. Shared menus, networking, deterministic math and typography retain their existing dependency licenses. Visual replacements do not replace the original physical masks or weapon-animation lifetime metadata. Fusero uses Fuse rooms and peer-to-peer rollback, rather than claiming compatibility with OpenLieroX's network protocol or arbitrary native mods.
