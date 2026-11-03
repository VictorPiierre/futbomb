import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  QUIZ_BET_PENALTY, QUIZ_CATEGORIES, QUIZ_CATEGORY_IDS, QUIZ_CLOSE_BONUS, QUIZ_DIFFICULTIES, QUIZ_EXACT_BONUS,
  QUIZ_HIGHLOW_POINTS, QUIZ_MAX_PLAYERS, QUIZ_POINTS, QUIZ_SPECIALS, QUIZ_SUSPENSE_MS, QUIZ_TARGETS, QUIZ_TIMES,
  QUIZ_UNDERDOG_BONUS, QUIZ_UNDERDOG_PENALTY,
  formatQuizNumber, parseGuess,
  type QuizCategory, type QuizDifficulty, type QuizPublicRoom, type QuizResult, type QuizSettings,
} from '../../../shared/quiz';
import { emitAck, inviteLink, serverNow, socket, useSocketEvent } from '../net';
import { sfx } from '../sound';
import Avatar from './Avatar';
import { IconCopy, IconCrown, IconLink, IconSend, QuizMark } from './Icons';

interface Props {
  room: QuizPublicRoom;
  meId: string;
  isHost: boolean;
  onCopy: () => void;
}

// Último chute devolvido pelo servidor ao reconectar.
let mine: { number: number; guess: number | null; betting?: boolean } = { number: 0, guess: null };
socket.on('quiz:mine', (p: typeof mine) => (mine = p));

function useRemaining(endsAt: number | null) {
  const [ms, setMs] = useState(() => (endsAt ? Math.max(0, endsAt - serverNow()) : 0));
  useEffect(() => {
    const tick = () => setMs(endsAt ? Math.max(0, endsAt - serverNow()) : 0);
    tick();
    const id = window.setInterval(tick, 150);
    return () => clearInterval(id);
  }, [endsAt]);
  return ms;
}

const unitLabel = (unit: string) => (unit === 'ano' ? 'Responda com o ano' : unit ? `Resposta em ${unit}` : 'Responda com um número');

export default function QuizGame(props: Props) {
  const { room } = props;
  const prev = useRef(room.phase);
  useEffect(() => {
    if (room.phase === 'reveal' && prev.current === 'question') {
      const me = room.results?.find((r) => r.playerId === props.meId);
      // Tambor durante o suspense, depois o som do resultado.
      for (let i = 0; i < 9; i++) setTimeout(() => sfx.tick(i > 6), i * 220);
      setTimeout(() => {
        if (me?.closeness === 'exact') sfx.win();
        else if (me && me.points > 0) sfx.correct();
        else if (me && me.points < 0) sfx.explode();
        else sfx.pass();
      }, QUIZ_SUSPENSE_MS);
    }
    prev.current = room.phase;
  }, [room.phase, room.results, props.meId]);

  if (room.phase === 'lobby') return <QuizLobby {...props} />;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      {room.phase === 'question' ? <QuizQuestionView key={room.number} {...props} /> : <QuizReveal {...props} />}
      <QuizScoreboard room={room} meId={props.meId} />
    </div>
  );
}

// ---------- sala de espera ----------

