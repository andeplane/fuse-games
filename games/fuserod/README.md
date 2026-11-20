# Fuserod

Start from **Play → Single player**. In the classifieds buy a Kestrel Six. The garage holds your cars, parts and cash across visits on the same browser. Choose a rival, course and stake. Losing a title race can cost you the car.

Hold **W / ↑** for gas, steer with **A/D** or **←/→** and brake with **S / ↓**. An automatic shifts when you accelerate. In a manual, use **X** or **Space** to shift from neutral to first, watch the rev counter and downshift with **Z**. On phones the pedals, steering and manual gear controls are under the cockpit. The mirror shows a rival approaching from behind.

The classifieds cover 22 car models. In the workshop you can change tyres, adjust ignition timing and swap components from the 64-part catalogue. Check the car is off the jack, bolted together and ready to start before leaving. The logbook holds your licence and 15 save slots.

Wednesday's Grudge Night starts with a timed quarter mile. Your qualifying time sets your dial-in for the elimination races. Winning the grudge event and beating rivals on the two road courses opens the championship. The garage shows the remaining qualifying requirements.

The quarter mile is straight. The aqueduct has steep banks and a drainage trough. Mulholland picks one of ten canyon layouts with different bends, rises and worksites. The [course verification notes](src/course/README.md) include a reproducible comparison with the DOS road builder.

**Play → Host room** creates a separate race for up to five drivers. Choose a course in room settings, race alone or add an AI driver, or invite friends with the room code. Shared TV displays the race while seated devices drive. A race is one analytics round and one match. The room uses the shared 20 Hz rollback log and confirmed results. Career money and title stakes belong to solo play.

## Development

Run `pnpm install` and `pnpm dev` at the repository root, then open `/fuserod/?mute` on the printed URL. `pnpm exec tsx --test games/fuserod/tests/*.test.ts` runs the focused engine, recovery and campaign checks. With a current build, `pnpm exec tsx scripts/fuserod-smoke.ts` exercises the solo and room flows. Set `FUSEROD_URL` to exercise an existing local server.

The [motor probes](tests/reference/README.md) pin the executable digest, synthetic car setup, tick rates, reference inputs and trace digests. The [course probes](src/course/README.md) describe which contact decisions were measured independently. The [graphics inventory](src/art/README.md) describes the two DOS picture formats and the original artwork that fills those roles here. Reference binaries and DOS pictures are user-supplied inputs for private verification. The browser runs native TypeScript and renders newly drawn artwork.
