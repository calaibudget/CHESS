import { useRef, useEffect, useCallback } from 'react';

const ELO_SKILL_LEVEL = { 400: 0, 600: 0, 800: 1, 1000: 3, 1200: 5 };

function applyEloSettings(send, elo) {
  if (elo >= 1320) {
    send('setoption name UCI_LimitStrength value true');
    send(`setoption name UCI_Elo value ${Math.min(2850, elo)}`);
    send('setoption name Skill Level value 20');
  } else {
    send('setoption name UCI_LimitStrength value false');
    send(`setoption name Skill Level value ${ELO_SKILL_LEVEL[elo] ?? 0}`);
  }
}

// ---------------------------------------------------------------------------
// Build a serialized Stockfish worker with hard timeouts on every operation.
// ---------------------------------------------------------------------------
function makeWorker() {
  let worker;
  try { worker = new Worker('/stockfish-lite.js'); }
  catch (e) {
    console.error('[Stockfish] Worker constructor failed:', e);
    return null; // caller must handle null
  }

  const state = {
    ready:       false,
    unavailable: false,
    listenerFn:  null,
    queue:       Promise.resolve(),
    eloCache:    null,
  };

  worker.onerror = (e) => {
    console.error('[Stockfish] worker error:', e.message || e);
    state.unavailable = true;
    state.ready = false;
  };

  worker.onmessage = (ev) => {
    const line = typeof ev.data === 'string' ? ev.data : String(ev.data);
    if (!state.ready && line === 'readyok') state.ready = true;
    if (state.listenerFn) state.listenerFn(line);
  };

  worker.postMessage('uci');
  worker.postMessage('isready');

  // If not ready in 8s, mark engine unavailable so the queue drains gracefully.
  setTimeout(() => {
    if (!state.ready && !state.unavailable) {
      console.warn('[Stockfish] readyok never received — marking unavailable');
      state.unavailable = true;
    }
  }, 8000);

  const send = (cmd) => { try { worker.postMessage(cmd); } catch (_) {} };

  // Returns rejected promise if engine unavailable, otherwise resolves when ready.
  const waitReady = () => new Promise((resolve, reject) => {
    if (state.ready)       { resolve();                          return; }
    if (state.unavailable) { reject(new Error('unavailable'));   return; }
    const iv = setInterval(() => {
      if (state.ready)       { clearInterval(iv); resolve(); }
      else if (state.unavailable) { clearInterval(iv); reject(new Error('unavailable')); }
    }, 50);
    setTimeout(() => { clearInterval(iv); reject(new Error('ready_timeout')); }, 8000);
  });

  // Send `stop`, wait for bestmove acknowledgment (max 500ms).
  const stopAndDrain = () => new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; state.listenerFn = null; resolve(); } };
    state.listenerFn = (line) => { if (line.startsWith('bestmove')) finish(); };
    send('stop');
    setTimeout(finish, 500);
  });

  // Serial job queue.  Each job runs after the previous one finishes (or errors).
  const enqueue = (job) => {
    const p = state.queue
      .then(() => waitReady())
      .then(job)
      .catch((err) => { console.warn('[Stockfish] queue job error:', err?.message); return null; });
    // Advance the queue regardless of success/failure.
    state.queue = p.then(() => {}, () => {});
    return p;
  };

  // UCI search — resolves or REJECTS on timeout so the queue moves on.
  const _search = (fen, { movetime, depth, multiPV = 1 }) => new Promise((resolve, reject) => {
    const scores = {};
    // Upper-bound timeout: movetime * 4 + 2s, or depth * 400ms + 3s
    const maxMs = movetime ? movetime * 4 + 2000 : (depth || 10) * 400 + 3000;

    const timer = setTimeout(() => {
      console.warn('[Stockfish] _search timeout after', maxMs, 'ms');
      state.listenerFn = null;
      send('stop');
      reject(new Error('search_timeout'));
    }, maxMs);

    state.listenerFn = (line) => {
      if (line.startsWith('info')) {
        const pvIdx = parseInt((line.match(/\smultipv\s+(\d+)/) || [, '1'])[1]);
        const mate  = line.match(/score mate (-?\d+)/);
        const cp    = line.match(/score cp (-?\d+)/);
        if (mate) {
          const m = parseInt(mate[1]);
          scores[pvIdx] = m > 0 ? 30000 - m : -30000 - m;
        } else if (cp) {
          scores[pvIdx] = parseInt(cp[1]);
        }
      }
      if (line.startsWith('bestmove')) {
        clearTimeout(timer);
        state.listenerFn = null;
        const turn = fen.split(' ')[1];
        const toW  = (s) => turn === 'w' ? s : -s;
        resolve({
          uciMove:  line.split(' ')[1],
          scoreCp:  toW(scores[1] ?? 0),
          secondCp: multiPV >= 2 ? toW(scores[2] ?? scores[1] ?? 0) : null,
        });
      }
    };

    // Reset/set MultiPV each time so searches don't bleed settings
    send(`setoption name MultiPV value ${multiPV}`);
    send(`position fen ${fen}`);
    if (depth)    send(`go depth ${depth}`);
    else          send(`go movetime ${movetime}`);
  });

  const configureElo = (elo) => {
    if (state.eloCache === elo) return;
    state.eloCache = elo;
    applyEloSettings(send, elo);
  };

  return {
    send, enqueue, stopAndDrain, _search, configureElo, state,
    terminate: () => { try { send('quit'); } catch (_) {} try { worker.terminate(); } catch (_) {} },
  };
}

