import { createHash } from "node:crypto";
import {
  RoomError,
  digest,
  peerId,
  roomGameId,
  validCode,
  validToken,
  type RoomStore,
  type RoomRecord,
} from "fuse-network-be";
import { LEGACY_GAME_ID, type Platform } from "./game.js";
import type { Account } from "./settlement.js";
import {
  INVITE_TTL_MS,
  MAX_FRIENDS,
  MAX_PENDING,
  ONLINE_WINDOW_MS,
  PRESENCE_REFRESH_MS,
  PUBLIC_ID_LENGTH,
  cleanStatus,
  lastSeenOf,
  validPublicId,
  type Friend,
  type FriendCard,
  type FriendInvite,
  type FriendRelation,
  type FriendsSyncBody,
  type FriendsView,
  type RoomPlayer,
} from "./friends-api.js";
import type { HistoryDatabase } from "./history.js";
import { validUid } from "./identity.js";
import { plain } from "./result.js";
import {
  MAX_CONVERSATION_MESSAGES,
  MAX_MESSAGE_LENGTH,
  MESSAGE_HISTORY_MS,
  validMessageId,
  type FriendMessage,
  type FriendConversation,
} from "./messages-api.js";

/**
 * Friends, presence and invites for every game's accounts. Gameplay is peer-to-peer and the service pushes nothing,
 * so a client polls: one `sync` reports where it is and answers with everything its friends panel shows. A friend
 * is online while its last sync is recent, in a room while it last said so, and an invite is a short-lived record
 * the invited client finds on its next poll. Nothing here is on the settlement path: presence has its own record.
 */

/** The account's public id: what other players see and address, never the uid itself. */
export const publicIdOf = (uid: string): string =>
  createHash("sha256")
    .update(`public:${uid}`)
    .digest("hex")
    .slice(0, PUBLIC_ID_LENGTH);

export interface PresenceRecord {
  uid: string;
  publicId: string;
  /** When the account last synced. */
  at: number;
  name?: string;
  /** Normalized public display name for bounded prefix discovery. */
  searchName?: string;
  avatarId?: string;
  /** Present only while the account says it is away. */
  away?: true;
  /** The status line, already tidied by `cleanStatus`; absent when there is none. */
  status?: string;
  /** The room the account is in, bound to the room's incarnation: a reissued code is another room. */
  room?: {
    code: string;
    memberId: string;
    gameId: string;
    incarnation: string;
    /** Claim was authenticated with the seat token. */
    proven?: true;
    session?: string;
  };
}
/**
 * A presence document as an adapter reads it back. Records written before `away` and `status` existed have neither
 * and read as "not away, no status"; a document of another shape is refused rather than guessed at.
 */
export function storedPresence(value: unknown): PresenceRecord | undefined {
  if (!plain(value)) return;
  const room = value.room;
  if (
    !validUid(value.uid) ||
    !validPublicId(value.publicId) ||
    !Number.isSafeInteger(value.at) ||
    (value.name !== undefined && typeof value.name !== "string") ||
    (value.searchName !== undefined && typeof value.searchName !== "string") ||
    (value.avatarId !== undefined && typeof value.avatarId !== "string") ||
    (value.away !== undefined && typeof value.away !== "boolean") ||
    (value.status !== undefined && typeof value.status !== "string") ||
    (room !== undefined &&
      (!plain(room) ||
        typeof room.code !== "string" ||
        typeof room.memberId !== "string" ||
        typeof room.gameId !== "string" ||
        typeof room.incarnation !== "string"))
  )
    throw new Error("Stored presence is incompatible");
  return {
    uid: value.uid,
    publicId: value.publicId,
    at: value.at as number,
    ...(value.name === undefined ? {} : { name: value.name as string }),
    ...(value.searchName === undefined
      ? {}
      : { searchName: value.searchName as string }),
    ...(value.avatarId === undefined
      ? {}
      : { avatarId: value.avatarId as string }),
    ...(value.away === true ? { away: true as const } : {}),
    ...(value.status ? { status: value.status as string } : {}),
    ...(room === undefined
      ? {}
      : {
          room: {
            code: room.code as string,
            memberId: room.memberId as string,
            gameId: room.gameId as string,
            incarnation: room.incarnation as string,
            ...(room.proven === true ? { proven: true as const } : {}),
            ...(typeof room.session === "string" &&
            /^[a-f0-9]{32}$/.test(room.session)
              ? { session: room.session }
              : {}),
          },
        }),
  };
}
/** One friendship, requested or accepted; the pair is one record whichever side asked. */
export interface FriendEdge {
  id: string;
  uids: [string, string];
  requestedBy: string;
  status: "pending" | "accepted";
  at: number;
  /** The newest chat message's sender (an account id, never sent to clients) and time. */
  lastMessage?: { from: string; at: number };
}
export interface InviteRecord {
  id: string;
  from: string;
  to: string;
  code: string;
  gameId: string;
  at: number;
  expiresAt: number;
}

