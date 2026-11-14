/**
 * Moon history for the History page: our own short stories, written for young readers.
 * Dates are the well-known public mission dates. Positions are never typed in here: Apollo and Intuitive Machines sites come from
 * public/sim/sites.json (the Crater tab's own list) and the other missions from MISSION_SITES, each with its published source.
 */
import { MISSION_SITES } from '../landing/candidateSites'

export type Kind = 'crew' | 'robot' | 'water' | 'today'
export type Country = 'USA' | 'USSR' | 'China' | 'India' | 'Japan' | 'Russia' | 'USA (company)'

export interface Mission {
  id: string
  year: number
  date: string
  title: string
  country: Country
  kind: Kind
  /** two or three short sentences */
  story: string
  fact: string
  /** place on the map: a site in the Crater tab list, or one of MISSION_SITES */
  siteId?: string
  missionSiteId?: string
  /** moment to open the Crater tab at (UTC) */
  atIso?: string
}

export const MISSIONS: Mission[] = [
  { id: 'luna2', year: 1959, date: '13 Sep 1959', title: 'Luna 2 reaches the Moon', country: 'USSR', kind: 'robot', story: 'A Soviet probe flew straight into the Moon. It was the first thing people ever sent there. It could not land softly, so it crashed on purpose.', fact: 'A month later Luna 3 took the first photos of the far side, the half we never see from Earth.' },
  { id: 'luna9', year: 1966, date: '3 Feb 1966', title: 'Luna 9: the first soft landing', country: 'USSR', kind: 'robot', story: 'Luna 9 landed gently and sent back pictures from the ground. Before this, some scientists worried a spacecraft would sink into deep dust. It did not.', fact: 'The Moon\'s surface turned out to be firm enough to stand on.' },
  { id: 'apollo8', year: 1968, date: 'Dec 1968', title: 'Apollo 8: people circle the Moon', country: 'USA', kind: 'crew', story: 'Three astronauts became the first people to fly around the Moon. They did not land, but they looked down at its craters with their own eyes.', fact: 'They took the famous "Earthrise" photo: Earth rising over the Moon\'s edge.' },
  { id: 'apollo11', year: 1969, date: '20 Jul 1969', title: 'Apollo 11: first footsteps', country: 'USA', kind: 'crew', story: 'Neil Armstrong and Buzz Aldrin landed in the Sea of Tranquility and walked on the Moon. Michael Collins stayed in orbit and waited for them.', fact: 'Their landing spot is close to the Moon\'s equator, where the Sun rises high in the sky.', siteId: 'apollo-11', atIso: '1969-07-20T20:17:40Z' },
  { id: 'apollo12', year: 1969, date: '19 Nov 1969', title: 'Apollo 12: a pinpoint landing', country: 'USA', kind: 'crew', story: 'Pete Conrad and Alan Bean landed in the Ocean of Storms, very close to a robot called Surveyor 3 that had arrived two years earlier.', fact: 'They walked over to Surveyor 3 and took parts home to study.', siteId: 'apollo-12', atIso: '1969-11-19T06:54:00Z' },
  { id: 'luna16', year: 1970, date: 'Sep and Nov 1970', title: 'Robots bring rocks home, and drive', country: 'USSR', kind: 'robot', story: 'Luna 16 scooped up Moon soil and flew it back to Earth with no people on board. Two months later Lunokhod 1, the first rover on another world, began to drive.', fact: 'Both were controlled from Earth by people watching camera pictures.' },
  { id: 'apollo14', year: 1971, date: '5 Feb 1971', title: 'Apollo 14: golf on the Moon', country: 'USA', kind: 'crew', story: 'Alan Shepard and Edgar Mitchell landed in the Fra Mauro highlands. They pulled a cart of tools across the rough ground.', fact: 'Shepard hit a golf ball with a tool he had made into a club.', siteId: 'apollo-14', atIso: '1971-02-05T09:18:00Z' },
  { id: 'apollo15', year: 1971, date: '30 Jul 1971', title: 'Apollo 15: the first Moon car', country: 'USA', kind: 'crew', story: 'David Scott and James Irwin landed beside a deep winding valley called Hadley Rille and drove the first Lunar Rover.', fact: 'The car let them travel several kilometres from the lander.', siteId: 'apollo-15', atIso: '1971-07-30T22:16:00Z' },
  { id: 'apollo16', year: 1972, date: '21 Apr 1972', title: 'Apollo 16: the highlands', country: 'USA', kind: 'crew', story: 'John Young and Charles Duke explored the Descartes highlands, old bright mountains very different from the dark plains of earlier landings.', fact: 'Charles Duke left a photo of his family on the surface.', siteId: 'apollo-16', atIso: '1972-04-21T02:23:00Z' },
  { id: 'apollo17', year: 1972, date: '11 Dec 1972', title: 'Apollo 17: the last visit so far', country: 'USA', kind: 'crew', story: 'Gene Cernan and Harrison Schmitt, a real geologist, landed in the Taurus-Littrow valley. They were the last people to walk on the Moon.', fact: 'In total, 12 people have walked on the Moon, all between 1969 and 1972.', siteId: 'apollo-17', atIso: '1972-12-11T19:54:00Z' },
  { id: 'lcross', year: 2009, date: '9 Oct 2009', title: 'LCROSS: is there water?', country: 'USA', kind: 'water', story: 'A spacecraft crashed into Cabeus, a crater near the south pole that never sees sunlight. Instruments looked at the dust cloud it threw up and found water in it.', fact: 'Earlier, in 1998, Lunar Prospector had already hinted at hydrogen near the poles.' },
  { id: 'ce4', year: 2019, date: '3 Jan 2019', title: "Chang'e-4: the far side", country: 'China', kind: 'robot', story: 'China landed the first spacecraft on the far side of the Moon. Because the Moon blocks the view of Earth there, it talks to home through a satellite.', fact: 'The far side has far fewer dark plains than the side we see.', missionSiteId: 'ce4' },
  { id: 'l25', year: 2023, date: '19 Aug 2023', title: 'Luna-25: a crash', country: 'Russia', kind: 'robot', story: 'Russia\'s Luna-25 was heading for the south polar region but crashed. NASA\'s LRO orbiter later spotted the new crater.', fact: 'Landing near the poles is hard, and not every try works.', missionSiteId: 'l25' },
  { id: 'ch3', year: 2023, date: '23 Aug 2023', title: 'Chandrayaan-3: close to the pole', country: 'India', kind: 'today', story: 'India landed near 69°S, closer to the south pole than any landing before it. A little rover named Pragyan rolled out and drove around.', fact: 'It landed during the lunar morning, so it had sunlight to work with.', missionSiteId: 'ch3', atIso: '2023-08-23T12:33:00Z' },
  { id: 'slim', year: 2024, date: '19 Jan 2024', title: 'SLIM: aiming for a spot', country: 'Japan', kind: 'today', story: 'Japan tried to land very close to a chosen target. It touched down at an odd angle, but it still worked.', fact: 'Its nickname is the "Moon Sniper".', missionSiteId: 'slim', atIso: '2024-01-19T15:20:00Z' },
  { id: 'im1', year: 2024, date: '22 Feb 2024', title: 'Odysseus: a company lands', country: 'USA (company)', kind: 'today', story: 'Odysseus, built by the company Intuitive Machines, was the first private spacecraft to land on the Moon. It tipped onto its side but kept working for days.', fact: 'It landed near the south pole, at about 80°S.', siteId: 'im1', atIso: '2024-02-22T23:23:00Z' },
  { id: 'ce6', year: 2024, date: 'Jun 2024', title: "Chang'e-6: far-side rocks", country: 'China', kind: 'today', story: 'China brought back rocks and soil from the far side of the Moon, the first time anyone has done this.', fact: 'It returned to Earth with almost 2 kilograms of samples.', missionSiteId: 'ce6' },
  { id: 'im2', year: 2025, date: '6 Mar 2025', title: 'Athena: closest yet', country: 'USA (company)', kind: 'today', story: 'A second Intuitive Machines lander went even nearer the pole, near Mons Mouton. It ended up on its side in a shadowy spot and ran out of power quickly.', fact: 'Shadows near the poles make power and landing both hard, which is why we study these places.', siteId: 'im2', atIso: '2025-03-06T12:00:00Z' },
  { id: 'art2', year: 2026, date: 'Apr 2026', title: 'Artemis II: people go back', country: 'USA', kind: 'today', story: 'Four astronauts flew around the Moon and returned to Earth after about ten days. They were the first people to travel that far since 1972.', fact: 'NASA says people should land on the Moon again on Artemis IV, planned for 2028. Plans can change.' },
]