function QuizLobby({ room, meId, isHost, onCopy }: Props) {
  const [error, setError] = useState('');
  const ready = room.players.filter((p) => p.connected).length;
  const amSpectator = room.spectators.some((s) => s.id === meId);
  const seatFree = room.players.length < room.settings.maxPlayers;

  async function start() {
    const res = await emitAck<{ ok: boolean; error?: string }>('game:start');
    setError(res.ok ? '' : (res.error ?? 'Erro ao iniciar.'));
  }

  return (
    <div className="pop-in grid gap-5 lg:grid-cols-[1fr_400px]">
      <section className="glass rounded-3xl p-5 sm:p-7">
        <p className="text-xs font-semibold tracking-wider text-muted uppercase">Sala de espera</p>
        <h1 className="font-display text-2xl sm:text-3xl">
          {room.players.length}/{room.settings.maxPlayers} jogadores
        </h1>
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {room.players.map((p) => (
            <div key={p.id} className={`pop-in flex items-center gap-2.5 rounded-2xl border p-2.5 ${p.id === meId ? 'border-spark/50 bg-spark/5' : 'border-line bg-panel/60'}`}>
              <div className="relative">
                <Avatar emoji={p.avatar} id={p.id} size={40} dim={!p.connected} />
                {p.id === room.hostId && (
                  <span className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-fire text-ink" title="Anfitrião">
                    <IconCrown width={11} />
                  </span>
                )}
              </div>
              <span className="min-w-0 truncate text-sm font-semibold">
                {p.name}
                {p.id === meId && <span className="text-muted"> (você)</span>}
              </span>
            </div>
          ))}
        </div>
        {room.spectators.length > 0 && <p className="mt-4 text-xs text-muted">👀 Assistindo: {room.spectators.map((s) => s.name).join(', ')}</p>}
        {amSpectator && (
          <button disabled={!seatFree} onClick={() => socket.emit('room:seat', true)} className="btn-secondary mt-4 px-4 text-sm">
            {seatFree ? 'Entrar como jogador' : 'Sala cheia — você está assistindo'}
          </button>
        )}

        <div className="mt-6 rounded-2xl border border-pop/30 bg-pop/10 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-pop-soft">
            <IconLink width={16} /> Convide seus amigos
          </p>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-ink/60 px-3 py-2.5 text-sm">{inviteLink(room.code)}</code>
            <button onClick={onCopy} className="btn-secondary flex items-center gap-1.5 px-4 text-sm">
              <IconCopy width={15} /> Copiar
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-panel/60 p-4 text-sm text-muted">
          <p className="mb-1 font-semibold text-white">Como funciona</p>
          Aparece uma pergunta de quantidade e todos chutam um número. Quem chegar mais perto leva{' '}
          <b className="text-white">{QUIZ_POINTS[0]}</b>, o segundo <b className="text-white">{QUIZ_POINTS[1]}</b> e o terceiro{' '}
          <b className="text-white">{QUIZ_POINTS[2]}</b> — mas quem errar feio não pontua. Muito perto dá{' '}
          <b className="text-spark">+{QUIZ_CLOSE_BONUS}</b> e na mosca <b className="text-spark">+{QUIZ_EXACT_BONUS}</b>. Cada um tem 2 fichas{' '}
          <b className="text-fire">🔥 Tô certo!</b> que dobram os pontos (ou tiram {QUIZ_BET_PENALTY} se errar). Aponte também o{' '}
          <b className="text-pop-soft">🫏 azarão</b> — quem vai ser o pior da rodada (+{QUIZ_UNDERDOG_BONUS} se acertar, -{QUIZ_UNDERDOG_PENALTY} se ele
          for o melhor). E fique de olho nas rodadas especiais: ⚡ relâmpago, ✖️2 dobrada e ⬆️⬇️ mais ou menos!
        </div>
      </section>

      <aside className="glass flex flex-col rounded-3xl p-5 sm:p-6">
        <h2 className="mb-4 font-display text-lg">Configurações</h2>
        <QuizSettingsPanel room={room} editable={isHost} />
        {!isHost && <p className="mt-3 text-xs text-muted">Somente o anfitrião ({room.hostName}) altera as configurações.</p>}
        <div className="mt-auto pt-6">
          {isHost ? (
            <>
              <button onClick={start} disabled={ready < 2} className="btn-primary w-full py-4 text-xl">
                Começar o Chutômetro
              </button>
              {ready < 2 && <p className="mt-2 text-center text-xs text-muted">Precisa de pelo menos 2 jogadores conectados.</p>}
            </>
          ) : (
            <div className="rounded-xl bg-panel-2 py-4 text-center text-sm text-muted">Aguardando {room.hostName} começar…</div>
          )}
          {error && <p className="slide-in mt-3 text-center text-sm text-danger">{error}</p>}
        </div>
      </aside>
    </div>
  );
}

