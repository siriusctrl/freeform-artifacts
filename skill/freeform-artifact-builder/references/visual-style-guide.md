# Artifact Visual Style Guide

Use this guide for every user-facing artifact, including personal runtime
bundles. The goal is a compact, legible data object that belongs on a spatial
canvas, not a miniature dashboard squeezed into a card.

## Information Hierarchy

- Give the artifact body one primary idea. A chart may have a title and one
  short explanatory line; a table can often start directly with its headers.
- Do not repeat the node chrome title inside the artifact unless the inner title
  adds necessary analytical meaning.
- Never expose table names, variable names, query ids, transform ids, or other
  snake_case implementation labels as presentation copy.
- Prefer plain domain language. Remove sensitive or overly specific nouns when
  the example works with a generic label such as `Supply`.
- Limit the body to three visible hierarchy levels. Delete decorative counters,
  badges, rails, legends, or kickers that do not improve interpretation.
- Use labels that explain meaning, not the implementation mechanism.

## Typography And Spacing

- Use Instrument Sans for prose and Geist Mono only for numeric values, dates, ids, or
  axis labels that benefit from fixed-width alignment.
- Body titles should normally be 20-24px at a 560-720px artifact width. Step or
  row labels should normally be 12-15px. Do not use hero-scale type in a card.
- Keep letter spacing at `0`. Avoid all-caps except short table headers.
- Use a consistent 4px-based rhythm: 20-24px outer padding, 5-8px within a text
  group, and 20-32px between major groups.
- If content is crowded, remove a hierarchy level or increase `defaultSize`.
  Do not solve crowding by shrinking meaningful text below 11px.
- Check the longest realistic label. Truncate only secondary text; essential
  labels must wrap or receive enough reserved space.

## Surfaces And Color

- Use the host surface as the artifact background. Avoid decorative gradients,
  glows, or nested card panels unless they encode information.
- Use borders sparingly. A sequence or pipeline should not become three cards
  inside the outer canvas card when a connector and whitespace are enough.
- Use one accent for structure and a restrained categorical palette only when
  categories or nodes must be distinguished.
- Do not make every mark the same accent color when color can clarify topology.
  Sankey nodes should use distinct colors; links should inherit or gradient
  between their source and target colors.
- Keep chart grid lines quieter than labels and data marks. Avoid pure black or
  pure white for secondary UI.

## Required Dark Mode

Every artifact must deliberately implement and verify both theme modes.

For ECharts, branch on `theme.mode` inside `buildOption` and theme all of these
when present:

- title and subtitle text;
- axis labels, axis lines, and split lines;
- legend text and symbols;
- annotation, mark-line, and graphic text;
- tooltip background, border, and text;
- node, edge, series, and emphasis colors;
- any panel or callout fill.

Do not assume the ECharts default tooltip or axis theme matches the host. Do not
reuse a dark node color on a dark surface or lower link opacity until topology
becomes unreadable.

For React artifacts, prefer existing CSS variables such as `--panel`, `--text`,
`--muted`, `--line`, and `--accent`. Runtime bundle React artifacts without
project CSS must derive inline values from the provided `theme` object.

## Chart Composition

- Reserve explicit space for titles, legends, labels, and bottom annotations;
  the plot must use the remaining rectangle, not overlap those regions.
- Use `containLabel` for axes, but still verify rendered SVG text bounds.
- Keep legends concise and place them near the plot they explain.
- For Sankey, use 10-16px node widths, enough `nodeGap` to separate flows, a
  controlled link opacity, and distinct accessible node colors in both themes.
- Disable animation for proof-oriented static artifacts unless motion carries
  analytical meaning. Hover and tooltip behavior must not interfere with card
  dragging.
- A chart resize must keep all essential labels inside the host at both
  `defaultSize` and `minSize`.

## Review Checklist

Before installation or registration, inspect the artifact in a real browser:

1. Default size in light mode.
2. Default size in dark mode.
3. Proportional minimum size in both themes for dense artifacts.
4. The longest label and the largest realistic value.
5. SVG label bounds, categorical color count, and tooltip contrast for ECharts.
6. The full canvas composition, including neighboring artifacts and node chrome.

Reject the artifact if it contains redundant titles, internal data names,
unreadable dark-mode defaults, clipped annotations, tightly stacked microcopy,
or decoration that competes with the data.
