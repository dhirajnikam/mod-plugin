#!/usr/bin/env python3
"""Builds tutorial/cockpit-tutorial.mp4: narrated slides on how to use Cockpit.

    python3 tutorial/build.py            # macOS only: needs `say`, Google Chrome, swift, Pillow

Edit SLIDES below and run again. Each slide is (title, on-screen html, screenshot or None, narration).
The narration is what the voice says, so it spells things the way they are spoken ("slash cockpit");
the on-screen text shows commands exactly as you type them.
"""
import html, pathlib, subprocess, tempfile
from PIL import Image, ImageChops

HERE = pathlib.Path(__file__).resolve().parent
IMAGES = HERE.parent / "docs" / "images"
OUT = HERE / "cockpit-tutorial.mp4"
VOICE = "Samantha"  # `say -v '?'` lists the others; Daniel (en_GB) and Rishi (en_IN) are installed too
RATE = "175"        # words per minute
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def code(s): return f"<pre>{html.escape(s)}</pre>"
def ul(*items): return "<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


SLIDES = [
    ("Cockpit for Claude Code",
     "<p class=lead>See what Claude Code is doing, and steer it.</p>"
     + ul("A side pane and a band around the prompt", "Progress, agents, your codebase as a map, and git",
          "Can work on a goal by itself until judges agree it is done"),
     "overview",
     "Welcome to Cockpit for Claude Code. Cockpit is a plugin that lets you see what Claude Code is doing, and steer it. "
     "It adds a side pane and a band around your prompt. They show each task's progress, the agents at work, "
     "your codebase as a map, and git, with the controls to act on all of it. "
     "In the next few minutes, you will learn how to install it and how to use each part."),

    ("1 · Install",
     "<p>Needs Claude Code <b>2.1.275</b> or later. At the prompt of a session, type:</p>"
     + code("/plugin install cockpit --marketplace dhirajnikam/mod-plugin")
     + ul("Answer <b>y</b> to add the marketplace", "Pick a scope: you everywhere, or one project",
          "Setup asks for theme, judges, testing and a daily budget", "Change any of it later in <code>/config</code>")
     + "<p>Update later with:</p>" + code("claude plugin update cockpit"),
     None,
     "First, install it. You need Claude Code version two point one point two seven five, or later. "
     "At the prompt of a Claude Code session, type the plugin install command shown on screen. "
     "Answer yes to add the repository as a marketplace, then pick a scope: you everywhere, or just one project. "
     "The install asks how to set Cockpit up: the theme, the judges, testing, and a daily budget. "
     "You can change every choice later in slash config. To get later versions, run claude plugin update cockpit."),

    ("2 · Open the pane",
     code("/cockpit") + "<p>Five tabs. Jump straight to one with:</p>"
     + code("/cockpit tab overview\n/cockpit tab files      (Activity)\n/cockpit tab agents\n/cockpit tab git\n/cockpit tab rules")
     + "<p>Every tab opens on one plain sentence. The rest is under <b>› More</b>.</p>",
     None,
     "Cockpit loads as soon as it is installed. Type slash cockpit to open its pane. "
     "The pane has five tabs: Overview, Activity, Agents, Git, and Rules. "
     "You can jump straight to a tab with slash cockpit tab, followed by its name. Note that the Activity tab is called files in this command. "
     "Every tab opens on one plain sentence that says what is happening, plus the few things you act on. "
     "Everything else is folded away under More."),

    ("3 · Overview",
     ul("<b>Needs you</b>: a question, or a commit to confirm",
        "<b>Now</b>: what Claude is doing, changed files, checks, agents",
        "<b>Steps</b>: the task as a checklist",
        "<b>Explain this codebase</b>: Claude writes a guide",
        "Under More: <b>Undo this turn</b>, Compact and Clear,<br>spend by day, and a daily budget")
     + code("/cockpit explain"),
     "overview",
     "The Overview tab is your home screen. At the top, the Needs you card appears when Claude is waiting on a question, "
     "or when Cockpit proposes a commit. Press Commit or Skip. "
     "Below it is one sentence about what Claude is doing right now, then the changed files, the checks, and the agents. "
     "The steps of the task are a simple checklist, with the current step in bold. "
     "Press Explain this codebase, or type slash cockpit explain, and Claude writes a guide to your project that you can then ask it to change. "
     "Under More, you will find Undo this turn, which puts back the files a turn changed. "
     "You will also find the context bar with Compact and Clear, your spend by day, and an optional daily budget that warns you but never stops anything."),

    ("4 · Activity",
     ul("<b>Live feed</b>: every file read, edited or searched",
        "<b>Feature map</b>: your codebase as a diagram,<br>with what is being worked on lit",
        "<b>Impact</b>: what a change to a file reaches",
        "<b>↻ Map again</b> renames the features")
     + "<p>Cockpit maps the repository at each session start, and Claude reads that map every turn.</p>",
     None,
     "The Activity tab shows what is happening, live. The feed lists every file Claude reads, edits, or searches, newest first. "
     "The feature map draws your codebase as a diagram of features, and lights up the one being worked on. "
     "Impact tells you which files a change reaches, so you know what to check. "
     "Behind this is the codebase memory. Cockpit maps your repository when a session starts, "
     "and Claude reads that map on every turn, so it can find the right file without reading all the code."),

    ("5 · Agents",
     ul("<b>Build</b>: planner, builder, reviewer, Prover, Breaker, scribe",
        "<b>Verify</b>: Prover, then Breaker", "<b>Review</b>: the reviewer",
        "Two testers check every change an agent makes",
        "<b>+ New agent</b>: describe one in plain words",
        "<b>In its own worktree</b>, then Bring back")
     + code("/cockpit run planner reviewer -- the task\n/cockpit test"),
     "agents",
     "The Agents tab is where you start and follow subagents. Three buttons sit on top. "
     "Build runs six experts in turn: the planner, the builder, the reviewer, the Prover, the Breaker, and the scribe. "
     "Verify runs the Prover, which proves the change works, and then the Breaker, which tries to break it. Review runs the reviewer. "
     "Whenever an agent changes a file, those two testers check its work automatically. "
     "Under More, New agent creates an agent from a plain description. "
     "You can run several experts at once with slash cockpit run, and slash cockpit test runs Verify right away. "
     "Tick In its own worktree, and an agent works in a separate copy of your repository. When it finishes, press Bring back to apply its changes."),

    ("6 · Git",
     ul("First visit asks five things, once: account, branch pattern,<br>message pattern, commit mode, and when",
        "Commit modes: <b>Auto-commit</b>, <b>Ask me</b>, <b>Manual</b>",
        "The commit message is written from the diff",
        "History as a git graph of every branch",
        "The pull request with its review and CI checks",
        "<b>Fix failing checks</b> hands the failing logs to Claude")
     + "<p>Push and pull requests stay off until you turn them on.</p>",
     None,
     "Next, the Git tab. The first time you open it in a repository, it asks five things, once: "
     "the account that commits, the branch pattern, the message pattern, the commit mode, and when to commit. "
     "There are three commit modes. Auto-commit commits by itself after each turn that changed files. "
     "Ask me proposes each commit, and you press Commit or Skip. Manual commits only when you press the button. "
     "In every mode, the commit message is written from the actual changes, not from your prompt. "
     "The tab also draws the history as a git graph, and shows the branch's pull request with its review and its checks. "
     "If a check fails, Fix failing checks hands the failing logs to Claude. Pushing stays off until you turn it on."),

    ("7 · Rules",
     ul("What loads into every session, with estimated tokens",
        "Hooks, permission rules, MCP servers, skills<br>and <code>CLAUDE.md</code> instructions",
        "Scope: <b>this repository</b> or <b>you, everywhere</b>",
        "<b>+ Add</b>, ✎ edit, ✕ delete (asks first)",
        "<b>Call only</b> keeps a skill out of context until you call it")
     + "<p>Hooks run shell commands: read one before you add it.</p>",
     "rules",
     "The Rules tab shows what Claude Code follows. At the top is an estimate of what loads into every session before you type, in tokens. "
     "Below are the hooks, the permission rules, the M C P servers, the skills, and the instructions from your Claude M D files. "
     "Switch the scope between this repository, and you everywhere. "
     "Each row can be edited or deleted, and each section has an Add button. "
     "For a large skill, Call only keeps it out of context until you call it by name. "
     "One caution: hooks run shell commands, so read a hook before you add it."),

    ("8 · Around the prompt",
     ul("A <b>Progress</b> and <b>Context</b> band above the prompt",
        "A spinner that says what is happening",
        "Tool activity as cards in the chat",
        "<b>Focus</b> (on by default) hides the cards")
     + code("/cockpit focus on|off\n/cockpit theme auto|paper|white|black|solarized|nord"),
     None,
     "Cockpit also works around the prompt. Above it is a band with Progress and Context bars. Click either one to open the Overview. "
     "The spinner tells you what Claude is doing, and each turn ends with a line that sums up the files changed, the tests, and the cost. "
     "Tool activity can show as cards in the chat. Focus is on by default and hides those cards, so you only see your prompts and Claude's replies. "
     "Switch it with slash cockpit focus, on or off. And slash cockpit theme changes the colours."),

    ("9 · Judges",
     ul("When Claude asks you something, 3 to 9 model judges vote",
        "<b>auto</b>: a clear winner answers for you",
        "<b>ask</b>: the judges advise, you decide",
        "<b>off</b>: no judges, no model calls for them")
     + code("/cockpit mode auto|ask|off")
     + "<p>Anything that publishes, pushes, deletes or touches settings always comes to you.</p>",
     None,
     "Now, the judges. When Claude asks you a question, a panel of three to nine model judges votes on it, each with its own point of view. "
     "In auto mode, which is the default, a clear winner answers for you. "
     "In ask mode, the judges only advise, and every decision is yours. Off means no judges, and no model calls for them. "
     "Switch with slash cockpit mode. "
     "Whatever the mode, anything that publishes, pushes, deletes, or touches settings always comes to you."),

    ("10 · Autopilot",
     "<p><b>Task</b>: one goal, until the judges agree it is done</p>"
     + code("/cockpit task $20 4h add offline sync")
     + "<p><b>Product owner</b>: a vision, goal after goal</p>"
     + code("/cockpit product [$budget] [hours h] <vision>")
     + ul("Budget and hours are optional limits", "<code>/cockpit task stop</code> and <code>resume</code>",
          "It pauses for you on anything hard to undo"),
     None,
     "Finally, the autopilot, which works on its own, cycle after cycle. It has two roles. "
     "The first is Task. Type slash cockpit task, an optional budget in dollars, an optional time limit in hours, and then your goal. "
     "Claude writes a roadmap of milestones, builds and tests each one, and stops only when the judges agree that every milestone is done. "
     "The second role is Product owner. Type slash cockpit product, followed by a vision. "
     "Each round it studies the product, the judges pick the next goal, and the task builds it. "
     "Without a budget or a time limit, the autopilot runs until it is done, spending as it goes, so set limits. "
     "You can stop and resume it at any time, and it always pauses for you on anything that is hard to undo."),

    ("Cheat sheet",
     code("/cockpit                      open the pane\n"
          "/cockpit tab <name>           open a tab\n"
          "/cockpit explain              write the codebase guide\n"
          "/cockpit run <agents> -- task run experts at once\n"
          "/cockpit test                 run Verify now\n"
          "/cockpit task <goal>          autopilot on one goal\n"
          "/cockpit mode auto|ask|off    how the judges decide\n"
          "/cockpit focus on|off         hide tool cards\n"
          "/cockpit theme <name>         switch the theme")
     + "<p>Cockpit keeps its data in a git-ignored <code>.cockpit/</code> folder and stores no credentials. "
       "More in the <code>docs/</code> folder.</p>",
     None,
     "Here is a cheat sheet of the commands you will use most. "
     "A last word on privacy and cost. Cockpit keeps its history and codebase memory in a dot cockpit folder in your repository. "
     "That folder is git-ignored, so nothing in it is ever committed, and it stores no credentials. "
     "Cockpit makes small model calls for its steps, commit messages, and judges. "
     "For more detail on any tab, see the docs folder in the repository. "
     "That is Cockpit. Type slash cockpit, and take the controls."),
]

