import { average } from "./utils.js";

export function getChildGroupColumnCount(childCount, options) {
  if (childCount < options.childGroupThreshold) {
    return null;
  }

  return Math.max(
    2,
    Math.min(options.childGroupMaxColumns, Math.ceil(Math.sqrt(childCount)))
  );
}

export function computeChildGroupSpanWidth(childIds, personWidthById, options) {
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

export function buildGroupedChildLayout(
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
