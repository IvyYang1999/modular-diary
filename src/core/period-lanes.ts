/** The fields lane layout needs from a timeline entry. */
export interface LaneEntry { startMin: number; endMin: number; plan?: boolean }

/**
 * Side-by-side columns for overlapping blocks of one day. Actual and plan blocks
 * are laid out separately (a plan stays a backdrop under the actual record).
 * Each block also widens into lanes to its right that stay free for its whole
 * span, so a cluster of three does not leave every block a third wide.
 */
export function laneLayout<T extends LaneEntry>(entries: T[]): Map<T, { lane: number; lanes: number; span: number }> {
  const out = new Map<T, { lane: number; lanes: number; span: number }>()
  for (const plan of [false, true]) {
    const group = entries.filter((entry) => Boolean(entry.plan) === plan).sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)
    let cluster: T[] = []
    let clusterEnd = -1
    let laneEnds: number[] = []
    const flush = (): void => {
      for (const entry of cluster) {
        const slot = out.get(entry)!
        slot.lanes = laneEnds.length
        while (slot.lane + slot.span < slot.lanes && !cluster.some((other) => out.get(other)!.lane === slot.lane + slot.span
          && other.startMin < entry.endMin && entry.startMin < other.endMin)) slot.span += 1
      }
      cluster = []
      laneEnds = []
    }
    for (const entry of group) {
      if (entry.startMin >= clusterEnd) { flush(); clusterEnd = -1 }
      let lane = laneEnds.findIndex((end) => end <= entry.startMin)
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(entry.endMin) } else laneEnds[lane] = entry.endMin
      out.set(entry, { lane, lanes: 1, span: 1 })
      cluster.push(entry)
      clusterEnd = Math.max(clusterEnd, entry.endMin)
    }
    flush()
  }
  return out
}
