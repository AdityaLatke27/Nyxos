/**
 * Direct-to-Earth radio link budget, standard link equation (e.g. Wertz and Larson, "Space Mission Analysis and Design"):
 *   Eb/N0 = Ptx + Gtx - FSPL - Losses + G/T - k - 10 log10(R)
 * with k = -228.6 dBW/K/Hz and FSPL = 20 log10(4 pi d / lambda). The inputs are the user's own assumptions about
 * the spacecraft and ground station. NYXOS supplies the Earth distance from DE440. The defaults are generic
 * placeholders and are not a NASA requirement or any specific mission's design.
 */
export interface LinkInputs {
  freqGHz: number
  txPowerW: number
  txGainDbi: number
  /** ground station figure of merit, dB/K */
  gOverTdBK: number
  dataRateKbps: number
  /** Eb/N0 needed for the chosen modulation and coding */
  requiredEbN0dB: number
  /** pointing, polarisation, atmosphere and implementation losses combined */
  lossesDb: number
  /** margin the project wants to keep above the required Eb/N0 */
  requiredMarginDb: number
}

export const DEFAULT_LINK: LinkInputs = {
  freqGHz: 2.2,
  txPowerW: 5,
  txGainDbi: 6,
  gOverTdBK: 40,
  dataRateKbps: 100,
  requiredEbN0dB: 2.5,
  lossesDb: 3,
  requiredMarginDb: 3,
}
export const LINK_SOURCE = 'User-defined placeholder inputs; not a NASA value or a specific spacecraft. Replace with your spacecraft and ground-station values.'

const C = 299792458
const K_DBW = -228.6

export const fspl = (distKm: number, freqGHz: number) => 20 * Math.log10((4 * Math.PI * distKm * 1000 * freqGHz * 1e9) / C)

/** Link margin in dB above the required Eb/N0 at one Earth distance. */
export function linkMarginDb(i: LinkInputs, distKm: number): number {
  const ebn0 = 10 * Math.log10(i.txPowerW) + i.txGainDbi - fspl(distKm, i.freqGHz) - i.lossesDb + i.gOverTdBK - K_DBW - 10 * Math.log10(i.dataRateKbps * 1000)
  return ebn0 - i.requiredEbN0dB
}

export interface LinkResult {
  nearKm: number
  farKm: number
  marginNearDb: number
  marginFarDb: number
  /** the link closes at every distance in the stay with the project margin kept */
  closesThroughout: boolean
  closesAtAll: boolean
  /** most downlink volume in megabytes, if the link runs during every Earth-visible moment; 0 when the link never closes */
  volumeMB: number
}

export function linkResult(i: LinkInputs, nearKm: number, farKm: number, earthVisibleHours: number): LinkResult {
  const marginNearDb = linkMarginDb(i, nearKm)
  const marginFarDb = linkMarginDb(i, farKm)
  const closesThroughout = marginFarDb >= i.requiredMarginDb
  return {
    nearKm, farKm, marginNearDb, marginFarDb, closesThroughout,
    closesAtAll: marginNearDb >= i.requiredMarginDb,
    volumeMB: marginNearDb < i.requiredMarginDb ? 0 : (i.dataRateKbps * 1000 * earthVisibleHours * 3600) / 8 / 1e6,
  }
}
