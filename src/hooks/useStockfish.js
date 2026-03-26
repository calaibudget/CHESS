import { useRef, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// ELO → Stockfish UCI strength settings
// ---------------------------------------------------------------------------
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
// Parse Stockfish centipawn score from an "info" line.
// Returns score from the SIDE-TO-MOVE's perspective.
// ---------------------------------------------------------------------------
function parseScore(line) {
  const mate = line.match(/score mate (-?\d+)/);
  if (mate) {
    const m = parseInt(mate[1]);
    return m > 0 ? 30000 - m : -30000 - m;
  }
  const cp = line.match(/score cp (-?\d+)/);
  return cp ? parseInt(cp[1]) : null;
}

// ---------------------------------------------------------------------------
// Factory: create a Stockfish worker wrapper with a serial promise queue.
// ---------------------------------------------------------------------------
function makeWorker() {
  const worker      = new Worker('/stockfish-lite.js');
  const state       = {
    ready:       false,
    listenerFn:  null,
    queue:       Promise.resolve(),
    eloCache:    null,
  };

  worker.onmessage = (e) => {
    const line = typeof e.data === 'string' ? e.data : String(e.data);
    if (!state.ready && line === 'readyok') state.ready = true;
    state.listenerFn?.(line);
  };

  worker.postMessage('uci');
  worker.postMessage('isready');

  const send = (cmd) => worker.postMessage(cmd);

  const waitReady = () => new Promise(resolve => {
    if (state.ready) { resolve(); return; }
    const t = setInterval(() => { if (state.ready) { clearInterval(t); resolve(); } }, 50);
  });

  const stopAndDrain = () => new Promise(resolve => {
    state.listenerFn = (line) => {
      if (line.startsWith('bestmove')) { state.listenerFn = null; resolve(); }
    };
    send('stop');
    setTimeout(resolve, 80);
  });

  const enqueue = (job) => {
    state.queue = state.queue
      .then(waitReady)
      .then(job)
      .catch(() => null);
    return state.queue;
  };

  // Raw UCI search (runs inside enqueue)
  const _search = (fen, { movetime, depth, multiPV = 1 }) => new Promise(resolve => {
    const scores = {}; // pv index → last score
    state.listenerFn = (line) => {
      if (line.startsWith('info')) {
        const pvMatch = line.match(/\smultipv\s+(\d+)/);
        const pvIdx   = pvMatch ? parseInt(pvMatch[1]) : 1;
        const s = parseScore(line);
        if (s !== null) scores[pvIdx] = s;
      }
      if (line.startsWith('bestmove')) {
        state.listenerFn = null;
        const turn = fen.split(' ')[1];
        // Convert all scores to White POV
        const toWhitePOV = (s) => turn === 'w' ? s : -s;
        resolve({
          uciMove: line.split(' ')[1],
          scoreCp: toWhitePOV(scores[1] ?? 0),
          secondCp: multiPV >= 2
            ? toWhitePOV(scores[2] ?? scores[1] ?? 0)
            : null,
        });
      }
    };
    if (multiPV > 1) send(`setoption name MultiPV value ${multiPV}`);
    send(`position fen ${fen}`);
    if (depth)    send(`go depth ${depth}`);
    else          send(`go movetime ${movetime}`);
  });

  const configureElo = (elo) => {
    if (state.eloCache === elo) return;
    state.eloCache = elo;
    applyEloSettings(send, elo);
  };

  return { send, enqueue, stopAndDrain, _search, configureElo, state,
           terminate: () => { worker.postMessage('quit'); worker.terminate(); } };
}

// ---------------------------------------------------------------------------
// useStockfish
// Exposes two workers: one for game (AI/eval/hints) and one for analysis
// (background quality classification that uses MultiPV 2).
// ---------------------------------------------------------------------------
export function useStockfish() {
  const gameRef     = useRef(null);  // game worker
  const analysisRef = useRef(null);  // analysis worker

  useEffect(() => {
    gameRef.current     = makeWorker();
    analysisRef.current = makeWorker();
    return () => {
      gameRef.current?.terminate();
      analysisRef.current?.terminate();
    };
  }, []);

  // ── Game worker API ───────────────────────────────────────────────────────

  const findBestMove = useCallback((fen, elo) => {
    const w = gameRef.current;
    if (!w) return Promise.resolve(null);
    return w.enqueue(async () => {
      await w.stopAndDrain();
      w.configureElo(elo);
      const moveTime = elo <= 800 ? 200 : elo <= 1400 ? 500 : 800;
      const { uciMove } = await w._search(fen, { movetime: moveTime });
      return uciMove && uciMove !== '(none)' ? uciMove : null;
    });
  }, []);

  const evaluatePosition = useCallback((fen, depth = 12) => {
    const w = gameRef.current;
    if (!w) return Promise.resolve(0);
    return w.enqueue(async () => {
      await w.stopAndDrain();
      const { scoreCp } = await w._search(fen, { depth });
      return scoreCp;
    });
  }, []);

  const getHint = useCallback((fen) => {
    const w = gameRef.current;
    if (!w) return Promise.resolve(null);
    return w.enqueue(async () => {
      await w.stopAndDrain();
      // Full strength for hints — reset ELO cache so next findBestMove reconfigures
      w.state.eloCache = null;
      w.send('setoption name UCI_LimitStrength value false');
      w.send('setoption name Skill Level value 20');
      const { uciMove } = await w._search(fen, { movetime: 400 });
      return uciMove && uciMove !== '(none)' ? uciMove : null;
    });
  }, []);

  // ── Analysis worker API ───────────────────────────────────────────────────

  // Returns { bestCp, secondCp } both from White's POV
  const evaluateWithMultiPV = useCallback((fen) => {
    const w = analysisRef.current;
    if (!w) return Promise.resolve({ bestCp: 0, secondCp: 0 });
    return w.enqueue(async () => {
      await w.stopAndDrain();
      const { scoreCp, secondCp } = await w._search(fen, { depth: 10, multiPV: 2 });
      return { bestCp: scoreCp, secondCp: secondCp ?? scoreCp };
    });
  }, []);

  return { findBestMove, evaluatePosition, getHint, evaluateWithMultiPV };
}
