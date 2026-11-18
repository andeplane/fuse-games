"""Produce a metadata-only inventory. No picture decompression or span rendering."""

import argparse
import csv
import hashlib
import io
import re
import struct
import subprocess
import sys
from pathlib import Path

REV = "9a3d488143d108985422c2eeb9501e4aa5a0fe72"
BUILD = "d763bd13be07b2ef457b5982f26316a8d71470d73beeb4eee7c6c1e1fef72d96"
IMAGE = "217a709d90715e4299814255a8370d01b9b2e902b8558dd3624e947940c273a5"


def require(value, reason):
    if not value:
        raise ValueError(reason)


def u16(data, at):
    return struct.unpack_from("<H", data, at)[0]


def pictures(path, count, depth):
    size = path.stat().st_size
    with path.open("rb") as file:
        directory = file.read(2 + count * 28)
    require(len(directory) == 2 + count * 28 and u16(directory, 0) == count, path.name)
    result = []
    cursor = 0
    for index in range(count):
        pos = 2 + index * 28
        w, h, planes, mask = struct.unpack_from("<HHBB", directory, pos)
        begin, packed = struct.unpack_from("<IH", directory, pos + 22)
        require(
            w and h and planes == depth and mask in (0, 1, 2),
            f"{path.name} record {index}",
        )
        require(
            begin == cursor and packed and len(directory) + begin + packed <= size,
            f"{path.name} range {index}",
        )
        cursor = begin + packed
        result.append((w, h, mask, packed))
    require(len(directory) + cursor == size - 1, f"{path.name} end")
    return result


def shapes(path, image):
    """Validate only directory/LOD headers. Seek over the actual drawing payload."""
    result = []
    with path.open("rb") as f:
        for i in range(26):
            off, size, reserved = struct.unpack_from(
                "<IHH", image, 0x3E080 + 0x80A2 + i * 8
            )
            require(off == f.tell() and reserved == 0, f"shape {i} directory")
            first = u16(f.read(2), 0)
            if i < 23:
                groups, levels = 1, first
                f.seek(4, 1)
            else:
                groups, levels = first, u16(f.read(2), 0)
                f.seek(4 + 4 * groups, 1)
            total = groups * levels
            require(0 < total <= 64, f"shape {i} dimensions")
            headers = f.read(16 * total)
            require(len(headers) == 16 * total, f"shape {i} truncated")
            spans = 0
            for j in range(total):
                spans += sum(headers[j * 16 + 1 : j * 16 + 12 : 2])
            f.seek(3 * spans, 1)
            require(f.tell() == off + size, f"shape {i} end")
            result.append((groups, levels, spans))
        require(f.tell() == path.stat().st_size, "unaccounted shape records")
    return result


def calls(reference):
    """Literal ids only. Dynamic id arguments are resolved separately from their data tables."""
    found = {}
    function_pattern = re.compile(
        r"^(?:static )?(?:inline )?[\w *]+\b(\w+)\([^;]*\)\s*$"
    )
    for path in sorted((reference / "sr2port/src").rglob("*.c")):
        source = path.read_text()
        source = re.sub(
            r"/\*.*?\*/",
            lambda m: "\n" * m.group().count("\n"),
            source,
            flags=re.DOTALL,
        )
        function = ""
        for number, line in enumerate(source.splitlines(), 1):
            line = line.split("//", 1)[0]
            match = function_pattern.match(line)
            if match:
                function = match[1]
            for match in re.finditer(
                r"\b(?:pic_get|show_picture_at|show_picture)\(\s*(0x[0-9a-fA-F]+|\d+)\s*,",
                line,
            ):
                pic = int(match[1], 0)
                found.setdefault(pic, []).append(
                    f"{path.relative_to(reference)}:{number} {function}"
                )
    return found


