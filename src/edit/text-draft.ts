export interface TextDraftKey<Owner extends object> {
  owner: Owner
  path: string
  blockOrdinal: number
  index: number
}

export interface TextDraftState {
  value: string
  editing: boolean
  shouldFocus: boolean
  saveFailed?: boolean
}

interface OwnerDrafts {
  drafts: Map<string, TextDraftState>
  queues: Map<string, Promise<void>>
}

function localKey<Owner extends object>(key: TextDraftKey<Owner>): string {
  return `${key.path}\u0000${key.blockOrdinal}\u0000${key.index}`
}

/** Plugin-owned text drafts outlive any one MarkdownPostProcessor DOM tree. */
export class TextDraftRegistry<Owner extends object> {
  private owners = new WeakMap<Owner, OwnerDrafts>()

  get(key: TextDraftKey<Owner>): TextDraftState | null {
    const value = this.owners.get(key.owner)?.drafts.get(localKey(key))
    return value ? { ...value } : null
  }

  set(key: TextDraftKey<Owner>, state: TextDraftState): void {
    this.ownerState(key.owner).drafts.set(localKey(key), { ...state })
  }

  delete(key: TextDraftKey<Owner>): void {
    this.owners.get(key.owner)?.drafts.delete(localKey(key))
  }

  enqueue(key: TextDraftKey<Owner>, task: () => Promise<void>): Promise<void> {
    const owner = this.ownerState(key.owner)
    const id = localKey(key)
    const previous = owner.queues.get(id) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(task)
    owner.queues.set(id, current)
    const cleanup = (): void => {
      if (owner.queues.get(id) === current) owner.queues.delete(id)
    }
    void current.then(cleanup, cleanup)
    return current
  }

  clear(): void {
    this.owners = new WeakMap<Owner, OwnerDrafts>()
  }

  private ownerState(owner: Owner): OwnerDrafts {
    let state = this.owners.get(owner)
    if (!state) {
      state = { drafts: new Map(), queues: new Map() }
      this.owners.set(owner, state)
    }
    return state
  }
}
