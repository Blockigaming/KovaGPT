# Directory loading geometry

990b2c8's isolated held-list review demonstrated two mismatches: Library list placeholders were80px against56px normal rows, and Projects removed the search/sort/filter toolbar and used an unrelated avatar-card skeleton.

The successor retains the actual Project toolbar while loading and draws title, description and bottom metadata placeholders inside the same responsive project grid/list containers. Library placeholder rows follow56px comfortable and48px compact density. Shared generic skeleton consumers remain unchanged.

Focused source geometry assertions cover toolbar ordering, matching containers, semantic placeholder structure and density rules. Actual successor loading pixels remain pending; the20-second isolated hold is review-only.