def metadata(data, ds):
    roles = {}

    def add(pic, role, owner, site):
        if pic:
            roles.setdefault(pic, []).append((role, owner, site))

    def table(address, count, stride, role, owner, site):
        for j in range(count):
            add(u16(ds, address + j * stride), role, owner, site + f" DS:{address:04X}")

    for i in range(22):
        add(
            u16(data, 18 * i + 4),
            f"Driver portrait / record {i}",
            "portraits.ts",
            "event17_screens.c:162; SR2_DATA person +4",
        )
        add(
            u16(data, 0x18C + 20 * i + 16),
            f"Side profile / model {i}",
            "cars.ts",
            "garage_draw.c:152; SR2_DATA model +16",
        )
        for n, name in enumerate(("roof", "hood scoop", "rear bumper", "front bumper")):
            add(
                u16(data, 0x344 + i * 10 + 2 + n * 2),
                f"{name} / model {i}",
                "cars.ts",
                "garage_draw.c:155-162; SR2_DATA overlay",
            )
    for row in range(6):
        for off, name in [
            (0, "side"),
            (2, "rear three-quarter"),
            (4, "rear"),
            (10, "front"),
        ]:
            vehicle = "police" if row == 5 else f"racing body {row}"
            add(
                u16(data, 0x8C6 + 14 * row + off),
                f"{vehicle} / {name}",
                "front.ts" if name == "front" else "cars.ts",
                "race_road.c:395-419; SR2_DATA angle table",
            )
    for i, role in enumerate(
        ["engine", "intake manifold", "carburettor", "carburettor", "carburettor"]
    ):
        table(
            0x47E0 + 18 * i, 9, 2, role + " bay layer", "workshop.ts", "garage.md:273"
        )
    for address, count, stride, role, owner, site in [
        (
            0x4C5A,
            12,
            2,
            "Weekly newspaper front page",
            "garage/index.ts",
            "garage.md:647",
        ),
        (0x483A, 4, 2, "Transmission by grade", "workshop.ts", "garage.md:1146"),
        (0x4D30, 12, 2, "Wheel service animation", "tools.ts", "garage.md:1110"),
        (0x79E6, 3, 2, "Car jack animation", "tools.ts", "garage.md:1741"),
        (0x822A, 2, 2, "Underbody exhaust manifold", "workshop.ts", "garage.md:1757"),
        (0x822E, 2, 2, "Underbody muffler", "workshop.ts", "garage.md:1757"),
        (0x8232, 3, 2, "Underbody differential", "workshop.ts", "garage.md:1757"),
        (0x78C8, 3, 2, "Instrument panel", "renderer.ts", "race_drive.c:318"),
        (0x78CE, 9, 2, "Steering wheel pose", "renderer.ts", "race_dash.c:208"),
        (0x78E0, 6, 6, "Cockpit overlay", "renderer.ts", "race_render.md:1118"),
        (
            0x7E1A,
            4,
            2,
            "Location road sign sheet",
            "landscape.ts",
            "race_render.md:1087",
        ),
        (0x1CD2, 3, 10, "Shifter gate", "renderer.ts", "race.md:196"),
        (0x1CD4, 3, 10, "Gearshift knob", "renderer.ts", "race.md:196"),
        (0x5136, 3, 6, "Collision windshield crack", "", "race.md:187"),
    ]:
        table(address, count, stride, role, owner, site)
    return roles, add


