# NYXOS: external data sources and links, by parameter

Compiled from the repository (report.tsx, validation.ts, profile.ts, build scripts, data manifests). Where the repo records no exact URL, that is stated instead of guessed.

## 1. Landing assessment: safety

| Parameter | Source | Link / identifier | Resolution |
|---|---|---|---|
| Landing slope (<10° over 100 m) | NASA PGDA, LOLA plane-fit slope, LDRM `SLP_100M` (Barker et al., "A New View of the Lunar South Pole from LOLA") | https://pgda.gsfc.nasa.gov/products/90 | 50 m pixels, 100–200 m hazard cells, 80°S to pole |
| Slope error carried with the verdict | PGDA LDSM `_ERR` rasters | https://pgda.gsfc.nasa.gov/products/90 | 10 m native, 100 m cells |
| Slope outside 80°S, and cross-check | PGDA LOLA LDSM digital slope maps, e.g. `LDSM_83S_10MPP_ADJ` | https://pgda.gsfc.nasa.gov/products/90 | 10–60 m native, 100–480 m cells, 60°S to pole |
| EVA slope (<20° over 2 km) | PGDA LDRM `SLP_1600M` (nearest published baseline to 2 km) | https://pgda.gsfc.nasa.gov/products/90 | 50 m pixels |
| Roughness (no verdict) | PGDA LDRM `ROUGH_100M` | https://pgda.gsfc.nasa.gov/products/90 | 50 m pixels |
| Elevation, relief | PGDA LOLA `LDEM_80S_20MPP_ADJ` | https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/ | 20 m, 80°S to pole |
| Boulders | Not evaluated. No open polar dataset found. | none | none |

## 2. Landing assessment: operations

