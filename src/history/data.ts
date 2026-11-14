/**
 * Data for the History page.
 *
 * The viewer presets come from the Nyxos-History repository (Zeus07-go, branch feat/lunar-chronicles): NASA's Eyes on the
 * Solar System, embedded with its documented URL options. Landing positions of the newer missions come from
 * MISSION_SITES in candidateSites.ts, which carries each position's source. Dates below are the well-known public
 * mission dates; nothing here is estimated.
 */
import { MISSION_SITES } from '../landing/candidateSites'

const EYES = 'https://eyes.nasa.gov/apps/solar-system/#'
/** logo=false is one of NASA's documented embed options. */
export const eyesUrl = (path: string) => `${EYES}${path}${path.includes('?') ? '&' : '?'}logo=false`

export interface Moment {
  id: string
  label: string
  note: string
  path: string
}

export const MOMENTS: Moment[] = [
  { id: 'now', label: 'Today', note: 'Live positions of planets and spacecraft', path: '/home' },
  { id: 'moon', label: 'The Moon', note: 'Fly to the Moon, right now', path: '/moon' },
  { id: 'apollo11', label: 'Apollo 11', note: 'First crewed landing, 20 July 1969', path: '/moon?time=1969-07-20T20:17:40.000+00:00&rate=0' },
  { id: 'artemis1', label: 'Artemis I', note: 'Uncrewed flight around the Moon, December 2022', path: '/sc_artemis_1?rate=1&time=2022-12-05T12:40:08.518+00:00' },
  { id: 'voyager', label: 'Voyager', note: 'The grand tour story', path: '/story/voyager_grand_tour' },
]

export interface Chapter {
  id: string
  year: string
  title: string
  who: string
  story: string
  /** a NASA Eyes moment to jump to */
  moment?: string
  /** a mission site in MISSION_SITES, for "check this site" links */
  site?: string
}

export const CHAPTERS: Chapter[] = [
  { id: 'a11', year: '1969', title: 'Apollo 11: the first footprints', who: 'United States (NASA)', story: 'On 20 July 1969 Neil Armstrong and Buzz Aldrin landed near the equator, in the Sea of Tranquility. All six Apollo landings, from 1969 to 1972, were in low and middle latitudes, where the Sun rises and sets about every two weeks.', moment: 'apollo11' },
  { id: 'ce4', year: '2019', title: "Chang'e-4: the far side", who: 'China (CNSA)', story: 'The first soft landing on the side of the Moon that never faces Earth. With no direct line to Earth, it needed a relay satellite to talk to home.', site: 'ce4' },
  { id: 'ch3', year: '2023', title: 'Chandrayaan-3: close to the pole', who: 'India (ISRO)', story: 'India landed at about 69°S, the closest to a pole any lander had touched down. Near the poles the Sun skims the horizon, so shadows are long and sunlight is hard to plan.', site: 'ch3' },
  { id: 'l25', year: '2023', title: 'Luna-25: a lesson', who: 'Russia (Roscosmos)', story: 'Luna-25 aimed for the south polar region and crashed. NASA\'s LRO later found the new crater. Polar landings are hard, which is why sites are checked so carefully.', site: 'l25' },
  { id: 'a1', year: '2022', title: 'Artemis I: testing the ride', who: 'United States (NASA)', story: 'An uncrewed Orion capsule flew around the Moon and back in late 2022. Artemis III plans to land people near the south pole, which is the kind of place NYXOS helps you look at.', moment: 'artemis1' },
  { id: 'slim', year: '2024', title: 'SLIM: landing on a target', who: 'Japan (JAXA)', story: 'Japan\'s lander aimed to touch down within a short distance of a chosen spot. It shows why small details of the ground matter.', site: 'slim' },
  { id: 'ce6', year: '2024', title: "Chang'e-6: samples from the far side", who: 'China (CNSA)', story: 'The first mission to bring back rock and soil from the far side of the Moon.', site: 'ce6' },
]

export const siteOf = (id?: string) => MISSION_SITES.find((s) => s.id === id)

export const landingLink = (id: string) => {
  const s = siteOf(id)
  return s ? `/app/landing?name=${encodeURIComponent(s.name)}&lat=${s.lat}&lon=${s.lon}` : '/app/landing'
}

/** Short, plain answers for the "why is the pole different" box. */
export const WHY_POLE = [
  { q: 'Why is the Sun always low?', a: 'The Moon\'s axis is tilted only about 1.5°, so near the poles the Sun never climbs high. It circles the horizon.' },
  { q: 'Why are there long shadows?', a: 'A low Sun makes tall things throw very long shadows. A crater rim can stay lit while the floor next to it is dark.' },
  { q: 'Why do some places stay dark forever?', a: 'Some crater floors never see the Sun. They are called permanently shadowed regions and are very cold. Cold alone is not proof of ice.' },
  { q: 'Why does the date matter?', a: 'The Sun and Earth move across the sky as the Moon wobbles slowly. A site can be fine one week and dark the next.' },
]