export const KIND_LABEL: Record<Kind, string> = { crew: 'People', robot: 'Robots', water: 'Water hunt', today: 'The new race' }

export const COUNTRY_COLOR: Record<Country, string> = {
  USA: '#6fc3ff', 'USA (company)': '#a78bfa', USSR: '#ff7a8a', Russia: '#ff7a8a', China: '#ffd166', India: '#5fd6a0', Japan: '#f78fb3',
}

export interface Place { lat: number; lon: number; note: string }

/** Position of a mission: from the Crater tab's site list or from MISSION_SITES. */
export function placeOf(m: Mission, sites: { id: string; lat: number; lon: number }[]): Place | null {
  if (m.siteId) {
    const s = sites.find((x) => x.id === m.siteId)
    return s ? { lat: s.lat, lon: s.lon, note: 'NYXOS site list (NASA LRO terrain)' } : null
  }
  if (m.missionSiteId) {
    const s = MISSION_SITES.find((x) => x.id === m.missionSiteId)
    return s ? { lat: s.lat, lon: s.lon, note: s.source } : null
  }
  return null
}

/** Where the Crater tab should open to show this landing. */
export function craterHref(m: Mission, p: Place): string {
  const t = m.atIso ? `&t=${encodeURIComponent(m.atIso)}` : ''
  if (m.siteId) return `/app/?site=${m.siteId}&view=${p.lat < -75 ? 'pole' : 'stand'}${t}`
  return `/app/?at=${p.lat},${p.lon}&view=globe${t}`
}

