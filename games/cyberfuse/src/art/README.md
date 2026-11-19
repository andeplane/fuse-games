# Cyberfuse art

The atlas renders at four texture pixels per DOS world pixel. Each actor combines a suit, face and piece of equipment around a foot pivot. Seventeen head designs include pilots, aliens, pirates and robots. Suits have team-coloured armour. High-contrast visors, shoulder lights and pickup markings help players read the scene over the darker facility floors.

## Reference and reproduction

Ronny Wester's C-Dogs v1.06 DOS release defines the geometry. `GRAFX.C` reads the indexed packs. Each starts with 256 VGA RGB triples followed by little-endian 16-bit record lengths. A populated record contains 16-bit width and height followed by one palette index per pixel. Empty records keep their indices. `PICS.C` supplies frame IDs and offsets. `ACTORS.C` selects the body, head and equipment, turns the head during idle glances and changes layer order with facing. The upper wall face begins 12 world pixels above the floor tile. [DOS distribution and source archive](https://www.dosgamesarchive.com/download/c-dogs)

`CDOGS.PX` and `CDOGS2.PX` have 398 and 182 slots. Slot 374 is empty. The font pack has 154 slots and 90 populated glyph records including space. The builder verifies the three pack hashes and reads their dimensions. The drawing definitions in `operative.py`, `facility.py` and `equipment.py` create the new imagery from geometry, material colours and animation poses. The generated PNG contains all 579 game sprites and 90 glyph records. `layout.ts` preserves the slot order, frame selection and anchors.

Use Python 3 and Pillow 12.2.0. Extract the DOS distribution and the DOS source into separate directories and run from this directory.

```sh
python3 build_atlas.py /path/to/dos-files /path/to/dos-source
```

The binary distribution SHA-256 is `de6c5e025b5c03b475e55c2ec6ab88b493517a4d4e8c649e2e7dd1919b7b50cc`. The source archive SHA-256 is `a3abe423206205739092953ccd1191746ab8a21130079cd0c40bbe9f48a309ee`. Both archives are available from the [C-Dogs download page](https://www.dosgamesarchive.com/download/c-dogs).

## Renderer

`loadCyberArt()` loads the checked-in atlas. All draw methods accept world coordinates and an optional final scale. Floor and room tiles use the tile’s top-left corner. Walls also take that ground coordinate and apply their elevation. Actors use their foot pivot. Named props, numbered object offsets and effects apply the reference offset internally. `drawSprite` and `glyph` use raw upper-left coordinates. Directions run clockwise from north, and `wallVariant` takes neighbour bits in north, east, south, west order.
