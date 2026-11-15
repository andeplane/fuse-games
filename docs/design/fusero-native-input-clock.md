# Native input cadence for Fusero

The Classic simulation samples human controls on its 11 ms physics pulses inside
10 ms outer frames. Fusero currently captures controls only at 50 ms Fuse log
boundaries, then runs five outer frames with that input. This changes short
press/release timing even when the individual physics kernels match native code.
A live desktop probe on `4176dd46` observed a 44.3 ms median and 50.5 ms p95 from
trusted key events to the public simulation view. Rendering interpolation alone
cannot recover the lost input timing.

Give the trusted game definition an optional log-clock duration. Existing games
keep the 50 ms default; Fusero selects 10 ms and runs one native outer frame per
log tick. This uses the existing room, transport, ordered streams and rollback
architecture. No gameplay relay or separate simulation service is introduced.
Changing the duration requires a rules-version bump so incompatible clients
refuse each other before applying inputs or checkpoints.

Clock elapsed-time, RTT, slew and snap conversions use the selected duration.
Duration-based tick windows retain their wall-time meaning: two seconds of
rollback/stall/history, twenty seconds of future-entry tolerance, 200 ms snapshot
cadence, one-second hash cadence, two-second hash lag and three-second snapshot
replay allowance. Entry/byte/allocation caps, snapshot count, retry counts,
wall-clock timeouts and simulation-step catch-up budgets retain their existing
bounds. The cadence comes from the local game contract, never an incoming packet.

Fusero keeps its independent integer physics/projectile clocks. A brief press
must survive an outer frame with no due physics pulse, including checkpoint and
rollback, so pending control edges are authoritative room state until sampled.
Presentation remains read-only interpolation and does not supply physics.

Verify both default and fast clocks with typed fake clocks/transports, including
RTT/slew, late/reordered inputs, time-equivalent history bounds and complete
checkpoint recovery. Then repeat native controls and multi-browser recovery
against the rebuilt app and repeat the trusted desktop response observation.