CSS = """
*{box-sizing:border-box} html,body{margin:0;width:1920px;height:1080px;overflow:hidden}
body{background:#f3f2f2;color:#222;font:36px/1.45 -apple-system,'Helvetica Neue',sans-serif;padding:80px 100px;display:flex;gap:70px}
.text{flex:1;min-width:0} h1{font-size:68px;margin:0 0 36px;color:#a8741f;letter-spacing:-1px}
.lead{font-size:46px;font-weight:600;margin:0 0 30px} p{margin:0 0 22px} ul{margin:0 0 26px;padding-left:44px} li{margin-bottom:14px}
li::marker{color:#b8842f} b{color:#111}
pre,code{font-family:Menlo,monospace} code{font-size:.88em;background:#e6e2da;padding:2px 10px;border-radius:8px}
pre{font-size:30px;line-height:1.5;background:#262422;color:#f1e7d3;padding:24px 32px;border-radius:14px;margin:0 0 28px;white-space:pre-wrap}
.shot{align-self:center;flex:none;border:2px solid #cdb891;border-radius:18px;overflow:hidden;box-shadow:0 12px 40px #0002}
.shot img{display:block;width:860px}
.foot{position:absolute;left:100px;bottom:36px;font-size:24px;color:#8a8580}
"""


def shot(name, work):
    """The screenshot cropped to its content (the previews have a tall empty tail)."""
    im = Image.open(IMAGES / f"{name}.png").convert("RGB")
    box = ImageChops.difference(im, Image.new("RGB", im.size, im.getpixel((2, 2)))).getbbox()
    path = work / f"{name}.png"
    im.crop((0, 0, im.width, min(im.height, box[3] + 24))).save(path)
    return path


