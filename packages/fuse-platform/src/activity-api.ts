/** Public gameplay history, shared by every game. No account UIDs, room capabilities or replay evidence. */
export type ActivityMode = "solo" | "multiplayer" | "unknown";
export type ActivityKind = "match" | "round";
export type ActivityProof =
  "peer-agreed" | "account-reported" | "server-replayed";
export interface ActivityPlayer {
  id: string;
  publicId?: string;
  name: string;
  label?: string;
  bot: boolean;
  place: number;
  score: number;
  wins: number;
  stats: Record<string, number>;
}
export interface GameActivity {
  version: 1;
  id: string;
  gameId: string;
  groupId: string;
  kind: ActivityKind;
  mode: ActivityMode;
  proof: ActivityProof;
  endedAt: number;
  round?: number;
  rounds: number;
  title: string;
  winner?: string;
  players: ActivityPlayer[];
  /** Game-owned, server-validated result context. Values are deliberately flat and bounded. */
  context: Record<string, string | number | boolean>;
}
export interface ActivityCursor {
  at: number;
  id: string;
}
export interface ActivityQuery {
  /** HTTP source resolves this through verified authentication; database adapters receive a public player ID. */
  mine?: boolean;
  gameId?: string;
  player?: string;
  mode?: ActivityMode;
  kind?: ActivityKind;
  before?: ActivityCursor;
}
export interface ActivityPage {
  events: GameActivity[];
  next?: ActivityCursor;
  games?: string[];
}
export interface ActivityGroup {
  events: GameActivity[];
  truncated?: boolean;
}
export interface ActivitySource {
  list(query: ActivityQuery): Promise<ActivityPage>;
  event(id: string): Promise<GameActivity>;
  group(id: string): Promise<ActivityGroup>;
}
export const ACTIVITY_PAGE = 20;
export const ACTIVITY_GROUP_LIMIT = 100;
