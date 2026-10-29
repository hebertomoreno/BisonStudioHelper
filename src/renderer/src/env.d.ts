import type { FinisherApi } from '../../shared/ipc'

declare global {
  interface Window {
    finisher: FinisherApi
  }
}
