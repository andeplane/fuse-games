# Mechanic’s bench

The campaign owns the wallet and each car’s workshop. A purchase or sale updates the shelf and cash in the same saved transaction. Removal returns the existing part to its shelf. An installed part occupies its mount at one turn of engagement; its fasteners need two more turns before the car can race.

## Reference and adaptation

The [garage study](https://github.com/kylofon/street-rod-2-sdl3/blob/9a3d488143d108985422c2eeb9501e4aa5a0fe72/port/spec/garage.md) and its companion bay, under-car and transmission implementations describe 64 parts in eight categories, an ignition connection, ignition adjustment from −5 through +3, mounting bolts with four engagement positions, two transmission mounts, and an under-car parts selector. The original supports up to three carburettors on an intake. These observations come from the independent reconstruction of the shipped DOS build.

Fuserod has its own 64 named parts and prices. The eight intakes use the first eight entries of the reference manifold table. Depending on the intake, the car needs one, two or three individually secured carburettors, or direct fuel injection. A four-barrel needs the wider flange. The lead must be unplugged to free the engine. Under-car work requires the jack. Removing the muffler leaves an open exhaust. Carburetion, exhaust, engine and distributor tuning affect horsepower, tyres affect grip, axle choice affects gearing, and the fitted transmission determines automatic shifting. Model-specific make restrictions, individual component wear and original catalogue values remain outside these rules.
