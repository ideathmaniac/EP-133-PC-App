export function createMidiLiveEngine({ expand, getOutput, getChannel = () => 0, now = () => performance.now(), every = setInterval, cancel = clearInterval, onCursor = () => {}, onStop = () => {}, onError = () => {} }) {
  let timer = null, playing = false, output = null, channel = 0, epoch = 0;
  const used = new Set();
  function stop() {
    epoch++; if (timer !== null) cancel(timer); timer = null;
    if (output) { try { output.clear(); } catch {} for (const key of used) try { output.send([0x80 | channel, key, 0]); } catch {} }
    used.clear(); output = null; const wasPlaying = playing; playing = false; if (wasPlaying) onStop();
  }
  async function play(project, _buffers, { startTick = 0, endTick = project.bars * 1920, loop = false } = {}) {
    stop(); output = getOutput(); channel = getChannel();
    if (!output || output.state !== 'connected') { output = null; throw new Error('Подключите MIDI-выход EP-133'); }
    if (!Number.isInteger(channel) || channel < 0 || channel > 15) throw new Error('MIDI-канал: 1–16');
    if (!(endTick > startTick) || startTick < 0 || endTick > project.bars * 1920) throw new Error('Некорректный диапазон воспроизведения');
    const notes = expand(project).filter(note => note.start >= startTick && note.start < endTick);
    if (!notes.length) throw new Error('В выбранном диапазоне нет нот');
    const ms = 60000 / project.bpm / 480, duration = (endTick - startTick) * ms, events = [];
    for (const pad of [...new Set(notes.map(note => note.pad))]) {
      const lane = notes.filter(note => note.pad === pad).sort((a, b) => a.start - b.start);
      for (let i = 0; i < lane.length; i++) {
        const note = lane[i], key = 36 + note.pad, next = lane[i + 1]?.start ?? endTick;
        if (!Number.isInteger(note.pad) || note.pad < 0 || note.pad > 47 || note.velocity < 1 || note.velocity > 127 || note.duration <= 0) throw new Error('Некорректная MIDI-нота');
        events.push({ at: (note.start - startTick) * ms, key, on: true, velocity: note.velocity });
        events.push({ at: (Math.min(note.start + note.duration, next, endTick) - startTick) * ms, key, on: false, velocity: 0 });
      }
    }
    events.sort((a, b) => a.at - b.at || Number(a.on) - Number(b.on));
    const port = output, generation = epoch; await port.open(); if (generation !== epoch) return;
    const base = now() + 80; let cycle = 0, index = 0; playing = true;
    function update() {
      try {
        if (output.state !== 'connected') throw new Error('EP-133 отключён');
        const current = now(), horizon = current + 100;
        if (loop && current > base + (cycle + 1) * duration + 100) { cycle = Math.floor((current - base) / duration); index = 0; output.clear(); for (const key of used) output.send([0x80 | channel, key, 0]); }
        for (;;) {
          while (index < events.length && base + cycle * duration + events[index].at <= horizon) {
            const event = events[index++], at = base + cycle * duration + event.at;
            if (at < current - 100) continue;
            used.add(event.key); output.send([(event.on ? 0x90 : 0x80) | channel, event.key, event.velocity], Math.max(current, at));
          }
          if (loop && index === events.length && base + (cycle + 1) * duration <= horizon) { cycle++; index = 0; } else break;
        }
        const elapsed = Math.max(0, current - base); onCursor(startTick + (loop ? elapsed % duration : Math.min(elapsed, duration)) / ms);
        if (!loop && current >= base + duration + 10) stop();
      } catch (error) { stop(); onError(error); }
    }
    update(); if (playing) timer = every(update, 25);
  }
  return { play, stop, get playing() { return playing; } };
}