/** The friendship's newest chat message as a client sees it: sender by public id, inside the history window. */
function lastMessageOf(
  edge: FriendEdge,
  uid: string,
  other: string,
  now: number,
): Pick<Friend, "lastMessage"> {
  const last = edge.lastMessage;
  if (
    !last ||
    last.at <= now - MESSAGE_HISTORY_MS ||
    (last.from !== uid && last.from !== other)
  )
    return {};
  return { lastMessage: { from: publicIdOf(last.from), at: last.at } };
}

export interface FriendsDatabase {
  /** The friendship and its bounded transcript are read atomically, so unfriending immediately revokes chat. */
  transactConversation<T>(
    id: string,
    operation: (
      edge: FriendEdge | undefined,
      messages: FriendMessage[],
    ) => {
      messages?: FriendMessage[];
      /** The friendship as it should be stored after the operation, when it changed. */
      edge?: FriendEdge;
      result: T;
    },
  ): Promise<T>;
  presence(uid: string): Promise<PresenceRecord | undefined>;
  presences(uids: readonly string[]): Promise<PresenceRecord[]>;
  setPresence(record: PresenceRecord): Promise<void>;
  searchNames(prefix: string, limit: number): Promise<PresenceRecord[]>;
  /** The account behind a public id, if it has ever synced. */
  resolve(publicId: string): Promise<string | undefined>;
  /** Everyone whose presence names this room, at most `limit`. */
  roomPresences(code: string, limit: number): Promise<PresenceRecord[]>;
  /** Every edge naming the account, at most `limit`. */
  edges(uid: string, limit: number): Promise<FriendEdge[]>;
  /** Like RoomDatabase.transact: pure and retried; `edge: null` deletes. */
  transactEdge<T>(
    id: string,
    operation: (current: FriendEdge | undefined) => {
      edge?: FriendEdge | null;
      result: T;
    },
  ): Promise<T>;
  /** Invites addressed to the account, at most `limit`, expired ones included. */
  invites(uid: string, limit: number): Promise<InviteRecord[]>;
  invite(id: string): Promise<InviteRecord | undefined>;
  setInvite(record: InviteRecord): Promise<void>;
  deleteInvite(id: string): Promise<void>;
}

/** One document per pair, whoever asked. */
export const edgeId = (a: string, b: string): string =>
  a < b ? `${a}|${b}` : `${b}|${a}`;
export const inviteId = (from: string, to: string, code: string): string =>
  digest(`invite:${from}:${to}:${code}`).slice(0, 32);

const SYNCS_PER_HOUR = 400,
  ADDS_PER_HOUR = 30,
  INVITES_PER_HOUR = 60,
  EDGE_LIMIT = 2 * MAX_FRIENDS + 50,
  INVITE_LIMIT = 20;

export class FriendsStore {
  constructor(
    private platform: Platform,
    private history: HistoryDatabase,
    private database: FriendsDatabase,
    private rooms: RoomStore,
    private now: () => number,
  ) {}

  private async allow(key: string, limit: number): Promise<void> {
    if (
      !(await this.rooms.database.allowance(
        digest(`friends-${key}`),
        this.now(),
        limit,
      ))
    )
      throw new RoomError(429, "Too many requests; try later");
  }

