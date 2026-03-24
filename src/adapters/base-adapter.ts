import type { HostEvent } from '../types/index.js'

export abstract class BaseAdapter {
  abstract name: string

  /**
   * Translate a host-specific raw event into a normalized HostEvent.
   * Return null if the raw event is unrecognized or should be ignored.
   */
  abstract translateEvent(rawEvent: unknown): HostEvent | null

  /**
   * Called by the worker after event normalization.
   * Returns a string to inject into the model context (e.g. system prompt prefix),
   * or null if no injection is needed for this event.
   */
  abstract buildInjectionContext(event: HostEvent): Promise<string | null>
}
