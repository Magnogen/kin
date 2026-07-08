const DEFAULT_LAYOUT_OPTIONS = {
  personWidth: 16,
  personHeight: 16,
  personPaddingX: 16,
  personLineHeight: 16,
  personPaddingY: 16,
  personNameFontSize: 16,
  personNoteFontSize: 12,
  personNameFontWeight: "400",
  personNoteFontWeight: "400",
  personFontFamily: "IBM Plex Sans, Segoe UI, sans-serif",
  personGap: 32,
  generationGap: 64,
  unionSize: 16,
  unionOffsetY: 0,
  paddingX: 24,
  paddingY: 24,
  iterations: 8,
  childGroupThreshold: 5,
  childGroupMaxColumns: 3,
  childGroupRowGap: 20,
};

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getPersonLabel(person) {
  if (!person) return "?";
  if (person.value && person.value.trim()) return person.value.trim();
  return "?";
}

function normalizeAnnotations(annotations) {
  return (annotations || [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function createTextWidthMeasurer(options) {
  let ctx = null;

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(1, 1);
    ctx = canvas.getContext("2d");
  } else if (typeof document !== "undefined" && document.createElement) {
    const canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d");
  }

  const cache = new Map();
  const family = options.personFontFamily;

  const fallbackWidth = (text, fontSize) => {
    const value = String(text || "");
    if (!value.length) return fontSize * 0.3;

    // Approximate glyph widths by category for non-browser runtimes.
    let units = 0;
    for (const ch of value) {
      if ("il.:,|'`!".includes(ch)) {
        units += 0.32;
      } else if ("mwMW@#%&".includes(ch)) {
        units += 0.92;
      } else if (ch === " ") {
        units += 0.33;
      } else {
        units += 0.58;
      }
    }

    return units * fontSize;
  };

  return (text, fontSize, fontWeight) => {
    const value = String(text || "");
    const key = `${fontWeight}|${fontSize}|${value}`;
    if (cache.has(key)) {
      return cache.get(key);
    }

    let width;
    if (ctx) {
      ctx.font = `${fontWeight} ${fontSize}px ${family}`;
      width = ctx.measureText(value).width;
    } else {
      width = fallbackWidth(value, fontSize);
    }

    cache.set(key, width);
    return width;
  };
}

function computePersonMetrics(meta, options, measureTextWidth) {
  const annotations = normalizeAnnotations(meta?.annotations || []);
  const label = meta?.label || "?";
  const widestLabel = measureTextWidth(
    label,
    options.personNameFontSize,
    options.personNameFontWeight
  );
  const widestAnnotation = annotations.length
    ? Math.max(
        ...annotations.map((line) =>
          measureTextWidth(line, options.personNoteFontSize, options.personNoteFontWeight)
        )
      )
    : 0;

  const widestLine = Math.max(widestLabel, widestAnnotation) + options.personPaddingX * 2;
  const width = Math.max(options.personWidth, widestLine);

  const lineCount = 1 + annotations.length;
  const computedHeight = options.personPaddingY * 2 + lineCount * options.personLineHeight;
  const height = Math.max(options.personHeight, computedHeight);

  return {
    annotations,
    width,
    height,
  };
}

function collectPeople(ast) {
  const map = new Map();

  (ast.people || []).forEach((person, index) => {
    map.set(person.id, {
      id: person.id,
      kind: person.kind || "named",
      label: getPersonLabel(person),
      annotations: normalizeAnnotations(person.annotations || []),
      sortIndex: index,
    });
  });

  (ast.unions || []).forEach((union) => {
    (union.members || []).forEach((member) => {
      if (!map.has(member.personId)) {
        map.set(member.personId, {
          id: member.personId,
          kind: member.kind || "named",
          label: getPersonLabel(member),
          annotations: normalizeAnnotations(member.annotations || []),
          sortIndex: member.personId,
        });
      } else if (member.annotations?.length) {
        const existing = map.get(member.personId);
        existing.annotations = normalizeAnnotations([
          ...(existing.annotations || []),
          ...member.annotations,
        ]);
      }
    });

    (union.children || []).forEach((child) => {
      if (!map.has(child.personId)) {
        map.set(child.personId, {
          id: child.personId,
          kind: child.kind || "named",
          label: getPersonLabel(child),
          annotations: normalizeAnnotations(child.annotations || []),
          sortIndex: child.personId,
        });
      } else if (child.annotations?.length) {
        const existing = map.get(child.personId);
        existing.annotations = normalizeAnnotations([
          ...(existing.annotations || []),
          ...child.annotations,
        ]);
      }
    });
  });

  return map;
}

function enforceMinGap(sortedItems, minGap) {
  if (!sortedItems.length) return;

  for (let i = 1; i < sortedItems.length; i += 1) {
    const prev = sortedItems[i - 1];
    const current = sortedItems[i];
    const nextX = Math.max(current.x, prev.x + minGap);
    current.x = nextX;
  }
}

function getChildGroupColumnCount(childCount, options) {
  if (childCount < options.childGroupThreshold) {
    return null;
  }

  return Math.max(
    2,
    Math.min(options.childGroupMaxColumns, Math.ceil(Math.sqrt(childCount)))
  );
}

function computeChildGroupSpanWidth(childIds, personWidthById, options) {
  const columns = getChildGroupColumnCount(childIds.length, options);
  if (!columns) {
    return null;
  }

  let maxRowWidth = 0;

  for (let start = 0; start < childIds.length; start += columns) {
    const rowIds = childIds.slice(start, start + columns);
    const rowWidth = rowIds.reduce(
      (sum, personId) => sum + (personWidthById.get(personId) ?? options.personWidth),
      0
    );
    const rowGapWidth = Math.max(0, rowIds.length - 1) * options.personGap;
    maxRowWidth = Math.max(maxRowWidth, rowWidth + rowGapWidth);
  }

  return maxRowWidth;
}

function buildUnionComponentsForGeneration(
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

function orderUnionComponentForGeneration(
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
  let placeOnLeft = false;

  componentUnions.forEach((members) => {
    if (!members.includes(anchorId)) {
      return;
    }

    members.forEach((personId) => {
      if (personId === anchorId || seen.has(personId)) {
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
  });

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

function compactGenerationIntoBlocks(
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

  const mergedBlocks = [];
  groupedBlocks.forEach((members) => {
    members.sort((a, b) => a.center - b.center);
    const ids = members.flatMap((block) => block.ids);

    let width = (ids.length - 1) * minGap;
    const sharedParentAnchorIds = [...new Set(
      ids.flatMap((personId) => parentAnchorIdsByPerson.get(personId) || [])
    )];
    if (sharedParentAnchorIds.length === 1) {
      const groupedWidth = groupedSpanWidthByParentAnchor.get(sharedParentAnchorIds[0]);
      if (Number.isFinite(groupedWidth)) {
        width = Math.min(width, Math.max(0, groupedWidth - minGap));
      }
    }

    const center = average(ids.map((id) => xByPersonId.get(id) ?? 0));
    const start = anchoredStartForIds(ids, width);
    const intraGap = getBlockIntraGap(ids, minGap);
    mergedBlocks.push({ ids, center, width, start, intraGap });
  });

  mergedBlocks.sort((a, b) => a.center - b.center);

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

function enforceCenterGapByWidth(personIds, centerByPersonId, widthByPersonId, gap) {
  if (!personIds.length) return;

  const ordered = [...personIds]
    .map((personId) => ({
      personId,
      center: centerByPersonId.get(personId) ?? 0,
      width: widthByPersonId.get(personId) ?? 0,
    }))
    .sort((a, b) => {
      const delta = a.center - b.center;
      if (delta !== 0) return delta;
      return a.personId - b.personId;
    });

  const targetMean = average(ordered.map((item) => item.center));

  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const current = ordered[i];
    const minCenter = prev.center + (prev.width + current.width) / 2 + gap;
    if (current.center < minCenter) {
      current.center = minCenter;
    }
  }

  const shiftedMean = average(ordered.map((item) => item.center));
  const meanShift = targetMean - shiftedMean;
  if (Number.isFinite(meanShift) && Math.abs(meanShift) > 1e-6) {
    ordered.forEach((item) => {
      item.center += meanShift;
    });

    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1];
      const current = ordered[i];
      const minCenter = prev.center + (prev.width + current.width) / 2 + gap;
      if (current.center < minCenter) {
        current.center = minCenter;
      }
    }
  }

  ordered.forEach((item) => {
    centerByPersonId.set(item.personId, item.center);
  });
}

function buildGroupedChildLayout(
  unions,
  singleParentLinks,
  personGeneration,
  personX,
  unionX,
  personWidthById,
  personHeightById,
  people,
  options
) {
  const positionOverrides = new Map();
  const yOffsets = new Map();
  const groupedPeople = new Set();
  const groupLayoutsByGeneration = new Map();
  const groupedGenerations = new Set();
  const rowGap = Math.max(8, options.childGroupRowGap);

  const applyGroup = (childIds, anchorX, generation) => {
    const uniqueIds = [...new Set(childIds)]
      .filter((personId) => !groupedPeople.has(personId))
      .sort((a, b) => {
        const delta = (personX.get(a) ?? 0) - (personX.get(b) ?? 0);
        if (delta !== 0) return delta;
        const aSort = people.get(a)?.sortIndex ?? a;
        const bSort = people.get(b)?.sortIndex ?? b;
        return aSort - bSort;
      });

    const columns = getChildGroupColumnCount(uniqueIds.length, options);
    if (!columns) {
      return;
    }

    let minLeft = Infinity;
    let maxRight = -Infinity;
    let minTop = Infinity;
    let maxBottom = -Infinity;
    const rowProfiles = [];
    let nextRowOffsetY = 0;
    for (let start = 0; start < uniqueIds.length; start += columns) {
      const rowIds = uniqueIds.slice(start, start + columns);
      let rowHeight = 0;
      const rowWidths = rowIds.map(
        (personId) => personWidthById.get(personId) ?? options.personWidth
      );

      const rowWidth = rowWidths.reduce((sum, width) => sum + width, 0);
      const rowGapWidth = Math.max(0, rowIds.length - 1) * options.personGap;
      const rowStartX = anchorX - (rowWidth + rowGapWidth) / 2;
      let cursorX = rowStartX;
      let rowMinLeft = Infinity;
      let rowMaxRight = -Infinity;

      rowIds.forEach((personId) => {
        rowHeight = Math.max(rowHeight, personHeightById.get(personId) ?? options.personHeight);
      });

      rowIds.forEach((personId, columnIndex) => {
        const width = rowWidths[columnIndex];
        const centerX = cursorX + width / 2;
        const personHeight = personHeightById.get(personId) ?? options.personHeight;
        positionOverrides.set(personId, centerX);
        yOffsets.set(personId, nextRowOffsetY);
        groupedPeople.add(personId);
        minLeft = Math.min(minLeft, centerX - width / 2);
        maxRight = Math.max(maxRight, centerX + width / 2);
        rowMinLeft = Math.min(rowMinLeft, centerX - width / 2);
        rowMaxRight = Math.max(rowMaxRight, centerX + width / 2);
        minTop = Math.min(minTop, nextRowOffsetY);
        maxBottom = Math.max(maxBottom, nextRowOffsetY + personHeight);
        cursorX += width + options.personGap;
      });

      rowProfiles.push({
        minTop: nextRowOffsetY,
        maxBottom: nextRowOffsetY + rowHeight,
        minLeft: rowMinLeft,
        maxRight: rowMaxRight,
      });

      nextRowOffsetY += rowHeight + rowGap;
    }

    if (!groupLayoutsByGeneration.has(generation)) {
      groupLayoutsByGeneration.set(generation, []);
    }

    groupLayoutsByGeneration.get(generation).push({
      personIds: uniqueIds,
      targetCenter: anchorX,
      minLeft,
      maxRight,
      minTop,
      maxBottom,
      rowProfiles,
      sortIndex: Math.min(...uniqueIds.map((personId) => people.get(personId)?.sortIndex ?? personId)),
      isFixed: false,
    });
    groupedGenerations.add(generation);
  };

  const relaxGroupOverlaps = () => {
    groupLayoutsByGeneration.forEach((groups) => {
      if (groups.length < 2) {
        return;
      }

      const rowOverlapsVertically = (aRow, bRow) =>
        aRow.minTop < bRow.maxBottom && bRow.minTop < aRow.maxBottom;

      const requiredShiftToClear = (leftGroup, rightGroup, minGap) => {
        let requiredShift = -Infinity;

        for (const leftRow of leftGroup.rowProfiles) {
          for (const rightRow of rightGroup.rowProfiles) {
            if (!rowOverlapsVertically(leftRow, rightRow)) {
              continue;
            }

            const constraint =
              leftRow.maxRight + leftGroup.shift + minGap - rightRow.minLeft;
            requiredShift = Math.max(requiredShift, constraint);
          }
        }

        return requiredShift;
      };

      const allowedShiftToClear = (leftGroup, rightGroup, minGap) => {
        let allowedShift = Infinity;

        for (const leftRow of leftGroup.rowProfiles) {
          for (const rightRow of rightGroup.rowProfiles) {
            if (!rowOverlapsVertically(leftRow, rightRow)) {
              continue;
            }

            const constraint =
              rightRow.minLeft + rightGroup.shift - minGap - leftRow.maxRight;
            allowedShift = Math.min(allowedShift, constraint);
          }
        }

        return allowedShift;
      };

      groups.sort((a, b) => {
        const delta = a.targetCenter - b.targetCenter;
        if (delta !== 0) return delta;
        const aSort = a.sortIndex ?? a.personIds[0] ?? 0;
        const bSort = b.sortIndex ?? b.personIds[0] ?? 0;
        return aSort - bSort;
      });
      groups.forEach((group) => {
        group.shift = 0;
      });

      const minGap = options.personGap;
      const relaxForward = () => {
        for (let i = 1; i < groups.length; i += 1) {
          const current = groups[i];
          let requiredShift = current.shift;

          for (let j = 0; j < i; j += 1) {
            const prev = groups[j];
            const pairRequiredShift = requiredShiftToClear(prev, current, minGap);
            if (!Number.isFinite(pairRequiredShift)) {
              continue;
            }
            requiredShift = Math.max(requiredShift, pairRequiredShift);
          }

          if (current.shift < requiredShift) {
            current.shift = requiredShift;
          }
        }
      };

      const relaxBackward = () => {
        for (let i = groups.length - 2; i >= 0; i -= 1) {
          const current = groups[i];
          let allowedShift = current.shift;

          for (let j = groups.length - 1; j > i; j -= 1) {
            const next = groups[j];
            const pairAllowedShift = allowedShiftToClear(current, next, minGap);
            if (!Number.isFinite(pairAllowedShift)) {
              continue;
            }
            allowedShift = Math.min(allowedShift, pairAllowedShift);
          }

          if (current.shift > allowedShift) {
            current.shift = allowedShift;
          }
        }
      };

      relaxForward();
      relaxBackward();
      relaxForward();

      groups.forEach((group) => {
        if (!group.shift) {
          return;
        }

        group.personIds.forEach((personId) => {
          const baseX = positionOverrides.get(personId) ?? personX.get(personId) ?? 0;
          positionOverrides.set(personId, baseX + group.shift);
        });
      });
    });
  };

  unions.forEach((union) => {
    const childIds = (union.children || []).map((child) => child.personId);
    if (!childIds.length) return;

    const generation = personGeneration.get(childIds[0]) ?? null;
    if (generation == null) return;
    if (!childIds.every((personId) => (personGeneration.get(personId) ?? null) === generation)) {
      return;
    }

    applyGroup(
      childIds,
      unionX.get(union.id) ?? average(childIds.map((personId) => personX.get(personId) ?? 0)),
      generation
    );
  });

  const childIdsByParent = new Map();
  singleParentLinks.forEach((link) => {
    const parentId = link.parent?.personId;
    const childId = link.child?.personId;
    if (parentId == null || childId == null) return;

    if (!childIdsByParent.has(parentId)) {
      childIdsByParent.set(parentId, []);
    }
    childIdsByParent.get(parentId).push(childId);
  });

  childIdsByParent.forEach((childIds, parentId) => {
    const generation = personGeneration.get(childIds[0]) ?? null;
    if (generation == null) {
      return;
    }
    if (!childIds.every((personId) => (personGeneration.get(personId) ?? null) === generation)) {
      return;
    }

    applyGroup(
      childIds,
      personX.get(parentId) ?? average(childIds.map((personId) => personX.get(personId) ?? 0)),
      generation
    );
  });

  groupedGenerations.forEach((generation) => {
    const entries = groupLayoutsByGeneration.get(generation) || [];

    for (const [personId, personMeta] of people.entries()) {
      if ((personGeneration.get(personId) ?? null) !== generation) {
        continue;
      }
      if (groupedPeople.has(personId)) {
        continue;
      }

      const width = personWidthById.get(personId) ?? options.personWidth;
      const height = personHeightById.get(personId) ?? options.personHeight;
      const centerX = personX.get(personId) ?? 0;

      entries.push({
        personIds: [personId],
        targetCenter: centerX,
        minLeft: centerX - width / 2,
        maxRight: centerX + width / 2,
        minTop: 0,
        maxBottom: height,
        rowProfiles: [
          {
            minTop: 0,
            maxBottom: height,
            minLeft: centerX - width / 2,
            maxRight: centerX + width / 2,
          },
        ],
        sortIndex: personMeta?.sortIndex ?? personId,
        isFixed: true,
      });
    }

    groupLayoutsByGeneration.set(generation, entries);
  });

  relaxGroupOverlaps();

  return {
    positionOverrides,
    yOffsets,
  };
}

export function layoutFamilyTree(ast, userOptions = {}) {
  const options = { ...DEFAULT_LAYOUT_OPTIONS, ...userOptions };
  const people = collectPeople(ast || {});
  const unions = ast?.unions || [];
  const singleParentLinks = ast?.singleParentLinks || [];
  const measureTextWidth = createTextWidthMeasurer(options);

  const personAnnotationsById = new Map();
  const personWidthById = new Map();
  const personHeightById = new Map();

  for (const personId of people.keys()) {
    const metrics = computePersonMetrics(people.get(personId), options, measureTextWidth);
    personAnnotationsById.set(personId, metrics.annotations);
    personWidthById.set(personId, metrics.width);
    personHeightById.set(personId, metrics.height);
  }

  if (!unions.length && !people.size) {
    return {
      nodes: [],
      edges: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      generationCount: 0,
    };
  }

  const memberUnionsByPerson = new Map();
  const parentUnionsByPerson = new Map();
  const parentPeopleByPerson = new Map();
  const childPeopleByPerson = new Map();

  for (const personId of people.keys()) {
    memberUnionsByPerson.set(personId, []);
    parentUnionsByPerson.set(personId, []);
    parentPeopleByPerson.set(personId, []);
    childPeopleByPerson.set(personId, []);
  }

  unions.forEach((union) => {
    (union.members || []).forEach((member) => {
      if (!memberUnionsByPerson.has(member.personId)) {
        memberUnionsByPerson.set(member.personId, []);
      }
      memberUnionsByPerson.get(member.personId).push(union.id);
    });

    (union.children || []).forEach((child) => {
      if (!parentUnionsByPerson.has(child.personId)) {
        parentUnionsByPerson.set(child.personId, []);
      }
      parentUnionsByPerson.get(child.personId).push(union.id);
    });
  });

  singleParentLinks.forEach((link) => {
    const parentId = link.parent?.personId;
    const childId = link.child?.personId;
    if (parentId == null || childId == null) return;

    if (!parentPeopleByPerson.has(childId)) {
      parentPeopleByPerson.set(childId, []);
    }
    parentPeopleByPerson.get(childId).push(parentId);

    if (!childPeopleByPerson.has(parentId)) {
      childPeopleByPerson.set(parentId, []);
    }
    childPeopleByPerson.get(parentId).push(childId);
  });

  const personGeneration = new Map();
  const unionGeneration = new Map();

  for (const personId of people.keys()) {
    personGeneration.set(personId, 0);
  }
  unions.forEach((union) => {
    unionGeneration.set(union.id, 0);
  });

  const maxIterations = Math.max(12, (people.size + unions.length) * 4);
  for (let i = 0; i < maxIterations; i += 1) {
    let changed = false;

    unions.forEach((union) => {
      const members = union.members || [];
      const children = union.children || [];

      const memberGeneration = members.length
        ? Math.max(...members.map((member) => personGeneration.get(member.personId) ?? 0))
        : 0;

      members.forEach((member) => {
        const prev = personGeneration.get(member.personId) ?? 0;
        if (memberGeneration > prev) {
          personGeneration.set(member.personId, memberGeneration);
          changed = true;
        }
      });

      const previousUnionGeneration = unionGeneration.get(union.id) ?? 0;
      if (memberGeneration > previousUnionGeneration) {
        unionGeneration.set(union.id, memberGeneration);
        changed = true;
      }

      const childGeneration = memberGeneration + 1;
      children.forEach((child) => {
        const prev = personGeneration.get(child.personId) ?? 0;
        if (childGeneration > prev) {
          personGeneration.set(child.personId, childGeneration);
          changed = true;
        }
      });
    });

    singleParentLinks.forEach((link) => {
      const parentId = link.parent?.personId;
      const childId = link.child?.personId;
      if (parentId == null || childId == null) return;

      const parentGeneration = personGeneration.get(parentId) ?? 0;
      const childGeneration = personGeneration.get(childId) ?? 0;

      const impliedFromParent = parentGeneration + 1;
      if (impliedFromParent > childGeneration) {
        personGeneration.set(childId, impliedFromParent);
        changed = true;
      }

      const impliedFromChild = childGeneration - 1;
      if (impliedFromChild > parentGeneration) {
        personGeneration.set(parentId, impliedFromChild);
        changed = true;
      }
    });

    if (!changed) break;
  }

  const generations = new Map();
  for (const personId of people.keys()) {
    const generation = personGeneration.get(personId) ?? 0;
    if (!generations.has(generation)) {
      generations.set(generation, []);
    }
    generations.get(generation).push(personId);
  }

  const generationKeys = [...generations.keys()].sort((a, b) => a - b);
  const nominalCenterGap = options.personWidth + options.personGap;
  const groupedSpanWidthByParentAnchor = new Map();

  unions.forEach((union) => {
    const childIds = (union.children || []).map((child) => child.personId);
    const groupedWidth = computeChildGroupSpanWidth(childIds, personWidthById, options);
    if (Number.isFinite(groupedWidth)) {
      groupedSpanWidthByParentAnchor.set(`u:${union.id}`, groupedWidth);
    }
  });

  childPeopleByPerson.forEach((childIds, parentId) => {
    const groupedWidth = computeChildGroupSpanWidth(childIds, personWidthById, options);
    if (Number.isFinite(groupedWidth)) {
      groupedSpanWidthByParentAnchor.set(`p:${parentId}`, groupedWidth);
    }
  });

  const componentsByGeneration = new Map();
  const orderedComponentIdsByGeneration = new Map();
  generationKeys.forEach((generation) => {
    const personIds = generations.get(generation) || [];
    const components = buildUnionComponentsForGeneration(
      personIds,
      unions,
      unionGeneration,
      generation
    );
    const componentMap = new Map();
    const orderedComponentIdsByPerson = new Map();

    components.forEach((component) => {
      const orderedComponent = orderUnionComponentForGeneration(
        component,
        unions,
        unionGeneration,
        generation,
        people
      );

      component.forEach((personId) => {
        componentMap.set(personId, component);
        orderedComponentIdsByPerson.set(personId, orderedComponent);
      });
    });

    componentsByGeneration.set(generation, componentMap);
    orderedComponentIdsByGeneration.set(generation, orderedComponentIdsByPerson);
  });

  const personX = new Map();
  generationKeys.forEach((generation) => {
    const personIds = generations.get(generation) || [];

    personIds
      .sort((a, b) => {
        const aSort = people.get(a)?.sortIndex ?? a;
        const bSort = people.get(b)?.sortIndex ?? b;
        return aSort - bSort;
      })
      .forEach((personId, index) => {
        personX.set(personId, index * nominalCenterGap);
      });
  });

  const unionX = new Map();
  const getUnionCenterX = (union) => {
    const members = union.members || [];
    const centers = members.map((member) => personX.get(member.personId) ?? 0);
    if (!centers.length) return 0;

    if (members.length === 2) {
      const [first, second] = members;
      const firstCenter = personX.get(first.personId) ?? 0;
      const secondCenter = personX.get(second.personId) ?? 0;
      const firstWidth = personWidthById.get(first.personId) ?? options.personWidth;
      const secondWidth = personWidthById.get(second.personId) ?? options.personWidth;

      let leftCenter = firstCenter;
      let rightCenter = secondCenter;
      let leftWidth = firstWidth;
      let rightWidth = secondWidth;

      if (firstCenter > secondCenter) {
        leftCenter = secondCenter;
        rightCenter = firstCenter;
        leftWidth = secondWidth;
        rightWidth = firstWidth;
      }

      const innerLeftEdge = leftCenter + leftWidth / 2;
      const innerRightEdge = rightCenter - rightWidth / 2;
      return (innerLeftEdge + innerRightEdge) / 2;
    }

    return average(centers);
  };

  const seededGroupedChildLayout = buildGroupedChildLayout(
    unions,
    singleParentLinks,
    personGeneration,
    personX,
    unionX,
    personWidthById,
    personHeightById,
    people,
    options
  );

  seededGroupedChildLayout.positionOverrides.forEach((centerX, personId) => {
    personX.set(personId, centerX);
  });

  for (let i = 0; i < options.iterations; i += 1) {
    unions.forEach((union) => {
      unionX.set(union.id, getUnionCenterX(union));
    });

    generationKeys.forEach((generation) => {
      const personIds = generations.get(generation) || [];
      const desiredByPersonId = new Map();
      const pinnedByPersonId = new Map();
      const parentAnchorIdsByPerson = new Map();

      personIds.forEach((personId) => {
        const parentUnionIds = parentUnionsByPerson.get(personId) || [];
        const memberUnionIds = memberUnionsByPerson.get(personId) || [];
        const parentPersonIds = parentPeopleByPerson.get(personId) || [];
        const childPersonIds = childPeopleByPerson.get(personId) || [];

        parentAnchorIdsByPerson.set(personId, [
          ...parentUnionIds.map((unionId) => `u:${unionId}`),
          ...parentPersonIds.map((parentId) => `p:${parentId}`),
        ]);

        const parentTargets = parentUnionIds
          .map((unionId) => unionX.get(unionId))
          .concat(
            parentPersonIds
              .map((parentId) => personX.get(parentId))
              .filter((value) => Number.isFinite(value))
          )
          .filter((value) => Number.isFinite(value));
        const memberTargets = memberUnionIds
          .map((unionId) => unionX.get(unionId))
          .filter((value) => Number.isFinite(value));

        const current = personX.get(personId) ?? 0;
        const parentBias = parentTargets.length ? average(parentTargets) : current;
        const memberBias = memberTargets.length ? average(memberTargets) : current;
        const nextX = parentTargets.length && memberTargets.length
          ? parentBias + (memberBias - parentBias) * 0.25
          : parentTargets.length
          ? parentBias
          : memberBias;

        desiredByPersonId.set(personId, Number.isFinite(nextX) ? nextX : current);
        pinnedByPersonId.set(personId, parentUnionIds.length > 0 && memberTargets.length === 0);
      });

      const componentMap = componentsByGeneration.get(generation) || new Map();
      const orderedComponentIdsByPerson =
        orderedComponentIdsByGeneration.get(generation) || new Map();
      const compacted = compactGenerationIntoBlocks(
        personIds,
        componentMap,
        orderedComponentIdsByPerson,
        desiredByPersonId,
        pinnedByPersonId,
        parentAnchorIdsByPerson,
        nominalCenterGap,
        groupedSpanWidthByParentAnchor
      );

      personIds.forEach((personId) => {
        const x = compacted.get(personId) ?? (personX.get(personId) ?? 0);
        personX.set(personId, x);
      });

      const hasGroupedSpan = personIds.some((personId) => {
        const anchorIds = parentAnchorIdsByPerson.get(personId) || [];
        return anchorIds.some((anchorId) =>
          Number.isFinite(groupedSpanWidthByParentAnchor.get(anchorId))
        );
      });

      if (!hasGroupedSpan) {
        enforceCenterGapByWidth(personIds, personX, personWidthById, options.personGap);
      }
    });
  }

  unions.forEach((union) => {
    unionX.set(union.id, getUnionCenterX(union));
  });

  const generationHeight = new Map();

  generationKeys.forEach((generation) => {
    const personIds = generations.get(generation) || [];
    let maxHeight = options.personHeight;

    personIds.forEach((personId) => {
      const height = personHeightById.get(personId) ?? options.personHeight;
      personHeightById.set(personId, height);
      const yOffset = seededGroupedChildLayout.yOffsets.get(personId) ?? 0;
      maxHeight = Math.max(maxHeight, yOffset + height);
    });

    generationHeight.set(generation, maxHeight);
  });

  const generationTop = new Map();
  let cursorY = options.paddingY;
  generationKeys.forEach((generation) => {
    generationTop.set(generation, cursorY);
    cursorY += (generationHeight.get(generation) ?? options.personHeight) + options.generationGap;
  });

  const groupedChildLayout = buildGroupedChildLayout(
    unions,
    singleParentLinks,
    personGeneration,
    personX,
    unionX,
    personWidthById,
    personHeightById,
    people,
    options
  );

  groupedChildLayout.positionOverrides.forEach((centerX, personId) => {
    personX.set(personId, centerX);
  });

  const nodes = [];
  const edges = [];

  for (const personId of people.keys()) {
    const generation = personGeneration.get(personId) ?? 0;
    const width = personWidthById.get(personId) ?? options.personWidth;
    const centerX = personX.get(personId) ?? 0;
    const x = options.paddingX + centerX - width / 2;
    const y =
      (generationTop.get(generation) ?? options.paddingY) +
      (seededGroupedChildLayout.yOffsets.get(personId) ?? 0);
    const meta = people.get(personId);
    const annotations = personAnnotationsById.get(personId) || [];
    const height = personHeightById.get(personId) ?? options.personHeight;

    nodes.push({
      id: `person:${personId}`,
      type: "person",
      personId,
      generation,
      x,
      y,
      width,
      height,
      label: meta?.label || "?",
      annotations,
      kind: meta?.kind || "named",
    });
  }

  unions.forEach((union) => {
    const generation = unionGeneration.get(union.id) ?? 0;
    const centerX = options.paddingX + (unionX.get(union.id) ?? 0);
    const centerY =
      (generationTop.get(generation) ?? options.paddingY) +
      (generationHeight.get(generation) ?? options.personHeight) / 2 +
      options.unionOffsetY;

    const x = centerX - options.unionSize / 2;
    const y = centerY - options.unionSize / 2;

    nodes.push({
      id: `union:${union.id}`,
      type: "union",
      unionId: union.id,
      generation,
      x,
      y,
      width: options.unionSize,
      height: options.unionSize,
      annotationCount: (union.annotations || []).filter(Boolean).length,
      annotationLines: normalizeAnnotations(union.annotations || []),
    });

    (union.members || []).forEach((member) => {
      edges.push({
        id: `edge:member:${union.id}:${member.personId}`,
        type: "member",
        from: `person:${member.personId}`,
        to: `union:${union.id}`,
      });
    });

    (union.children || []).forEach((child) => {
      edges.push({
        id: `edge:child:${union.id}:${child.personId}`,
        type: "child",
        from: `union:${union.id}`,
        to: `person:${child.personId}`,
      });
    });
  });

  singleParentLinks.forEach((link) => {
    const parentId = link.parent?.personId;
    const childId = link.child?.personId;
    if (parentId == null || childId == null) return;

    edges.push({
      id: `edge:single-parent:${parentId}:${childId}`,
      type: "singleParent",
      from: `person:${parentId}`,
      to: `person:${childId}`,
    });
  });

  if (!nodes.length) {
    return {
      nodes,
      edges,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      generationCount: generationKeys.length,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach((node) => {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  });

  return {
    nodes,
    edges,
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    },
    generationCount: generationKeys.length,
  };
}