  /** Only public cards leave this boundary; presence, room and account ids stay private. */
  async search(uid: string, query: unknown): Promise<FriendCard[]> {
    if (
      typeof query !== "string" ||
      query.trim().length < 2 ||
      query.length > 64
    )
      throw new RoomError(400, "Enter 2 to 64 characters of a friend's name");
    await this.allow(`search:${uid}`, 120);
    const prefix = query.trim().toLowerCase();
    const matches = await this.database.searchNames(prefix, 21);
    const accounts = await this.history.accounts(matches.map((p) => p.uid));
    return matches
      .filter((p) => p.uid !== uid)
      .map((p) => this.card(p.uid, accounts.get(p.uid), p))
      .filter((card) => card.name.toLowerCase().startsWith(prefix))
      .slice(0, 20);
  }

  /** The name and head other players see: the chosen username first, then the name the player last showed up with. */
  private card(
    uid: string,
    account: Account | undefined,
    presence: PresenceRecord | undefined,
  ): FriendCard {
    const avatarId = account?.avatarId ?? presence?.avatarId;
    return {
      publicId: publicIdOf(uid),
      name:
        account?.username ??
        presence?.name ??
        account?.name ??
        this.platform.account.fallbackName,
      ...(avatarId ? { avatarId } : {}),
    };
  }

  /** The body as sent, checked field by field; `status` comes back tidied. Nothing is stored before this passes. */
  private parseSync(body: unknown): FriendsSyncBody {
    if (
      !plain(body) ||
      !Object.keys(body).every((key) =>
        ["name", "avatarId", "room", "passive", "away", "status"].includes(key),
      ) ||
      (body.name !== undefined &&
        !this.platform.account.validName(body.name)) ||
      (body.avatarId !== undefined &&
        !this.platform.account.validAvatar(body.avatarId)) ||
      (body.passive !== undefined && typeof body.passive !== "boolean") ||
      (body.away !== undefined && typeof body.away !== "boolean") ||
      // A passive page is by definition not the one in the room, so it has no claim to make.
      (body.passive === true && body.room !== undefined)
    )
      throw new RoomError(400, "Invalid presence");
    let status: string | undefined;
    if (body.status !== undefined) {
      status = cleanStatus(body.status);
      if (status === undefined) throw new RoomError(400, "Invalid presence");
    }
    const room = body.room;
    if (room !== undefined) {
      if (
        !plain(room) ||
        !Object.keys(room).every((key) =>
          ["code", "memberId", "gameId", "token", "session"].includes(key),
        ) ||
        typeof room.code !== "string" ||
        !validCode(room.code) ||
        typeof room.memberId !== "string" ||
        !/^[a-f0-9]{24}$/.test(room.memberId) ||
        typeof room.token !== "string" ||
        !validToken(room.token) ||
        typeof room.session !== "string" ||
        !/^[a-f0-9]{32}$/.test(room.session) ||
        (room.gameId !== undefined &&
          (typeof room.gameId !== "string" ||
            !this.platform.gameIds.includes(room.gameId)))
      )
        throw new RoomError(400, "Invalid presence");
    }
    return {
      ...(body as FriendsSyncBody),
      ...(status === undefined ? {} : { status }),
    };
  }

