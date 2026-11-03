/**
 * When each scene shows. Scenes keep their own lengths, so the video is
 * exactly as long as their sum: a transition straddles the boundary between
 * two scenes, taking half its time from each side. A scene's own clock (for
 * its CSS animations) starts the moment it begins to appear.
 */

export const TRANSITIONS = ['fade', 'cut', 'slide-left', 'slide-up', 'wipe', 'circle'] as const
export type TransitionKind = (typeof TRANSITIONS)[number]

/** Longest transition, in seconds; shorter when a scene next to it is short. */
export const TRANSITION_SECONDS = 0.6

export interface TimedScene {
  seconds: number
  /** How this scene hands over to the next one. */
  transition: TransitionKind
}

interface Handover {
  /** Time of the boundary between two scenes. */
  at: number
  duration: number
  kind: TransitionKind
}

export interface Timeline {
  total: number
  starts: number[]
  /** handovers[i] joins scene i to scene i + 1. */
  handovers: Handover[]
}

export interface Shot {
  scene: number
  /** Seconds on the scene's own clock. */
  local: number
}

export type Frame = Shot | { from: Shot; to: Shot; kind: TransitionKind; progress: number }

export function planTimeline(scenes: TimedScene[]): Timeline {
  const starts: number[] = []
  let at = 0
  for (const scene of scenes) {
    starts.push(at)
    at += scene.seconds
  }
  const handovers = scenes.slice(0, -1).map((scene, i) => {
    const room = Math.min(scene.seconds, scenes[i + 1].seconds) / 2
    const duration = scene.transition === 'cut' ? 0 : Math.min(TRANSITION_SECONDS, room)
    return { at: starts[i + 1], duration, kind: scene.transition }
  })
  return { total: at, starts, handovers }
}

/** When scene `i` begins to appear: half a transition before its nominal start. */
function appearsAt(timeline: Timeline, i: number): number {
  return timeline.starts[i] - (i > 0 ? timeline.handovers[i - 1].duration / 2 : 0)
}

function shot(timeline: Timeline, scene: number, t: number): Shot {
  return { scene, local: t - appearsAt(timeline, scene) }
}

function sceneAt(timeline: Timeline, t: number): number {
  let i = 0
  while (i + 1 < timeline.starts.length && timeline.starts[i + 1] <= t) i++
  return i
}

/** What to draw at time `t`: one scene, or two in the middle of a transition. */
export function frameAt(timeline: Timeline, t: number): Frame {
  const i = sceneAt(timeline, t)
  for (const j of [i - 1, i]) {
    const handover = timeline.handovers[j]
    if (!handover || handover.duration === 0) continue
    const progress = (t - (handover.at - handover.duration / 2)) / handover.duration
    if (progress >= 0 && progress < 1) {
      return { from: shot(timeline, j, t), to: shot(timeline, j + 1, t), kind: handover.kind, progress }
    }
  }
  return shot(timeline, i, t)
}
