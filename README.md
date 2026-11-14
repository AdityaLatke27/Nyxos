# NYXOS

A lunar south-pole landing-site navigator built for the NASA Space Apps challenge on Sun and Earth positions at candidate landing sites. It answers three questions separately, for one lander and one landing time: **can we land here** (Safety), **can we complete the mission** (Operations), and **is it worth visiting** (Science). There is no combined score and no ranking. Every figure shows its source and the resolution of the data behind it.

Live demo: _add the hosted link here_

## What it does

| Page | Use it to |
|---|---|
| `/app` Simulator | See the Sun and Earth over real terrain in 3D and from the lander's eye view. Scrub or play time, and read elevation cross-sections, sunlight timelines and an illumination heatmap for any point. |
| `/app/landing` Landing analysis | Pick a site (or type coordinates), a lander and a landing time. Get the three verdicts, the Sun and Earth timelines against the terrain horizon, the longest dark and Earth-out spells, time to the next sunset and Earthset, windows when a stay can start, nearby shadowed ground and craters, and a downloadable report (HTML, PDF, CSV, JSON). |
| `/app/compare` Compare | Put up to 6 sites side by side at one landing time, **or** put one site at up to 6 landing dates to see what a schedule slip does. Differences between columns are highlighted and summarised. |

Also on the Landing and Compare pages:
- **Power and battery** (informational): editable array, battery and load assumptions; output is computed from the lit fraction of the Sun's disc and its elevation every 30 minutes.
- **Link budget** (informational): editable radio assumptions and the Earth distance from the ephemeris.
- **How fast the answer changes with place:** the same assessment at eight points 1 km around the site.

## How it works

- **Sun and Earth positions:** JPL DE440 (hourly table, 2026–2035) with the lunar libration frame. Outside the table an analytic model is used. Checked against JPL Horizons: elevation error up to 0.0007° and azimuth up to 0.0001° at 847 samples across 7 sites.
- **Horizons:** traced from NASA LOLA terrain (about 20 m near a site, up to 400 m far away, depending on the region), including the Moon's curvature. There is no atmosphere, so there is no refraction.
- **Lit:** at least half the Sun's disc above the horizon. The report also gives the share for any part of the disc and for the whole disc.
- **Sunrise and sunset times:** found by bisection on the exact model, not read off the 30-minute samples.
- **Verdicts:** each constraint is Pass, Warning, Fail, Not evaluated or Info, judged against limits tied to the chosen lander (default: NASA Artemis human landing system requirements). Where the terrain data is coarser than the scale a limit is defined at, a Pass is capped at Warning.
- **Sensitivity:** the horizon is raised and lowered to find the shift at which a verdict flips, so each answer is labelled stable, sensitive or fragile.

## Accuracy and limits

Against NASA's published average-illumination maps (LOLA, 60 m and 120 m, 18.6-year average) at 800 random points poleward of 75°S: the modelled Sun-visible fraction differs by 3.3 percentage points RMS (correlation 0.977), and Earth visibility, counted as NASA counts it, by 4.4 points RMS (correlation 0.992). Most of the remaining difference is the coarser terrain model and comparing three modelled years with an 18.6-year average.

A second, weaker check against the 130 Artemis candidate sites of Wueller et al. (2026): the longest sunlit run agrees in rank (Spearman 0.71) and to within 3 days for 69% of 910 site-years. The paper does not publish its window or terrain model, so the window start was fitted. Treat this as a consistency check, not an independent validation.

Known limits:
- **Boulders and small craters are not assessed.** No site is certified safe by slope alone.
- Hydrogen is Lunar Prospector regional context (tens of km). Cold or shadowed ground is evidence of conditions where ice could survive, not proof of ice.
- Direct sunlight only: no scattered light and no shadowing by the lander itself.
- Terrain relief smaller than the data resolution is not modelled.
- Slope data is finest poleward of 80°S; further out it is coarser and verdicts that depend on it are capped at Warning.
- The main simulator (`/app`) uses the analytic Sun and Earth model. Landing and Compare use DE440, so values can differ slightly between the pages.
- The power and link inputs are placeholders to be replaced with a spacecraft's own values.

## Data sources

All terrain and map data comes from NASA and partner archives. The full list with links and resolutions: [`NYXOS_data_sources.md`](NYXOS_data_sources.md). In short: LOLA and SLDEM2015 terrain, PGDA slope, roughness and permanently-shadowed-region maps, LRO Diviner temperatures, Lunar Prospector hydrogen, the Robbins (2019) crater database, JPL DE440 and Horizons, the IAU/USGS nomenclature, and NASA SVS and Moon Trek imagery.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # engine, comparison, link, power and ephemeris tests
npm run build        # type-check and production build
npm run smoke        # opens Landing and Compare in a headless browser and checks key results (needs playwright)
```

The generated assets are committed under `public/`. To rebuild them, the scripts that produced them are:
- `scripts/build_moon_data.py`, `scripts/build_sim_data.py`: simulator terrain, imagery, stars, sites, features.
- `tools/build_landing_tiles.py`, `tools/build_terrain_tiles.py`, `tools/build_science_grid.py`: slope, terrain and science tiles.
- `tools/validation/`: the NASA-map and Wueller comparisons and the Horizons reference.

The CI workflows used to fetch the large source files were run on temporary branches and are not in this repository, so a rebuild needs the source URLs listed at the top of each script.

## Stack

Vite, React, TypeScript, React Three Fiber and zustand. Analysis runs in the browser, with no server.