def main():
    work = pathlib.Path(tempfile.mkdtemp(prefix="cockpit-tutorial-"))
    (work / "slides").mkdir()
    for i, (title, body, image, narration) in enumerate(SLIDES, 1):
        n = f"{i:02d}"
        img = f'<div class=shot><img src="{shot(image, work).as_uri()}"></div>' if image else ""
        (work / f"{n}.html").write_text(
            f"<!doctype html><meta charset=utf-8><style>{CSS}</style>"
            f"<div class=text><h1>{html.escape(title)}</h1>{body}</div>{img}"
            f"<div class=foot>Cockpit for Claude Code · {i}/{len(SLIDES)}</div>")
        subprocess.run([CHROME, "--headless=new", "--hide-scrollbars", "--force-device-scale-factor=1",
                        "--window-size=1920,1080", f"--user-data-dir={work / 'chrome'}",
                        f"--screenshot={work / 'slides' / f'{n}.png'}", (work / f"{n}.html").as_uri()],
                       check=True, capture_output=True)
        subprocess.run(["say", "-v", VOICE, "-r", RATE, "--data-format=BEI16@44100",
                        "-o", str(work / "slides" / f"{n}.aiff"), narration], check=True)
    subprocess.run(["swift", str(HERE / "assemble.swift"), str(work / "slides"), str(OUT)], check=True,
                   stderr=subprocess.DEVNULL)
    print(f"slides and narration kept in {work / 'slides'}")


if __name__ == "__main__":
    main()
