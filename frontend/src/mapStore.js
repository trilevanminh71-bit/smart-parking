/* Cấu hình bản đồ (GET /api/map/config) dùng chung toàn app; tải lại khi có sự kiện `map_updated`. */
import { useEffect, useState } from 'react'
import { api, useEvent } from './api.js'

let cache = null
let inflight = null
const subs = new Set()

export function loadMapConfig(force = false) {
  if (cache && !force) return Promise.resolve(cache)
  if (!inflight) {
    inflight = api('/api/map/config').then((cfg) => {
      cache = cfg
      subs.forEach((fn) => fn(cfg))
      return cfg
    }).finally(() => { inflight = null })
  }
  return inflight
}

export function setMapConfigCache(cfg) {
  cache = cfg
  subs.forEach((fn) => fn(cfg))
}

export function useMapConfig() {
  const [cfg, setCfg] = useState(cache)
  useEffect(() => {
    subs.add(setCfg)
    loadMapConfig().catch(() => {})
    return () => subs.delete(setCfg)
  }, [])
  useEvent((ev) => { if (ev.event === 'map_updated') loadMapConfig(true).catch(() => {}) })
  return cfg
}
