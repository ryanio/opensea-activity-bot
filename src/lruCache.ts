export class LRUCache<K, V> {
  private cache: Map<K, V>
  private order: K[]

  constructor(private capacity: number) {
    this.cache = new Map()
    this.order = []
  }

  get(key: K): V | undefined {
    this.updateOrder(key)

    return this.cache.get(key)
  }

  put(key: K, value: V): void {
    if (this.cache.size >= this.capacity) {
      const leastRecentlyUsed = this.order.shift()
      if (leastRecentlyUsed !== undefined) {
        this.cache.delete(leastRecentlyUsed)
      }
    }

    this.cache.set(key, value)
    this.order.push(key)
  }

  private updateOrder(key: K): void {
    const index = this.order.indexOf(key)

    if (index !== -1) {
      // Move the accessed key to the end to represent it as the most recently used
      this.order.splice(index, 1)
      this.order.push(key)
    }
  }
}
