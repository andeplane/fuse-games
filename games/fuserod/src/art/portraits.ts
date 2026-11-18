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

/** Five original screen-printed portraits, each drawn in a 160 × 144 view. */
export function portrait(g: Brush, id: number) {
  const index = Math.abs(Math.trunc(id)) % palettes.length,
    p = palettes[index]!;
  rect(g, metal(g, 0, 144, [0, p.bg], [1, "#202637"]), 0, 0, 160, 144);
  for (let i = 0; i < 6; i++)
    fill(g, "#dfb19213", `M${i * 48 - 140} 144 l96 -144 h6 l-96 144Z`);
  ellipse(g, "#f2b47b30", 94, 51, 43, 43);
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
  fill(g, p.hair, haircuts[index]!);
  if (index === 0) {
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
}
