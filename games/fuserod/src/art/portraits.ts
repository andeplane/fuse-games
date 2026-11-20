import { ellipse, fill, metal, rect, stroke, type Brush } from "./drawing";

const palettes = [
  {
    skin: "#dd9d73",
    light: "#f8c697",
    shade: "#96624f",
    hair: "#523936",
    shirt: "#4ba799",
    bg: "#344f5a",
  },
  {
    skin: "#a36c50",
    light: "#cb916d",
    shade: "#70463b",
    hair: "#292632",
    shirt: "#ce8d54",
    bg: "#6e4c52",
  },
  {
    skin: "#915d4c",
    light: "#b57860",
    shade: "#603c37",
    hair: "#302737",
    shirt: "#8d729f",
    bg: "#514359",
  },
  {
    skin: "#d69471",
    light: "#efb793",
    shade: "#a46350",
    hair: "#34313a",
    shirt: "#4d8197",
    bg: "#4a6065",
  },
  {
    skin: "#c98970",
    light: "#e7ac8b",
    shade: "#8c574c",
    hair: "#3f2d35",
    shirt: "#bf5759",
    bg: "#61464f",
  },
] as const;

const haircuts = [
  "M48 66 Q41 41 52 26 Q70 10 97 21 L113 34 102 49 94 41 Q77 34 63 50 L60 65 54 57 54 71Z",
  "M46 64 Q39 55 43 43 Q39 33 50 29 Q48 19 62 18 Q68 8 78 14 Q90 8 99 17 Q115 19 115 30 Q125 42 111 48 L102 52 Q96 41 84 43 L65 48 57 61 57 73Z",
  "M35 99 Q24 88 33 78 Q23 63 34 55 Q27 44 40 38 Q37 23 50 24 Q51 8 67 15 Q77 4 88 13 Q103 6 106 19 Q123 19 118 34 Q129 44 115 54 L104 58 Q99 46 92 43 Q70 41 61 58 L56 93 48 112Z",
  "M45 79 Q28 72 35 55 Q33 39 47 34 Q51 17 71 20 Q96 10 111 34 L108 48 Q88 38 78 47 Q67 49 59 67 L58 91 54 103 47 94Z",
  "M44 68 Q32 55 42 39 Q30 21 49 23 Q62 6 84 10 Q118 6 121 27 Q123 39 108 45 Q102 36 92 36 Q78 42 64 49 L60 64 54 61 57 79Z",
] as const;

