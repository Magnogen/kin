import { average } from "./utils.js";

export function buildUnionComponentsForGeneration(
  personIds,
  unions,
  unionGeneration,
  generation
) {
  const personSet = new Set(personIds);
  const adjacency = new Map();

  personIds.forEach((personId) => {
    adjacency.set(personId, new Set());
  });

  unions.forEach((union) => {
    if ((unionGeneration.get(union.id) ?? 0) !== generation) {
      return;
    }

    const members = (union.members || [])
      .map((member) => member.personId)
      .filter((personId) => personSet.has(personId));

    if (members.length < 2) {
      return;
    }

    const anchor = members[0];
    for (let i = 1; i < members.length; i += 1) {
      const memberId = members[i];
      adjacency.get(anchor).add(memberId);
      adjacency.get(memberId).add(anchor);
    }
  });

  const visited = new Set();
  const components = [];

  personIds.forEach((personId) => {
    if (visited.has(personId)) return;
    if (!(adjacency.get(personId)?.size > 0)) return;

    const stack = [personId];
    const component = [];
    visited.add(personId);

    while (stack.length) {
      const current = stack.pop();
      component.push(current);

      (adjacency.get(current) || []).forEach((next) => {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      });
    }

    if (component.length > 1) {
      components.push(component);
    }
  });

  return components;
}

export function orderUnionComponentForGeneration(
  component,
  unions,
  unionGeneration,
  generation,
  people
) {
  const componentSet = new Set(component);
  const adjacency = new Map(component.map((personId) => [personId, new Set()]));
  const componentUnions = [];

  unions.forEach((union) => {
    if ((unionGeneration.get(union.id) ?? 0) !== generation) {
      return;
    }

    const members = (union.members || [])
      .map((member) => member.personId)
      .filter((personId) => componentSet.has(personId));

    if (members.length < 2) {
      return;
    }

    componentUnions.push(members);

    const anchor = members[0];
    for (let i = 1; i < members.length; i += 1) {
      const memberId = members[i];
      adjacency.get(anchor)?.add(memberId);
      adjacency.get(memberId)?.add(anchor);
    }
  });

  const orderedBySortIndex = [...component].sort((a, b) => {
    const aSort = people.get(a)?.sortIndex ?? a;
    const bSort = people.get(b)?.sortIndex ?? b;
    return aSort - bSort;
  });

  let anchorId = null;
  let anchorDegree = 1;
  orderedBySortIndex.forEach((personId) => {
    const degree = adjacency.get(personId)?.size ?? 0;
    if (degree > anchorDegree) {
      anchorId = personId;
      anchorDegree = degree;
    }
  });

  if (anchorId == null) {
    return orderedBySortIndex;
  }

  const seen = new Set([anchorId]);
  const left = [];
  const right = [];

  componentUnions.forEach((members) => {
    if (!members.includes(anchorId)) {
      return;
    }

    const anchorIndex = members.indexOf(anchorId);

    members.forEach((personId, memberIndex) => {
      if (personId === anchorId || seen.has(personId)) {
        return;
      }

      if (memberIndex < anchorIndex) {
        left.unshift(personId);
      } else {
        right.push(personId);
      }

      seen.add(personId);
    });
  });

  let placeOnLeft = false;
  orderedBySortIndex.forEach((personId) => {
    if (seen.has(personId)) {
      return;
    }

    if (placeOnLeft) {
      left.unshift(personId);
    } else {
      right.push(personId);
    }

    seen.add(personId);
    placeOnLeft = !placeOnLeft;
  });

  return [...left, anchorId, ...right];
}

