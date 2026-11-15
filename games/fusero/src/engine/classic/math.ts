import sin from "@stdlib/math-base-special-sin";
import cos from "@stdlib/math-base-special-cos";
import atan2 from "@stdlib/math-base-special-atan2";

/** Pinned software implementations avoid browser-specific libm results entering rollback state. */
export { sin, cos, atan2 };
