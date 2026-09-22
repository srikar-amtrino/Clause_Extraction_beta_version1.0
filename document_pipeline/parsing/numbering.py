"""Numbering definitions.

A numId points at a num, which points at an abstractNum, which may hand off to
a numbering style, which points back at a different abstractNum. Overrides on
the way can replace the start value or a whole level. Skip any hop and that
list loses its numbering entirely. Results are cached.

Word counts per abstractNum, not per numId: two nums pointing at one abstractNum
are one list and keep counting across each other, unless a num carries a
startOverride, which restarts its level the first time that num is used.
Documents lean on this constantly - a new num per section, all continuing
"1.0, 2.0, 3.0" - so counting per numId shows numbers Word never prints.
"""
from . import switches
from .ooxml import W, parse_xml, wv


class Numbering:
    """Resolves numId/ilvl to a concrete level definition."""

    def __init__(self, xml, styles):
        self.abstract, self.num, self.styles = {}, {}, styles
        self._cache = {}
        self._resolved = {}
        if xml is None:
            return
        root = parse_xml(xml)
        for a in root.findall(W + "abstractNum"):
            self.abstract[a.get(W + "abstractNumId")] = a
        for n in root.findall(W + "num"):
            self.num[n.get(W + "numId")] = n

    def _follow(self, a, depth=0):
        """Follow numStyleLink to the abstractNum that really holds the levels."""
        if a is None or depth > 5:
            return a
        nsl = a.find(W + "numStyleLink")
        if nsl is None:
            return a
        sid = wv(nsl)
        nid = self.styles.num_style_numid(sid)
        if nid and nid in self.num:
            b = self.abstract.get(wv(self.num[nid].find(W + "abstractNumId")))
            if b is not None and b is not a:
                return self._follow(b, depth + 1)
        for b in self.abstract.values():
            sl = b.find(W + "styleLink")
            if sl is not None and wv(sl) == sid and b is not a:
                return self._follow(b, depth + 1)
        return a

    def resolve(self, num_id):
        """-> (abstractNum element, {ilvl: override}) or None. Cached."""
        key = str(num_id)
        if key not in self._resolved:
            self._resolved[key] = self._resolve(key)
        return self._resolved[key]

    def counter_key(self, num_id):
        """Which counter a numId advances: its abstractNum's, shared by every num
        that points at it. Falls back to the numId when there is no abstractNum."""
        r = self.resolve(num_id)
        if not switches.SHARE_ABSTRACT_COUNTERS or r is None or r[0] is None:
            return "num:%s" % num_id
        return "abs:%s" % r[0].get(W + "abstractNumId")

    def start_override(self, num_id, ilvl):
        """The startOverride this num puts on a level, or None."""
        r = self.resolve(num_id)
        return r[1].get(ilvl, {}).get("start") if r else None

    def restarts(self, num_id):
        """True when this num restarts its list rather than continuing it."""
        r = self.resolve(num_id)
        return bool(r) and any(o.get("start") is not None for o in r[1].values())

    def list_key(self, num_id):
        """Identity of the visible list a numId belongs to. Nums continuing one
        abstractNum are one list; a num that restarts it is a list of its own."""
        if self.restarts(num_id):
            return "num:%s" % num_id
        return self.counter_key(num_id)

    def _resolve(self, num_id):
        n = self.num.get(num_id)
        if n is None:
            return None
        a = self._follow(self.abstract.get(wv(n.find(W + "abstractNumId"))))
        ov = {}
        for lo in n.findall(W + "lvlOverride"):
            try:
                il = int(lo.get(W + "ilvl"))
            except (TypeError, ValueError):
                continue
            so = lo.find(W + "startOverride")
            ov[il] = {"start": int(wv(so)) if so is not None else None,
                      "lvl": lo.find(W + "lvl")}
        return (a, ov)

    def level(self, num_id, ilvl):
        """-> {start, numFmt, lvlText, lvlRestart, isLgl} or None. Cached."""
        key = (str(num_id), ilvl)
        if key in self._cache:
            return self._cache[key]
        r, res = self.resolve(num_id), None
        if r:
            a, ov = r
            lvl = ov.get(ilvl, {}).get("lvl")
            if lvl is None and a is not None:
                for candidate in a.findall(W + "lvl"):
                    if int(candidate.get(W + "ilvl")) == ilvl:
                        lvl = candidate
                        break
            if lvl is not None:
                def g(tag, default=None):
                    el = lvl.find(W + tag)
                    return wv(el) if el is not None else default

                start = int(g("start", "1") or 1)
                if ov.get(ilvl, {}).get("start") is not None:
                    start = ov[ilvl]["start"]
                lr = g("lvlRestart")
                res = {"start": start,
                       "numFmt": g("numFmt", "decimal"),
                       "lvlText": g("lvlText", "%1."),
                       "lvlRestart": int(lr) if lr is not None else None,
                       "isLgl": lvl.find(W + "isLgl") is not None}
        self._cache[key] = res
        return res
