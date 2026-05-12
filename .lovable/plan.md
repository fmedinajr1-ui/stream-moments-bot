## Problem

The whole app renders unstyled (browser defaults, serif font, no colors, no layout). Tailwind never compiles `src/styles.css`, so neither utility classes (`flex`, `bg-panel`, `font-display`) nor the design-system tokens reach the page.

Root cause: `src/styles.css` declares two `@utility` blocks with pseudo-element selectors:

```css
@utility scanlines::after { ... }
@utility noise::before { ... }
```

Tailwind v4's `@utility` directive only accepts a single utility-name token. Pseudo-element selectors must live inside the block via `&::after` / `&::before` nesting. The invalid syntax aborts Tailwind's CSS compilation, so the emitted stylesheet is effectively empty.

## Fix

Rewrite the four affected utilities in `src/styles.css` so the pseudo-element rule lives inside its parent utility:

```css
@utility scanlines {
  position: relative;
  &::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: repeating-linear-gradient(
      to bottom,
      transparent 0px,
      transparent 2px,
      rgba(255, 255, 255, 0.025) 2px,
      rgba(255, 255, 255, 0.025) 3px
    );
    mix-blend-mode: overlay;
  }
}

@utility noise {
  position: relative;
  &::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0.04;
    background-image: url("data:image/svg+xml;utf8,<svg ...>");
  }
}
```

Leave the other utilities (`text-glow-red`, `shadow-glow-red`, `bg-radial-blood`) alone — they already have valid single-name `@utility` declarations.

## Verification

1. After the edit, the build should re-emit `styles.css` with all Tailwind utilities included.
2. Reload the preview — the QUEUE page should render with the dark fight-night theme: black background, red sidebar accents, Bebas Neue display font, sharp 0-radius cards, scanline overlay.
3. Confirm no console/runtime errors and no remaining hydration warnings.

## Scope

Single file edited: `src/styles.css`. No component, route, or schema changes. Step 4 (Kick poller) is untouched.