| Parameter | Source | Link / identifier | Notes |
|---|---|---|---|
| Lander limits (slope, 100 m zone, 2 km EVA, 6° polar band, lit for whole stay, direct Earth) | NASA Artemis HLS update, "Key Artemis III Landing Requirements" | NTRS 20240009596 (https://ntrs.nasa.gov, search the ID) | Thresholds only, not a data layer |
| Stay length (6.5 d), traverse reach (10 km) | NYXOS assumptions, editable | none | Stated as assumptions in the report |
| Sun and Earth direction | JPL DE440 via SPICE. Kernels: `naif0012.tls`, `de440s.bsp`, `moon_pa_de440_200625.bpc`, `pck00011.tpc`, `moon_de440_250416.tf` | https://naif.jpl.nasa.gov/ ; Park et al. 2021, AJ 161, 105 | Hourly table 2026–2035, cubic interpolation |
| Ephemeris check | JPL Horizons | https://ssd.jpl.nasa.gov/horizons/ | 847 samples at 7 sites: elevation error ≤ 0.0007°, azimuth ≤ 0.0001° |
| Fallback Sun/Earth model (dates outside the table, and the main `/app` simulator) | Meeus, *Astronomical Algorithms*; IAU WGCCRE lunar orientation (Archinal et al.) | books/papers, no URL | Up to 0.26° azimuth vs Horizons |
| Link budget | Standard link equation; inputs are the user's own placeholders | none | Informational row, never changes a verdict |

## 3. Landing assessment: science

| Parameter | Source | Link / identifier | Resolution |
|---|---|---|---|
| Permanently shadowed regions | PGDA LOLA illumination-based PSR map `LPSR_80S_20MPP_ADJ` | https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LPSR_80S_20MPP_ADJ.TIF | 20 m |
| Surface temperature, thermal cold traps (≤110 K) | LRO Diviner polar products, UCLA (Williams et al. 2019, JGR 124, 2505; Schorghofer & Williams 2020) | https://luna1.diviner.ucla.edu/~jpierre/diviner/level4_polar/ | 240 m bins, 2009–2020 |
| Regional hydrogen | Lunar Prospector neutron spectrometer, reduced hydrogen maps (Feldman et al. 2001, JGR), PDS Geosciences Node (`hydrogenlow`, `hydrogenhd`) | PDS Geosciences Node. The repo does not record the exact file URL. | 60 km equal-area bins and 0.5° bins |
| Large-crater density | Robbins (2019) Lunar Crater Database, JGR Planets 124, 871–892, USGS Astrogeology 2018-08-15 release | https://astrogeology.usgs.gov/ckan/dataset/f89f5478-b69a-486c-b9b5-30d7b0c5ad2b/resource/c4f25cc2-4f8a-4207-a845-5e176da3ac5a/download/lunar_crater_database_robbins_2018 | 14,406 craters ≥ 1 km poleward of 80°S |
| Named craters and sites | IAU/USGS Gazetteer of Planetary Nomenclature | https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.zip | Diameter ≥ 2 km |

Hydrogen is regional context only. Evidence of cold or shadowed ground is not proof of ice.

### Other missions' landing sites (Compare and Landing place lists)

| Site | Position used | Source | Link |
|---|---|---|---|
| Chandrayaan-3 (Statio Shiv Shakti), India, 2023 | 69.37°S, 32.32°E (two decimals) | IAU/USGS Gazetteer of Planetary Nomenclature, adopted 19 March 2024 | https://planetarynames.wr.usgs.gov/Feature/16272 |
| Luna-25 impact crater, Russia, 2023 (a crash) | 57.865°S, 61.360°E | NASA LRO, crater likely from the impact | https://www.nasa.gov/?p=505500 |
| Chang'e-4, China, 2019 | 45.457°S, 177.589°E, ±20 m | LROC lander coordinates | https://lroc.im-ldi.com/images/1087 |
| Chang'e-6, China, 2024 | 41.6385°S, 206.0148°E (153.9852°W), ±30 m | LROC computed landing site coordinates | https://lroc.im-ldi.com/images/1374 |
| SLIM, Japan, 2024 | 13.3160°S, 25.2510°E | NASA LRO observation of the lander | https://www.nasa.gov/missions/lro/nasas-lro-spots-japans-moon-lander |

These sites lie outside the polar terrain maps, so the analysis uses coarser terrain there (about 2.7 km in the tests) and the app states the terrain resolution with each result. Blue Ghost Mission 1 was left out because the sources found give only its target region, not the touchdown point.

## 4. Terrain used for sunlight and Earth-visibility shadows

| Layer | Source | Link | Resolution |
|---|---|---|---|
| Polar DEM, fine | LRO LOLA `LDEM_80S_80M` | PDS Geosciences Node: https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ | 100 m, ±204.8 km |
| Polar DEM, wide | LRO LOLA `LDEM_75S_240M` | same folder | 400 m, ±409.6 km |
| Per-site local grids | LOLA `LDEM_75S_30M` / `_120M`; SLDEM2015 outside the polar caps | PDS (above); http://imbrium.mit.edu/DATA/SLDEM2015/ | 20 m / 120 m polar; 60 m / 240 m SLDEM |
| Global and mid-latitude relief | LOLA `LDEM_16`, `LDEM_64`; SLDEM2015 (LOLA + SELENE Terrain Camera) | https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ ; http://imbrium.mit.edu/DATA/SLDEM2015/ | 2.67 km to 59 m |

## 5. Appearance of the 3D scene (visual only, no effect on verdicts)

| Layer | Source | Link |
|---|---|---|
| Moon colour | NASA SVS CGI Moon Kit (LROC WAC colour) | https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ |
| Stars | NASA SVS Deep Star Maps 2020 (Hipparcos-2, Tycho-2, Gaia DR2) | https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/ |
| Polar imagery | LRO WAC global mosaic v2 (NASA/GSFC/ASU) via NASA Moon Trek | https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/ |
| Earth day, clouds, night | Solar System Scope textures (CC BY 4.0, from NASA data) | https://www.solarsystemscope.com/textures/ |

## 6. Validation and benchmarks

| Check | Source | Link / identifier | Result recorded in the app |
|---|---|---|---|
| Sun-visible and Earth-visible fraction | NASA PGDA average-illumination maps `AVGVISIB_85S_060M_201608`, `AVGVISIB_75S_120M_201608` (18.6-year hourly average) | https://pgda.gsfc.nasa.gov/data/MoonIllumination/ | See `validationSentence()` in src/landing/validation.ts |
| 130 Artemis candidate sites, longest sunlit run | Wueller et al. 2026, JGR Planets, doi 10.1029/2025JE009434; data on Zenodo | doi 10.5281/zenodo.17084058 | Spearman 0.71, within 3 days for 69% of 910 site-years, mean absolute difference 3.4 d. A consistency check only: the paper's window and DEM are unpublished, so the window start was fitted. |
| Ephemeris | JPL Horizons | https://ssd.jpl.nasa.gov/horizons/ | 847 samples, errors under 0.001° |
| Crater catalogue | IAU polar craters | see Section 3 | 36 of 36 matched, median diameter ratio 0.99 |

## 7. Evaluated and rejected

| Candidate | Why it was not used |
|---|---|
| LU5M812TGT crater catalogue | Polar crater diameters were wrong |
| Aussel et al. 2025 boulder map | Covers only 60°S–60°N |
| Boazman et al. 2022 boulders | No data link found |

## 8. Open gaps

- Boulders and small craters: not assessed.
- LEND finer hydrogen: not loaded.
- LROC, LAMP and Mini-RF evidence layers: listed as instruments only, no data.
- Link-budget values and the thermal limits of any lander: user-defined, not sourced.
