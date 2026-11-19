# Dockside

Canal Lock is a two-pilot convoy race. Walk or switch to a faster travel chassis, claim turrets on contact, and use the north or south factory pad to launch a ground drone for six credits. The first delivery wins. A simultaneous delivery draws.

## Architecture

The authoritative simulation advances at 20 Hz in integer centimetres. The same map definitions supply collision, drone routes and the orthographic Three.js view. Each match uses the shared Fuse rollback runtime for solo practice, peer rooms and shared TV. A practice pilot submits the same controls as a human. A delivery decides one analytics round and one match.

## Play

Open `/dockside/?mute`, choose solo practice or create a two-seat room. Use WASD or arrows to move, Shift to change form, Space to fire and E on a marked factory pad to dispatch. Touch controls support simultaneous movement and actions.
