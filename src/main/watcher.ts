// Watches mounted roots for project changes and /Volumes for drives coming and going (SPEC section 3).
import { watch as watchDir, type FSWatcher as NodeWatcher } from 'node:fs'
import { basename, relative } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { Root } from '../shared/schema'
import type { Library } from './library'
import { SIDECAR_NAME, shouldSkipDir } from './scanner'
import type { SelfWrites } from './sidecar'

const RESCAN_DELAY_MS = 1500
const MOUNT_CHECK_DELAY_MS = 2000

export class LibraryWatcher {
  private watchers = new Map<string, FSWatcher>()
  private timers = new Map<string, NodeJS.Timeout>()
  private volumes: NodeWatcher | null = null
  private mountTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly library: Library,
    private readonly selfWrites: SelfWrites,
    private readonly getRoots: () => Root[],
    private readonly getBounceFolderNames: () => string[]
  ) {}

  start(): void {
    this.sync()
    try {
      this.volumes = watchDir('/Volumes', () => this.scheduleMountCheck())
    } catch {
      // No /Volumes watching; mounts are still picked up on manual rescans.
    }
  }

  stop(): void {
    this.volumes?.close()
    this.volumes = null
    for (const w of this.watchers.values()) void w.close()
    this.watchers.clear()
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }

  // Starts watchers for mounted roots and stops the rest. Call after settings or mounts change.
  sync(): void {
    const roots = this.getRoots()
    const wanted = new Map(roots.filter((r) => this.library.isMounted(r.path)).map((r) => [r.path, r]))

    for (const [path, watcher] of this.watchers) {
      if (!wanted.has(path)) {
        void watcher.close()
        this.watchers.delete(path)
      }
    }
    for (const [path, root] of wanted) {
      if (!this.watchers.has(path)) this.watchers.set(path, this.watchRoot(root))
    }
  }

  // Settings changed in a way that affects scanning: rebuild every watcher.
  restart(): void {
    for (const w of this.watchers.values()) void w.close()
    this.watchers.clear()
    this.sync()
  }

  private watchRoot(root: Root): FSWatcher {
    const ignored = (path: string): boolean => {
      if (path === root.path) return false
      const rel = relative(root.path, path)
      if (rel.startsWith('..')) return true
      const name = basename(path)
      if (name === SIDECAR_NAME) return false
      // Applies to files too: hidden files, ._ AppleDouble files and .finisher.json.tmp are skipped.
      const rules = { exclude: root.exclude, bounceFolderNames: this.getBounceFolderNames() }
      const parts = rel.split('/')
      return parts.some((part, i) => shouldSkipDir(part, parts.slice(0, i + 1).join('/'), rules))
    }

    const watcher = chokidar.watch(root.path, {
      ignoreInitial: true,
      followSymlinks: false,
      ignorePermissionErrors: true,
      // A project at maxDepth still needs its own files (.als, sidecar) watched.
      depth: root.maxDepth + 1,
      ignored
    })
    watcher.on('all', (_event, path) => void this.onEvent(root.path, path))
    watcher.on('error', () => {
      // Usually the drive went away; the /Volumes watcher handles that.
    })
    return watcher
  }

  private async onEvent(rootPath: string, path: string): Promise<void> {
    if (basename(path) === SIDECAR_NAME && (await this.selfWrites.isOwnWrite(path))) return
    const existing = this.timers.get(rootPath)
    if (existing) clearTimeout(existing)
    this.timers.set(
      rootPath,
      setTimeout(() => {
        this.timers.delete(rootPath)
        void this.library.scan([rootPath])
      }, RESCAN_DELAY_MS)
    )
  }

  private scheduleMountCheck(): void {
    if (this.mountTimer) clearTimeout(this.mountTimer)
    this.mountTimer = setTimeout(async () => {
      this.mountTimer = null
      const changed = await this.library.refreshMounts()
      if (changed.length === 0) return
      this.sync()
      const nowMounted = changed.filter((p) => this.library.isMounted(p))
      if (nowMounted.length > 0) await this.library.scan(nowMounted)
      else this.library.notifyChanged()
    }, MOUNT_CHECK_DELAY_MS)
  }
}
