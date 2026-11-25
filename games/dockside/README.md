# Dockside

Canal Lock is a two-pilot convoy race. Walk or switch to a faster travel chassis, claim turrets on contact, and use the north or south factory pad to launch a ground drone for six credits. The first delivery wins. A simultaneous delivery draws.

## Architecture

The authoritative simulation advances at 20 Hz in integer centimetres. The elevated perspective camera follows the pilot’s heading. The TV uses an orthographic overview, and both the chase view and radar use the simulation’s map definitions. Each match uses the shared Fuse rollback runtime for solo practice, peer rooms and shared TV. A practice pilot submits the same controls as a human. A delivery decides one analytics round and one match.

## Play

Open `/dockside/?mute`, choose solo practice or create a two-seat room. W/S drives forward or reverses, A/D rotates, Q/E jinks sideways. J/K/L fires the laser, heavy missile or shock pulse in either form. R cycles a target, F dispatches on a factory pad, Shift transforms, and Space jumps or brakes. Hold F with movement for careful walker steps or short jinks, or with Space to crouch. C changes the chase distance and M expands the radar. How to Play lists the corresponding standard gamepad buttons. Touch supports simultaneous movement and actions.

F also claims a neutral turret within reach. Touching any turret still captures it. With the map open, movement controls pan the map, F centers it on your rig, and M returns to driving. The match continues while you read the map.

On a phone, pilot controls overlay the full-screen arena. Shared TV phones show the dedicated controller and radar. To verify these layouts and both room paths against a built app, run `pnpm exec tsx scripts/dockside-phone-smoke.ts`.
