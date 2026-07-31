# Mining prospects implementation notes

This feature derives known mining prospects from the human player's faction intelligence:

- a space body is fully prospected when its faction intel value is at least `1.0`
- every `TIHabSiteState` attached to that body is included
- saved daily site yields are converted to monthly output using `30.436875` days
- claim status is resolved through the site's linked `TIHabState`

The default weighted score is a strategic heuristic:

```text
Water × 1 + Volatiles × 1 + Base metals × 0.5 + Noble metals × 3 + Fissiles × 6
```

Weights remain fully user-editable in the browser and are persisted locally.