  /**
   * Record where the caller is and answer with its friends. The presence record is rewritten only when something in
   * it changed or it is about to fall out of the online window, so an idle poll costs reads alone.
   */
  async sync(uid: string, body: unknown): Promise<FriendsView> {
    await this.allow(`sync:${uid}`, SYNCS_PER_HOUR);
    const claim = this.parseSync(body),
      now = this.now();
    const current = await this.database.presence(uid);
    const passive = claim.passive === true,
      stored =
        current?.room?.proven && current.room.session
          ? current.room
          : undefined,
      due = !current || now - current.at >= PRESENCE_REFRESH_MS;
    // A passive poll (the desktop around an embedded game) makes no claim of its own: it carries the stored one
    // forward, so the two pages of one account do not overwrite each other's room every poll.
    const claimed = passive
      ? stored && {
          code: stored.code,
          memberId: stored.memberId,
          gameId: stored.gameId,
          session: stored.session!,
        }
      : claim.room
        ? {
            code: claim.room.code,
            memberId: claim.room.memberId,
            gameId: claim.room.gameId ?? LEGACY_GAME_ID,
            session: claim.room.session,
          }
        : undefined;
    if (
      !passive &&
      claim.room &&
      peerId(claim.room.token) !== claim.room.memberId
    )
      throw new RoomError(403, "Join the room first");
    // An active page proves possession on every request. Passive pages can only carry a previously
    // proven claim, and periodically recheck the live seat and room incarnation.
    let room: PresenceRecord["room"];
    let liveRoom: RoomRecord | undefined;
    if (claimed && !passive) {
      liveRoom = await this.rooms.database.transact(
        claimed.code,
        (currentRoom) => {
          const seat = currentRoom?.members[claimed.memberId];
          if (
            !currentRoom ||
            currentRoom.expiresAt <= now ||
            !seat ||
            seat.expiresAt <= now ||
            roomGameId(currentRoom) !== claimed.gameId
          )
            throw new RoomError(403, "Join the room first");
          const owner = publicIdOf(uid),
            previous = seat.presence;
          if (
            previous?.retired.includes(claimed.session) ||
            (previous?.session === claimed.session && previous.owner !== owner)
          )
            throw new RoomError(
              409,
              "Presence session replaced; sign in again",
            );
          if (!previous || previous.session !== claimed.session) {
            const retired = previous
              ? [...previous.retired, previous.session]
              : [];
            if (retired.length > 128)
              throw new RoomError(
                409,
                "Too many presence sessions; rejoin the room",
              );
            seat.presence = { owner, session: claimed.session, retired };
            currentRoom.revision++;
            return { room: currentRoom, result: currentRoom };
          }
          return { result: currentRoom };
        },
      );
      room = { ...claimed, incarnation: liveRoom.incarnation, proven: true };
    } else if (claimed && passive) {
      try {
        const record = await this.rooms.get(claimed.code);
        const seat = record.members[claimed.memberId];
        if (
          record.incarnation === stored!.incarnation &&
          roomGameId(record) === claimed.gameId &&
          seat &&
          seat.expiresAt > now &&
          seat.presence?.owner === publicIdOf(uid) &&
          seat.presence.session === claimed.session
        )
          room = { ...claimed, incarnation: record.incarnation, proven: true };
      } catch (error) {
        if (!(error instanceof RoomError && error.status === 404)) throw error;
      }
    }
    // A poll that names nothing keeps the name, head and status the player last showed up with.
    const name = claim.name ?? current?.name,
      avatarId = claim.avatarId ?? current?.avatarId,
      status = claim.status ?? current?.status;
    // Away: an active page that does not say is in use (every client from before the field, and it heals an "away"
    // left behind by a page that closed). A passive page keeps what is stored unless it says, and says nothing
    // that counts while the account is in a room, where the page in the room speaks for it. Coming back is recorded
    // at once; going away rides the periodic rewrite, so two pages that disagree cannot cost a write per poll.
    const reported = passive
      ? room
        ? undefined
        : claim.away
      : (claim.away ?? false);
    const away =
      reported === undefined
        ? current?.away === true
        : reported && (due || current?.away === true);
    const next: PresenceRecord = {
      uid,
      publicId: publicIdOf(uid),
      at: now,
      ...(name === undefined ? {} : { name }),
      ...(avatarId === undefined ? {} : { avatarId }),
      ...(away ? { away: true as const } : {}),
      ...(status ? { status } : {}),
      ...(room ? { room } : {}),
    };
    const same = (a: unknown, b: unknown) =>
      JSON.stringify(a) === JSON.stringify(b);
    const ownAccounts = await this.history.accounts([uid]);
    next.searchName = this.card(
      uid,
      ownAccounts.get(uid),
      next,
    ).name.toLowerCase();
    if (
      due ||
      current.name !== next.name ||
      current.searchName !== next.searchName ||
      current.avatarId !== next.avatarId ||
      current.away !== next.away ||
      current.status !== next.status ||
      !same(current.room, next.room)
    )
      await this.database.setPresence(next);
    // The room's signed-in members are for the page in the room; a passive poll does not pay for that query.
    const here = passive ? undefined : room;
    // Resolve only current live seat owners. Room capacity bounds these lookups; stale presence rows
    // from previous sessions or room incarnations cannot consume a limited query page.
    const owners =
      here && liveRoom
        ? [
            ...new Set(
              Object.values(liveRoom.members)
                .filter((member) => member.expiresAt > now && member.presence)
                .map((member) => member.presence!.owner),
            ),
          ]
        : [];
    const ownerUids = (
      await Promise.all(owners.map((id) => this.database.resolve(id)))
    ).filter((id): id is string => id !== undefined);
    const [edges, pending, seated] = await Promise.all([
      this.database.edges(uid, EDGE_LIMIT),
      this.database
        .invites(uid, INVITE_LIMIT)
        .then((invites) => invites.filter((i) => i.expiresAt > now)),
      this.database.presences(ownerUids),
    ]);
    const others = edges.map((edge) =>
      edge.uids[0] === uid ? edge.uids[1] : edge.uids[0],
    );
    const presences = new Map<string, PresenceRecord>([[uid, next]]);
    for (const p of seated) presences.set(p.uid, p);
    // An invite from someone no longer a friend still names its sender.
    const wanted = [
      ...new Set([...others, ...pending.map((invite) => invite.from)]),
    ].filter((other) => !presences.has(other));
    for (const p of await this.database.presences(wanted))
      presences.set(p.uid, p);
    const accounts = await this.history.accounts(
      [...presences.keys()].filter((who) => who !== uid),
    );
    for (const [who, account] of ownAccounts) accounts.set(who, account);
    const cards = new Map<string, FriendCard>();
    const cardOf = (who: string): FriendCard => {
      let card = cards.get(who);
      if (!card) {
        card = this.card(who, accounts.get(who), presences.get(who));
        cards.set(who, card);
      }
      return card;
    };
    const online = (p: PresenceRecord): boolean =>
      now - p.at < ONLINE_WINDOW_MS;
    const friends: Friend[] = [],
      incoming: FriendCard[] = [],
      outgoing: FriendCard[] = [],
      relations = new Map<string, FriendRelation>([[uid, "you"]]);
    for (const [index, edge] of edges.entries()) {
      const other = others[index]!,
        card = cardOf(other);
      if (edge.status === "accepted") {
        const p = presences.get(other);
        friends.push(
          p && online(p)
            ? {
                ...card,
                online: true,
                ...(p.away ? { away: true as const } : {}),
                ...(p.status ? { status: p.status } : {}),
                ...(p.room?.proven
                  ? { room: { code: p.room.code, gameId: p.room.gameId } }
                  : {}),
                ...lastMessageOf(edge, uid, other, now),
              }
            : {
                ...card,
                online: false,
                ...(p ? { lastSeen: lastSeenOf(p.at) } : {}),
                ...lastMessageOf(edge, uid, other, now),
              },
        );
        relations.set(other, "friend");
      } else if (edge.requestedBy === uid) {
        outgoing.push(card);
        relations.set(other, "outgoing");
      } else {
        incoming.push(card);
        relations.set(other, "incoming");
      }
    }
    const byName = (a: FriendCard, b: FriendCard) =>
      a.name.localeCompare(b.name) || a.publicId.localeCompare(b.publicId);
    friends.sort((a, b) => Number(b.online) - Number(a.online) || byName(a, b));
    incoming.sort(byName);
    outgoing.sort(byName);
    const invites: FriendInvite[] = [];
    for (const invite of pending) {
      invites.push({
        id: invite.id,
        from: cardOf(invite.from),
        code: invite.code,
        gameId: invite.gameId,
        at: invite.at,
      });
    }
    invites.sort((a, b) => b.at - a.at);
    const roomPlayers: RoomPlayer[] = [];
    if (here) {
      const seenPublic = new Set<string>();
      const seatCounts = new Map<string, number>();
      for (const p of seated) {
        if (
          online(p) &&
          p.room?.proven &&
          p.room.code === here.code &&
          p.room.incarnation === here.incarnation &&
          (liveRoom?.members[p.room.memberId]?.expiresAt ?? 0) > now &&
          liveRoom?.members[p.room.memberId]?.presence?.owner === p.publicId &&
          liveRoom?.members[p.room.memberId]?.presence?.session ===
            p.room.session
        )
          seatCounts.set(
            p.room.memberId,
            (seatCounts.get(p.room.memberId) ?? 0) + 1,
          );
      }
      for (const p of seated) {
        if (
          !online(p) ||
          !p.room?.proven ||
          seatCounts.get(p.room.memberId) !== 1 ||
          liveRoom?.members[p.room.memberId]?.presence?.owner !== p.publicId ||
          liveRoom?.members[p.room.memberId]?.presence?.session !==
            p.room.session ||
          seenPublic.has(p.publicId) ||
          p.room.code !== here.code ||
          p.room.incarnation !== here.incarnation
        )
          continue;
        seenPublic.add(p.publicId);
        roomPlayers.push({
          memberId: p.room.memberId,
          publicId: p.publicId,
          name: cardOf(p.uid).name,
          relation: relations.get(p.uid) ?? "none",
        });
      }
      roomPlayers.sort((a, b) => a.memberId.localeCompare(b.memberId));
    }
    return {
      me: cardOf(uid),
      friends,
      incoming,
      outgoing,
      invites,
      roomPlayers,
    };
  }