export function QuizSettingsPanel({ room, editable }: { room: QuizPublicRoom; editable: boolean }) {
  const s = room.settings;
  const set = (patch: Partial<QuizSettings>) => editable && socket.emit('room:settings', patch);
  const toggle = (c: QuizCategory) => {
    const has = s.categories.includes(c);
    if (has && s.categories.length <= 1) return;
    set({ categories: has ? s.categories.filter((x) => x !== c) : [...s.categories, c] });
  };
  const chip = (on: boolean) => `chip ${on ? 'chip-on' : editable ? '' : 'opacity-60'}`;
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Categorias de perguntas</p>
        <div className="flex flex-wrap gap-1.5">
          {QUIZ_CATEGORY_IDS.map((c) => (
            <button key={c} disabled={!editable} onClick={() => toggle(c)} className={`${chip(s.categories.includes(c))} px-2.5 py-1.5 text-xs`}>
              {QUIZ_CATEGORIES[c].icon} {QUIZ_CATEGORIES[c].label}
            </button>
          ))}
        </div>
      </div>
      <Row label="Dificuldade">
        {(Object.keys(QUIZ_DIFFICULTIES) as QuizDifficulty[]).map((d) => (
          <button key={d} disabled={!editable} onClick={() => set({ difficulty: d })} className={`${chip(s.difficulty === d)} flex-1`} title={QUIZ_DIFFICULTIES[d].hint}>
            {QUIZ_DIFFICULTIES[d].label}
          </button>
        ))}
      </Row>
      <p className="-mt-3 text-[11px] text-muted">{QUIZ_DIFFICULTIES[s.difficulty].hint}</p>
      <Row label="Pontos para vencer">
        {QUIZ_TARGETS.map((t) => (
          <button key={t} disabled={!editable} onClick={() => set({ target: t })} className={`${chip(s.target === t)} flex-1`}>
            {t}
          </button>
        ))}
      </Row>
      <Row label="Tempo por pergunta">
        {QUIZ_TIMES.map((t) => (
          <button key={t} disabled={!editable} onClick={() => set({ questionTime: t })} className={`${chip(s.questionTime === t)} flex-1`}>
            {t}s
          </button>
        ))}
      </Row>
      <Row label="Máximo de jogadores">
        {QUIZ_MAX_PLAYERS.map((n) => (
          <button key={n} disabled={!editable || n < room.players.length} onClick={() => set({ maxPlayers: n })} className={`${chip(s.maxPlayers === n)} flex-1`}>
            {n}
          </button>
        ))}
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">{label}</p>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

function QuestionHeader({ room }: { room: QuizPublicRoom }) {
  const q = room.question!;
  const sp = q.special ? QUIZ_SPECIALS[q.special] : null;
  return (
    <div>
      {sp && (
        <div className="pop-in mb-3 flex items-center gap-2 rounded-2xl border border-fire/50 bg-fire/15 px-4 py-2.5">
          <span className="text-2xl">{sp.icon}</span>
          <span className="font-display text-lg text-fire">{sp.label}</span>
          <span className="text-sm text-muted">— {sp.text}</span>
        </div>
      )}
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-muted uppercase">
        Pergunta {room.number} · {QUIZ_CATEGORIES[q.cat].icon} {QUIZ_CATEGORIES[q.cat].label}
      </p>
      <h2 className="font-display text-2xl leading-tight sm:text-4xl">{q.q}</h2>
    </div>
  );
}

// ---------- pergunta ----------

function QuizQuestionView({ room, meId }: Props) {
  const q = room.question!;
  const remaining = useRemaining(room.endsAt);
  const total = room.settings.questionTime * 1000;
  const me = room.players.find((p) => p.id === meId);
  const playing = !!me && !me.left;
  const [text, setText] = useState('');
  const [sent, setSent] = useState<number | null>(() => (mine.number === room.number ? mine.guess : null));
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const highlow = q.special === 'highlow';
  const betting = !!me?.betting;
  const [pick, setPick] = useState<string | null>(null);
  const others = room.players.filter((p) => p.id !== meId && !p.left);

  async function choosePick(id: string) {
    const target = pick === id ? null : id;
    const res = await emitAck<{ ok: boolean; error?: string }>('quiz:pick', target);
    if (res.ok) setPick(target);
  }

  async function toggleBet() {
    const res = await emitAck<{ ok: boolean; error?: string }>('quiz:bet');
    if (!res.ok) setError(res.error ?? 'Não deu.');
  }

  async function choose(side: 'up' | 'down') {
    const res = await emitAck<{ ok: boolean; value?: number; error?: string }>('quiz:guess', side);
    if (res.ok) {
      setSent(res.value!);
      sfx.myTurn();
    } else setError(res.error ?? 'Não deu para enviar.');
  }
  const preview = parseGuess(text);
  const lastTick = useRef(0);

  useSocketEvent<typeof mine>('quiz:mine', (p) => {
    if (p.number === room.number) setSent(p.guess);
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const s = Math.ceil(remaining / 1000);
    if (s <= 5 && s > 0 && s !== lastTick.current) sfx.tick(s <= 2);
    lastTick.current = s;
  }, [remaining]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const res = await emitAck<{ ok: boolean; value?: number; error?: string }>('quiz:guess', text);
    if (res.ok) {
      setSent(res.value!);
      setError('');
      setText('');
      sfx.myTurn();
    } else {
      setError(res.error ?? 'Não deu para enviar.');
      sfx.wrong();
    }
  }

  return (
    <section className="glass rounded-3xl p-5 sm:p-7">
      <QuestionHeader room={room} />
      <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-panel-2">
        <div
          className={`h-full rounded-full transition-[width] duration-150 ${remaining < 5000 ? 'bg-danger' : 'bg-spark'}`}
          style={{ width: `${(remaining / total) * 100}%` }}
        />
      </div>
      <p className="mt-1 text-right font-display text-xl tabular-nums text-muted">{Math.ceil(remaining / 1000)}s</p>

      {playing && highlow ? (
        <div className="mt-4">
          <p className="text-center text-sm text-muted">A resposta é maior ou menor que…</p>
          <p className="my-2 text-center font-display text-5xl text-spark">
            {formatQuizNumber(q.reference!, q.unit)} <span className="text-lg text-muted">{q.unit !== 'ano' && q.unit}</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            {(['up', 'down'] as const).map((side) => {
              const on = sent === (side === 'up' ? 1 : -1);
              return (
                <button
                  key={side}
                  onClick={() => choose(side)}
                  className={`cursor-pointer rounded-2xl border-2 py-5 font-display text-2xl transition ${on ? 'border-ok bg-ok/20 text-ok' : 'border-line bg-panel-2 hover:border-spark/60'}`}
                >
                  {side === 'up' ? '⬆️ Maior' : '⬇️ Menor'}
                </button>
              );
            })}
          </div>
          {error && <p className="mt-2 text-center text-sm text-danger">{error}</p>}
        </div>
      ) : playing ? (
        <form onSubmit={submit} className="mt-4">
          <p className="mb-2 text-sm text-muted">{unitLabel(q.unit)}</p>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={text}
              inputMode="decimal"
              autoComplete="off"
              maxLength={30}
              onChange={(e) => setText(e.target.value)}
              placeholder={q.unit === 'ano' ? 'Ex.: 1969' : 'Ex.: 330, 1.500 ou 2 milhões'}
              className="min-w-0 flex-1 rounded-2xl border-2 border-spark/50 bg-panel-2 px-4 py-4 font-display text-3xl outline-none placeholder:font-sans placeholder:text-base placeholder:text-muted focus:border-spark focus:ring-4 focus:ring-spark/15"
            />
            <button disabled={!text.trim()} className="btn-primary flex items-center gap-2 rounded-2xl px-5">
              <IconSend width={18} /> <span className="hidden sm:inline">{sent === null ? 'Chutar' : 'Trocar'}</span>
            </button>
          </div>
          <div className="mt-2 min-h-[24px] text-sm">
            {text.trim() && preview !== null && (
              <span className="text-muted">
                = <b className="text-white">{formatQuizNumber(preview, q.unit)}</b> {q.unit !== 'ano' && q.unit}
              </span>
            )}
            {error && <span className="text-danger">{error}</span>}
          </div>
          {sent !== null && (
            <div className="pop-in mt-3 rounded-2xl border border-ok/40 bg-ok/10 px-4 py-3 text-center">
              Seu chute: <b className="font-display text-2xl text-ok">{formatQuizNumber(sent, q.unit)}</b> {q.unit !== 'ano' && q.unit}
              <p className="text-xs text-muted">Dá para trocar até o tempo acabar.</p>
            </div>
          )}
        </form>
      ) : (
        <p className="mt-5 rounded-xl bg-panel-2 p-3 text-center text-sm text-muted">Você está assistindo esta partida.</p>
      )}

      {playing && (
        <button
          type="button"
          onClick={toggleBet}
          disabled={!betting && (me?.bets ?? 0) <= 0}
          className={`mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 py-3 font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
            betting ? 'border-fire bg-fire/20 text-fire shadow-[0_0_30px_-8px_rgb(255_122_26/0.8)]' : 'border-line bg-panel-2 text-muted hover:border-fire/50'
          }`}
        >
          🔥 {betting ? 'Tô certo! (ficha ligada — dobra os pontos, -' + QUIZ_BET_PENALTY + ' se errar)' : `Usar ficha "Tô certo!" (${me?.bets ?? 0} restante${me?.bets === 1 ? '' : 's'})`}
        </button>
      )}

      {playing && others.length > 0 && (
        <div className="mt-4 rounded-2xl border border-line bg-panel-2/60 p-3">
          <p className="mb-2 text-sm font-semibold">
            🫏 Azarão da rodada <span className="font-normal text-muted">— quem vai ser o pior?</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {others.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => choosePick(p.id)}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border-2 py-1 pr-3 pl-1 text-sm transition ${
                  pick === p.id ? 'border-pop bg-pop/20 text-white' : 'border-line hover:border-pop/50'
                }`}
              >
                <Avatar emoji={p.avatar} id={p.id} size={24} /> {p.name}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Acertou quem foi o pior: +{QUIZ_UNDERDOG_BONUS}. Mas se ele for o melhor da rodada, você perde {QUIZ_UNDERDOG_PENALTY}.
          </p>
        </div>
      )}
    </section>
  );
}

// ---------- revelação ----------

function CountUp({ to, unit }: { to: number; unit: string }) {
  const [v, setV] = useState(unit === 'ano' ? Math.max(0, to - 60) : 0);
  useEffect(() => {
    const from = unit === 'ano' ? Math.max(0, to - 60) : 0;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      const eased = 1 - Math.pow(1 - k, 3);
      setV(from + (to - from) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, unit]);
  const shown = Number.isInteger(to) ? Math.round(v) : Math.round(v * 10) / 10;
  return <>{formatQuizNumber(shown, unit)}</>;
}

/** Régua com o chute de cada um e a resposta certa (escala logarítmica quando os números variam muito). */
function Ruler({ room, revealed }: { room: QuizPublicRoom; revealed: boolean }) {
  const q = room.question!;
  const answer = room.answer!;
  const results = (room.results ?? []).filter((r) => r.guess !== null);
  const player = (id: string) => room.players.find((p) => p.id === id);
  const values = [answer, ...results.map((r) => r.guess!)];
  const allPositive = values.every((v) => v > 0);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const useLog = allPositive && q.unit !== 'ano' && hi / lo > 30;
  const f = (v: number) => (useLog ? Math.log10(v) : v);
  const span = f(hi) - f(lo) || 1;
  const pos = (v: number) => (hi === lo ? 50 : 6 + ((f(v) - f(lo)) / span) * 88);
  // Empilha avatares que caem muito perto um do outro.
  const placed = results
    .map((r) => ({ r, x: pos(r.guess!) }))
    .sort((x, y) => x.x - y.x)
    .map((item, i, arr) => ({ ...item, row: i > 0 && item.x - arr[i - 1].x < 7 ? 1 : 0 }));
  for (let i = 1; i < placed.length; i++) if (placed[i].row && placed[i - 1].row && placed[i].x - placed[i - 1].x < 7) placed[i].row = 2;

  return (
    <div className="relative mt-5 h-36 select-none">
      <div className="absolute inset-x-[3%] top-[88px] h-1.5 rounded-full bg-panel-2" />
      {placed.map(({ r, x, row }) => {
        const p = player(r.playerId);
        return (
          <div key={r.playerId} className="pop-in absolute -translate-x-1/2 text-center" style={{ left: `${x}%`, top: 4 + row * 26 }}>
            {p && <Avatar emoji={p.avatar} id={p.id} size={30} />}
            <div className="mx-auto h-3 w-0.5 bg-muted/60" style={{ height: 52 - row * 26 }} />
          </div>
        );
      })}
      {revealed && (
        <div className="absolute -translate-x-1/2 text-center" style={{ left: `${pos(answer)}%`, top: 70, animation: 'pop-in 0.4s cubic-bezier(.2,.9,.3,1.3)' }}>
          <div className="mx-auto h-0 w-0 border-x-8 border-t-[14px] border-x-transparent border-t-spark" />
          <div className="mt-6 rounded-md bg-spark px-1.5 text-[11px] font-bold whitespace-nowrap text-ink">{formatQuizNumber(answer, q.unit)}</div>
        </div>
      )}
      <div className="absolute inset-x-[3%] top-[116px] flex justify-between text-[10px] text-muted">
        <span>{formatQuizNumber(lo, q.unit)}</span>
        {useLog && <span>escala log</span>}
        <span>{formatQuizNumber(hi, q.unit)}</span>
      </div>
    </div>
  );
}

const CLOSENESS: Record<NonNullable<QuizResult['closeness']>, { text: string; cls: string }> = {
  exact: { text: '🎯 na mosca!', cls: 'text-spark' },
  close: { text: '👌 muito perto!', cls: 'text-ok' },
  ok: { text: '', cls: 'text-muted' },
  far: { text: '😬 longe demais', cls: 'text-danger' },
};

function QuizReveal({ room, meId, isHost }: Props) {
  const q = room.question;
  const remaining = useRemaining(room.phase === 'reveal' ? room.endsAt : null);
  const [suspense, setSuspense] = useState(room.phase === 'reveal');
  const [shown, setShown] = useState(0);
  const player = (id: string) => room.players.find((p) => p.id === id);
  const medals = ['🥇', '🥈', '🥉'];
  const highlow = q?.special === 'highlow';
  // Revela do mais longe para o mais perto, deixando o vencedor por último.
  const ordered = [...(room.results ?? [])].sort((x, y) => (y.diff ?? (y.guess === null ? Infinity : 0)) - (x.diff ?? (x.guess === null ? Infinity : 0)) || x.points - y.points);

  useEffect(() => {
    if (!suspense) return;
    const t = setTimeout(() => setSuspense(false), QUIZ_SUSPENSE_MS);
    return () => clearTimeout(t);
  }, [suspense]);
  useEffect(() => {
    if (suspense || shown >= ordered.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), 420);
    return () => clearTimeout(t);
  }, [suspense, shown, ordered.length]);

  if (!q || room.answer === null) return <section />;
  const visible = room.phase === 'ended' ? ordered : ordered.slice(0, shown);
  const list = [...visible].sort((x, y) => (x.place ?? 99) - (y.place ?? 99) || y.points - x.points);

  return (
    <section className="glass rounded-3xl p-5 sm:p-7">
      <QuestionHeader room={room} />
      <div className="mt-5 rounded-2xl border border-spark/40 bg-spark/10 p-5 text-center">
        <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">Resposta certa</p>
        {suspense ? (
          <p className="font-display text-5xl text-muted sm:text-6xl">
            <span className="inline-block animate-bounce">🥁</span> …
          </p>
        ) : (
          <p className="pop-in font-display text-5xl text-spark sm:text-6xl">
            <CountUp to={room.answer} unit={q.unit} />
          </p>
        )}
        {q.unit && q.unit !== 'ano' && <p className="text-sm text-muted">{q.unit}</p>}
        {highlow && !suspense && (
          <p className="mt-1 text-sm text-muted">
            {room.answer > q.reference! ? '⬆️ Maior' : '⬇️ Menor'} que {formatQuizNumber(q.reference!, q.unit)}
          </p>
        )}
      </div>

      {!highlow && <Ruler room={room} revealed={!suspense} />}

      {!suspense && room.roundWorst && room.roundWorst.length > 0 && (
        <p className="pop-in mt-2 text-center text-sm">
          🫏 Azarão da rodada: <b className="text-pop-soft">{room.roundWorst.map((id) => player(id)?.name).join(', ')}</b>
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {list.map((r) => {
          const p = player(r.playerId);
          const cl = r.closeness ? CLOSENESS[r.closeness] : null;
          return (
            <li
              key={r.playerId}
              className={`slide-in flex items-center gap-3 rounded-2xl border p-3 ${r.playerId === meId ? 'border-pop/50' : 'border-line'} ${r.points > 0 ? 'bg-ok/5' : r.points < 0 ? 'bg-danger/10' : 'bg-panel-2/50'}`}
            >
              <span className="w-7 text-center text-xl">{!highlow && r.place && r.place <= 3 && r.points > 0 ? medals[r.place - 1] : !highlow && r.place ? `${r.place}º` : r.points > 0 ? '✅' : '—'}</span>
              {p && <Avatar emoji={p.avatar} id={p.id} size={34} />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {p?.name}
                  {r.playerId === meId && ' (você)'} {r.bet && <span title="Usou a ficha Tô certo!">🔥</span>}
                  {room.roundWorst?.includes(r.playerId) && <span className="ml-1 rounded bg-pop/20 px-1.5 text-[10px] font-bold text-pop-soft">🫏 AZARÃO</span>}
                </p>
                {r.pick && (
                  <p className={`text-[11px] ${r.pickPoints > 0 ? 'text-ok' : r.pickPoints < 0 ? 'text-danger' : 'text-muted'}`}>
                    apostou que {player(r.pick)?.name ?? '?'} seria o azarão
                    {r.pickPoints > 0 ? ` · acertou! +${r.pickPoints}` : r.pickPoints < 0 ? ` · foi o melhor! ${r.pickPoints}` : ''}
                  </p>
                )}
                <p className="text-xs text-muted">
                  {r.guess === null ? (
                    'não chutou'
                  ) : highlow ? (
                    <>escolheu <b className="text-white">{r.guess > 0 ? '⬆️ maior' : '⬇️ menor'}</b></>
                  ) : (
                    <>
                      chutou <b className="text-white">{formatQuizNumber(r.guess, q.unit)}</b>
                      {r.closeness !== 'exact' && <> · errou por {formatQuizNumber(Math.round(r.diff! * 10) / 10, q.unit === 'ano' ? '' : q.unit)}</>}
                      {cl?.text && <span className={cl.cls}> · {cl.text}</span>}
                    </>
                  )}
                </p>
              </div>
              <span className={`font-display text-xl ${r.points + r.pickPoints > 0 ? 'text-ok' : r.points + r.pickPoints < 0 ? 'text-danger' : 'text-muted'}`}>
                {r.points + r.pickPoints > 0 ? '+' : ''}
                {r.points + r.pickPoints}
              </span>
            </li>
          );
        })}
      </ul>

      {room.phase === 'reveal' && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-sm text-muted">Próxima pergunta em {Math.ceil(remaining / 1000)}s…</span>
          {isHost && !suspense && (
            <button onClick={() => socket.emit('quiz:next')} className="btn-primary px-5">
              Próxima →
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- placar ----------

function QuizScoreboard({ room, meId }: { room: QuizPublicRoom; meId: string }) {
  const rows = [...room.players].sort((a, b) => b.score - a.score);
  const target = room.settings.target;
  return (
    <aside className="glass h-fit rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wider text-muted uppercase">Placar</h3>
        <span className="text-xs text-muted">meta: {target} pts</span>
      </div>
      <ul className="space-y-2.5">
        {rows.map((p) => (
          <li key={p.id} className={p.left ? 'opacity-50' : ''}>
            <div className="flex items-center gap-2.5">
              <Avatar emoji={p.avatar} id={p.id} size={30} dim={!p.connected} />
              <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${p.id === meId ? 'text-spark' : ''}`}>{p.name}</span>
              {room.phase === 'question' && p.betting && <span className="text-xs" title="Usou a ficha Tô certo!">🔥</span>}
              {room.phase === 'question' && p.picked && <span className="text-xs" title="Escolheu um azarão">🫏</span>}
              {room.phase === 'question' && <span className="text-xs">{p.answered ? '✅' : '🤔'}</span>}
              {p.bets > 0 && <span className="text-[10px] text-muted" title="Fichas Tô certo! restantes">🔥×{p.bets}</span>}
              <span className="font-display text-lg tabular-nums">{p.score}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full rounded-full bg-spark transition-[width] duration-500" style={{ width: `${Math.min(100, (p.score / target) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-xs text-muted">
        <QuizMark className="h-4 w-4" /> 1º +{QUIZ_POINTS[0]} · 2º +{QUIZ_POINTS[1]} · 3º +{QUIZ_POINTS[2]} · perto +{QUIZ_CLOSE_BONUS} · mosca +{QUIZ_EXACT_BONUS} · ⬆️⬇️ +{QUIZ_HIGHLOW_POINTS}
      </p>
    </aside>
  );
}
