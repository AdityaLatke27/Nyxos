import { describe, expect, it } from 'vitest'
import type { Feature } from '../sim/data/types'
import { craterAt, searchCraters } from './craterLookup'

const F: Feature[] = [
  ['Big', -80, 0, 100, 'crater'],
  ['Small', -80, 0.5, 10, 'crater'],
  ['Tiny', -80, 0.5, 1, 'crater'], // below the minimum size
  ['Mare Big', -80, 0, 500, 'mare'], // not a crater
  ['Seam', 0, 179.95, 20, 'crater'], // straddles the antimeridian
  ['Bigfoot', 10, 10, 30, 'crater'],
]

describe('crater lookup', () => {
  it('returns the smallest crater that contains the point', () => {
    expect(craterAt(F, -80, -0.5)?.[0]).toBe('Big') // 5.3 km from Small's centre: outside it (r = 5 km), inside Big
    expect(craterAt(F, -80, 0.5)?.[0]).toBe('Small') // inside both: the smaller one wins
  })

  it('ignores non-craters and craters below the minimum size', () => {
    expect(craterAt(F, -80, 0.5)?.[0]).not.toBe('Tiny')
    expect(craterAt([['Mare Big', -80, 0, 500, 'mare']], -80, 0)).toBeNull()
  })

  it('returns null outside every crater', () => {
    expect(craterAt(F, 45, 45)).toBeNull()
    expect(craterAt(F, -80, 10)).toBeNull() // ~53 km from Big's centre (r = 50 km)
  })

  it('works across the 180° meridian', () => {
    expect(craterAt(F, 0, -179.95)?.[0]).toBe('Seam')
  })

  it('searches by name, prefix matches first, then larger craters first', () => {
    expect(searchCraters(F, 'big').map((f) => f[0])).toEqual(['Big', 'Bigfoot'])
    expect(searchCraters(F, 'ig').map((f) => f[0])).toEqual(['Big', 'Bigfoot'])
    expect(searchCraters(F, 'b')).toEqual([]) // too short
    expect(searchCraters(F, 'tiny')).toEqual([]) // below the minimum size
  })
})