// ---------------------------------------------------------------------------
// useStockfish
//
// FIX for "Thinking…" freeze:
//   • gameRef   → only AI moves + hints  (never blocked by eval)
//   • analysisRef → eval bar + quality classification (separate queue)
//
// Both workers have per-operation timeouts so a crashed/unresponsive WASM
// never permanently blocks the queue.
// ---------------------------------------------------------------------------
export function useStockfish() {
  const gameRef     = useRef(null);
  const analysisRef = useRef(null);

  useEffect(() => {
    gameRef.current     = makeWorker();
    analysisRef.current = makeWorker();
    return () => {
      gameRef.current?.terminate();
      analysisRef.current?.terminate();
    };
  }, []);

  // ── Game worker: AI moves ─────────────────────────────────────────────────

  const findBestMove = useCallback((fen, elo) => {
    const w = gameRef.current;
    if (!w || w.state.unavailable) return Promise.resolve(null);

    // Hard 5s wrapper so isThinking never sticks even if the queue deadlocks.
    return new Promise((resolve) => {
      const hardTimeout = setTimeout(() => {
        console.warn('[findBestMove] hard timeout — returning null for fallback');
        resolve(null);
      }, 5000);

      w.enqueue(async () => {
        await w.stopAndDrain();
        w.configureElo(elo);
        const moveTime = elo <= 800 ? 200 : elo <= 1400 ? 500 : 800;
        const { uciMove } = await w._search(fen, { movetime: moveTime });
        clearTimeout(hardTimeout);
        resolve(uciMove && uciMove !== '(none)' ? uciMove : null);
      }).catch(() => { clearTimeout(hardTimeout); resolve(null); });
    });
  }, []);

  // ── Game worker: hints ────────────────────────────────────────────────────

  const getHint = useCallback((fen) => {
    const w = gameRef.current;
    if (!w || w.state.unavailable) return Promise.resolve(null);

    return new Promise((resolve) => {
      const hardTimeout = setTimeout(() => resolve(null), 5000);

      w.enqueue(async () => {
        await w.stopAndDrain();
        w.state.eloCache = null; // reset so next findBestMove re-applies ELO
        w.send('setoption name UCI_LimitStrength value false');
        w.send('setoption name Skill Level value 20');
        const { uciMove } = await w._search(fen, { movetime: 400 });
        clearTimeout(hardTimeout);
        resolve(uciMove && uciMove !== '(none)' ? uciMove : null);
      }).catch(() => { clearTimeout(hardTimeout); resolve(null); });
    });
  }, []);

  // ── Analysis worker: eval bar (cosmetic, never blocks game flow) ──────────

  const evaluatePosition = useCallback((fen, depth = 10) => {
    const w = analysisRef.current;
    if (!w || w.state.unavailable) return Promise.resolve(0);
    return w.enqueue(async () => {
      await w.stopAndDrain();
      const { scoreCp } = await w._search(fen, { depth });
      return scoreCp ?? 0;
    });
  }, []);

  // ── Analysis worker: quality classification (MultiPV 2) ──────────────────

  const evaluateWithMultiPV = useCallback((fen) => {
    const w = analysisRef.current;
    if (!w || w.state.unavailable) return Promise.resolve({ bestCp: 0, secondCp: 0 });
    return w.enqueue(async () => {
      await w.stopAndDrain();
      const { scoreCp, secondCp } = await w._search(fen, { depth: 10, multiPV: 2 });
      return { bestCp: scoreCp ?? 0, secondCp: secondCp ?? scoreCp ?? 0 };
    });
  }, []);

  return { findBestMove, evaluatePosition, getHint, evaluateWithMultiPV };
}
