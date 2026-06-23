Hi Chisom, here's the readme guide for this folder 

```
app/
  roi-calculator/
    page.jsx            The route. Renders at /roi-calculator
components/
  RoiCalculator.jsx     The calculator (client component, all logic + styling)
  RoiCtaButton.jsx      Example button/redirect patterns (reference only)
```

## Install

1. Copy `app/roi-calculator/` into your project's `app/` directory.
2. Copy `components/RoiCalculator.jsx` into your `components/` directory.
3. If your import paths differ, fix the import at the top of
   `app/roi-calculator/page.jsx` to point at wherever `RoiCalculator.jsx` lives.
   If you use the `@/` alias, you can simplify it to:
   `import RoiCalculator from "@/components/RoiCalculator";`

That is the whole install. No dependencies beyond React and Next, both already
in your project. No environment variables, no API keys.

## Wire the button / redirect

The calculator lives at `/roi-calculator`. To send a user there from any
existing page (hero, pricing, footer), use a link:

```jsx
import Link from "next/link";

<Link href="/roi-calculator">Calculate your absenteeism cost</Link>
```

`components/RoiCtaButton.jsx` has two ready patterns: a styled link (preferred),
and a programmatic `router.push("/roi-calculator")` for buttons that already run
their own onClick logic. Use whichever matches your existing markup.

## How it behaves

- All calculation runs in the browser. Nothing is submitted anywhere and no
  visitor data leaves the page. This keeps the page simple and avoids handling
  personal data.
- Currency is USD. Defaults are set for a US workforce. The working-days basis
  is 260 days/year (52 x 5).
- The "Pilot fee" field is a placeholder default and so please change if required by Zanele

## Styling

Styling is scoped under the `.roi` class and injected with the component, so it
will not collide with the rest of the site. Colours match the Welo brand
(brick red on warm paper). To restyle, edit the `styles` template string at the
bottom of `RoiCalculator.jsx`, or lift the CSS into your own stylesheet.
