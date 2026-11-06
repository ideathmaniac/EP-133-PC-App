export function detectTransients(channels, sampleRate, { sensitivity = 1.5, minGap = 0.08, maxSlices = 12 } = {}) {
  if (!Array.isArray(channels) || !channels.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return [];
  const length = Math.min(...channels.map(channel => channel?.length || 0));
  if (!length) return [];
  const window = 256, hop = 128, energy = [];
  for (let start = 0; start < length; start += hop) {
    const end = Math.min(length, start + window); let total = 0;
    for (const channel of channels) for (let i = start; i < end; i++) total += Math.abs(channel[i] || 0);
    energy.push(total / ((end - start) * channels.length));
  }
  const novelty = energy.map((value, index) => Math.max(0, value - (energy[index - 1] || 0)));
  const mean = novelty.reduce((sum, value) => sum + value, 0) / novelty.length;
  const deviation = Math.sqrt(novelty.reduce((sum, value) => sum + (value - mean) ** 2, 0) / novelty.length);
  const threshold = mean + Math.max(0.1, sensitivity) * deviation, minimumSamples = Math.max(hop, minGap * sampleRate);
  const candidates = [];
  for (let index = 1; index < novelty.length - 1; index++) if (novelty[index] >= threshold && novelty[index] >= novelty[index - 1] && novelty[index] >= novelty[index + 1]) candidates.push({ sample: index * hop, strength: novelty[index] });
  const chosen = [];
  for (const candidate of candidates.sort((a, b) => b.strength - a.strength)) if (chosen.every(item => Math.abs(item.sample - candidate.sample) >= minimumSamples)) { chosen.push(candidate); if (chosen.length >= maxSlices - 1) break; }
  const boundaries = [0, ...chosen.map(item => item.sample).sort((a, b) => a - b), length];
  return boundaries.slice(0, -1).map((start, index) => ({ start: start / sampleRate, end: boundaries[index + 1] / sampleRate })).filter(slice => slice.end > slice.start);
}

export function snapSlicesToZeroCrossings(slices, channels, sampleRate, { radius = 0.012 } = {}) {
  if (!slices.length || !channels.length) return slices.map(slice => ({ ...slice }));
  const length = Math.min(...channels.map(channel => channel.length)), range = Math.max(1, Math.round(radius * sampleRate));
  const score = index => channels.reduce((sum, channel) => sum + Math.abs(channel[index] || 0), 0);
  const boundary = time => { const center = Math.max(1, Math.min(length - 2, Math.round(time * sampleRate))); let best = center, bestScore = score(center);
    for (let index = Math.max(1, center - range); index <= Math.min(length - 2, center + range); index++) { const crossing = channels.every(channel => (channel[index - 1] || 0) * (channel[index + 1] || 0) <= 0); const current = score(index) * (crossing ? .25 : 1); if (current < bestScore) { best = index; bestScore = current; } }
    return best / sampleRate;
  };
  const points = [slices[0].start, ...slices.slice(1).map(slice => boundary(slice.start)), slices.at(-1).end];
  for (let index = 1; index < points.length; index++) points[index] = Math.max(points[index], points[index - 1] + 1 / sampleRate);
  return points.slice(0, -1).map((start, index) => ({ start, end: points[index + 1] }));
}

export function findAudibleRange(channels, sampleRate, { threshold = .008, padding = .004 } = {}) {
  if (!channels.length) return null; const length = Math.min(...channels.map(channel => channel.length)); if (!length) return null;
  const loud = index => channels.some(channel => Math.abs(channel[index] || 0) >= threshold); let start = 0, end = length;
  while (start < length && !loud(start)) start++; while (end > start && !loud(end - 1)) end--;
  if (start === length) return null; const pad = Math.round(padding * sampleRate); return { start: Math.max(0, start - pad) / sampleRate, end: Math.min(length, end + pad) / sampleRate };
}