  /** The account behind a public id, refused as not found when none has synced under it. */
  private async resolve(publicId: unknown): Promise<string> {
    if (!validPublicId(publicId)) throw new RoomError(400, "Invalid player id");
    const uid = await this.database.resolve(publicId);
    if (uid === undefined || !validUid(uid))
      throw new RoomError(404, "Player not found");
    return uid;
  }

  /**
   * Ask to be friends, or accept: a request the other side already made becomes a friendship, and asking twice is
   * the same request. Both sides count towards the friend limit, so no one can be handed more friends than they can hold.
   */
  async add(
    uid: string,
    body: unknown,
  ): Promise<{ status: FriendEdge["status"] }> {
    if (!plain(body) || Object.keys(body).length !== 1)
      throw new RoomError(400, "Invalid player id");
    await this.allow(`add:${uid}`, ADDS_PER_HOUR);
    const other = await this.resolve(body.publicId);
    if (other === uid) throw new RoomError(400, "That is you");
    const [mine, theirs] = await Promise.all([
      this.database.edges(uid, EDGE_LIMIT),
      this.database.edges(other, EDGE_LIMIT),
    ]);
    const accepted = (edges: FriendEdge[]) =>
      edges.filter((edge) => edge.status === "accepted").length;
    if (accepted(mine) >= MAX_FRIENDS || accepted(theirs) >= MAX_FRIENDS)
      throw new RoomError(409, "Friend list is full");
    // Pending requests are bounded too, in both directions, so many accounts cannot bury one under requests.
    const pendingFrom = (edges: FriendEdge[], who: string) =>
      edges.filter(
        (edge) => edge.status === "pending" && edge.requestedBy === who,
      ).length;
    const pendingTo = (edges: FriendEdge[], who: string) =>
      edges.filter(
        (edge) => edge.status === "pending" && edge.requestedBy !== who,
      ).length;
    const existing = mine.find((edge) => edge.uids.includes(other));
    if (
      !existing &&
      (pendingFrom(mine, uid) >= MAX_PENDING ||
        pendingTo(theirs, other) >= MAX_PENDING)
    )
      throw new RoomError(409, "Too many pending requests");
    const now = this.now();
    return this.database.transactEdge(edgeId(uid, other), (current) => {
      if (current?.status === "accepted")
        return { result: { status: "accepted" } };
      const status: FriendEdge["status"] =
        current && current.requestedBy !== uid ? "accepted" : "pending";
      return {
        edge: {
          id: edgeId(uid, other),
          uids: uid < other ? [uid, other] : [other, uid],
          requestedBy: current?.requestedBy ?? uid,
          status,
          at: now,
        },
        result: { status },
      };
    });
  }

