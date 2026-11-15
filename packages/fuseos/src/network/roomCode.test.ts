import {
  isRoomCode,
  normalizeRoomCode,
  roomCodeInUrl,
  roomUrl,
} from "./roomCode";

describe(isRoomCode.name, () => {
  it("accepts six uppercase letters or digits only", () => {
    expect(isRoomCode("AB42AA")).toBe(true);
    expect(isRoomCode("ZZ00AA")).toBe(true);
    expect(isRoomCode("ab42")).toBe(false);
    expect(isRoomCode("AB4")).toBe(false);
    expect(isRoomCode("ABCD")).toBe(false);
    expect(isRoomCode("1234")).toBe(false);
    expect(isRoomCode(" AB42AA")).toBe(false);
    expect(isRoomCode(42)).toBe(false);
    expect(isRoomCode(null)).toBe(false);
  });
});

describe(normalizeRoomCode.name, () => {
  it("trims and upper-cases what was typed without validating it", () => {
    expect(normalizeRoomCode("  ab42aa ")).toBe("AB42AA");
    expect(normalizeRoomCode("xyz")).toBe("XYZ");
  });
});

describe(roomUrl.name, () => {
  it("adds ?room= to a plain game URL and &room= after an existing query", () => {
    expect(roomUrl("/fuse-riders/fuseball/", "AB42AA")).toBe(
      "/fuse-riders/fuseball/?room=AB42AA",
    );
    expect(roomUrl("./fuseball/?mute", "AB42AA")).toBe(
      "./fuseball/?mute&room=AB42AA",
    );
  });
});

describe(roomCodeInUrl.name, () => {
  it("reads a valid room from a page's query, upper-casing it", () => {
    expect(roomCodeInUrl("?room=AB42AA")).toBe("AB42AA");
    expect(roomCodeInUrl("?mute&room=ab42aa&display=1")).toBe("AB42AA");
  });

  it("is null without a room or with one the service would never issue", () => {
    expect(roomCodeInUrl("")).toBeNull();
    expect(roomCodeInUrl("?solo=1")).toBeNull();
    expect(roomCodeInUrl("?room=")).toBeNull();
    expect(roomCodeInUrl("?room=nope")).toBeNull();
  });
});
