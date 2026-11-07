/**
 * Where a number on screen comes from. Every measurement in the crater overview carries one
 * of these, so a catalogue value is never mistaken for something NYXOS measured.
 */
export type Source = 'catalogue' | 'dem' | 'modelled' | 'unavailable'

export const SOURCE_SHORT: Record<Source, string> = {
  catalogue: 'CAT',
  dem: 'DEM',
  modelled: 'MODEL',
  unavailable: 'N/A',
}

export const SOURCE_EXPLAIN: Record<Source, string> = {
  catalogue: 'Published value from the IAU / USGS Gazetteer of Planetary Nomenclature',
  dem: 'Calculated by NYXOS from the LOLA elevation model; not yet checked against published depths',
  modelled: 'Output of a NYXOS model',
  unavailable: 'Not available: the required dataset is not loaded',
}
