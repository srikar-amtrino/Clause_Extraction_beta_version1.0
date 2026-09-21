"""Group micro chunks by section and pack the groups into requests.

Siblings travel together, so the model sees a section's paragraphs side by
side and can keep them consistent. Groups are packed by an estimated token
budget and a hard item cap, whichever is hit first; the cap bounds the answer's
length and what retrying a batch costs. A group is split only when it alone
breaks a limit, and every piece keeps its section context.

Pure data: nothing here touches the database or the network.
"""
from dataclasses import dataclass, field


def estimate_tokens(text):
    """Rough and dependency-free (characters / 4). Sizes batches, never bills."""
    return max(1, len(text or '') // 4)


@dataclass(frozen=True)
class Paragraph:
    """One micro chunk, as the classifier sees it."""

    chunk_id: str
    local_id: str
    order_index: int
    number: str | None
    title: str | None
    heading_trail: str
    lead_in: str | None
    region: str
    text: str

    def token_estimate(self):
        return estimate_tokens(self.text) + estimate_tokens(self.lead_in) \
            + estimate_tokens(self.heading_trail) + estimate_tokens(self.title) + 12


@dataclass(frozen=True)
class Group:
    """A section: the micros sharing one parent, with that parent as context.

    `section` is the parent's heading trail and `preview` the opening words of
    the parent's own text. A micro with no parent is a group of one with an
    empty section.
    """

    key: str
    section: str
    preview: str
    paragraphs: tuple

    def overhead_estimate(self):
        return estimate_tokens(self.section) + estimate_tokens(self.preview) + 8

    def token_estimate(self):
        return self.overhead_estimate() + sum(p.token_estimate() for p in self.paragraphs)


@dataclass
class Batch:
    """One request's worth of groups. `index` survives splits and retries so
    every call and row a batch produces can be traced back to it."""

    index: int
    groups: tuple
    _ids: dict = field(default=None, repr=False)

    @property
    def paragraphs(self):
        return [p for g in self.groups for p in g.paragraphs]

    @property
    def ids(self):
        """Batch-local id ("p1", "p2", ...) -> Paragraph, in reading order.

        Short ids cost fewer tokens than chunk UUIDs and are harder to garble
        when the model echoes them back.
        """
        if self._ids is None:
            self._ids = {'p%d' % n: p for n, p in enumerate(self.paragraphs, start=1)}
        return self._ids

    def subset(self, chunk_ids):
        """The same batch restricted to `chunk_ids`, keeping section context."""
        wanted = set(chunk_ids)
        groups = []
        for g in self.groups:
            kept = tuple(p for p in g.paragraphs if p.chunk_id in wanted)
            if kept:
                groups.append(Group(g.key, g.section, g.preview, kept))
        return Batch(self.index, tuple(groups))

    def halves(self):
        """Split in two by paragraph count, for an answer cut off at max_tokens."""
        paragraphs = self.paragraphs
        middle = len(paragraphs) // 2
        return (self.subset(p.chunk_id for p in paragraphs[:middle]),
                self.subset(p.chunk_id for p in paragraphs[middle:]))


def _pieces(group, max_tokens, max_items):
    """A group that alone breaks a limit, cut into pieces that each fit."""
    if len(group.paragraphs) <= max_items and group.token_estimate() <= max_tokens:
        return [group]
    pieces, current, used = [], [], group.overhead_estimate()
    for paragraph in group.paragraphs:
        cost = paragraph.token_estimate()
        if current and (len(current) >= max_items or used + cost > max_tokens):
            pieces.append(Group(group.key, group.section, group.preview, tuple(current)))
            current, used = [], group.overhead_estimate()
        current.append(paragraph)
        used += cost
    if current:
        pieces.append(Group(group.key, group.section, group.preview, tuple(current)))
    return pieces


def plan_batches(groups, *, max_tokens, max_items):
    """Groups in reading order -> batches, packed greedily. Never splits a
    group that fits in a batch of its own."""
    if max_items < 1 or max_tokens < 1:
        raise ValueError('batch limits must be positive')
    batches, current, used, count = [], [], 0, 0
    for group in groups:
        for piece in _pieces(group, max_tokens, max_items):
            size, cost = len(piece.paragraphs), piece.token_estimate()
            if current and (count + size > max_items or used + cost > max_tokens):
                batches.append(Batch(len(batches), tuple(current)))
                current, used, count = [], 0, 0
            current.append(piece)
            used += cost
            count += size
    if current:
        batches.append(Batch(len(batches), tuple(current)))
    return batches
