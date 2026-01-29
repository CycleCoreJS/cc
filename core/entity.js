"use strict";
// Entity-Component system for games and simulations
export class Entity {
  constructor(id = Symbol('entity'), world = null) {
    this.id = id;
    this.components = new Map();
    this.tags = new Set();
    this.world = world;
  }

  add(name, component) {
    this.components.set(name, component);
    if (this.world) this.world._invalidateCache();
    return this;
  }

  get(name) {
    return this.components.get(name);
  }

  has(name) {
    return this.components.has(name);
  }

  remove(name) {
    this.components.delete(name);
    if (this.world) this.world._invalidateCache();
    return this;
  }

  tag(...tags) {
    tags.forEach(t => this.tags.add(t));
    return this;
  }

  hasTag(tag) {
    return this.tags.has(tag);
  }
}

export class World {
  constructor() {
    this.entities = new Map();
    this.systems = [];
    this.queryCache = new Map();
    this.cacheVersion = 0;
  }

  spawn(entity) {
    entity.world = this;
    this.entities.set(entity.id, entity);
    this._invalidateCache();
    return entity;
  }

  destroy(entityId) {
    const entity = this.entities.get(entityId);
    if (entity) entity.world = null;
    this.entities.delete(entityId);
    this._invalidateCache();
  }

  _invalidateCache() {
    this.cacheVersion++;
  }

  query(...componentNames) {
    const cacheKey = componentNames.join(',');
    const cached = this.queryCache.get(cacheKey);
    
    if (cached && cached.version === this.cacheVersion) {
      return cached.result;
    }
    
    const result = [];
    for (const entity of this.entities.values()) {
      let hasAll = true;
      for (const name of componentNames) {
        if (!entity.has(name)) {
          hasAll = false;
          break;
        }
      }
      if (hasAll) result.push(entity);
    }
    
    this.queryCache.set(cacheKey, { result, version: this.cacheVersion });
    return result;
  }

  addSystem(system) {
    this.systems.push(system);
  }

  update(dt) {
    this.systems.forEach(system => system(this, dt));
  }
}