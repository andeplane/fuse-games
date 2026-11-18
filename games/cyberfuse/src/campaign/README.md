# C-Dogs campaign data

Cyberfuse adapts Ronny Wester’s original C-Dogs campaign data, © Ronny Wester, released under Creative Commons Attribution (CC BY). The author confirmed this grant to the C-Dogs SDL maintainers. [Upstream licensing record](https://github.com/cxong/cdogs-sdl/blob/master/doc/README_DATA.md)

The DOS release carries **73 missions**. Bug-Eyed Monsters has 9, Ogre Rampage has 16, Distress call from scientific outpost has 18, The Brotherhood of Anarchy and Death has 13, and Chambers of the deceased has 17. All five campaign headers identify Ronny Wester as author. The two independent arena configurations are Dogfight in the dungeon and Cubicle wars.

The conversion keeps the original briefing text, optional and required objective counts, procedural map settings, character statistics, palette selections, prop placement and weapon restrictions. It names the original fields and stores sprite offsets in DOS world pixels so the new atlas can use the same anchor points. The lobby adapts the two starting inventories for additional seats by alternating them, and offers the first permitted weapon when a mission excludes the entire starting inventory. A mission is one analytics round.

## Rebuilding the tables

Extract the [DOS v1.06 distribution](https://dosgames.com/files/cdogs106.zip) to a local directory. From the checkout, run:

```sh
python3 games/cyberfuse/src/campaign/import_campaigns.py /path/to/extracted-cdogs
```

The importer verifies each input’s SHA-256 and only reads the initialized records in the executable and the three external campaign files. The ZIP’s SHA-256 is `de6c5e025b5c03b475e55c2ec6ab88b493517a4d4e8c649e2e7dd1919b7b50cc`. It reads Watcom’s 32-bit little-endian mission format (1,324 bytes per mission, 64 per character) and decodes DOS text as CP437. Each external campaign must consume its file exactly. The DOS archive and executables stay outside the repository.

As an independent check, compiling the released `OGRE.INC` and `BEM.INC` mission and character records produced the same 37,644 bytes as the corresponding executable sections. Concatenating Ogre characters, Ogre missions, BEM characters, then BEM missions produced SHA-256 `be731e3ffd15f723b93c4a28468d932df5722562d3244fa7144ae3d2efcbb699`. The three external campaign headers, ordered character banks and mission lists come directly from the shipped `.CPN` files.
