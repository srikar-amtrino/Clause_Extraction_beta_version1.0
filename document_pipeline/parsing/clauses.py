"""The clause tree as flat rows, one per clause in reading order.

Each row carries every relationship field, so a consumer never walks the tree.
"""


def flatten(root):
    """-> JSON-safe clause rows sorted by order_index."""
    rows = []

    def walk(nodes, parent_path):
        for n in nodes:
            rows.append({
                "clause_id": str(n["id"]),
                "level": int(n["level"]),
                "assigned_depth": int(n["assigned_depth"]),
                "display_number": n.get("display_number") or None,
                "clause_title": n.get("clause_title") or None,
                "canonical_path": n.get("canonical_path") or None,
                "full_path": n.get("full_path") or None,
                "is_compound_lead_in": bool(n.get("is_compound_lead_in")),
                "lead_in_child_ids": [str(x) for x in n.get("lead_in_child_ids", [])],
                "bonded_to_lead_in": n.get("bonded_to_lead_in"),
                "parent_id": n.get("parent_id"),
                "parent_path": parent_path,
                "ancestor_ids": list(n.get("ancestor_ids", [])),
                "child_ids": list(n.get("child_ids", [])),
                "child_count": int(n.get("child_count", 0)),
                "descendant_count": int(n.get("descendant_count", 0)),
                "sibling_index": int(n.get("sibling_index", 1)),
                "sibling_count": int(n.get("sibling_count", 1)),
                "is_leaf": bool(n.get("is_leaf", True)),
                "order_index": n.get("order_index"),
                "dfs_index": n.get("dfs_index"),
                "bfs_index": n.get("bfs_index"),
                "paragraph_ids": [int(x) for x in n.get("paragraph_ids", [])],
                "text": str(n.get("text") or ""),
                "body_text": "\n".join(str(x) for x in n.get("body_paragraphs", [])),
                "numbering_source": n.get("numbering_source") or None,
                "confidence": float(n.get("confidence") or 0.0),
                "conflict": bool(n.get("conflict")),
                "flags": list(n.get("flags", [])),
                "style": n.get("style") or None,
            })
            walk(n["children"], n.get("canonical_path"))

    walk(root["children"], None)
    rows.sort(key=lambda r: r["order_index"])
    return rows
