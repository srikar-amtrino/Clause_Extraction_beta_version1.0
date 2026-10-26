"""Running Word's counters.

Word stores counting rules, not the numbers shown on screen. To know what a
clause displays, the items are counted here, honouring restart rules and the
legal-numbering flag.
"""
from collections import defaultdict

ROMAN = [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"),
         (50, "l"), (40, "xl"), (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]


def to_roman(n):
    s = ""
    for v, r in ROMAN:
        while n >= v:
            s += r
            n -= v
    return s


def to_letter(n):
    """1 -> a, 26 -> z, 27 -> aa."""
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(97 + r) + s
    return s


def fmt_num(n, fmt):
    """Render a counter value in a Word number format."""
    return {"decimal": str(n), "decimalZero": "%02d" % n,
            "lowerLetter": to_letter(n), "upperLetter": to_letter(n).upper(),
            "lowerRoman": to_roman(n), "upperRoman": to_roman(n).upper(),
            "none": ""}.get(fmt, str(n))


class Counters:
    """Counter state per list, keyed the way Word keys it (see numbering.py).
    One instance per document."""

    def __init__(self, numbering):
        self.nb = numbering
        self.state = defaultdict(dict)
        self.used = set()   # (numId, ilvl) already counted, for startOverride

    def advance(self, num_id, ilvl):
        """Consume one item at this level -> (display, canonical dotted path)."""
        lvl = self.nb.level(num_id, ilvl)
        if lvl is None:
            return None, None
        st = self.state[self.nb.counter_key(num_id)]
        first_use = (str(num_id), ilvl) not in self.used
        self.used.add((str(num_id), ilvl))
        if ilvl not in st or (first_use and self.nb.start_override(num_id, ilvl) is not None):
            st[ilvl] = lvl["start"]
        else:
            st[ilvl] += 1

        # reset deeper levels, honouring lvlRestart (0 means never restart)
        for m in [k for k in st if k > ilvl]:
            ml = self.nb.level(num_id, m)
            lr = ml["lvlRestart"] if ml else None
            if lr == 0:
                continue
            if lr is None or ilvl <= lr - 1:
                st.pop(m, None)

        out = lvl["lvlText"] or ""
        for k in range(1, 10):
            ph = "%" + str(k)
            if ph not in out:
                continue
            kl = self.nb.level(num_id, k - 1)
            cur = st.get(k - 1, kl["start"] if kl else 1)
            f = "decimal" if lvl["isLgl"] else (kl["numFmt"] if kl else "decimal")
            out = out.replace(ph, fmt_num(cur, f))

        path = []
        for i in range(ilvl + 1):
            kl = self.nb.level(num_id, i)
            if kl is None:
                continue
            path.append(fmt_num(st.get(i, kl["start"]), kl["numFmt"]))
        return out.strip(), ".".join(p for p in path if p)
