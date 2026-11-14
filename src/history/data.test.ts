import raw from '../../public/sim/sites.json?raw'
import { describe, expect, it } from 'vitest'
import { INFO, MISSIONS, QUIZ, craterHref, eyesUrl, placeOf } from './data'

const sites = JSON.parse(raw) as { id: string; lat: number; lon: number }[]

describe('history data', () => {
  it('every mission id is unique and years are in order', () => {
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(MISSIONS.length)
    const years = MISSIONS.map((m) => m.year)
    expect(years).toEqual([...years].sort((a, b) => a - b))
  })
  it('every site reference resolves to a real position', () => {
    for (const m of MISSIONS.filter((x) => x.siteId || x.missionSiteId)) expect(placeOf(m, sites), m.id).not.toBeNull()
  })
  it('six Apollo landings are all in the Crater tab list', () => {
    expect(MISSIONS.filter((m) => m.id.startsWith('apollo') && m.siteId).length).toBe(6)
    expect(sites.filter((s) => s.id.startsWith('apollo-')).length).toBe(6)
  })
  it('Crater tab links: stand view for Apollo, pole view for polar landers, picked point for others', () => {
    const get = (id: string) => { const m = MISSIONS.find((x) => x.id === id)!; return craterHref(m, placeOf(m, sites)!) }
    expect(get('apollo11')).toMatch(/^\/app\/\?site=apollo-11&view=stand&t=1969-07-20/)
    expect(get('im1')).toMatch(/view=pole/)
    expect(get('ch3')).toMatch(/^\/app\/\?at=-69\.37,32\.32&view=globe/)
  })
  it('quiz answers are in range', () => { for (const q of QUIZ) expect(q.answer).toBeLessThan(q.options.length) })
  it('every mission has launch, purpose, result and a NASA Eyes view', () => {
    for (const m of MISSIONS) {
      const i = INFO[m.id]
      expect(i, m.id).toBeDefined()
      for (const k of ['launched', 'arrived', 'purpose', 'result', 'eyes'] as const) expect(i[k].length, `${m.id}.${k}`).toBeGreaterThan(3)
      expect(eyesUrl(i.eyes)).toMatch(/^https:\/\/eyes\.nasa\.gov\/apps\/solar-system\/#\/.+logo=false$/)
    }
  })
})