// Name order follows the driver's licence number in garage/drivers.ts. Each
// silhouette is inked from the forehead to the nape at the same print scale.
const guests = [
  {
    skin: 1,
    shirt: "#44818d",
    ink: "#40323b",
    hair: "M45 71 Q35 45 48 29 Q61 15 92 23 L112 37 107 46 87 43 66 51 55 73Z",
    trim: "flatcap",
    lean: -3,
  },
  {
    skin: 0,
    shirt: "#a55469",
    ink: "#793d30",
    hair: "M37 100 Q26 59 43 36 Q58 12 91 22 L106 36 Q91 32 73 48 L65 61 59 92 48 110Z",
    trim: "scarf",
    lean: 2,
  },
  {
    skin: 3,
    shirt: "#658d79",
    ink: "#b4a39b",
    hair: "M44 66 L41 40 50 29 54 32 59 22 66 26 72 18 82 23 95 20 108 32 111 44 99 41 83 42 66 50 55 68Z",
    trim: "rounds",
    lean: -2,
  },
  {
    skin: 2,
    shirt: "#be8155",
    ink: "#272336",
    hair: "M44 67 Q43 29 69 24 Q95 18 108 31 L111 40 95 38 69 44 56 60 52 72Z",
    trim: "beard",
    lean: 3,
  },
  {
    skin: 0,
    shirt: "#b95c48",
    ink: "#813f37",
    hair: "M28 84 Q21 66 38 57 Q26 39 42 35 Q37 22 52 25 Q59 9 77 21 Q94 10 105 28 L113 42 97 37 88 46 75 40 63 53 59 72 49 72 44 86Z",
    trim: "freckles",
    lean: 2,
  },
  {
    skin: 2,
    shirt: "#4e9696",
    ink: "#352c3a",
    hair: "M36 94 Q23 72 40 66 Q28 62 37 45 Q30 29 48 28 Q40 14 61 18 Q67 3 82 16 Q94 6 104 22 Q122 20 118 43 L102 52 95 39 78 43 65 55 54 85Z",
    trim: "hoops",
    lean: -2,
  },
  {
    skin: 4,
    shirt: "#7e8793",
    ink: "#4b3933",
    hair: "M45 62 L43 38 Q48 24 63 22 L97 19 109 28 111 42 90 40 76 43 63 48 57 62Z",
    trim: "stache",
    lean: 3,
  },
  {
    skin: 3,
    shirt: "#8b659a",
    ink: "#262938",
    hair: "M39 91 L35 55 Q33 27 55 20 Q86 7 106 28 L115 43 87 42 84 53 80 44 66 48 59 77 49 96Z",
    trim: "cats",
    lean: -2,
  },
  {
    skin: 1,
    shirt: "#587759",
    ink: "#645347",
    hair: "M44 72 Q37 49 48 29 Q68 13 91 24 L107 37 97 42 81 39 68 46 58 60 55 72Z",
    trim: "beanie",
    lean: 1,
  },
  {
    skin: 4,
    shirt: "#517eaa",
    ink: "#453143",
    hair: "M29 106 Q16 86 35 68 Q20 53 35 40 Q52 15 72 17 Q98 15 111 39 L99 46 90 41 77 46 66 54 53 81 47 106Z",
    trim: "stripe",
    lean: 3,
  },
  {
    skin: 1,
    shirt: "#cc9355",
    ink: "#2d2c35",
    hair: "M45 64 Q38 46 49 34 Q42 25 61 25 Q59 12 74 17 Q78 5 91 13 L109 27 112 44 90 39 72 47 59 59 55 72Z",
    trim: "goggles",
    lean: -3,
  },
  {
    skin: 4,
    shirt: "#c16776",
    ink: "#88462d",
    hair: "M38 91 Q23 65 40 41 Q32 29 52 25 Q51 13 69 18 Q79 5 97 13 Q115 17 118 30 Q106 40 85 36 L72 47 59 71 52 94Z",
    trim: "flower",
    lean: 1,
  },
  {
    skin: 2,
    shirt: "#62687e",
    ink: "#262836",
    hair: "M45 65 L44 41 Q47 29 57 27 L92 24 105 30 111 44 97 43 82 40 66 46 56 65Z",
    trim: "goatee",
    lean: 3,
  },
  {
    skin: 0,
    shirt: "#7f94a6",
    ink: "#d1bca0",
    hair: "M39 90 Q30 69 37 47 Q35 30 52 25 Q60 11 79 19 Q97 11 107 26 L110 39 96 34 88 46 84 37 71 48 62 67 53 93Z",
    trim: "pearls",
    lean: -3,
  },
  {
    skin: 3,
    shirt: "#55778b",
    ink: "#523d38",
    hair: "M41 76 Q36 43 49 32 Q63 17 89 24 L105 34 109 45 95 39 74 46 61 55 56 70Z",
    trim: "sailor",
    lean: 3,
  },
  {
    skin: 1,
    shirt: "#95675a",
    ink: "#272938",
    hair: "M45 73 Q30 45 46 31 Q34 16 55 19 Q71 2 91 15 Q116 9 120 24 Q121 41 100 42 L87 37 68 49 60 62 54 61 55 74Z",
    trim: "lapels",
    lean: 2,
  },
  {
    skin: 4,
    shirt: "#a48a58",
    ink: "#443632",
    hair: "M39 97 Q29 73 40 49 Q35 32 51 27 Q59 13 82 19 Q99 15 110 34 L113 44 97 39 77 46 66 55 61 78 52 101Z",
    trim: "kerchief",
    lean: -2,
  },
] as const;

