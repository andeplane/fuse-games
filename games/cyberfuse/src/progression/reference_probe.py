"""Exercise the DOS source's password and scoring routines outside the renderer."""

from pathlib import Path
import subprocess
import sys
import tempfile


def function(source, start, end):
    first = source.index(start)
    return source[first:source.index(end, first)]


def main(source_folder):
    password = (source_folder / "PASSWORD.C").read_text("cp437")
    game = (source_folder / "CDOGS.C").read_text("cp437")
    routines = "".join([
        function(password, "const char *MakePassword", "static int TestPassword"),
        function(game, "void Summary(", "void Bonuses("),
        function(game, "void Bonuses(", "void MissionSummary("),
    ])
    harness = Path(__file__).with_name("reference_probe.c").read_text()
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / "probe.c"
        program = Path(directory) / "probe"
        source.write_text(harness.replace("/* DOS routines */", routines))
        subprocess.run(["cc", "-I", str(source_folder), str(source), "-o", str(program)], check=True)
        subprocess.run([str(program)], check=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve())