  /** Unfriend, decline or withdraw: whatever the pair's record is, it goes. */
  async remove(uid: string, publicId: string): Promise<{ removed: boolean }> {
    const other = await this.resolve(publicId);
    return this.database.transactEdge(edgeId(uid, other), (current) => ({
      ...(current ? { edge: null } : {}),
      result: { removed: current !== undefined },
    }));
  }

  /** Only the two accepted friends can read or send. A retry reuses its id and never duplicates a message. */
  async conversation(
    uid: string,
    publicId: string,
    body?: unknown,
  ): Promise<FriendConversation> {
    if (
      body !== undefined &&
      (!plain(body) ||
        Object.keys(body).length !== 2 ||
        !validMessageId(body.id) ||
        typeof body.text !== "string" ||
        body.text.length > MAX_MESSAGE_LENGTH ||
        !body.text.trim() ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.text))
    )
      throw new RoomError(
        400,
        "A message must contain 1 to 1000 plain-text characters",
      );
    await this.allow(
      `messages-${body === undefined ? "read" : "send"}:${uid}`,
      body === undefined ? 800 : 600,
    );
    const other = await this.resolve(publicId);
    const now = this.now();
    return this.database.transactConversation(
      edgeId(uid, other),
      (edge, stored) => {
        if (
          !edge ||
          edge.status !== "accepted" ||
          !edge.uids.includes(uid) ||
          !edge.uids.includes(other)
        )
          throw new RoomError(403, "Only accepted friends can chat");
        const messages = stored.filter(
          (message) => message.at > now - MESSAGE_HISTORY_MS,
        );
        let sent = false;
        if (body !== undefined) {
          // Validated above, before any storage operation.
          const input = body as { id: string; text: string };
          const from = publicIdOf(uid);
          const existing = messages.find(
            (message) => message.from === from && message.id === input.id,
          );
          if (existing && existing.text !== input.text.trim())
            throw new RoomError(
              409,
              "That message was already sent with different text",
            );
          if (!existing) {
            messages.push({
              id: input.id,
              from,
              text: input.text.trim(),
              at: now,
            });
            sent = true;
          }
        }
        const recent = messages.slice(-MAX_CONVERSATION_MESSAGES);
        return {
          ...(body !== undefined || recent.length !== stored.length
            ? { messages: recent }
            : {}),
          // The buddy list's poll reads the friendship anyway: marking it here lets a closed chat pop up for free.
          ...(sent
            ? { edge: { ...edge, lastMessage: { from: uid, at: now } } }
            : {}),
          result: { messages: recent },
        };
      },
    );
  }

  /**
   * Invite friends to a room the caller is a live member of, proven by its room token as a result report is. Only
   * accepted friends are invited; anyone else in the list is skipped, not refused, so one stale name cannot block
   * the rest. Inviting the same friend to the same room again refreshes the one invite.
   */
  async invite(
    code: string,
    roomToken: string,
    uid: string,
    body: unknown,
  ): Promise<{ sent: number }> {
    if (!validCode(code) || !validToken(roomToken))
      throw new RoomError(401, "Invalid identity");
    if (
      !plain(body) ||
      Object.keys(body).length !== 1 ||
      !Array.isArray(body.to) ||
      body.to.length > MAX_FRIENDS ||
      !body.to.every(validPublicId)
    )
      throw new RoomError(400, "Invalid invite");
    const room = await this.rooms.get(code),
      member = room.members[peerId(roomToken)];
    if (!member || member.expiresAt <= this.now())
      throw new RoomError(403, "Join the room first");
    await this.allow(`invite:${uid}`, INVITES_PER_HOUR);
    const friends = new Map(
      (await this.database.edges(uid, EDGE_LIMIT))
        .filter((edge) => edge.status === "accepted")
        .map((edge) => {
          const other = edge.uids[0] === uid ? edge.uids[1] : edge.uids[0];
          return [publicIdOf(other), other];
        }),
    );
    const now = this.now(),
      gameId = roomGameId(room);
    let sent = 0;
    for (const publicId of new Set(body.to as string[])) {
      const to = friends.get(publicId);
      if (to === undefined) continue;
      await this.database.setInvite({
        id: inviteId(uid, to, code),
        from: uid,
        to,
        code,
        gameId,
        at: now,
        expiresAt: now + INVITE_TTL_MS,
      });
      sent++;
    }
    return { sent };
  }

  /** Clear an invite from the list; only its addressee can, and one already gone is fine. */
  async dismissInvite(uid: string, id: string): Promise<void> {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new RoomError(400, "Invalid invite");
    const invite = await this.database.invite(id);
    if (invite && invite.to === uid) await this.database.deleteInvite(id);
  }
}

