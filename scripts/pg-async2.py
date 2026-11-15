#!/usr/bin/env python3
"""
Step-01 pass 2: string-aware async/await + transaction + changes conversion.

Tokenizes each file into code vs template-literal segments; only transforms
code segments (so SQL strings stay intact). Adds `await` before db./rows.
async calls and makes the enclosing function async (walks backwards to the
nearest method/function/arrow header). Converts:
  db.transaction(() => { ... })      → await db.transaction(async (tx) => { ... ; void tx; })
  const { changes } = await db.run() → const changes = await db.run()
  expr.changes (db.run result var)   → expr   [only simple `x.changes` where x is a run result]
"""
import re, sys, pathlib

ASYNC_CALLS = [
    "db.get", "db.all", "db.run", "db.emitEvent", "db.addMessage", "db.listMessages",
    "db.listEvents", "db.listEventsTail", "db.getSetting", "db.setSetting", "db.listRepos",
    "db.repoById", "db.repoByCloudUrl", "db.upsertRepo", "db.deleteRepo",
    "db.countFlowsByRepoId", "rows.get", "rows.all",
]

def split_segments(src):
    """Yield (is_template, text) segments; template = backtick literal."""
    segs = []
    i = 0
    buf = []
    while i < len(src):
        ch = src[i]
        if ch == "`":
            if buf:
                segs.append((False, "".join(buf))); buf = []
            j = i + 1
            body = []
            while j < len(src):
                if src[j] == "\\": body.append(src[j:j+2]); j += 2; continue
                if src[j] == "`": break
                body.append(src[j]); j += 1
            segs.append((True, "`" + "".join(body) + "`"))
            i = j + 1
        elif ch == "'" or ch == '"':
            if buf:
                segs.append((False, "".join(buf))); buf = []
            q = ch
            j = i + 1
            body = [ch]
            while j < len(src):
                body.append(src[j])
                if src[j] == "\\": body.append(src[j+1] if j+1 < len(src) else ""); j += 2; continue
                if src[j] == q: j += 1; break
                j += 1
            segs.append((False, "".join(body)))
            i = j
        else:
            buf.append(ch); i += 1
    if buf:
        segs.append((False, "".join(buf)))
    return segs

def transform_code(code):
    out = code
    # await db/rows calls (not already awaited/voided/returned, not a method def `db.get(`)
    for call in ASYNC_CALLS:
        pattern = re.compile(
            rf"(?<![\w.])(?<!await )(?<!await\()(?<!void )(?<!return )(?<!yield )"
            rf"{re.escape(call)}\(")
        out = pattern.sub(f"await {call}(", out)
    # db.transaction(() => { → await db.transaction(async (tx) => {
    out = re.sub(r"(?<!await )db\.transaction\(\s*\(\s*\)\s*=>\s*\{",
                 "await db.transaction(async (tx) => {", out)
    out = re.sub(r"(?<!await )db\.transaction\(\s*async\s*\(\s*\)\s*=>\s*\{",
                 "await db.transaction(async (tx) => {", out)
    out = re.sub(r"(?<!await )(?<!await\()db\.transaction\(", "await db.transaction(", out)
    # { changes } = await db.run( → changes = await db.run(
    out = re.sub(r"const\s*\{\s*changes\s*\}\s*=\s*await db\.run\(", "const changes = await db.run(", out)
    # x = await db.run(...); ... x.changes → x
    out = re.sub(r"\b(\w+)\.changes\b", r"\1", out)
    return out

def make_enclosing_async(src):
    """Add `async` to functions that contain a bare `await ` but lack it."""
    out = []
    i = 0
    n = len(src)
    # crude: find `await ` not preceded by async function context — instead:
    # for every `await `, walk back to nearest `{` opener candidate line start
    # Pattern-based: method defs `name(...) {`, arrows `(...) => {`, `function name(...) {`
    # We'll mark each await position, then find its enclosing opener and prepend async if missing.
    positions = [m.start() for m in re.finditer(r"\bawait ", src)]
    inserts = set()
    for pos in positions:
        # scan backwards for the nearest of: `) {`, `) => {`, `function ... {`, `get name() {`
        j = pos
        depth = 0
        while j > 0:
            j -= 1
            ch = src[j]
            if ch == "}": depth += 1
            elif ch == "{":
                if depth == 0:
                    # found enclosing block opener; look at the header before it
                    header_start = src.rfind("\n", 0, j) + 1
                    header = src[header_start:j]
                    # could span multiple lines — take up to 4 lines back
                    for _ in range(4):
                        prev = src.rfind("\n", 0, header_start - 1)
                        if prev == -1: break
                        candidate = src[prev + 1:j]
                        if re.search(r"\)\s*(:\s*[\w<>\[\] |&,.()?]*)?\s*$", candidate) or "=>" in candidate:
                            header_start = prev + 1
                            header = candidate
                        else:
                            break
                    if "async" not in header.split("{")[0] and not re.match(r"\s*(if|for|while|switch|catch|else|try|do)\b", header):
                        # find where to insert 'async ': before the function keyword/name/(
                        m = re.search(r"(public |private |protected |static |readonly )*", header)
                        inserts.add(header_start)
                    break
                depth -= 1
    # apply inserts
    if not inserts:
        return src
    parts = []
    prev = 0
    for p in sorted(inserts):
        parts.append(src[prev:p])
        # skip leading whitespace
        k = p
        while k < n and src[k] in " \t": k += 1
        parts.append(src[p:k])
        # don't double-async
        if not src[k:k+6] == "async":
            parts.append("async ")
        prev = k
    parts.append(src[prev:])
    return "".join(parts)

def main(paths):
    for p in paths:
        path = pathlib.Path(p)
        src = path.read_text()
        segs = split_segments(src)
        code = "".join(seg if not is_tpl else seg for is_tpl, seg in segs)
        # transform only non-template segments
        out_parts = []
        for is_tpl, seg in segs:
            out_parts.append(seg if is_tpl else transform_code(seg))
        out = "".join(out_parts)
        out = make_enclosing_async(out)
        if out != src:
            path.write_text(out)
            print("converted", p)
        else:
            print("unchanged", p)

if __name__ == "__main__":
    main(sys.argv[1:])