def static_roles(add):
    # Picture roles resolved from explicit loads / ids in the pinned reconstruction.
    groups = [
        ([1], "Title illustration", "app/main.ts", "game_flow.md:670"),
        ([2], "Mouse pointer bank", "", "platform/screen.c:279"),
        ([3], "Publisher title card", "", "game_flow.md:668"),
        ([4], "Credits panel", "", "game_flow.md:675"),
        ([1000], "Pump-number background", "town-art.ts", "game_flow.md:1033"),
        (
            [1001, 1002, 1003, 1004, 1005, 1006],
            "Licence or save-book interface",
            "",
            "game_flow.md:476; flow_save.c:151-154,236-239",
        ),
        (
            [1007, 1013],
            "Classified newspaper backdrop",
            "garage/index.ts",
            "garage.md:631; garage_classifieds.c:66",
        ),
        ([1018, 1020], "Garage wall/floor layer", "garage.ts", "garage.md:979,1013"),
        ([1054], "Engine-bay backdrop", "workshop.ts", "garage_bay_draw.c:367"),
        ([1055], "Transmission panel", "workshop.ts", "garage_trans.c:33"),
        (
            [1056, 1060, 1076],
            "Engine-front timing adjustment",
            "tools.ts",
            "garage_bay.c:86,100,109",
        ),
        ([1057, 1058, 1059], "Message box style", "app/main.ts", "garage.md:1357"),
        ([1065], "V6 manifold", "workshop.ts", "garage.md:274"),
        (
            [1072, 1150, 1110, 1111],
            "Fuel station and pump components",
            "town-art.ts",
            "game_flow.md:1032-1036",
        ),
        ([1073], "Drive-in scene", "town-art.ts", "race_bob.c:442"),
        ([1074, 1075], "Engine connector / plug", "workshop.ts", "garage.md:282"),
        ([1081, 1186], "Workshop bolt", "tools.ts", "garage_bay_draw.c:29,195"),
        ([1138, 1148], "Wheel shadow or hub", "cars.ts", "garage_tire.c:234,267"),
        (
            [1112],
            "Drive-in carhop background/compositing strip",
            "town-art.ts",
            "garage_draw.c:373-417; garage.md:1691",
        ),
        (
            [1113, 1114],
            "Drive-in carhop actor animation sheet",
            "town-art.ts",
            "garage.md:1687",
        ),
        ([1149], "Drive-in dancing sign", "town-art.ts", "race_bob.c:432"),
        (
            [1188],
            "Newspaper lower strip",
            "garage/index.ts",
            "garage_classifieds.c:425",
        ),
        (
            [1144, 1145, 1146],
            "Calendar month/mark",
            "garage/index.ts",
            "game_flow.md:600",
        ),
        (
            [1147, 1151],
            "Tool or hand overlay",
            "tools.ts",
            "garage_bay_draw.c:378; garage_tire.c:75",
        ),
        (
            [1153, 1154, 1155],
            "Jail bars and trim",
            "",
            "race_bob.c:459-467; race.md:188",
        ),
        (
            [1198, 1199],
            "Undercar jack/backdrop",
            "workshop.ts",
            "garage_bay_draw.c:422,468",
        ),
        (
            [1181, 1211, 1195],
            "Ending animation or scene",
            "town-art.ts",
            "flow_end.c:225,226,277",
        ),
        (
            [1209, 1083],
            "Champion or finale illustration",
            "town-art.ts",
            "flow_end.c:114,177",
        ),
        (
            [1207, 2038],
            "Competition results border",
            "app/main.ts",
            "event17_screens.c:132",
        ),
        (
            [2002, 2004, 2055, 2056],
            "Sky, town roofs or horizon",
            "landscape.ts",
            "race_road.c:356-371",
        ),
        (
            [2005, 2037, 2063],
            "Rear-view mirror or backdrop",
            "renderer.ts",
            "race_road.c:338-343",
        ),
        ([2003], "Cockpit A-pillar", "renderer.ts", "race_road.c:390"),
        ([2049, 2050], "Roadside advertising", "landscape.ts", "race_road.c:386"),
        (
            [2067, 2068, 2069, 2070, 2071],
            "Start-line character/starting equipment",
            "renderer.ts",
            "race_render.md:2037-2046,2516",
        ),
        (
            [2078, 2079, 2080, 2081, 2000, 2022, 2057, 2058],
            "Starter distance variant",
            "renderer.ts",
            "race_opp.c:28-32; race_render.md:2035-2036",
        ),
        ([2009], "Speeding ticket paper", "", "race_results.c:75-87"),
        ([2051], "Speeding ticket scene portrait/figure", "", "race_results.c:75-81"),
        ([2013], "Top cockpit framing strip", "renderer.ts", "race_drive.c:313"),
        (
            [2048, 2064, 2065, 2066],
            "Crash cockpit composition",
            "",
            "race_results.c:99-118",
        ),
    ]
    for ids, role, owner, site in groups:
        for n in ids:
            add(n, role, owner, site)


def shape_role(i):
    source = "race_road.c:1149-1241"
    roles = [
        ("Palm tree", "landscape.ts"),
        ("Reflector post", "landscape.ts"),
        ("Hydrant", ""),
        ("Roadwork warning diamond", "hazards.ts"),
        ("Small roadside shrub", "landscape.ts"),
        ("Speed-limit sign", "hazards.ts"),
        ("Striped barricade", "hazards.ts"),
        ("Small shrub / rock hazard", "hazards.ts"),
        ("Bush", "landscape.ts"),
        ("Telephone pole", "landscape.ts"),
        ("Tree", "landscape.ts"),
        ("Large tree", "landscape.ts"),
        ("Overhead left-route banner", ""),
        ("City boundary banner", ""),
        ("Overhead straight-route banner", ""),
        ("Road narrowing warning", "hazards.ts"),
        ("Left chevron", ""),
        ("Right chevron", ""),
        ("Winding-road warning, left first", ""),
        ("Winding-road warning, right first", ""),
    ]
    if i < 20:
        return (
            *roles[i],
            ("race_road.c:903-908" if i in (12, 13, 14) else source)
            + "; race_render.md:1297-1312; SR1 race_render.md:1487-1506",
            "role",
        )
    if i in (23, 24):
        return (
            "Aqueduct sky, rotation frames",
            "landscape.ts",
            "race_render.md:1700-1702",
            "role",
        )
    if i == 25:
        return (
            "Aqueduct course shape, nine groups at seven angles",
            "renderer.ts",
            "race_render.md:1693",
            "role",
        )
    consumers = [
        "Secondary hit-test obstacle",
        "Canyon roadside object from left/right flags",
        "Distant canyon object from left/right flags",
    ]
    return consumers[i - 20], "", source, "consumer"