/** Single-process FriendsDatabase with the Firestore adapter's contract; everything is gone when the process exits. */
export class MemoryFriendsDatabase implements FriendsDatabase {
  private conversations = new Map<string, FriendMessage[]>();
  private presenceByUid = new Map<string, PresenceRecord>();
  private edgesById = new Map<string, FriendEdge>();
  private invitesById = new Map<string, InviteRecord>();
  private chain: Promise<unknown> = Promise.resolve();

  async presence(uid: string): Promise<PresenceRecord | undefined> {
    return structuredClone(this.presenceByUid.get(uid));
  }
  async presences(uids: readonly string[]): Promise<PresenceRecord[]> {
    return uids.flatMap((uid) => {
      const record = this.presenceByUid.get(uid);
      return record ? [structuredClone(record)] : [];
    });
  }
  async setPresence(record: PresenceRecord): Promise<void> {
    this.presenceByUid.set(record.uid, structuredClone(record));
  }
  async searchNames(prefix: string, limit: number): Promise<PresenceRecord[]> {
    return [...this.presenceByUid.values()]
      .filter((p) => p.searchName?.startsWith(prefix))
      .sort(
        (a, b) =>
          a.searchName!.localeCompare(b.searchName!) ||
          a.uid.localeCompare(b.uid),
      )
      .slice(0, limit)
      .map((p) => structuredClone(p));
  }
  async resolve(publicId: string): Promise<string | undefined> {
    for (const record of this.presenceByUid.values())
      if (record.publicId === publicId) return record.uid;
    return undefined;
  }
  async roomPresences(code: string, limit: number): Promise<PresenceRecord[]> {
    return [...this.presenceByUid.values()]
      .filter((record) => record.room?.code === code)
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }
  async edges(uid: string, limit: number): Promise<FriendEdge[]> {
    return [...this.edgesById.values()]
      .filter((edge) => edge.uids.includes(uid))
      .slice(0, limit)
      .map((edge) => structuredClone(edge));
  }
  transactEdge<T>(
    id: string,
    operation: (current: FriendEdge | undefined) => {
      edge?: FriendEdge | null;
      result: T;
    },
  ): Promise<T> {
    const work = this.chain.then(() => {
      const next = operation(structuredClone(this.edgesById.get(id)));
      if (next.edge === null) {
        this.edgesById.delete(id);
        this.conversations.delete(id);
      } else if (next.edge) this.edgesById.set(id, structuredClone(next.edge));
      return next.result;
    });
    this.chain = work.catch(() => undefined);
    return work;
  }
  transactConversation<T>(
    id: string,
    operation: (
      edge: FriendEdge | undefined,
      messages: FriendMessage[],
    ) => {
      messages?: FriendMessage[];
      edge?: FriendEdge;
      result: T;
    },
  ): Promise<T> {
    const work = this.chain.then(() => {
      const next = operation(
        structuredClone(this.edgesById.get(id)),
        structuredClone(this.conversations.get(id) ?? []),
      );
      if (next.messages)
        this.conversations.set(id, structuredClone(next.messages));
      if (next.edge && this.edgesById.has(id))
        this.edgesById.set(id, structuredClone(next.edge));
      return next.result;
    });
    this.chain = work.catch(() => undefined);
    return work;
  }
  async invites(uid: string, limit: number): Promise<InviteRecord[]> {
    return [...this.invitesById.values()]
      .filter((invite) => invite.to === uid)
      .slice(0, limit)
      .map((invite) => structuredClone(invite));
  }
  async invite(id: string): Promise<InviteRecord | undefined> {
    return structuredClone(this.invitesById.get(id));
  }
  async setInvite(record: InviteRecord): Promise<void> {
    this.invitesById.set(record.id, structuredClone(record));
  }
  async deleteInvite(id: string): Promise<void> {
    this.invitesById.delete(id);
  }
}
