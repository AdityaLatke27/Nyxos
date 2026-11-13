// @ts-nocheck
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { craterContext } from './craters'

const data = JSON.parse(readFileSync('public/landing/craters.json', 'utf8'))
describe('Robbins polar crater context (real catalogue)', () => {
  it('has the polar craters and places Shackleton centre inside a ~21 km crater', () => {
    expect(data.craters.length).toBe(14406)
    const c = craterContext(data, -89.9, 129.78)!
    expect(c.insideDiamKm).toBeGreaterThan(19)
    expect(c.insideDiamKm).toBeLessThan(23)
  })
  it('returns null north of 80.5°S and counts craters within the radius', () => {
    expect(craterContext(data, -70, 0)).toBeNull()
    const c = craterContext(data, -86, 20, 10)!
    expect(c.count1).toBeGreaterThanOrEqual(c.count2)
    expect(c.capDensity1).toBeGreaterThan(40)
    expect(c.capDensity1).toBeLessThan(60)
  })
})
