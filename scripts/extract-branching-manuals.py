#!/usr/bin/env python3
# Extract the HF4 branching-manuals LyX source into markdown: a master file in
# document order with branch tags, plus one file per branch. Pragmatic, not a
# full LyX converter - good enough for a searchable rules reference.
#
# Usage:
#   python3 scripts/extract-branching-manuals.py <source.lyx> <out-dir>
# The .lyx lives inside reference/HF4-branching-manuals-v0.3.zip; unzip it first.
# Output lands in reference/manuals/ (see that folder's README). No third-party
# deps - stdlib only - so it runs anywhere Python 3 does.
import re, sys, os, collections

SRC = sys.argv[1]
OUTDIR = sys.argv[2]
os.makedirs(OUTDIR, exist_ok=True)

lines = open(SRC, encoding='utf-8', errors='replace').read().split('\n')

# --- find body start (after \begin_body) ---
start = 0
for i, l in enumerate(lines):
    if l.strip() == '\\begin_body':
        start = i + 1
        break

inset_stack = []          # list of inset "kind" strings; 'Branch:<name>' for branch insets
branch_stack = []         # active branch names (innermost last)
cur_layout = None
buf = []                  # text fragments for current layout
HEAD = {'Title': '#', 'Section': '##', 'Subsection': '###', 'Subsubsection': '####', 'Subparagraph': '#####'}

# document-order records: (branch_path_tuple, layout, text)
records = []

def flush():
    global buf, cur_layout
    if cur_layout is None:
        buf = []
        return
    text = ''.join(buf)
    text = re.sub(r'[ \t]+', ' ', text).strip()
    if text:
        records.append((tuple(branch_stack), cur_layout, text))
    buf = []
    cur_layout = None

i = start
while i < len(lines):
    l = lines[i]
    s = l.rstrip('\n')
    st = s.strip()
    if st.startswith('\\begin_inset'):
        m = re.match(r'\\begin_inset Branch (.+)', st)
        if m:
            name = m.group(1).strip()
            inset_stack.append('Branch:' + name)
            branch_stack.append(name)
        elif st.startswith('\\begin_inset Quotes'):
            inset_stack.append('skip-inline')
            buf.append('"')
        elif st.startswith('\\begin_inset space') or st.startswith('\\begin_inset Newline') or st.startswith('\\begin_inset Argument'):
            inset_stack.append('skip-inline')
            buf.append(' ')
        elif st.startswith('\\begin_inset Graphics'):
            inset_stack.append('drop')   # swallow image inset content
        elif st.startswith('\\begin_inset Formula'):
            inset_stack.append('formula')
        else:
            # Foot / Note / Text / Tabular / CommandInset / Flex / ERT ...
            inset_stack.append('inset')
        i += 1
        continue
    if st == '\\end_inset':
        if inset_stack:
            kind = inset_stack.pop()
            if kind.startswith('Branch:') and branch_stack:
                branch_stack.pop()
        i += 1
        continue
    # inside a dropped (graphics) inset: ignore everything till it closes
    if inset_stack and inset_stack[-1] == 'drop':
        i += 1
        continue
    if st.startswith('\\begin_layout'):
        flush()
        cur_layout = st[len('\\begin_layout'):].strip() or 'Standard'
        i += 1
        continue
    if st == '\\end_layout':
        flush()
        i += 1
        continue
    if st.startswith('\\'):
        # inline formatting / control line -> ignore (series, color, emph, lang, bar, noun, ...)
        i += 1
        continue
    if st in ('status open', 'status collapsed', 'status inlined'):
        # inset display-state lines (follow \begin_inset) - not body text
        i += 1
        continue
    # plain text line (may be empty) - part of current layout
    if cur_layout is not None:
        buf.append(s)
    i += 1

flush()

# --- emit master ---
def md_for(layout, text):
    if layout in HEAD:
        return f"\n{HEAD[layout]} {text}\n"
    if layout in ('Description', 'Labeling'):
        # bold the leading label (first whitespace-delimited token)
        parts = text.split(' ', 1)
        if len(parts) == 2:
            return f"- **{parts[0]}** {parts[1]}"
        return f"- **{text}**"
    if layout == 'Itemize':
        return f"- {text}"
    if layout == 'Author':
        return f"_{text}_\n"
    return text + "\n"

def branch_tag(path):
    if not path:
        return ''
    return f"`[{ ' > '.join(path) }]` "

master = ["# HF4: All - branching manuals (extracted reference)",
          "",
          "Auto-extracted from `reference/HF4-branching-manuals-v0.3.zip`"
          " (`HF4A branching manuals_v0.3.lyx`). Text in `[Branch]` tags is"
          " specific to that module/variant; untagged text is shared (Core).",
          " Light auto-conversion: tables/figures are omitted, formatting is"
          " approximate. Treat as a searchable reference, not the typeset rulebook.",
          ""]
prev_path = None
for path, layout, text in records:
    if path != prev_path:
        if path:
            master.append(f"\n> **Branch: {' > '.join(path)}**\n")
        prev_path = path
    line = md_for(layout, text)
    if path and layout not in HEAD:
        line = branch_tag(path) + line
    master.append(line)

master_txt = re.sub(r'\n{3,}', '\n\n', '\n'.join(master))
open(os.path.join(OUTDIR, 'hf4-branching-manual.md'), 'w', encoding='utf-8').write(master_txt)

# --- per-branch files (innermost branch == that branch) + shared ---
def safe(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')

bybranch = collections.OrderedDict()
shared = []
for path, layout, text in records:
    key = path[-1] if path else None
    if key is None:
        shared.append((layout, text))
    else:
        bybranch.setdefault(key, []).append((layout, text))

def write_branch(fname, title, items):
    out = [f"# HF4 manual - {title}", "",
           "Auto-extracted from the branching-manuals LyX source. Approximate"
           " conversion; see `hf4-branching-manual.md` for full in-order context.", ""]
    for layout, text in items:
        out.append(md_for(layout, text))
    txt = re.sub(r'\n{3,}', '\n\n', '\n'.join(out))
    open(os.path.join(OUTDIR, fname), 'w', encoding='utf-8').write(txt)

write_branch('branch-shared-core.md', 'Shared / Core (untagged)', shared)
counts = {}
for key, items in bybranch.items():
    counts[key] = len(items)
    write_branch(f'branch-{safe(key)}.md', key, items)

print("branches + paragraph counts:")
print(f"  (shared/core untagged): {len(shared)}")
for k, n in sorted(counts.items(), key=lambda kv: -kv[1]):
    print(f"  {k}: {n}")
print(f"\nwrote master + {len(counts)+1} branch files to {OUTDIR}")
