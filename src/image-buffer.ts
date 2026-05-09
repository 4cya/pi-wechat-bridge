export interface ImageEntry {
  data: string       // base64
  mimeType: string   // e.g., image/jpeg
  receivedAt: number
}

export class ImageBuffer {
  private images: ImageEntry[] = []
  private lastImageAt = 0
  private ttl: number

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttl = ttlMs
  }

  add(image: ImageEntry): void {
    this.images.push(image)
    this.lastImageAt = Date.now()
  }

  /** Returns all cached images, clearing the buffer */
  flush(): ImageEntry[] {
    const result = [...this.images]
    this.images = []
    this.lastImageAt = 0
    return result
  }

  /** Check if cached images have expired */
  isExpired(): boolean {
    return this.images.length > 0 && Date.now() - this.lastImageAt > this.ttl
  }

  clear(): void {
    this.images = []
    this.lastImageAt = 0
  }

  get count(): number {
    return this.images.length
  }
}
