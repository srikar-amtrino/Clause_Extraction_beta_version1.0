"""Style inheritance.

A paragraph can inherit numbering, outline level, indentation and page-break
behaviour from its style, and styles inherit from other styles. Reading only
the paragraph loses the hierarchy, so the `basedOn` chain is walked to find the
effective value. Cyclic chains exist in real files, hence the `seen` guard.
"""
from .ooxml import W, is_on, parse_xml, wv


class Styles:
    """Effective paragraph properties resolved through style inheritance."""

    def __init__(self, xml):
        self.by_id = {}
        if xml is None:
            return
        for st in parse_xml(xml).findall(W + "style"):
            self.by_id[st.get(W + "styleId")] = st

    def chain(self, sid):
        """Style and all its ancestors, nearest first. Cycle-safe."""
        out, seen = [], set()
        while sid and sid in self.by_id and sid not in seen:
            seen.add(sid)
            st = self.by_id[sid]
            out.append(st)
            sid = wv(st.find(W + "basedOn"))
        return out

    def numpr(self, sid):
        """First numbering reference up the chain -> (numId, ilvl, styleId)."""
        for st in self.chain(sid):
            npr = st.find(W + "pPr/" + W + "numPr")
            if npr is not None:
                nid = wv(npr.find(W + "numId"))
                il = wv(npr.find(W + "ilvl")) or "0"
                if nid:
                    return (nid, int(il), st.get(W + "styleId"))
        return None

    def outline(self, sid):
        """First outlineLvl up the chain, or None."""
        for st in self.chain(sid):
            o = st.find(W + "pPr/" + W + "outlineLvl")
            if o is not None:
                return int(wv(o))
        return None

    def indent(self, sid):
        """First left/start indent up the chain, in twips, or None."""
        for st in self.chain(sid):
            ind = st.find(W + "pPr/" + W + "ind")
            if ind is not None:
                for a in ("left", "start"):
                    if ind.get(W + a) is not None:
                        try:
                            return int(ind.get(W + a))
                        except ValueError:
                            pass
        return None

    def page_break_before(self, sid):
        """Effective pageBreakBefore up the chain."""
        for st in self.chain(sid):
            el = st.find(W + "pPr/" + W + "pageBreakBefore")
            if el is not None:
                return is_on(el)
        return False

    def num_style_numid(self, sid):
        """numId declared directly on a numbering style, for numStyleLink."""
        st = self.by_id.get(sid)
        return None if st is None else wv(st.find(W + "pPr/" + W + "numPr/" + W + "numId"))
