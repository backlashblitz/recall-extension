// hnsw.js — Pure JavaScript implementation of the Hierarchical Navigable Small
// World (HNSW) algorithm for approximate nearest-neighbor search.
//
// Reference: "Efficient and robust approximate nearest neighbor search using
// Hierarchical Navigable Small World graphs" — Malkov & Yashunin (2018).
//
// How it works (plain English):
//   Imagine a multi-level map. At the top layer only a few nodes are visible,
//   connected by long-range "express" links. Each layer below adds more nodes
//   with shorter connections — like highway -> main road -> local street.
//   To search: start at the top, greedily walk toward the query, then descend.
//   Result: you visit O(log N) nodes instead of all N — dramatically faster.
//
// Properties:
//   - O(log N) approximate search vs O(N) brute force
//   - Configurable accuracy/speed via ef parameters
//   - Fully serializable to plain JSON for IndexedDB storage
//   - No external dependencies

export class HNSW {
  constructor({ M = 16, efConstruction = 100, efSearch = 50 } = {}) {
    this.M = M;
    this.M0 = M * 2;
    this.efConstruction = efConstruction;
    this.efSearch = efSearch;
    this.nodes = [];
    this.entryPoint = -1;
    this.maxLevel = -1;
    this._urlToIdx = new Map();
  }

  _dist(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return 1 - dot;
  }

  _randomLevel() {
    let level = 0;
    while (Math.random() < 1 / this.M && level < 12) level++;
    return level;
  }

  _searchLayer(query, entryIds, ef, layer) {
    const visited = new Set(entryIds);
    const candidates = entryIds
      .map(id => ({ id, dist: this._dist(query, this.nodes[id].vector) }))
      .sort((a, b) => a.dist - b.dist);
    const found = candidates.slice();

    while (candidates.length > 0) {
      const nearest = candidates.shift();
      const worstFound = found.length >= ef ? found[found.length - 1].dist : Infinity;
      if (nearest.dist > worstFound) break;

      for (const nId of (this.nodes[nearest.id].neighbors[layer] ?? [])) {
        if (visited.has(nId)) continue;
        visited.add(nId);
        const d = this._dist(query, this.nodes[nId].vector);
        const worstNow = found.length >= ef ? found[found.length - 1].dist : Infinity;
        if (d < worstNow || found.length < ef) {
          let ci = candidates.length;
          while (ci > 0 && candidates[ci - 1].dist > d) ci--;
          candidates.splice(ci, 0, { id: nId, dist: d });
          let fi = found.length;
          while (fi > 0 && found[fi - 1].dist > d) fi--;
          found.splice(fi, 0, { id: nId, dist: d });
          if (found.length > ef) found.pop();
        }
      }
    }
    return found;
  }

  insert(externalId, vector) {
    if (this._urlToIdx.has(externalId)) return;
    const nodeIdx = this.nodes.length;
    const level   = this._randomLevel();
    const node = { externalId, vector, neighbors: Array.from({ length: level + 1 }, () => []) };
    this.nodes.push(node);
    this._urlToIdx.set(externalId, nodeIdx);

    if (this.entryPoint === -1) {
      this.entryPoint = nodeIdx;
      this.maxLevel   = level;
      return;
    }

    let ep = [this.entryPoint];
    for (let l = this.maxLevel; l > level; l--) {
      const found = this._searchLayer(vector, ep, 1, l);
      ep = [found[0].id];
    }

    for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
      const found   = this._searchLayer(vector, ep, this.efConstruction, l);
      const maxConn = l === 0 ? this.M0 : this.M;
      const selected = found.slice(0, maxConn).map(f => f.id);
      node.neighbors[l] = selected;

      for (const nId of selected) {
        const nList = this.nodes[nId].neighbors[l];
        if (!nList.includes(nodeIdx)) nList.push(nodeIdx);
        if (nList.length > maxConn) {
          this.nodes[nId].neighbors[l] = nList
            .map(id => ({ id, dist: this._dist(this.nodes[nId].vector, this.nodes[id].vector) }))
            .sort((a, b) => a.dist - b.dist)
            .slice(0, maxConn)
            .map(e => e.id);
        }
      }
      ep = found.map(f => f.id);
    }

    if (level > this.maxLevel) {
      this.maxLevel   = level;
      this.entryPoint = nodeIdx;
    }
  }

  search(query, k = 10) {
    if (this.entryPoint === -1 || this.nodes.length === 0) return [];
    let ep = [this.entryPoint];
    for (let l = this.maxLevel; l > 0; l--) {
      const found = this._searchLayer(query, ep, 1, l);
      ep = [found[0].id];
    }
    const ef    = Math.max(this.efSearch, k);
    const found = this._searchLayer(query, ep, ef, 0);
    return found.slice(0, k).map(f => ({
      externalId: this.nodes[f.id].externalId,
      score: 1 - f.dist
    }));
  }

  serialize() {
    return {
      M: this.M, M0: this.M0,
      efConstruction: this.efConstruction, efSearch: this.efSearch,
      entryPoint: this.entryPoint, maxLevel: this.maxLevel,
      urlToIdx: [...this._urlToIdx.entries()],
      nodes: this.nodes.map(n => ({
        externalId: n.externalId,
        vector: Array.from(n.vector),
        neighbors: n.neighbors
      }))
    };
  }

  static deserialize(data) {
    const h = new HNSW({ M: data.M, efConstruction: data.efConstruction, efSearch: data.efSearch });
    h.M0         = data.M0;
    h.entryPoint = data.entryPoint;
    h.maxLevel   = data.maxLevel;
    h._urlToIdx  = new Map(data.urlToIdx ?? []);
    h.nodes      = data.nodes.map(n => ({
      externalId: n.externalId, vector: n.vector, neighbors: n.neighbors
    }));
    return h;
  }
}
