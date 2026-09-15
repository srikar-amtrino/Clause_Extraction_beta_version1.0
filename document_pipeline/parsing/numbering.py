"""Numbering definitions.

A numId points at a num, which points at an abstractNum, which may hand off to
a numbering style, which points back at a different abstractNum. Overrides on
the way can replace the start value or a whole level. Skip any hop and that
list loses its numbering entirely. Results are cached.
"""
from .ooxml import W, parse_xml, wv


class Numbering:
    """Resolves numId/ilvl to a concrete level definition."""

    def __init__(self, xml, styles):
        self.abstract, self.num, self.styles = {}, {}, styles
        self._cache = {}
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
        """-> (abstractNum element, {ilvl: override}) or None."""
        n = self.num.get(str(num_id))
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