def generate(build, ref, mz):
    require(
        hashlib.sha256((build / "SR.EXE").read_bytes()).hexdigest() == BUILD,
        "wrong DOS build",
    )
    require(
        subprocess.check_output(
            ["git", "-C", str(ref), "rev-parse", "HEAD"], text=True
        ).strip()
        == REV,
        "wrong source revision",
    )
    require(
        not subprocess.check_output(
            ["git", "-C", str(ref), "status", "--porcelain", "--", "sr2port/src"]
        ),
        "modified reference source",
    )
    exe = mz.read_bytes()
    image = exe[u16(exe, 8) * 16 :]
    require(hashlib.sha256(image).hexdigest() == IMAGE, "wrong unpacked image")
    data = (build / "SR2_DATA").read_bytes()
    require(len(data) == 3607, "unexpected table layout")
    roles, add = metadata(data, image[0x3E080:])
    static_roles(add)
    direct = calls(ref)
    rows = []
    for lib, count, first in [(1, 4, 1), (2, 212, 1000), (3, 83, 2000)]:
        name = f"LIB{lib}"
        ega = pictures(build / name, count, 4)
        cga = pictures(build / (name + "C"), count, 2)
        for i, (e, c) in enumerate(zip(ega, cga)):
            n = first + i
            require(e[2] == c[2], "mask disagreement")
            matches = roles.get(n, [])
            evidence = sorted({m[2] for m in matches} | set(direct.get(n, [])))
            status = "role" if matches else "consumer" if evidence else "unknown"
            desc = " / ".join(sorted({m[0] for m in matches}))
            if not desc:
                desc = (
                    "Direct picture load; subject unresolved"
                    if evidence
                    else "Unresolved"
                )
            owners = "; ".join(sorted({m[1] for m in matches if m[1]}))
            rows.append(
                [
                    name,
                    i,
                    n,
                    f"{e[0]}x{e[1]}",
                    f"{c[0]}x{c[1]}",
                    e[2],
                    e[3],
                    c[3],
                    "",
                    status,
                    desc,
                    owners,
                    "; ".join(evidence),
                ]
            )
    for i, (groups, levels, spans) in enumerate(shapes(build / "SR2_SHP", image)):
        desc, owner, evidence, status = shape_role(i)
        rows.append(
            [
                "SR2_SHP",
                i,
                i,
                "",
                "",
                "",
                "",
                "",
                f"{groups}x{levels}; {spans} spans",
                status,
                desc,
                owner,
                evidence,
            ]
        )
    require(len(rows) == 325, "unexpected inventory length")
    output = io.StringIO()
    writer = csv.writer(output, delimiter="\t", lineterminator="\n")
    writer.writerow(
        [
            "library",
            "directory_index",
            "runtime_id",
            "EGA_px",
            "CGA_px",
            "mask_flag",
            "EGA_packed_size",
            "CGA_packed_size",
            "shape_structure",
            "evidence_level",
            "reference_role",
            "Fuse_role_module",
            "reference_evidence",
        ]
    )
    writer.writerows(rows)
    return output.getvalue()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ["build", "reference", "unpacked"]:
        parser.add_argument(arg, type=Path)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Compare generated output to the checked-in inventory",
    )
    args = parser.parse_args()
    manifest = generate(args.build, args.reference, args.unpacked)
    if args.check:
        require(
            manifest == Path(__file__).with_name("inventory.tsv").read_text(),
            "manifest differs from this build",
        )
        print("Verified 299 picture records and 26 shape sets.")
    else:
        sys.stdout.write(manifest)
