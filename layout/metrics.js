import { average, normalizeAnnotations } from "./utils.js";

export function computePersonMetrics(meta, options, measureTextWidth) {
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

export function enforceCenterGapByWidth(personIds, centerByPersonId, widthByPersonId, gap) {
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
