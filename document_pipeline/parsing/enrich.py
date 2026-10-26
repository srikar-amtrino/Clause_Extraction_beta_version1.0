"""Filling in the relationships.

Level is counted from actual ancestors after nesting, not from the depth
assigned earlier, so level and parent can never disagree. Direct children, all
descendants and siblings are reported separately because "how many clauses are
in this clause" has three different answers.
"""
from collections import deque

from .tree import ROOT_ID


def enrich(root):
    """Attach every relationship fact to every clause. -> clause count"""

    def walk(node, num_chain, ancestors):
        kids = node["children"]
        for pos, c in enumerate(kids):
            c["level"] = len(ancestors) + 1
            c["parent_id"] = None if node["id"] == ROOT_ID else node["id"]
            c["ancestor_ids"] = list(ancestors)
            c["child_ids"] = [k["id"] for k in c["children"]]
            c["child_count"] = len(c["children"])
            c["sibling_index"] = pos + 1
            c["sibling_count"] = len(kids)
            c["is_leaf"] = not c["children"]

            tok = (c.get("display_number") or "").strip(". ") or None
            nums = num_chain + ([tok] if tok else [])
            c["full_path"] = " > ".join(nums) if nums else None

            # an inferred parent owns no source paragraph of its own
            own = [c["_pi"]] if c["_pi"] is not None else []
            c["paragraph_ids"] = own + list(c["body_paragraph_ids"])
            walk(c, nums, ancestors + [c["id"]])

    walk(root, [], [])

    def descendants(node):
        n = 0
        for c in node["children"]:
            n += 1 + descendants(c)
        node["descendant_count"] = n
        return n

    total = descendants(root)

    order = [0]

    def dfs(node):
        for c in node["children"]:
            c["dfs_index"] = c["order_index"] = order[0]
            order[0] += 1
            dfs(c)

    dfs(root)

    q, i = deque(root["children"]), 0
    while q:
        n = q.popleft()
        n["bfs_index"] = i
        i += 1
        q.extend(n["children"])

    return total