function detail(
  g: Brush,
  trim: (typeof guests)[number]["trim"],
  ink: string,
  accent: string,
) {
  switch (trim) {
    case "flatcap":
      fill(
        g,
        "#887557",
        "M38 48 Q36 25 59 19 Q91 11 109 31 L121 35 115 40 90 40 55 52Z",
      );
      stroke(g, "#514a46", 2, "M46 47 Q77 27 110 33 M64 19 L73 35");
      break;
    case "scarf":
    case "kerchief":
      fill(
        g,
        trim === "scarf" ? "#e5c38d" : "#64948e",
        "M56 99 L79 108 98 97 97 107 84 116 93 130 83 128 76 119 68 128 61 125 67 111Z",
      );
      break;
    case "rounds":
      stroke(
        g,
        ink,
        2.5,
        "M57 58 L63 58 M83 56 L94 54 M64 59 a9 8 0 1 0 18 -2 a9 8 0 1 0 -18 2 M94 55 a6 7 0 1 0 12 -2 a6 7 0 1 0 -12 2",
      );
      break;
    case "beard":
    case "goatee":
      fill(
        g,
        ink,
        trim === "beard"
          ? "M56 68 L68 79 78 83 86 85 100 77 106 71 Q102 93 88 99 L75 97 63 89Z"
          : "M77 84 Q88 88 98 80 L94 92 86 98 79 92Z",
      );
      break;
    case "freckles":
      for (const [x, y] of [
        [68, 68],
        [73, 71],
        [77, 67],
        [81, 69],
        [100, 64],
        [102, 67],
      ] as const)
        ellipse(g, "#985b4a", x, y, 1.2, 1);
      break;
    case "hoops":
    case "pearls":
      if (trim === "hoops")
        stroke(
          g,
          "#edc073",
          3,
          "M54 74 C42 72 45 95 55 91 C62 86 61 77 54 74Z",
        );
      else
        for (let i = 0; i < 11; i++)
          ellipse(
            g,
            "#f1e0c4",
            61 + i * 3.3,
            101 + Math.sin((i * Math.PI) / 10) * 11,
            2.1,
            2.1,
          );
      break;
    case "stache":
      fill(
        g,
        ink,
        "M74 78 Q78 72 86 73 L88 74 Q96 68 100 72 L103 75 Q97 73 93 78 L87 79 83 77Z",
      );
      break;
    case "cats":
      fill(
        g,
        "#8c494c",
        "M58 53 L80 53 88 56 91 53 112 44 108 58 96 62 90 57 85 60 78 66 67 65Z",
      );
      break;
    case "beanie":
      fill(
        g,
        "#bb714d",
        "M40 50 Q38 21 61 17 Q90 7 104 32 L111 40 104 44 94 39 74 42 48 53Z",
      );
      stroke(
        g,
        "#e8ad74",
        2,
        "M44 45 Q75 26 106 37 M59 21 L64 33 M71 17 L74 30 M84 17 L87 29",
      );
      break;
    case "stripe":
      fill(g, "#e7b888", "M43 53 Q53 22 78 20 Q59 33 55 53 L46 72Z");
      break;
    case "goggles":
      stroke(g, "#463f40", 5, "M41 43 L66 32 108 33");
      fill(
        g,
        "#c8c5ac",
        "M61 29 L80 26 85 36 68 41Z M88 26 L104 25 108 32 93 36Z",
      );
      fill(
        g,
        "#5c8391",
        "M66 31 L78 29 80 34 69 37Z M91 28 L102 27 105 31 94 33Z",
      );
      break;
    case "flower":
      for (let i = 0; i < 5; i++)
        ellipse(
          g,
          "#e3a15f",
          49 + Math.cos(i * 1.256) * 5,
          42 + Math.sin(i * 1.256) * 5,
          4,
          4,
        );
      ellipse(g, "#efd79c", 49, 42, 3, 3);
      break;
    case "sailor":
      fill(
        g,
        "#eee2c7",
        "M38 39 L38 27 63 15 90 16 107 30 102 38 76 37 52 48Z",
      );
      stroke(g, "#547283", 3, "M40 36 Q71 20 101 29");
      break;
    case "lapels":
      fill(
        g,
        "#ede4cb",
        "M45 111 L58 103 72 124 59 118 53 121Z M99 103 L110 108 101 120 96 116 85 122Z",
      );
      break;
  }
  stroke(g, accent, 1.5, "M24 138 L39 128");
}

