import { useRef, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// ELO → Stockfish UCI strength settings
// Stockfish's UCI_LimitStrength floor is ~1320 ELO.
// Below that, use Skill Level (0–20).
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
// useStockfish
// Uses a promise queue so only one UCI operation runs at a time, avoiding
// listener cross-talk between concurrent calls.
// ---------------------------------------------------------------------------
export function useStockfish() {
  const workerRef   = useRef(null);
  const readyRef    = useRef(false);
  const queueRef    = useRef(Promise.resolve()); // serialisation chain
  const eloRef      = useRef(null);
  const listenerRef = useRef(null);              // current active line handler

  useEffect(() => {
    const worker = new Worker('/stockfish-lite.js');
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      if (!readyRef.current && line === 'readyok') {
        readyRef.current = true;
      }
      listenerRef.current?.(line);
    };

    worker.postMessage('uci');
    worker.postMessage('isready');

    return () => { worker.postMessage('quit'); worker.terminate(); };
  }, []);

  const send = (cmd) => workerRef.current?.postMessage(cmd);

  // Wait until Stockfish has signalled readyok
  const waitReady = () => new Promise(resolve => {
    if (readyRef.current) { resolve(); return; }
    const check = setInterval(() => {
      if (readyRef.current) { clearInterval(check); resolve(); }
    }, 50);
  });

  // Enqueue a job — runs sequentially, never concurrently
  const enqueue = useCallback((job) => {
    queueRef.current = queueRef.current
      .then(waitReady)
      .then(job)
      .catch(() => null);   // swallow errors so the queue keeps draining
    return queueRef.current;
  }, []);

  // Stop any running search and drain the resulting bestmove response
  const stopAndDrain = () => new Promise(resolve => {
    listenerRef.current = (line) => {
      if (line.startsWith('bestmove')) {
        listenerRef.current = null;
        resolve();
      }
    };
    send('stop');
    // Stockfish might not send bestmove if nothing was running — guard with timeout
    setTimeout(resolve, 80);
  });

  // Core UCI search — assumes it's running inside enqueue()
  const _runSearch = (fen, timeoutMs, depth) => new Promise(resolve => {
    let lastScore = 0;
    listenerRef.current = (line) => {
      if (line.startsWith('info')) {
        const s = parseScore(line);
        if (s !== null) lastScore = s;
      }
      if (line.startsWith('bestmove')) {
        listenerRef.current = null;
        const turn = fen.split(' ')[1];
        resolve({ uciMove: line.split(' ')[1], scoreCp: turn === 'w' ? lastScore : -lastScore });
      }
    };
    send(`position fen ${fen}`);
    if (depth) send(`go depth ${depth}`);
    else       send(`go movetime ${timeoutMs}`);
  });

  // Apply ELO (idempotent on same value)
  const configureElo = (elo) => {
    if (eloRef.current === elo) return;
    eloRef.current = elo;
    applyEloSettings(send, elo);
  };

  // ── Public API ─────────────────────────────────────────────────────────────

  const findBestMove = useCallback((fen, elo) => {
    return enqueue(async () => {
      await stopAndDrain();
      configureElo(elo);
      const moveTime = elo <= 800 ? 200 : elo <= 1400 ? 500 : 800;
      const { uciMove } = await _runSearch(fen, moveTime, null);
      return uciMove && uciMove !== '(none)' ? uciMove : null;
    });
  }, [enqueue]);  // eslint-disable-line react-hooks/exhaustive-deps

  const evaluatePosition = useCallback((fen, depth = 12) => {
    return enqueue(async () => {
      await stopAndDrain();
      const { scoreCp } = await _runSearch(fen, null, depth);
      return scoreCp;
    });
  }, [enqueue]);  // eslint-disable-line react-hooks/exhaustive-deps

  // For quality classification — lightweight depth-10 eval
  const evaluateForQuality = useCallback((fen) => {
    return enqueue(async () => {
      await stopAndDrain();
      const { scoreCp } = await _runSearch(fen, null, 10);
      return scoreCp;
    });
  }, [enqueue]);  // eslint-disable-line react-hooks/exhaustive-deps

  const getHint = useCallback((fen) => {
    return enqueue(async () => {
      await stopAndDrain();
      // Reset to full strength for hint
      eloRef.current = null;
      send('setoption name UCI_LimitStrength value false');
      send('setoption name Skill Level value 20');
      const { uciMove } = await _runSearch(fen, 400, null);
      return uciMove && uciMove !== '(none)' ? uciMove : null;
    });
  }, [enqueue]);  // eslint-disable-line react-hooks/exhaustive-deps

  return { findBestMove, evaluatePosition, evaluateForQuality, getHint };
}