export const landingHref = (m: Mission, p: Place) => `/app/landing?name=${encodeURIComponent(m.title)}&lat=${p.lat}&lon=${p.lon}`

export const FAST_FACTS = [
  { big: '12', small: 'people have walked on the Moon' },
  { big: '1972', small: 'the last time anyone did' },
  { big: '3 days', small: 'for Apollo to fly from Earth to the Moon' },
]

export interface QuizQ { q: string; options: string[]; answer: number; why: string }
export const QUIZ: QuizQ[] = [
  { q: 'Who was the first person to walk on the Moon?', options: ['Buzz Aldrin', 'Neil Armstrong', 'Alan Shepard', 'Gene Cernan'], answer: 1, why: 'Neil Armstrong stepped out first on Apollo 11, in July 1969. Buzz Aldrin followed him.' },
  { q: 'How many people have walked on the Moon?', options: ['2', '6', '12', '24'], answer: 2, why: 'Twelve people, on six Apollo landings between 1969 and 1972.' },
  { q: 'Chang\'e-4 landed on the Moon\'s far side. What is the far side?', options: ['The half that always faces away from Earth', 'The side in shadow right now', 'The South Pole', 'The side with the most craters named after people'], answer: 0, why: 'The Moon always shows us the same face, so the far side is the half we never see from Earth.' },
  { q: 'Why are landings near the Moon\'s poles tricky?', options: ['It is too windy', 'The Sun stays low, so shadows are long and some places are always dark', 'There is no ground', 'The poles are too far from Earth'], answer: 1, why: 'The Moon\'s axis is tilted only about 1.5°, so near the poles the Sun skims the horizon. Shadows are long and some crater floors never see sunlight.' },
  { q: 'Which landing happened first?', options: ['Chandrayaan-3', 'Apollo 17', 'Chang\'e-4', 'Odysseus'], answer: 1, why: 'Apollo 17 landed in December 1972, long before the others.' },
]