/** Original screen-printed driver portraits on a 160 × 144 view. */
export function portrait(g: Brush, id: number) {
  const index =
      Number.isInteger(id) && id >= 0 && id < 5 + guests.length ? id : 0,
    guest = guests[index - 5],
    base = palettes[guest?.skin ?? index]!,
    p = guest ? { ...base, shirt: guest.shirt, hair: guest.ink } : base,
    hair = guest?.hair ?? haircuts[index]!;
  rect(g, metal(g, 0, 144, [0, p.bg], [1, "#202637"]), 0, 0, 160, 144);
  for (let i = 0; i < 6; i++)
    fill(g, "#dfb19213", `M${i * 48 - 140} 144 l96 -144 h6 l-96 144Z`);
  ellipse(g, "#f2b47b30", 94, 51, 43, 43);
  g.save();
  if (guest) {
    if (index % 2) {
      g.translate(160, 0);
      g.scale(-1, 1);
    }
    g.transform(1, 0, guest.lean / 100, 1, -guest.lean, 0);
    fill(g, p.hair, hair);
  }
  if (index === 2 || index === 3) fill(g, p.hair, haircuts[index]!);
  // The face in three-quarter view is broken into ink, shadow and light planes.
  fill(
    g,
    p.shirt,
    "M13 144 Q16 119 34 110 L62 98 74 96 94 98 116 106 Q143 114 153 144Z",
  );
  fill(
    g,
    "#20273388",
    "M14 144 L30 118 51 109 42 121 48 144Z M117 108 Q146 117 153 144 H128 L130 123Z",
  );
  fill(g, p.shade, "M65 82 L90 83 94 104 79 119 60 102Z");
  fill(g, p.skin, "M73 88 L88 86 92 102 83 111 74 101Z");
  fill(
    g,
    p.hair,
    "M48 47 Q54 23 84 25 Q111 25 112 49 L106 75 91 93 Q81 100 68 94 L54 78Z",
  );
  fill(
    g,
    p.skin,
    "M54 46 Q70 28 89 32 Q108 35 109 49 L106 60 110 70 103 73 Q101 90 87 96 L76 96 Q62 90 56 74 Q47 78 47 64 Q45 58 52 59Z",
  );
  fill(
    g,
    p.shade,
    "M49 61 Q56 58 58 67 L60 76 66 88 76 96 Q62 90 55 74 Q49 75 48 69Z M103 75 Q99 90 85 94 L79 91 89 89 95 82Z",
  );
  fill(
    g,
    p.light,
    "M62 53 Q71 44 80 49 L83 55 75 59 66 59Z M93 47 Q105 43 107 50 L105 55 98 54Z M67 67 L80 64 75 72 67 73Z M91 58 L96 68 91 68Z",
  );
  fill(
    g,
    p.hair,
    "M61 54 Q70 47 81 51 L81 54 Q73 52 62 57Z M93 50 Q99 45 105 49 L105 51 94 53Z",
  );
  stroke(g, "#483641", 1.6, "M65 60 Q72 56 78 59 M95 56 Q99 53 104 55");
  ellipse(g, p.hair, 74, 59, 1.7, 1.8);
  ellipse(g, p.hair, 101, 55.5, 1.5, 1.6);
  stroke(g, p.shade, 1.5, "M88 55 L90 61 95 67 91 70 85 69");
  fill(
    g,
    index === 2 || index === 3 ? "#8a4d50" : "#945d54",
    "M77 78 Q84 76 87 77 L97 74 Q92 82 86 83Z",
  );
  stroke(g, "#543b41", 1.25, "M78 78 Q88 80 97 75");
  fill(g, p.hair, hair);
  if (guest) detail(g, guest.trim, p.hair, p.light);
  else if (index === 0) {
    fill(
      g,
      "#576f6a",
      "M40 49 Q40 27 58 21 Q81 11 100 28 L105 37 Q80 31 49 51Z",
    );
    fill(
      g,
      "#2b4347",
      "M49 51 Q78 29 106 34 Q120 34 122 38 Q105 40 91 45 L68 46Z",
    );
    stroke(g, "#aac2a5", 1.3, "M62 21 Q77 18 86 30");
  } else if (index === 1) {
    fill(g, "#eed399", "M43 46 Q68 29 107 36 L111 43 Q72 36 46 53Z");
    stroke(g, "#ab504c", 1.7, "M48 47 Q73 32 108 39");
  } else if (index === 2) {
    ellipse(g, "#efb978", 57, 78, 4, 5);
    ellipse(g, p.hair, 57, 78, 2, 3);
  } else if (index === 3) {
    fill(
      g,
      "#d16863",
      "M39 49 Q63 20 102 28 L105 34 Q69 28 41 56Z M43 45 Q29 17 24 26 Q19 38 42 49Z M42 47 Q26 45 17 58 Q34 58 45 51Z",
    );
    for (let i = 0; i < 6; i++)
      ellipse(g, "#e9c8a5", 48 + i * 9, 41 - Math.sin(i * 0.45) * 10, 1.5, 1.5);
  } else {
    fill(
      g,
      "#475363",
      "M58 56 L80 51 85 54 82 63 66 65Z M91 52 L108 48 107 58 96 60Z",
    );
    stroke(g, "#bcb3a2", 2, "M56 56 L80 51 87 54 92 52 109 48");
    stroke(g, "#a9bac0", 1, "M69 54 L64 62 M100 51 L96 57");
  }
  fill(
    g,
    "#eff0d954",
    "M57 100 L73 111 68 127 48 107Z M94 100 L84 113 91 123 105 106Z",
  );
  stroke(
    g,
    "#19243188",
    2,
    "M75 114 L77 144 M53 109 L64 125 71 120 M103 106 L92 124 85 117",
  );
  stroke(g, "#d9d6c89c", 1.4, "M28 134 L47 124 M115 122 L130 132");
  g.restore();
}