export function compactGenerationIntoBlocks(
  personIds,
  componentMap,
  orderedComponentIdsByPerson,
  xByPersonId,
  pinnedByPersonId,
  parentAnchorIdsByPerson,
  minGap,
  groupedSpanWidthByParentAnchor
) {
  const getBlockIntraGap = (ids, baseGap) => {
    if (ids.length <= 1) {
      return 0;
    }

    const sharedParentAnchorIds = [
      ...new Set(ids.flatMap((personId) => parentAnchorIdsByPerson.get(personId) || [])),
    ];

    if (sharedParentAnchorIds.length !== 1) {
      return baseGap;
    }

    const groupedWidth = groupedSpanWidthByParentAnchor.get(sharedParentAnchorIds[0]);
    if (!Number.isFinite(groupedWidth)) {
      return baseGap;
    }

    const compressedGap = groupedWidth / (ids.length - 1);
    return Math.max(0, Math.min(baseGap, compressedGap));
  };

  const blocks = [];
  const consumed = new Set();

  const anchoredStartForIds = (ids, width) => {
    const pinnedTargets = ids
      .filter((id) => pinnedByPersonId.get(id))
      .map((id) => xByPersonId.get(id))
      .filter((value) => Number.isFinite(value));

    if (!pinnedTargets.length) {
      const center = average(ids.map((id) => xByPersonId.get(id) ?? 0));
      return center - width / 2;
    }

    // For partnered/branch blocks, anchor the block center to parent-union targets.
    const targetCenter = average(pinnedTargets);
    if (ids.length <= 1) {
      return targetCenter;
    }
    return targetCenter - width / 2;
  };

  personIds.forEach((personId) => {
    if (consumed.has(personId)) return;

    const component = componentMap.get(personId);
    if (component?.length > 1) {
      const ids = [...(orderedComponentIdsByPerson.get(personId) || component)];
      ids.forEach((id) => consumed.add(id));

      const width = (ids.length - 1) * minGap;
      const center = average(ids.map((id) => xByPersonId.get(id) ?? 0));
      const start = anchoredStartForIds(ids, width);
      blocks.push({ ids, center, width, start });
      return;
    }

    consumed.add(personId);
    const x = xByPersonId.get(personId) ?? 0;
    blocks.push({ ids: [personId], center: x, width: 0, start: x });
  });

  const personToBlockIndex = new Map();
  blocks.forEach((block, index) => {
    block.ids.forEach((personId) => {
      personToBlockIndex.set(personId, index);
    });
  });

  const parentAnchorToBlockIndices = new Map();
  personIds.forEach((personId) => {
    const blockIndex = personToBlockIndex.get(personId);
    if (blockIndex == null) return;

    const parentAnchorIds = parentAnchorIdsByPerson.get(personId) || [];
    parentAnchorIds.forEach((anchorId) => {
      if (!parentAnchorToBlockIndices.has(anchorId)) {
        parentAnchorToBlockIndices.set(anchorId, new Set());
      }
      parentAnchorToBlockIndices.get(anchorId).add(blockIndex);
    });
  });

  const roots = new Map();
  const find = (index) => {
    let root = roots.get(index);
    if (root == null) {
      roots.set(index, index);
      return index;
    }
    while (root !== roots.get(root)) {
      root = roots.get(root);
    }
    let cursor = index;
    while (roots.get(cursor) !== root) {
      const parent = roots.get(cursor);
      roots.set(cursor, root);
      cursor = parent;
    }
    return root;
  };

  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      roots.set(rb, ra);
    }
  };

  parentAnchorToBlockIndices.forEach((indices) => {
    const list = [...indices];
    if (list.length < 2) return;
    const anchor = list[0];
    for (let i = 1; i < list.length; i += 1) {
      unite(anchor, list[i]);
    }
  });

  const groupedBlocks = new Map();
  blocks.forEach((block, index) => {
    const root = find(index);
    if (!groupedBlocks.has(root)) {
      groupedBlocks.set(root, []);
    }
    groupedBlocks.get(root).push({ ...block });
  });

  const rankByPersonId = new Map(personIds.map((id, i) => [id, i]));

  const mergedBlocks = [];
  groupedBlocks.forEach((members) => {
    members.sort((a, b) => a.center - b.center);
    const ids = members.flatMap((block) => block.ids);

    let width = (ids.length - 1) * minGap;
    const sharedParentAnchorIds = [
      ...new Set(ids.flatMap((personId) => parentAnchorIdsByPerson.get(personId) || [])),
    ];
    if (sharedParentAnchorIds.length === 1) {
      const groupedWidth = groupedSpanWidthByParentAnchor.get(sharedParentAnchorIds[0]);
      if (Number.isFinite(groupedWidth)) {
        width = Math.min(width, Math.max(0, groupedWidth - minGap));
      }
    }

    const center = average(ids.map((id) => xByPersonId.get(id) ?? 0));
    const start = anchoredStartForIds(ids, width);
    const intraGap = getBlockIntraGap(ids, minGap);
    const minRank = Math.min(...ids.map((id) => rankByPersonId.get(id) ?? Infinity));
    const parentAnchors = new Set(ids.flatMap((id) => parentAnchorIdsByPerson.get(id) || []));
    mergedBlocks.push({ ids, center, width, start, intraGap, minRank, parentAnchors });
  });

  mergedBlocks.sort((a, b) => {
    // When two blocks share a common parent anchor (they are siblings), preserve
    // declaration order (min rank) rather than sorting by desired center. This
    // prevents a child who gains a union partner from jumping past their siblings.
    for (const anchor of a.parentAnchors) {
      if (b.parentAnchors.has(anchor)) {
        return a.minRank - b.minRank;
      }
    }
    return a.center - b.center;
  });

  const targetStarts = mergedBlocks.map((block) => block.start);
  const relaxNonOverlap = () => {
    for (let i = 1; i < mergedBlocks.length; i += 1) {
      const prev = mergedBlocks[i - 1];
      const block = mergedBlocks[i];
      const minStart = prev.start + prev.width + minGap;
      if (block.start < minStart) {
        block.start = minStart;
      }
    }

    for (let i = mergedBlocks.length - 2; i >= 0; i -= 1) {
      const next = mergedBlocks[i + 1];
      const block = mergedBlocks[i];
      const maxStart = next.start - block.width - minGap;
      if (block.start > maxStart) {
        block.start = maxStart;
      }
    }
  };

  relaxNonOverlap();

  const targetMean = average(targetStarts);
  const currentMean = average(mergedBlocks.map((block) => block.start));
  const meanShift = targetMean - currentMean;
  if (Number.isFinite(meanShift) && Math.abs(meanShift) > 1e-6) {
    mergedBlocks.forEach((block) => {
      block.start += meanShift;
    });
    relaxNonOverlap();
  }

  const placed = new Map();
  mergedBlocks.forEach((block) => {
    block.ids.forEach((personId, index) => {
      placed.set(personId, block.start + index * block.intraGap);
    });
  });

  return placed;
}
